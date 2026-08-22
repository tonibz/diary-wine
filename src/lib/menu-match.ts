import { supabase } from "@/integrations/supabase/client";
import { findBestMatches } from "@/lib/wine-match";
import { withTimeout } from "@/lib/with-timeout";

import type {
  MenuParsedItem,
  MenuPrice,
  MenuWineAttributes,
  ServingBasis,
} from "@/lib/menu-parse";

/**
 * menu_scans / menu_items are user-private tables that hold what a restaurant
 * stocks. They must never turn into diary entries or feed the taste profile.
 * Nothing in this file writes to `entries`, `taste_profiles` or `wines`.
 */
type LooseClient = { from: (table: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
export const menuDb = supabase as unknown as LooseClient;

export const CONFIDENT_MATCH = 0.85;

export type MenuItemRow = {
  id: string;
  menu_scan_id: string;
  raw_text: string | null;
  parsed_name: string | null;
  parsed_producer: string | null;
  parsed_vintage: number | null;
  price: number | null;
  currency: string | null;
  glass_price: number | null;
  prices: MenuPrice[] | null;
  rejected: boolean;
  by_the_glass: boolean;
  section_heading: string | null;
  /** page-level heading, e.g. "WINE BY THE GLASS" — governs the serving */
  page_heading: string | null;
  /** what the price buys; 'unknown' is never treated as a bottle */
  serving_basis: ServingBasis;
  attributes: MenuWineAttributes | null;
  wine_type: string | null;
  grapes: string[] | null;
  item_confidence: number | null;
  truncated: boolean;
  matched_wine_id: string | null;
  match_score: number | null;
  position: number | null;
};


export type MenuScanRow = {
  id: string;
  restaurant_name: string | null;
  /** the user explicitly said they don't know the venue — different from blank */
  restaurant_unknown: boolean;
  photo_path: string | null;
  scanned_at: string;
  skipped_count: number;
  skipped_categories: string[];
  /** price context: what a bottle costs means nothing without where and in what */
  currency: string | null;
  city: string | null;
  country: string | null;
  venue_note: string | null;
  /** replaced by a later scan of the same list; excluded from prices and export */
  superseded: boolean;
};

export type DiaryWine = {
  entryId: string;
  wineId: string;
  name: string;
  producer: string | null;
  region: string | null;
  country: string | null;
  wine_type: string | null;
  grapes: string[];
  rating: number | null;
  notes: string | null;
  tasted_on: string;
};

export type TasteContext = {
  entries: DiaryWine[];
  topGrapes: string[];
  topCountries: string[];
  topRegions: string[];
  topType: string | null;
};

/** Same normalisation idea as the wine deduplication: lowercase, strip accents and punctuation. */
export function normalise(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The user's tasting history, loaded once per scan view. Recommendation scoring
 * is built from this alone — it never reads the shared wines catalogue.
 */
export async function loadTasteContext(userId: string): Promise<TasteContext> {
  const { data } = await supabase
    .from("entries")
    .select(
      "id, rating, notes, tasted_on, vintage_row:wine_vintages(wine:wines(id, name, producer, region, country, wine_type, grapes))",
    )
    .eq("user_id", userId)
    .eq("status", "tasted")
    .order("tasted_on", { ascending: false });

  const rows = (data ?? []) as unknown as Array<{
    id: string;
    rating: number | null;
    notes: string | null;
    tasted_on: string;
    vintage_row: {
      wine: {
        id: string;
        name: string;
        producer: string | null;
        region: string | null;
        country: string | null;
        wine_type: string | null;
        grapes: string[] | null;
      } | null;
    } | null;
  }>;

  const entries: DiaryWine[] = [];
  for (const r of rows) {
    const w = r.vintage_row?.wine;
    if (!w) continue;
    entries.push({
      entryId: r.id,
      wineId: w.id,
      name: w.name,
      producer: w.producer,
      region: w.region,
      country: w.country,
      wine_type: w.wine_type,
      grapes: w.grapes ?? [],
      rating: r.rating,
      notes: r.notes,
      tasted_on: r.tasted_on,
    });
  }

  const count = (vals: string[]) => {
    const m = new Map<string, number>();
    for (const v of vals) {
      const k = v.trim();
      if (!k) continue;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  };

  const liked = entries.filter((e) => (e.rating ?? 0) >= 4);
  const pool = liked.length >= 3 ? liked : entries;

  return {
    entries,
    topGrapes: count(pool.flatMap((e) => e.grapes)).slice(0, 6),
    topCountries: count(pool.map((e) => e.country ?? "")).slice(0, 4),
    topRegions: count(pool.map((e) => e.region ?? "")).slice(0, 5),
    topType: count(pool.map((e) => e.wine_type ?? ""))[0] ?? null,
  };
}

const SCAN_COLS =
  "id, restaurant_name, restaurant_unknown, photo_path, scanned_at, skipped_count, skipped_categories, currency, city, country, venue_note, superseded";
const ITEM_COLS =
  "id, menu_scan_id, raw_text, parsed_name, parsed_producer, parsed_vintage, price, glass_price, prices, rejected, currency, by_the_glass, section_heading, page_heading, serving_basis, attributes, wine_type, grapes, item_confidence, truncated, matched_wine_id, match_score, position";

function asScan(row: Record<string, unknown>): MenuScanRow {
  return {
    id: row.id as string,
    restaurant_name: (row.restaurant_name as string) ?? null,
    restaurant_unknown: row.restaurant_unknown === true,
    photo_path: (row.photo_path as string) ?? null,
    scanned_at: row.scanned_at as string,
    skipped_count: Number(row.skipped_count ?? 0),
    skipped_categories: (row.skipped_categories as string[] | null) ?? [],
    currency: (row.currency as string) ?? null,
    city: (row.city as string) ?? null,
    country: (row.country as string) ?? null,
    venue_note: (row.venue_note as string) ?? null,
    superseded: row.superseded === true,
  };
}

/**
 * Persist the scan and every parsed line, prices included. This runs BEFORE any
 * matching: the prices on a list can only be captured at the moment it was
 * photographed, so storage must never depend on the diary or on find_wine_match.
 */
export async function saveMenuScan(args: {
  userId: string;
  photoPath: string | null;
  restaurantName: string | null;
  restaurantUnknown?: boolean;
  raw: unknown;
  items: MenuParsedItem[];
  currency: string | null;
  city?: string | null;
  country?: string | null;
  venueNote?: string | null;
  skippedCount?: number;
  skippedCategories?: string[];
  /** an earlier scan of the same list, marked superseded once this one is saved */
  supersedeScanId?: string | null;
  /** stage timing, so a stalled insert is visible in the console */
  onStage?: (stage: string, extra?: Record<string, unknown>) => void;
}): Promise<{ scan: MenuScanRow; items: MenuItemRow[] }> {
  const mark = args.onStage ?? (() => {});
  const { data: scan, error } = await menuDb
    .from("menu_scans")
    .insert({
      user_id: args.userId,
      scanned_by: args.userId,
      photo_path: args.photoPath,
      restaurant_name: args.restaurantName?.trim() || null,
      restaurant_unknown: args.restaurantUnknown === true,
      raw_response: args.raw,
      currency: args.currency,
      city: args.city ?? null,
      country: args.country ?? null,
      venue_note: args.venueNote ?? null,
      skipped_count: args.skippedCount ?? 0,
      skipped_categories: args.skippedCategories ?? [],
    })
    .select(SCAN_COLS)
    .single();
  if (error) throw error;
  mark("scan inserted", { scanId: (scan as { id: string }).id });

  if (args.supersedeScanId) {
    // Kept, not deleted: the earlier reading is still evidence of what was read.
    // Fire and forget — bookkeeping must never delay the results screen.
    void menuDb
      .from("menu_scans")
      .update({ superseded: true, superseded_by: (scan as { id: string }).id })
      .eq("id", args.supersedeScanId);
  }

  const rows = args.items.map((it, i) => ({
    menu_scan_id: (scan as { id: string }).id,
    raw_text: it.raw_text,
    parsed_name: it.name,
    parsed_producer: it.producer,
    parsed_vintage: it.vintage,
    // Prices are always stored, even when the wine matches nothing and nobody
    // orders it: only the moment of scanning can capture what a list charged.
    price: it.price,
    currency: args.currency,
    glass_price: it.glass_price,
    prices: it.prices.length ? it.prices : null,
    // Non-wine lines are kept, flagged, and never shown, so the filter's
    // accuracy can be measured against what the model returned.
    rejected: it.rejected,
    by_the_glass: it.by_the_glass,
    section_heading: it.section_heading,
    page_heading: it.page_heading,
    // 'unknown' when nothing on the page says what the price buys.
    serving_basis: it.serving_basis,
    attributes: it.attributes,
    wine_type: it.wine_type,
    grapes: it.grapes.length ? it.grapes : null,
    item_confidence: it.confidence,
    truncated: it.truncated,
    // Matching is a later enrichment step; these start empty on purpose.
    matched_wine_id: null,
    match_score: null,
    position: i,
  }));

  let items: MenuItemRow[] = [];
  if (rows.length) {
    const { data: inserted, error: itemErr } = await menuDb
      .from("menu_items")
      .insert(rows)
      .select(ITEM_COLS);
    if (itemErr) throw itemErr;
    mark("items inserted", { count: rows.length });
    // Rejected lines stay in the database but never reach the review screen.
    items = ((inserted ?? []) as MenuItemRow[]).filter((r) => !r.rejected);
    items.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  }
  return { scan: asScan(scan as Record<string, unknown>), items };
}

/**
 * The newest scan for this user. Used when a save times out: the rows are
 * usually already written, so the user is taken to them instead of a spinner.
 */
export async function newestScanId(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const { data } = await menuDb
    .from("menu_scans")
    .select("id, scanned_at")
    .eq("user_id", userId)
    .order("scanned_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}


/**
 * Enrichment only: match already-stored rows against the catalogue and write
 * back matched_wine_id / match_score. Throws on failure — the caller shows the
 * stored list anyway and offers a retry.
 */
export async function matchStoredItems(items: MenuItemRow[]): Promise<MenuItemRow[]> {
  // A truncated line is a fragment of a name: matching it against the catalogue
  // would produce a confident-looking link to the wrong wine.
  const candidates = items.filter((i) => !i.rejected && !i.truncated && i.parsed_name);
  if (!candidates.length) return items;

  const results = await withTimeout(
    findBestMatches(
      candidates.map((i) => ({ name: i.parsed_name ?? "", producer: i.parsed_producer })),
    ),
    30_000,
    "Matching timed out",
  );

  const patched = new Map<string, { matched_wine_id: string | null; match_score: number | null }>();
  candidates.forEach((item, i) => {
    const m = results[i];
    patched.set(item.id, {
      matched_wine_id: m && m.score >= CONFIDENT_MATCH ? m.id : null,
      match_score: m ? m.score : null,
    });
  });

  await Promise.all(
    [...patched.entries()].map(([id, patch]) =>
      menuDb.from("menu_items").update(patch).eq("id", id),
    ),
  );

  return items.map((i) => (patched.has(i.id) ? { ...i, ...patched.get(i.id)! } : i));
}

/** Re-run only the matching step against the rows already stored for a scan. */
export async function rematchScan(scanId: string): Promise<MenuItemRow[]> {
  const loaded = await loadMenuScan(scanId);
  if (!loaded) throw new Error("That scan is no longer here");
  return matchStoredItems(loaded.items);
}

export async function loadMenuScan(
  scanId: string,
): Promise<{ scan: MenuScanRow; items: MenuItemRow[] } | null> {
  const { data: scan } = await menuDb
    .from("menu_scans")
    .select(SCAN_COLS)
    .eq("id", scanId)
    .maybeSingle();
  if (!scan) return null;
  const { data: items } = await menuDb
    .from("menu_items")
    .select(ITEM_COLS)
    .eq("menu_scan_id", scanId)
    .eq("rejected", false)
    .order("position", { ascending: true });
  return { scan: asScan(scan as Record<string, unknown>), items: (items ?? []) as MenuItemRow[] };
}

export async function updateMenuScanContext(
  scanId: string,
  patch: {
    restaurant_name?: string | null;
    restaurant_unknown?: boolean;
    city?: string | null;
    country?: string | null;
    venue_note?: string | null;
  },
): Promise<void> {
  const { error } = await menuDb.from("menu_scans").update(patch).eq("id", scanId);
  if (error) throw error;
}

/** Fix or discard a line the photo cut off. */
export async function updateMenuItem(
  itemId: string,
  patch: { parsed_name?: string | null; parsed_producer?: string | null; truncated?: boolean },
): Promise<void> {
  const { error } = await menuDb.from("menu_items").update(patch).eq("id", itemId);
  if (error) throw error;
}

export async function deleteMenuItem(itemId: string): Promise<void> {
  const { error } = await menuDb.from("menu_items").delete().eq("id", itemId);
  if (error) throw error;
}

/**
 * One tap fixes a whole page. When the parser read a by-the-glass page as
 * bottles (or the reverse), every price on the scan moves to the right field
 * rather than making the user edit 25 rows.
 */
export async function setScanServingBasis(
  items: MenuItemRow[],
  basis: Extract<ServingBasis, "glass" | "bottle">,
): Promise<MenuItemRow[]> {
  const changed: MenuItemRow[] = [];
  for (const item of items) {
    if (item.serving_basis === basis) continue;
    // Only single-priced lines are moved: a line printing both a glass and a
    // bottle price already states its own servings.
    const both = item.price != null && item.glass_price != null;
    const amount = item.price ?? item.glass_price;
    const patch =
      both || amount == null
        ? { serving_basis: basis }
        : basis === "glass"
          ? { serving_basis: basis, price: null, glass_price: amount, by_the_glass: true }
          : { serving_basis: basis, price: amount, glass_price: null, by_the_glass: false };
    changed.push({ ...item, ...patch } as MenuItemRow);
    const { error } = await menuDb.from("menu_items").update(patch).eq("id", item.id);
    if (error) throw error;
  }
  const byId = new Map(changed.map((c) => [c.id, c]));
  return items.map((i) => byId.get(i.id) ?? i);
}

/** What a line's single price buys, in words, e.g. "glass". */
export function servingLabel(basis: ServingBasis): string {
  return basis === "half_bottle"
    ? "half bottle"
    : basis === "unknown"
      ? "serving unknown"
      : basis;
}

/**
 * Price comparison must compare like with like. A row whose serving we never
 * established is excluded outright rather than assumed to be a bottle.
 */
export function comparablePrices(
  items: MenuItemRow[],
  basis: Exclude<ServingBasis, "unknown">,
): Array<{ item: MenuItemRow; amount: number }> {
  const out: Array<{ item: MenuItemRow; amount: number }> = [];
  for (const item of items) {
    if (item.rejected) continue;
    if (basis === "glass") {
      if (item.glass_price != null) out.push({ item, amount: item.glass_price });
      continue;
    }
    if (item.serving_basis !== basis) continue;
    if (item.price != null) out.push({ item, amount: item.price });
  }
  return out;
}


/** Restaurants this user has scanned before, newest first — a picklist. */
export async function listRecentRestaurants(limit = 8): Promise<string[]> {
  const { data } = await menuDb
    .from("menu_scans")
    .select("restaurant_name, scanned_at")
    .eq("superseded", false)
    .not("restaurant_name", "is", null)
    .order("scanned_at", { ascending: false })
    .limit(60);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of (data ?? []) as Array<{ restaurant_name: string | null }>) {
    const name = r.restaurant_name?.trim();
    if (!name) continue;
    const key = normalise(name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= limit) break;
  }
  return out;
}

export type DuplicateScan = {
  scan: MenuScanRow;
  itemCount: number;
  overlap: number;
  reason: "restaurant" | "items";
};

/**
 * The price dataset counts how many different venues charge what, so several
 * scans of one list from one venue distort it. A repeat is either the same
 * restaurant name or more than 70% of the same item names, within 24 hours.
 */
export async function findDuplicateScan(args: {
  userId: string;
  restaurantName: string | null;
  names: string[];
}): Promise<DuplicateScan | null> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data } = await menuDb
    .from("menu_scans")
    .select(`${SCAN_COLS}, menu_items(parsed_name)`)
    .eq("user_id", args.userId)
    .eq("superseded", false)
    .gte("scanned_at", since)
    .order("scanned_at", { ascending: false })
    .limit(20);

  const fresh = new Set(args.names.map((n) => normalise(n)).filter((n) => n.length >= 4));
  const wanted = normalise(args.restaurantName);

  let best: DuplicateScan | null = null;
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const scan = asScan(row);
    const names = ((row.menu_items as Array<{ parsed_name: string | null }> | null) ?? [])
      .map((i) => normalise(i.parsed_name))
      .filter((n) => n.length >= 4);
    const sameRestaurant = !!wanted && normalise(scan.restaurant_name) === wanted;
    const overlap = fresh.size
      ? [...new Set(names)].filter((n) => fresh.has(n)).length / fresh.size
      : 0;
    if (!sameRestaurant && overlap <= 0.7) continue;
    const candidate: DuplicateScan = {
      scan,
      itemCount: names.length,
      overlap,
      reason: sameRestaurant ? "restaurant" : "items",
    };
    if (!best || candidate.overlap > best.overlap) best = candidate;
  }
  return best;
}

export async function listMenuScans(): Promise<Array<MenuScanRow & { item_count: number }>> {
  const { data } = await menuDb
    .from("menu_scans")
    .select(`${SCAN_COLS}, menu_items(count)`)
    // Superseded scans are duplicates of a list already captured.
    .eq("superseded", false)
    .order("scanned_at", { ascending: false });
  return ((data ?? []) as Array<Record<string, unknown>>).map((s) => ({
    ...asScan(s),
    item_count: Number((s.menu_items as Array<{ count: number }> | undefined)?.[0]?.count ?? 0),
  }));
}

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Every menu line this user has ever captured, as CSV. RLS scopes the query to
 * their own scans, so it can never export anyone else's data.
 */
export async function exportMenuItemsCsv(): Promise<string> {
  const { data, error } = await menuDb
    .from("menu_items")
    .select(
      "parsed_name, parsed_producer, parsed_vintage, price, glass_price, serving_basis, page_heading, attributes, currency, by_the_glass, rejected, truncated, position, menu_scans!inner(restaurant_name, restaurant_unknown, scanned_at, city, country, venue_note, superseded)",
    )
    .eq("rejected", false)
    // Duplicate scans of one list would over-count that venue's prices.
    .eq("menu_scans.superseded", false)
    .order("position", { ascending: true });
  if (error) throw error;

  const header = [
    "restaurant",
    "date",
    "city",
    "country",
    "venue_note",
    "wine_name",
    "producer",
    "vintage",
    "price",
    "glass_price",
    // Comparisons must be like with like; 'unknown' rows are excluded, not guessed.
    "serving_basis",
    "page_heading",
    "markers",
    "currency",
    "by_the_glass",
    "text_cut_off",
  ];
  const rows = ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
    const scan = (r.menu_scans ?? {}) as Record<string, unknown>;
    const markers = Object.entries((r.attributes ?? {}) as Record<string, unknown>)
      .filter(([, v]) => v === true)
      .map(([k]) => k)
      .join(", ");
    return [
      scan.restaurant_name ?? "",
      scan.scanned_at ? String(scan.scanned_at).slice(0, 10) : "",
      scan.city,
      scan.country,
      scan.venue_note,
      r.parsed_name,
      r.parsed_producer,
      r.parsed_vintage,
      r.price,
      r.glass_price,
      r.serving_basis ?? "unknown",
      r.page_heading,
      markers,
      r.currency,
      r.by_the_glass ? "yes" : "no",
      r.truncated ? "yes" : "no",
    ]
      .map(csvCell)
      .join(",");
  });

  return [header.join(","), ...rows].join("\n");
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
