import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const Input = z.object({
  photoPaths: z.array(z.string().min(1)).min(1).max(8),
});

export type MenuParsedItem = {
  raw_text: string | null;
  name: string | null;
  producer: string | null;
  vintage: number | null;
  price: number | null;
  currency: string | null;
  by_the_glass: boolean;
};

export type ReadMenuResult =
  | {
      ok: true;
      restaurant_name: string | null;
      items: MenuParsedItem[];
      raw: unknown;
    }
  | { ok: false; error: string; raw?: unknown };

const PROMPT = `You are reading a photograph of a restaurant wine list. Return ONLY a JSON object with no prose and no markdown code fences.

Return: { "restaurant_name": string or null, "items": [ ... ] }

Each item: { "raw_text": the line exactly as printed, "name": the wine name, "producer": the winery or null, "vintage": integer or null, "price": number or null, "currency": three-letter code or null, "by_the_glass": true or false }

Rules. Include every wine you can read, even if some fields are missing. Wine lists are terse and often omit the producer. Do not invent producers or vintages that are not printed. Menus frequently group by region or style with headings such as Rioja or Champagne: use those headings to help identify the wines but do not return the headings as items. If a wine is listed at both glass and bottle prices, return the bottle price and set by_the_glass true. If the photo is unreadable, return an empty items array.`;

export const readMenu = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => Input.parse(v))
  .handler(async ({ data, context }): Promise<ReadMenuResult> => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return { ok: false, error: "ANTHROPIC_API_KEY is not configured" };
    const { supabase } = context;

    const content: Array<Record<string, unknown>> = [];
    for (const path of data.photoPaths) {
      const dl = await supabase.storage.from("wine-photos").download(path);
      if (dl.error || !dl.data) continue;
      const b64 = Buffer.from(await dl.data.arrayBuffer()).toString("base64");
      content.push({
        type: "image",
        source: { type: "base64", media_type: dl.data.type || "image/jpeg", data: b64 },
      });
    }
    if (content.length === 0) return { ok: false, error: "Could not read the uploaded photos" };
    content.push({ type: "text", text: PROMPT });

    let raw: unknown = null;
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
          max_tokens: 4000,
          messages: [{ role: "user", content }],
        }),
      });
      raw = await res.json();
      if (!res.ok) return { ok: false, error: `Anthropic returned ${res.status}`, raw };
      const text =
        (raw as { content?: Array<{ type: string; text?: string }> })?.content?.find(
          (b) => b.type === "text",
        )?.text ?? "";
      const cleaned = text
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/```\s*$/i, "")
        .trim();
      const parsed = JSON.parse(cleaned) as {
        restaurant_name?: string | null;
        items?: Array<Record<string, unknown>>;
      };
      const items: MenuParsedItem[] = (parsed.items ?? []).map((it) => ({
        raw_text: typeof it.raw_text === "string" ? it.raw_text : null,
        name: typeof it.name === "string" && it.name.trim() ? it.name.trim() : null,
        producer: typeof it.producer === "string" && it.producer.trim() ? it.producer.trim() : null,
        vintage: Number.isFinite(Number(it.vintage)) && it.vintage !== null ? Number(it.vintage) : null,
        price: Number.isFinite(Number(it.price)) && it.price !== null ? Number(it.price) : null,
        currency:
          typeof it.currency === "string" && it.currency.trim()
            ? it.currency.trim().toUpperCase().slice(0, 3)
            : null,
        by_the_glass: it.by_the_glass === true,
      }));
      return {
        ok: true,
        restaurant_name:
          typeof parsed.restaurant_name === "string" && parsed.restaurant_name.trim()
            ? parsed.restaurant_name.trim()
            : null,
        items,
        raw,
      };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "Could not read that wine list",
        raw,
      };
    }
  });
