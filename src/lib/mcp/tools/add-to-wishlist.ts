import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";

export default defineTool({
  name: "add_to_wishlist",
  title: "Add a wine to the wishlist",
  description:
    "Add a wine the user wants to try to their Wine Diary wishlist. Reuses an existing catalogue wine when the name and producer already match.",
  inputSchema: {
    name: z.string().describe("Wine name as written on the label or wine list."),
    producer: z.string().optional().describe("Producer or winery, when known."),
    vintage: z.number().int().optional().describe("Vintage year, when known."),
    notes: z.string().optional().describe("Why the user wants to try it, or where they saw it."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async ({ name, producer, vintage, notes }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated();
    const supabase = supabaseForUser(ctx);
    const trimmedName = name.trim();
    if (!trimmedName) throw new ToolError("A wine name is required.");

    let wineId: string | undefined;
    let existing = supabase.from("wines").select("id").ilike("name", trimmedName).limit(1);
    if (producer?.trim()) existing = existing.ilike("producer", producer.trim());
    const found = await existing;
    if (found.error) throw new ToolError(found.error.message);
    wineId = found.data?.[0]?.id;

    if (!wineId) {
      const created = await supabase
        .from("wines")
        .insert({
          name: trimmedName,
          producer: producer?.trim() || null,
          data_source: "user",
          created_by: ctx.getUserId(),
        })
        .select("id")
        .single();
      if (created.error) throw new ToolError(created.error.message);
      wineId = created.data.id;
    }

    const vintageValue = vintage ?? null;
    const vintageMatch = await supabase
      .from("wine_vintages")
      .select("id")
      .eq("wine_id", wineId)
      .is("vintage", vintageValue === null ? null : (null as never))
      .limit(1);
    let vintageId: string | undefined =
      vintageValue === null && !vintageMatch.error ? vintageMatch.data?.[0]?.id : undefined;

    if (!vintageId && vintageValue !== null) {
      const byYear = await supabase
        .from("wine_vintages")
        .select("id")
        .eq("wine_id", wineId)
        .eq("vintage", vintageValue)
        .limit(1);
      if (byYear.error) throw new ToolError(byYear.error.message);
      vintageId = byYear.data?.[0]?.id;
    }

    if (!vintageId) {
      const createdVintage = await supabase
        .from("wine_vintages")
        .insert({ wine_id: wineId, vintage: vintageValue })
        .select("id")
        .single();
      if (createdVintage.error) throw new ToolError(createdVintage.error.message);
      vintageId = createdVintage.data.id;
    }

    const entry = await supabase
      .from("entries")
      .insert({
        user_id: ctx.getUserId()!,
        wine_vintage_id: vintageId,
        status: "interested",
        notes: notes?.trim() || null,
      })
      .select("id")
      .single();
    if (entry.error) throw new ToolError(entry.error.message);

    return {
      content: [
        {
          type: "text",
          text: `Added ${trimmedName}${producer ? ` by ${producer}` : ""}${vintage ? ` (${vintage})` : ""} to the wishlist.`,
        },
      ],
      structuredContent: { entry_id: entry.data.id, wine_id: wineId, wine_vintage_id: vintageId },
    };
  },
});
