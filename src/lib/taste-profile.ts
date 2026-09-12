import { supabase } from "@/integrations/supabase/client";
import { captureClientError } from "@/lib/sentry-browser";

type EntryRow = {
  rating: number | null;
  vintage_row: {
    vintage: number | null;
    alcohol_percent: number | null;
    wine: {
      wine_type: string | null;
      country: string | null;
      grapes: string[] | null;
    } | null;
  } | null;
};

export async function recomputeTasteProfile(userId: string) {
  // Only wines the user actually tasted feed the profile — wishlist items never do.
  const { data, error } = await supabase
    .from("entries")
    .select(
      "rating, vintage_row:wine_vintages(vintage, alcohol_percent, wine:wines(wine_type, country, grapes))",
    )
    .eq("user_id", userId)
    .eq("status", "tasted");
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
    const v = r.vintage_row;
    const w = v?.wine;
    if (!w) continue;
    if (w.wine_type) typeSplit[w.wine_type] = (typeSplit[w.wine_type] ?? 0) + 1;
    if (!w.wine_type || !statTypes.has(w.wine_type)) continue;
    if (w.country) countries[w.country] = (countries[w.country] ?? 0) + 1;
    for (const g of w.grapes ?? []) grapes[g] = (grapes[g] ?? 0) + 1;
    if (v?.vintage) { ageSum += thisYear - v.vintage; ageCount++; }
    if (v?.alcohol_percent) { alcSum += Number(v.alcohol_percent); alcCount++; }
  }
  const top = (o: Record<string, number>, n: number) =>
    Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ key: k, count: v }));
  const { error: upsertError } = await supabase.from("taste_profiles").upsert({
    user_id: userId,
    type_split: typeSplit,
    top_countries: top(countries, 3),
    top_grapes: top(grapes, 5),
    avg_vintage_age: ageCount ? +(ageSum / ageCount).toFixed(1) : null,
    avg_alcohol: alcCount ? +(alcSum / alcCount).toFixed(1) : null,
    entry_count: total,
    updated_at: new Date().toISOString(),
  });
  if (upsertError) throw upsertError;
}

const PENDING_KEY = "wine-diary:taste-profile-pending";

function markPending(userId: string) {
  try {
    localStorage.setItem(PENDING_KEY, userId);
  } catch {
    /* storage unavailable */
  }
}

function clearPending() {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    /* storage unavailable */
  }
}

/**
 * Secondary work: the wine is already saved, so a failure here must never change
 * what the user is told. It goes to Sentry, and the profile is marked stale so
 * the next app open recomputes it instead of leaving it wrong forever.
 */
export function recomputeTasteProfileSafely(userId: string, route: string) {
  void recomputeTasteProfile(userId)
    .then(clearPending)
    .catch((e) => {
      markPending(userId);
      captureClientError(e instanceof Error ? e : new Error(String(e)), { route });
    });
}

/** Called once per app start: retry a recompute that failed in an earlier session. */
export function retryPendingTasteProfile(userId: string) {
  let pending: string | null = null;
  try {
    pending = localStorage.getItem(PENDING_KEY);
  } catch {
    return;
  }
  if (pending !== userId) return;
  recomputeTasteProfileSafely(userId, "startup-retry");
}
