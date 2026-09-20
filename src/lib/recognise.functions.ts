import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

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

/** Web Crypto only — this runs on the Cloudflare Workers runtime, not Node. */
async function sha256Hex(bytes: ArrayBuffer | Uint8Array | string): Promise<string> {
  const data =
    typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  const digest = await crypto.subtle.digest("SHA-256", data as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function isValidRecognition(v: unknown): v is RecognitionData {
  if (!v || typeof v !== "object") return false;
  const d = v as Record<string, unknown>;
  const hasAnyField =
    typeof d.name === "string" ||
    typeof d.producer === "string" ||
    typeof d.appellation === "string" ||
    typeof d.region === "string" ||
    typeof d.country === "string" ||
    typeof d.vintage === "number" ||
    typeof d.wine_type === "string" ||
    Array.isArray(d.grapes);
  return hasAnyField;
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
    if (data.backPhotoPath) {
      const dlBack = await supabase.storage.from("wine-photos").download(data.backPhotoPath);
      if (!dlBack.error && dlBack.data) {
        backB64 = Buffer.from(await dlBack.data.arrayBuffer()).toString("base64");
        backMedia = dlBack.data.type || "image/jpeg";
      }
    }

    const modelName = MODEL_NAME;
    const prompt = RECOGNISE_PROMPT;

    // Cache key: bytes of the photos + model + prompt. A cache failure must never
    // break recognition, so every step below is best-effort.
    let imageHash: string | null = null;
    let backImageHash: string | null = null;
    let promptHash: string | null = null;
    try {
      imageHash = await sha256Hex(arrayBuf);
      if (backArrayBuf) backImageHash = await sha256Hex(backArrayBuf);
      promptHash = (await sha256Hex(prompt)).slice(0, 16);
    } catch {
      imageHash = null;
    }

    if (imageHash && promptHash) {
      try {
        const { data: cached } = await supabase
          .from("recognition_cache")
          .select("id, result, hit_count")
          .eq("image_hash", imageHash)
          .eq("model_name", modelName)
          .eq("prompt_hash", promptHash)
          .is("back_image_hash", backImageHash === null ? (null as never) : (undefined as never))
          .maybeSingle();
        void cached;
      } catch {
        // ignore — handled by the explicit lookup below
      }
    }

    const cachedResult =
      imageHash && promptHash
        ? await lookupCache(supabase, imageHash, backImageHash, modelName, promptHash)
        : null;

    if (cachedResult) {
      // Bump the shared counter with server credentials; never block on it.
      void (async () => {
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          await supabaseAdmin
            .from("recognition_cache")
            .update({ hit_count: cachedResult.hit_count + 1 })
            .eq("id", cachedResult.id);
        } catch (e) {
          await captureServerError(e, { where: "recognition_cache.hit_count" });
        }
      })();

      const { data: hitRow } = await supabase
        .from("recognitions")
        .insert({
          user_id: userId,
          photo_path: data.photoPath,
          model_name: modelName,
          raw_response: null,
          cache_hit: true,
          inferred_fields: (cachedResult.result.inferred_fields ?? null) as never,
          confidence: cachedResult.result.confidence ?? null,
        })
        .select("id")
        .single();

      return { ok: true, data: cachedResult.result, recognition_id: hitRow?.id ?? "" };
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

    // Log recognition row regardless
    const { data: recRow } = await supabase
      .from("recognitions")
      .insert({
        user_id: userId,
        photo_path: data.photoPath,
        model_name: modelName,
        raw_response: raw as never,
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
