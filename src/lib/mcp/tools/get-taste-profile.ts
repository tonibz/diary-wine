import { defineTool } from "@lovable.dev/mcp-js";
import { notAuthenticated, supabaseForUser } from "../supabase";

export default defineTool({
  name: "get_taste_profile",
  title: "Get taste profile",
  description:
    "Get the signed-in user's taste profile: how many wines they've logged, their top grapes and countries, red/white split, and average alcohol and vintage age.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated();
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("taste_profiles")
      .select("entry_count, top_grapes, top_countries, type_split, avg_alcohol, avg_vintage_age, updated_at")
      .maybeSingle();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    if (!data) {
      return {
        content: [{ type: "text", text: "No taste profile yet — log a few wines first." }],
        structuredContent: { profile: null },
      };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { profile: data },
    };
  },
});
