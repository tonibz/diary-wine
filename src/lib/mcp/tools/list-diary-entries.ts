import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";

const SELECT =
  "id, rating, tasted_on, place, company, notes, status, price_paid, price_currency, price_context, wine_vintages!inner(vintage, alcohol_percent, wines!inner(name, producer, appellation, region, country, wine_type, grapes))";

export default defineTool({
  name: "list_diary_entries",
  title: "List diary entries",
  description:
    "List the signed-in user's wine diary entries (or wishlist items), newest first. Optionally filter by a search term matching the wine name or producer.",
  inputSchema: {
    status: z
      .enum(["tasted", "interested"])
      .optional()
      .describe("'tasted' for diary entries, 'interested' for wishlist items. Defaults to tasted."),
    search: z.string().optional().describe("Text to match against wine name or producer."),
    limit: z.number().int().optional().describe("How many entries to return (1-100, default 20)."),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: async ({ status, search, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated();
    const supabase = supabaseForUser(ctx);
    const take = Math.min(Math.max(limit ?? 20, 1), 100);

    let query = supabase
      .from("entries")
      .select(SELECT)
      .eq("status", status ?? "tasted")
      .order("tasted_on", { ascending: false })
      .limit(take);

    if (search?.trim()) {
      const term = `%${search.trim()}%`;
      query = query.or(`name.ilike.${term},producer.ilike.${term}`, {
        referencedTable: "wine_vintages.wines",
      });
    }

    const { data, error } = await query;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };

    const rows = (data ?? []).map((e) => {
      const vintage = e.wine_vintages;
      const wine = vintage?.wines;
      return {
        id: e.id,
        wine: wine?.name ?? null,
        producer: wine?.producer ?? null,
        vintage: vintage?.vintage ?? null,
        wine_type: wine?.wine_type ?? null,
        appellation: wine?.appellation ?? null,
        region: wine?.region ?? null,
        country: wine?.country ?? null,
        grapes: wine?.grapes ?? null,
        rating: e.rating,
        tasted_on: e.tasted_on,
        place: e.place,
        company: e.company,
        notes: e.notes,
        price: e.price_paid,
        currency: e.price_currency,
        price_context: e.price_context,
      };
    });

    return {
      content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
      structuredContent: { entries: rows, count: rows.length },
    };
  },
});
