import { supabase } from "@/integrations/supabase/client";
import { findOrCreateVintage, logAlias, logDecision } from "@/lib/wine-match";
import type { MenuItemRow } from "@/lib/menu-match";

/**
 * The only two paths from a menu into the diary, both explicitly chosen by the
 * user. Scanning a list on its own never writes an entry.
 *
 * A confidently matched line links to the existing catalogue wine. An unmatched
 * line only gets a wine row here, at the moment the user says they want it —
 * never as a side effect of reading a menu.
 */
async function resolveVintageId(item: MenuItemRow, userId: string): Promise<string> {
  const name = (item.parsed_name ?? item.raw_text ?? "Unnamed wine").trim();
  const producer = item.parsed_producer?.trim() || null;

  if (item.matched_wine_id) {
    await logAlias(item.matched_wine_id, name, producer, "user", userId);
    await logDecision(userId, name, producer, item.parsed_vintage ?? null, {
      id: item.matched_wine_id,
      score: item.match_score ?? null,
    }, "auto_merge");
    return findOrCreateVintage(item.matched_wine_id, item.parsed_vintage ?? null, null);
  }

  const { data: wine, error } = await supabase
    .from("wines")
    .insert({
      name,
      producer,
      // The section heading on the list is the most reliable colour signal.
      wine_type: (item.wine_type ?? null) as never,
      grapes: (item.grapes ?? []) as never,
      data_source: "user" as never,
      created_by: userId,
    } as never)
    .select("id")
    .single();
  if (error) throw error;
  const wineId = (wine as { id: string }).id;
  await logAlias(wineId, name, producer, "user", userId);
  await logDecision(
    userId,
    name,
    producer,
    item.parsed_vintage ?? null,
    { id: null, score: item.match_score ?? null },
    "auto_new",
  );
  return findOrCreateVintage(wineId, item.parsed_vintage ?? null, null);
}

export async function addMenuItemToWishlist(item: MenuItemRow, userId: string): Promise<string> {
  const vintageId = await resolveVintageId(item, userId);
  const { data, error } = await supabase
    .from("entries")
    .insert({
      user_id: userId,
      wine_vintage_id: vintageId,
      status: "interested" as never,
      price_paid: item.price,
      price_currency: item.currency,
      price_context: item.price != null ? ("restaurant" as never) : null,
    } as never)
    .select("id")
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

export async function addMenuItemAsTasted(
  item: MenuItemRow,
  userId: string,
  restaurantName: string | null,
): Promise<string> {
  const vintageId = await resolveVintageId(item, userId);
  const { data, error } = await supabase
    .from("entries")
    .insert({
      user_id: userId,
      wine_vintage_id: vintageId,
      status: "tasted" as never,
      tasted_on: new Date().toISOString().slice(0, 10),
      place: restaurantName,
      price_paid: item.price,
      price_currency: item.currency,
      price_context: "restaurant" as never,
    } as never)
    .select("id")
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}
