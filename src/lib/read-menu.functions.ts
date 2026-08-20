import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { MENU_PROMPT } from "./read-menu-prompt";
import { parseMenuJson } from "./read-menu-salvage";
import { normaliseMenuItem, normaliseCurrency, type MenuParsedItem } from "./menu-parse";

const Input = z.object({
  /** One page at a time: a whole list in one call hits the token ceiling. */
  photoPath: z.string().min(1),
  pageNumber: z.number().int().min(1).max(20).default(1),
});

export type { MenuParsedItem };

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type ReadMenuPageResult =
  | {
      ok: true;
      restaurant_name: string | null;
      currency: string | null;
      items: MenuParsedItem[];
      /** true when the model's reply was cut off and we salvaged what we could */
      salvaged: boolean;
      raw: JsonValue;
    }
  | { ok: false; error: string; raw: JsonValue };

const TIMEOUT_MS = 110_000;

export const readMenuPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => Input.parse(v))
  .handler(async ({ data, context }): Promise<ReadMenuPageResult> => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return { ok: false, error: "The wine-reading service is not configured", raw: null };
    const { supabase } = context;

    const dl = await supabase.storage.from("wine-photos").download(data.photoPath);
    if (dl.error || !dl.data) {
      return { ok: false, error: `Could not open page ${data.pageNumber}`, raw: null };
    }
    const b64 = Buffer.from(await dl.data.arrayBuffer()).toString("base64");

    let raw: JsonValue = null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-sonnet-5",
          max_tokens: 16000,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: dl.data.type || "image/jpeg",
                    data: b64,
                  },
                },
                { type: "text", text: MENU_PROMPT },
              ],
            },
          ],
        }),
      });
      raw = (await res.json().catch(() => null)) as JsonValue;
      if (!res.ok) {
        const message =
          (raw as { error?: { message?: string } } | null)?.error?.message ??
          `the service returned ${res.status}`;
        return { ok: false, error: `Page ${data.pageNumber}: ${message} (${res.status})`, raw };
      }

      const text =
        (raw as { content?: Array<{ type: string; text?: string }> })?.content?.find(
          (b) => b.type === "text",
        )?.text ?? "";
      const stopReason = (raw as { stop_reason?: string } | null)?.stop_reason ?? null;

      const parsed = parseMenuJson(text);
      if (!parsed) {
        return {
          ok: false,
          error: `Couldn't read page ${data.pageNumber} properly, try again or photograph fewer pages at once`,
          raw,
        };
      }

      return {
        ok: true,
        restaurant_name: parsed.restaurant_name,
        currency: normaliseCurrency(parsed.currency),
        items: parsed.items.map(normaliseMenuItem),
        salvaged: parsed.truncated || stopReason === "max_tokens",
        raw,
      };
    } catch (e) {
      const aborted = e instanceof Error && e.name === "AbortError";
      return {
        ok: false,
        error: aborted
          ? `Page ${data.pageNumber} took too long to read — try again with fewer pages at once`
          : e instanceof Error
            ? e.message
            : `Could not read page ${data.pageNumber}`,
        raw,
      };
    } finally {
      clearTimeout(timer);
    }
  });
