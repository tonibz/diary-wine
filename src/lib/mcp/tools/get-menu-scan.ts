import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";

export default defineTool({
  name: "get_menu_scan",
  title: "Get a scanned wine list",
  description:
    "Get every wine parsed from one of the signed-in user's scanned restaurant wine lists, with prices, section headings and any diary matches.",
  inputSchema: {
    menu_scan_id: z.string().describe("The id of the menu scan, from list_menu_scans."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ menu_scan_id }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated();
    const supabase = supabaseForUser(ctx);

    const scan = await supabase
      .from("menu_scans")
      .select("id, restaurant_name, city, country, currency, scanned_at, skipped_count")
      .eq("id", menu_scan_id)
      .maybeSingle();
    if (scan.error) throw new ToolError(scan.error.message);
    if (!scan.data) throw new ToolError("No menu scan found with that id.");

    const items = await supabase
      .from("menu_items")
      .select(
        "id, parsed_name, parsed_producer, parsed_vintage, wine_type, section_heading, page_heading, serving_basis, attributes, grapes, price, glass_price, prices, currency, by_the_glass, matched_wine_id, match_score, item_confidence, rejected",
      )
      .eq("menu_scan_id", menu_scan_id)
      .eq("rejected", false);
    if (items.error) throw new ToolError(items.error.message);

    const payload = { scan: scan.data, items: items.data ?? [] };
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      structuredContent: payload,
    };
  },
});
