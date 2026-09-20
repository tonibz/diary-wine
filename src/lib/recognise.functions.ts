import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { captureServerError } from "@/lib/sentry.server";

const Input = z.object({
  photoPath: z.string().min(1),
  backPhotoPath: z.string().min(1).optional().nullable(),
});

export type RecognitionData = {
  name: string | null;
  producer: string | null;
  appellation: string | null;
  /** ageing/quality term printed on the label — never part of the appellation */
  classification: string | null;
  region: string | null;
  country: string | null;
  vintage: number | null;
  wine_type: string | null;
  grapes: string[];
  alcohol_percent: number | null;
  confidence: number;
  inferred_fields: string[];
};


export type RecognitionResult =
  | { ok: true; data: RecognitionData; recognition_id: string }
  | { ok: false; error: string; recognition_id?: string };

const MODEL_NAME = "claude-sonnet-5";

const RECOGNISE_PROMPT = `You are reading a photograph of a wine bottle label. Return ONLY a JSON object, with no prose and no markdown code fences.

You may be given two photographs: the front label and the back label. Read both. Back labels often carry the alcohol percentage, the grape varieties, and importer or bottling details that the front label omits. Combine what you find. If the two disagree, prefer the back label for technical details such as alcohol percentage and grape varieties, and the front label for the wine name and producer.

Fields:
- name: the wine's name as printed
- producer: the winery or estate
- appellation: the denomination of origin, for example Corton-Charlemagne, Rioja, Chianti Classico
- classification: the ageing or quality classification, or null
- region: the wider wine region
- country
- vintage: integer year, or null
- wine_type: one of red, white, rose, sparkling, dessert, fortified
- grapes: array of grape varieties
- alcohol_percent: number or null
- confidence: number from 0 to 1
- inferred_fields: array naming any field you filled in from knowledge of the appellation rather than reading it off the label

The appellation is the legally defined origin printed on the label, such as Chianti Classico, Rioja, Chablis, Brunello di Montalcino, Napa Valley. It is not the producer's slogan, not a marketing phrase, and not a range name.

Do not include ageing or quality classifications in the appellation. Riserva, Reserva, Gran Reserva, Grand Cru, Premier Cru, Superiore and Classico Riserva are separate from the appellation name. Return 'Chianti Classico', not 'Chianti Classico Riserva'.

Return the classification separately in the field 'classification', for example 'Riserva', 'Grand Cru', 'Gran Reserva', or null.

If no appellation is printed, return null rather than substituting a region or a phrase from the label.

Rules. If something is not legible on the label, return null instead of guessing. Many European labels never print the colour or the grape, so you may infer those from the appellation, but you must list every field you inferred in inferred_fields. Set confidence low when the photo is blurred, badly lit, cropped, or the label is at a steep angle.`;

/** Web Crypto only — this runs on the Cloudflare Workers runtime, not Node. */
async function sha256Hex(input: ArrayBuffer | Uint8Array | string): Promise<string> {
  const data = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest("SHA-256", data as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function isValidRecognition(v: unknown): v is RecognitionData {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const d = v as Record<string, unknown>;
  return (
    typeof d.name === "string" ||
    typeof d.producer === "string" ||
    typeof d.appellation === "string" ||
    typeof d.region === "string" ||
    typeof d.country === "string" ||
    typeof d.vintage === "number" ||
    typeof d.wine_type === "string" ||
    Array.isArray(d.grapes)
  );
}

export const recogniseLabel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => Input.parse(v))
  .handler(async ({ data, context }): Promise<RecognitionResult> => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return { ok: false, error: "ANTHROPIC_API_KEY is not configured" };
    }
    const { supabase, userId } = context;

    // Download image bytes via authenticated storage client
    const dl = await supabase.storage.from("wine-photos").download(data.photoPath);
    if (dl.error || !dl.data) {
      return { ok: false, error: "Could not read the uploaded photo" };
    }
    const arrayBuf = await dl.data.arrayBuffer();
    const b64 = Buffer.from(arrayBuf).toString("base64");
    const mediaType = dl.data.type || "image/jpeg";

    let backB64: string | null = null;
    let backMedia = "image/jpeg";
    let backArrayBuf: ArrayBuffer | null = null;
    if (data.backPhotoPath) {
      const dlBack = await supabase.storage.from("wine-photos").download(data.backPhotoPath);
      if (!dlBack.error && dlBack.data) {
        backArrayBuf = await dlBack.data.arrayBuffer();
        backB64 = Buffer.from(backArrayBuf).toString("base64");
        backMedia = dlBack.data.type || "image/jpeg";
      }
    }

    const modelName = MODEL_NAME;
    const prompt = RECOGNISE_PROMPT;

    // Cache key = photo bytes + model + prompt. Every cache step is best-effort:
    // a cache problem must never surface as an error to the user.
    let imageHash: string | null = null;
    let backImageHash: string | null = null;
    let promptHash: string | null = null;
    try {
      imageHash = await sha256Hex(arrayBuf);
      if (backArrayBuf) backImageHash = await sha256Hex(backArrayBuf);
      promptHash = (await sha256Hex(prompt)).slice(0, 16);
    } catch {
      imageHash = null;
      promptHash = null;
    }

    if (imageHash && promptHash) {
      try {
        let q = supabase
          .from("recognition_cache")
          .select("id, result, hit_count")
          .eq("image_hash", imageHash)
          .eq("model_name", modelName)
          .eq("prompt_hash", promptHash);
        q = backImageHash
          ? q.eq("back_image_hash", backImageHash)
          : q.is("back_image_hash", null);
        const { data: cached } = await q.maybeSingle();

        if (cached && isValidRecognition(cached.result)) {
          const result = cached.result as RecognitionData;

          // Shared counter: server credentials only, and never blocking.
          try {
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            await supabaseAdmin
              .from("recognition_cache")
              .update({ hit_count: (cached.hit_count ?? 0) + 1 })
              .eq("id", cached.id);
          } catch (e) {
            await captureServerError(e, { where: "recognition_cache.hit_count" });
          }

          const { data: hitRow } = await supabase
            .from("recognitions")
            .insert({
              user_id: userId,
              photo_path: data.photoPath,
              model_name: modelName,
              raw_response: null,
              cache_hit: true,
              inferred_fields: (result.inferred_fields ?? null) as never,
              confidence: result.confidence ?? null,
            })
            .select("id")
            .single();

          return { ok: true, data: result, recognition_id: hitRow?.id ?? "" };
        }
      } catch (e) {
        // Read failure: carry on and ask the model.
        await captureServerError(e, { where: "recognition_cache.lookup" });
      }
    }

    const content: Array<Record<string, unknown>> = [
      { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } },
    ];
    if (backB64) {
      content.push({ type: "image", source: { type: "base64", media_type: backMedia, data: backB64 } });
    }
    content.push({ type: "text", text: prompt });

    let raw: unknown = null;
    let parsed: RecognitionData | null = null;
    let errText: string | null = null;
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: modelName,
          max_tokens: 1000,
          messages: [{ role: "user", content }],
        }),
      });
      raw = await res.json();
      if (!res.ok) {
        errText = `Anthropic returned ${res.status}`;
      } else {
        const text = (raw as { content?: Array<{ type: string; text?: string }> })?.content?.find(
          (b) => b.type === "text",
        )?.text ?? "";
        const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
        try {
          parsed = JSON.parse(cleaned);
        } catch {
          errText = "Model response was not valid JSON";
        }
      }
    } catch (e) {
      errText = e instanceof Error ? e.message : "Network error";
    }

    // Only ever cache a cleanly parsed, non-empty result — never errors.
    if (parsed && isValidRecognition(parsed) && imageHash && promptHash) {
      try {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        await supabaseAdmin.from("recognition_cache").insert({
          image_hash: imageHash,
          back_image_hash: backImageHash,
          model_name: modelName,
          prompt_hash: promptHash,
          result: parsed as never,
        });
      } catch (e) {
        await captureServerError(e, { where: "recognition_cache.write" });
      }
    }

    // Log recognition row regardless
    const { data: recRow } = await supabase
      .from("recognitions")
      .insert({
        user_id: userId,
        photo_path: data.photoPath,
        model_name: modelName,
        raw_response: raw as never,
        cache_hit: false,
        inferred_fields: (parsed?.inferred_fields ?? null) as never,
        confidence: parsed?.confidence ?? null,
      })
      .select("id")
      .single();

    if (errText || !parsed) {
      return { ok: false, error: errText ?? "Unknown error", recognition_id: recRow?.id };
    }
    return { ok: true, data: parsed, recognition_id: recRow?.id ?? "" };
  });
