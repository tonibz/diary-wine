import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { CLASSIFY_PROMPT } from "@/lib/classify-label-prompt";

const Input = z.object({
  paths: z.array(z.string().min(1)).min(1).max(12),
});

export type LabelSide = "front" | "back";

export type ClassifyResult =
  | { ok: true; sides: Array<{ side: LabelSide; reason: string | null }> }
  | { ok: false; error: string };

export const classifyLabelSides = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => Input.parse(v))
  .handler(async ({ data, context }): Promise<ClassifyResult> => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return { ok: false, error: "ANTHROPIC_API_KEY is not configured" };
    const { supabase } = context;

    const content: Array<Record<string, unknown>> = [];
    for (let i = 0; i < data.paths.length; i++) {
      const dl = await supabase.storage.from("wine-photos").download(data.paths[i]);
      if (dl.error || !dl.data) return { ok: false, error: "Could not read one of the photos" };
      const b64 = Buffer.from(await dl.data.arrayBuffer()).toString("base64");
      content.push({ type: "text", text: `Photo ${i + 1}:` });
      content.push({
        type: "image",
        source: { type: "base64", media_type: dl.data.type || "image/jpeg", data: b64 },
      });
    }
    content.push({ type: "text", text: CLASSIFY_PROMPT(data.paths.length) });

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
          max_tokens: 1000,
          messages: [{ role: "user", content }],
        }),
      });
      const raw = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
      if (!res.ok) return { ok: false, error: `Anthropic returned ${res.status}` };
      const text = raw?.content?.find((b) => b.type === "text")?.text ?? "";
      const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
      const parsed = JSON.parse(cleaned) as {
        photos?: Array<{ side?: string; reason?: string | null }>;
      };
      const sides = (parsed.photos ?? []).map((p) => ({
        side: (p.side === "back" ? "back" : "front") as LabelSide,
        reason: p.reason ?? null,
      }));
      if (sides.length !== data.paths.length) {
        return { ok: false, error: "Classification returned the wrong number of photos" };
      }
      return { ok: true, sides };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Network error" };
    }
  });
