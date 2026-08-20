import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { COMPARE_LABELS_PROMPT } from "@/lib/compare-labels-prompt";

const Input = z.object({
  candidatePath: z.string().min(1),
  newPath: z.string().min(1),
});

export type LabelComparison = {
  same_wine: boolean | null;
  same_producer: boolean | null;
  confidence: number;
  reason: string | null;
};

export type CompareLabelsResult =
  | { ok: true; data: LabelComparison }
  | { ok: false; error: string };

/**
 * Visual duplicate check. Only called for the ambiguous text-similarity band,
 * so it stays a small fraction of scans.
 */
export const compareLabels = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => Input.parse(v))
  .handler(async ({ data, context }): Promise<CompareLabelsResult> => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return { ok: false, error: "ANTHROPIC_API_KEY is not configured" };
    const { supabase } = context;

    const content: Array<Record<string, unknown>> = [];
    // Candidate first, then the new photo — the prompt refers to them in that order.
    for (const path of [data.candidatePath, data.newPath]) {
      const dl = await supabase.storage.from("wine-photos").download(path);
      if (dl.error || !dl.data) return { ok: false, error: "Could not read one of the photos" };
      const b64 = Buffer.from(await dl.data.arrayBuffer()).toString("base64");
      content.push({
        type: "image",
        source: { type: "base64", media_type: dl.data.type || "image/jpeg", data: b64 },
      });
    }
    content.push({ type: "text", text: COMPARE_LABELS_PROMPT });

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-sonnet-5",
          max_tokens: 500,
          messages: [{ role: "user", content }],
        }),
      });
      const raw = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
      if (!res.ok) return { ok: false, error: `Anthropic returned ${res.status}` };
      const text = raw?.content?.find((b) => b.type === "text")?.text ?? "";
      const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
      const parsed = JSON.parse(cleaned) as Partial<LabelComparison>;
      return {
        ok: true,
        data: {
          same_wine: typeof parsed.same_wine === "boolean" ? parsed.same_wine : null,
          same_producer: typeof parsed.same_producer === "boolean" ? parsed.same_producer : null,
          confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
          reason: typeof parsed.reason === "string" ? parsed.reason : null,
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Comparison failed" };
    }
  });
