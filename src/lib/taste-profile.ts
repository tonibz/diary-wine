import { supabase } from "@/integrations/supabase/client";

type EntryRow = {
  rating: number | null;
  wine: {
    wine_type: string | null;
    country: string | null;
    grapes: string[] | null;
    vintage: number | null;
    alcohol_percent: number | null;
  } | null;
};

export async function recomputeTasteProfile(userId: string) {
  const { data, error } = await supabase
    .from("entries")
    .select("rating, wine:wines(wine_type, country, grapes, vintage, alcohol_percent)")
    .eq("user_id", userId);
  if (error) throw error;
  const rows = (data ?? []) as unknown as EntryRow[];
  const total = rows.length;
  const typeSplit: Record<string, number> = {};
  const countries: Record<string, number> = {};
  const grapes: Record<string, number> = {};
  let ageSum = 0, ageCount = 0, alcSum = 0, alcCount = 0;
  const thisYear = new Date().getFullYear();
  const statTypes = new Set(["red", "white"]);
  for (const r of rows) {
    const w = r.wine;
    if (!w) continue;
    if (w.wine_type) typeSplit[w.wine_type] = (typeSplit[w.wine_type] ?? 0) + 1;
    if (!w.wine_type || !statTypes.has(w.wine_type)) continue;
    if (w.country) countries[w.country] = (countries[w.country] ?? 0) + 1;
    for (const g of w.grapes ?? []) grapes[g] = (grapes[g] ?? 0) + 1;
    if (w.vintage) { ageSum += thisYear - w.vintage; ageCount++; }
    if (w.alcohol_percent) { alcSum += Number(w.alcohol_percent); alcCount++; }
  }
  const top = (o: Record<string, number>, n: number) =>
    Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ key: k, count: v }));
  await supabase.from("taste_profiles").upsert({
    user_id: userId,
    type_split: typeSplit,
    top_countries: top(countries, 3),
    top_grapes: top(grapes, 5),
    avg_vintage_age: ageCount ? +(ageSum / ageCount).toFixed(1) : null,
    avg_alcohol: alcCount ? +(alcSum / alcCount).toFixed(1) : null,
    entry_count: total,
    updated_at: new Date().toISOString(),
  });
}
