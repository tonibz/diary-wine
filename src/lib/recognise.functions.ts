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

    const modelName = "claude-sonnet-5";
    const prompt = `You are reading a photograph of a wine bottle label. Return ONLY a JSON object, with no prose and no markdown code fences.

Fields:
- name: the wine's name as printed
- producer: the winery or estate
- appellation: the denomination of origin, for example Corton-Charlemagne, Rioja, Chianti Classico
- region: the wider wine region
- country
- vintage: integer year, or null
- wine_type: one of red, white, rose, sparkling, dessert, fortified
- grapes: array of grape varieties
- alcohol_percent: number or null
- confidence: number from 0 to 1
- inferred_fields: array naming any field you filled in from knowledge of the appellation rather than reading it off the label

Rules. If something is not legible on the label, return null instead of guessing. Many European labels never print the colour or the grape, so you may infer those from the appellation, but you must list every field you inferred in inferred_fields. Set confidence low when the photo is blurred, badly lit, cropped, or the label is at a steep angle.`;

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
          messages: [
            {
              role: "user",
              content: [
                { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } },
                { type: "text", text: prompt },
              ],
            },
          ],
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
        confidence: parsed?.confidence ?? null,
      })
      .select("id")
      .single();

    if (errText || !parsed) {
      return { ok: false, error: errText ?? "Unknown error", recognition_id: recRow?.id };
    }
    return { ok: true, data: parsed, recognition_id: recRow?.id ?? "" };
  });
