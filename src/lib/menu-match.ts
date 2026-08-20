import { supabase } from "@/integrations/supabase/client";
import { findBestMatches } from "@/lib/wine-match";
import { withTimeout } from "@/lib/with-timeout";

import type { MenuParsedItem, MenuPrice } from "@/lib/menu-parse";

/**
 * menu_scans / menu_items are user-private tables that hold what a restaurant
 * stocks. They must never turn into diary entries or feed the taste profile.
 * Nothing in this file writes to `entries`, `taste_profiles` or `wines`.
 */
type LooseClient = { from: (table: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
export const menuDb = supabase as unknown as LooseClient;

export const CONFIDENT_MATCH = 0.85;
export const MIN_ENTRIES_FOR_SUGGESTIONS = 5;

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
  photo_path: string | null;
  scanned_at: string;
  skipped_count: number;
  skipped_categories: string[];
  /** price context: what a bottle costs means nothing without where and in what */
  currency: string | null;
  city: string | null;
  country: string | null;
  venue_note: string | null;
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

export type EnrichedItem = {
  item: MenuItemRow;
  group: "had" | "similar" | "other";
  /** the user's own tasting of this wine, when they have had it */
  diary: DiaryWine | null;
  reason: string | null;
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

function titleCase(s: string) {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

const COLOUR_WORDS: Record<string, string> = {
  red: "red",
  white: "white",
  rose: "rosé",
  sparkling: "sparkling",
  dessert: "dessert",
  fortified: "fortified",
};

/** Everything we know about the user's palate, loaded once per scan view. */
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

  // Weight by rating: a 4 or 5 star wine says more about taste than a 2.
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





function textOf(item: MenuItemRow) {
  return normalise(`${item.parsed_name ?? ""} ${item.parsed_producer ?? ""} ${item.raw_text ?? ""}`);
}

/**
 * Sort every menu line into "You've had this", "Similar to wines you like" and
 * "Everything else". A recommendation is only ever produced with a reason.
 */
export function enrichItems(
  items: MenuItemRow[],
  ctx: TasteContext,
  catalogue: Map<string, DiaryWine | null>,
): EnrichedItem[] {
  const byWineId = new Map<string, DiaryWine>();
  for (const e of ctx.entries) {
    const prev = byWineId.get(e.wineId);
    if (!prev || (e.rating ?? 0) > (prev.rating ?? 0)) byWineId.set(e.wineId, e);
  }

  const enoughHistory = ctx.entries.length >= MIN_ENTRIES_FOR_SUGGESTIONS;

  return items.map((item) => {
    // 1. Have they had it? Either the confident catalogue link is in their diary,
    //    or the printed name closely matches something they logged.
    let diary: DiaryWine | null = item.matched_wine_id
      ? byWineId.get(item.matched_wine_id) ?? null
      : null;
    if (!diary) {
      const t = textOf(item);
      for (const e of ctx.entries) {
        const n = normalise(e.name);
        if (n.length >= 6 && t.includes(n)) {
          if (!diary || (e.rating ?? 0) > (diary.rating ?? 0)) diary = e;
        }
      }
    }
    if (diary) return { item, group: "had" as const, diary, reason: null };

    if (!enoughHistory) return { item, group: "other" as const, diary: null, reason: null };

    // 2. Close to their taste? Attributes come from a matched catalogue wine when
    //    there is one, otherwise from the words printed on the list.
    const linked = item.matched_wine_id ? catalogue.get(item.matched_wine_id) ?? null : null;
    const t = textOf(item);
    const has = (v: string | null | undefined) => {
      if (!v) return false;
      const n = normalise(v);
      return n.length >= 3 && t.includes(n);
    };

    const grape =
      ctx.topGrapes.find((g) => linked?.grapes.some((x) => normalise(x) === normalise(g))) ??
      ctx.topGrapes.find((g) => has(g)) ??
      null;
    const region =
      ctx.topRegions.find((r) => linked?.region && normalise(linked.region) === normalise(r)) ??
      ctx.topRegions.find((r) => has(r)) ??
      null;
    const country =
      ctx.topCountries.find((c) => linked?.country && normalise(linked.country) === normalise(c)) ??
      ctx.topCountries.find((c) => has(c)) ??
      null;
    const colour =
      ctx.topType && (linked?.wine_type === ctx.topType || has(COLOUR_WORDS[ctx.topType] ?? ""))
        ? ctx.topType
        : null;

    let score = 0;
    if (grape) score += 3;
    if (region) score += 2;
    if (country) score += 2;
    if (colour) score += 1;
    if (score < 3) return { item, group: "other" as const, diary: null, reason: null };

    // The exemplar: their best-loved wine sharing the strongest attribute.
    const shares = (e: DiaryWine) => {
      if (grape) return e.grapes.some((x) => normalise(x) === normalise(grape));
      if (region) return !!e.region && normalise(e.region) === normalise(region);
      if (country) return !!e.country && normalise(e.country) === normalise(country);
      return e.wine_type === colour;
    };
    const exemplar = ctx.entries
      .filter(shares)
      .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))[0];
    if (!exemplar) return { item, group: "other" as const, diary: null, reason: null };

    const what = grape ? titleCase(grape) : titleCase(COLOUR_WORDS[colour ?? ""] ?? "wine");
    const where = region ?? country;
    const stars = exemplar.rating
      ? ` you rated ${exemplar.rating} star${exemplar.rating === 1 ? "" : "s"}`
      : " you logged";
    const reason = `${what}${where ? ` from ${where}` : ""}, like the ${exemplar.name}${stars}`;
    return { item, group: "similar" as const, diary: null, reason };
  });
}

/** Full wine rows for confident links, so reasons can use grape/region/colour. */
export async function loadLinkedWines(ids: string[]): Promise<Map<string, DiaryWine | null>> {
  const map = new Map<string, DiaryWine | null>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return map;
  const { data } = await supabase
    .from("wines")
    .select("id, name, producer, region, country, wine_type, grapes")
    .in("id", unique);
  for (const w of data ?? []) {
    map.set(w.id, {
      entryId: "",
      wineId: w.id,
      name: w.name,
      producer: w.producer,
      region: w.region,
      country: w.country,
      wine_type: w.wine_type,
      grapes: w.grapes ?? [],
      rating: null,
      notes: null,
      tasted_on: "",
    });
  }
  return map;
}

const SCAN_COLS =
  "id, restaurant_name, photo_path, scanned_at, skipped_count, skipped_categories, currency, city, country, venue_note";
const ITEM_COLS =
  "id, menu_scan_id, raw_text, parsed_name, parsed_producer, parsed_vintage, price, glass_price, prices, rejected, currency, by_the_glass, section_heading, wine_type, grapes, item_confidence, truncated, matched_wine_id, match_score, position";

function asScan(row: Record<string, unknown>): MenuScanRow {
  return {
    id: row.id as string,
    restaurant_name: (row.restaurant_name as string) ?? null,
    photo_path: (row.photo_path as string) ?? null,
    scanned_at: row.scanned_at as string,
    skipped_count: Number(row.skipped_count ?? 0),
    skipped_categories: (row.skipped_categories as string[] | null) ?? [],
    currency: (row.currency as string) ?? null,
    city: (row.city as string) ?? null,
    country: (row.country as string) ?? null,
    venue_note: (row.venue_note as string) ?? null,
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
  raw: unknown;
  items: MenuParsedItem[];
  currency: string | null;
  city?: string | null;
  country?: string | null;
  venueNote?: string | null;
  skippedCount?: number;
  skippedCategories?: string[];
}): Promise<{ scan: MenuScanRow; items: MenuItemRow[] }> {
  const { data: scan, error } = await menuDb
    .from("menu_scans")
    .insert({
      user_id: args.userId,
      scanned_by: args.userId,
      photo_path: args.photoPath,
      restaurant_name: args.restaurantName,
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
    // Rejected lines stay in the database but never reach the review screen.
    items = ((inserted ?? []) as MenuItemRow[]).filter((r) => !r.rejected);
    items.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  }
  return { scan: asScan(scan as Record<string, unknown>), items };
}

/**
 * Enrichment only: match already-stored rows against the catalogue and write
 * back matched_wine_id / match_score. Throws on failure — the caller shows the
 * stored list anyway and offers a retry.
 */
export async function matchStoredItems(items: MenuItemRow[]): Promise<MenuItemRow[]> {
  const candidates = items.filter((i) => !i.rejected && i.parsed_name);
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
  patch: { restaurant_name?: string | null; city?: string | null; country?: string | null; venue_note?: string | null },
): Promise<void> {
  const { error } = await menuDb.from("menu_scans").update(patch).eq("id", scanId);
  if (error) throw error;
}

export async function listMenuScans(): Promise<Array<MenuScanRow & { item_count: number }>> {
  const { data } = await menuDb
    .from("menu_scans")
    .select(`${SCAN_COLS}, menu_items(count)`)
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
      "parsed_name, parsed_producer, parsed_vintage, price, glass_price, currency, by_the_glass, rejected, position, menu_scans!inner(restaurant_name, scanned_at, city, country, venue_note)",
    )
    .eq("rejected", false)
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
    "currency",
    "by_the_glass",
  ];
  const rows = ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
    const scan = (r.menu_scans ?? {}) as Record<string, unknown>;
    return [
      scan.restaurant_name,
      scan.scanned_at ? String(scan.scanned_at).slice(0, 10) : "",
      scan.city,
      scan.country,
      scan.venue_note,
      r.parsed_name,
      r.parsed_producer,
      r.parsed_vintage,
      r.price,
      r.glass_price,
      r.currency,
      r.by_the_glass ? "yes" : "no",
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

