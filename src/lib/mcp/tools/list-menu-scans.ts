import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { notAuthenticated, supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_menu_scans",
  title: "List scanned wine lists",
  description:
    "List the restaurant wine lists the signed-in user has scanned, newest first, with venue and location details.",
  inputSchema: {
    limit: z.number().int().optional().describe("How many scans to return (1-50, default 10)."),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: async ({ limit }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated();
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("menu_scans")
      .select("id, restaurant_name, city, country, currency, venue_note, scanned_at")
      .order("scanned_at", { ascending: false })
      .limit(Math.min(Math.max(limit ?? 10, 1), 50));
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { scans: data ?? [] },
    };
  },
});
