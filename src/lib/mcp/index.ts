import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listDiaryEntries from "./tools/list-diary-entries";
import getTasteProfile from "./tools/get-taste-profile";
import addToWishlist from "./tools/add-to-wishlist";
import listMenuScans from "./tools/list-menu-scans";
import getMenuScan from "./tools/get-menu-scan";

// The OAuth issuer must be the direct Supabase host; the project ref is the only
// value that survives publish unchanged.
const projectRef = import.meta.env['VITE_SUPABASE_PROJECT_ID'] ?? "project-ref-unset";

export default defineMcp({
  name: "my-wine-journal",
  title: "My Wine Journal",
  version: "0.1.0",
  instructions:
    "Tools for a personal wine diary. Use list_diary_entries to see wines the user has tasted or wants to try, get_taste_profile to understand their preferences, add_to_wishlist to note a wine they want to try, and list_menu_scans / get_menu_scan to read restaurant wine lists they photographed — useful for recommending what to order.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listDiaryEntries, getTasteProfile, addToWishlist, listMenuScans, getMenuScan],
});
