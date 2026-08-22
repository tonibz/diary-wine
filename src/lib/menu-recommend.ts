import { supabase } from "@/integrations/supabase/client";
import { withTimeout } from "@/lib/with-timeout";
import { normalise, type DiaryWine, type MenuItemRow } from "@/lib/menu-match";

/**
 * Recommendation is deliberately independent of the wines catalogue. A parsed
 * menu line already carries name, producer, grapes, region, country, colour and
 * price, so it can be scored against the palate on its own. Catalogue matching
 * only ever adds the "you've had this" note on top; if it fails completely the
 * suggestions below are unaffected.
 */

export const MIN_RATED_FOR_SUGGESTIONS = 5;

/** Weights per the product brief. They sum to 1. */
const W_GRAPE = 0.45;
const W_REGION = 0.2;
const W_COUNTRY = 0.15;
const W_TYPE = 0.2;

const COLOUR_WORDS: Record<string, string> = {
  red: "red",
  white: "white",
  rose: "rosé",
  sparkling: "sparkling",
  dessert: "dessert",
  fortified: "fortified",
};

function titleCase(s: string) {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

type Facet = {
  /** normalised key -> accumulated weight */
  weight: Map<string, number>;
  /** normalised key -> the best-loved diary wine carrying it */
  exemplar: Map<string, DiaryWine>;
  /** normalised key -> the label as the user's diary spells it */
  label: Map<string, string>;
  max: number;
};

export type TasteProfile = {
  /** only rated, tasted entries count — wishlist and unrated never do */
  ratedCount: number;
  grapes: Facet;
  regions: Facet;
  countries: Facet;
  types: Facet;
};

function emptyFacet(): Facet {
  return { weight: new Map(), exemplar: new Map(), label: new Map(), max: 0 };
}

/**
 * Recency half-life of one year: a 5 rated last month outweighs a 5 from three
 * years ago, and a 3 barely registers next to either.
 */
function entryWeight(e: DiaryWine): number {
  const rating = e.rating ?? 0;
  // 3 stars is neutral-ish, 5 stars is the strong signal, 1-2 pull nothing.
  const strength = Math.max(0, (rating - 2) / 3);
  const days = Math.max(0, (Date.now() - new Date(e.tasted_on).getTime()) / 86_400_000);
  const recency = Math.pow(0.5, days / 365);
  return strength * (0.25 + 0.75 * recency);
}

function add(facet: Facet, raw: string | null | undefined, weight: number, entry: DiaryWine) {
  const key = normalise(raw);
  if (!key || weight <= 0) return;
  const next = (facet.weight.get(key) ?? 0) + weight;
  facet.weight.set(key, next);
  if (next > facet.max) facet.max = next;
  if (!facet.label.has(key)) facet.label.set(key, (raw ?? "").trim());
  const prev = facet.exemplar.get(key);
  if (!prev || entryWeight(entry) > entryWeight(prev)) facet.exemplar.set(key, entry);
}

/** Build the weighted palate from rated, tasted diary entries only. */
export function buildTasteProfile(entries: DiaryWine[]): TasteProfile {
  const rated = entries.filter((e) => e.rating != null && e.rating > 0);
  const profile: TasteProfile = {
    ratedCount: rated.length,
    grapes: emptyFacet(),
    regions: emptyFacet(),
    countries: emptyFacet(),
    types: emptyFacet(),
  };
  for (const e of rated) {
    const w = entryWeight(e);
    if (w <= 0) continue;
    for (const g of e.grapes) add(profile.grapes, g, w, e);
    add(profile.regions, e.region, w, e);
    add(profile.countries, e.country, w, e);
    add(profile.types, e.wine_type, w, e);
  }
  return profile;
}

function facetHit(facet: Facet, value: string | null | undefined) {
  const key = normalise(value);
  if (!key || !facet.max) return null;
  const weight = facet.weight.get(key);
  if (!weight) return null;
  return {
    key,
    label: facet.label.get(key) ?? value ?? "",
    share: weight / facet.max,
    exemplar: facet.exemplar.get(key) ?? null,
  };
}

/* ------------------------------------------------------------------ *
 * Filling in what the list didn't print
 * ------------------------------------------------------------------ */

export type ReferenceFill = {
  appellation: string;
  grapes: boolean;
  wine_type: boolean;
};

export type ScoredItem = {
  item: MenuItemRow;
  /** attributes used for scoring, after any reference fill */
  grapes: string[];
  wine_type: string | null;
  region: string | null;
  country: string | null;
  /** set when the appellations reference supplied grapes or colour */
  filled: ReferenceFill | null;
  score: number;
  reason: string | null;
  /** the user's own tasting, added by catalogue matching only */
  diary: DiaryWine | null;
};

type AppellationRefRow = {
  idx: number;
  name: string;
  country: string | null;
  region: string | null;
  typical_colour: string | null;
  grapes: unknown;
  score: number | string;
};

const REF_THRESHOLD = 0.8;

function toGrapeArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x).trim()).filter(Boolean);
}

/**
 * Many lines print a place and no grape ("Chablis", "Txakolina Getaria").
 * Look the printed words up in the Wikipedia-derived appellations table and
 * borrow the grapes and typical colour so those lines can still be scored.
 */
export async function fillFromAppellations(
  items: MenuItemRow[],
): Promise<Map<string, { grapes: string[]; wine_type: string | null; fill: ReferenceFill }>> {
  const out = new Map<
    string,
    { grapes: string[]; wine_type: string | null; fill: ReferenceFill }
  >();
  const needs = items.filter((i) => !i.grapes?.length || !i.wine_type);
  if (!needs.length) return out;

  // Each item contributes its name and its producer as lookup candidates.
  const probes: Array<{ itemId: string; text: string }> = [];
  for (const i of needs) {
    for (const t of [i.parsed_name, i.parsed_producer]) {
      const text = (t ?? "").trim();
      if (text.length >= 3) probes.push({ itemId: i.id, text });
    }
  }
  if (!probes.length) return out;

  const { data, error } = await withTimeout(
    withValidSession(async () =>
      supabase.rpc(
        "lookup_appellations" as never,
        {
          _names: probes.map((p) => p.text),
        } as never,
      ),
    ),
    15_000,
    "Appellation lookup timed out",
  );

  if (error) {
    console.error("lookup_appellations failed", error);
    return out;
  }

  const best = new Map<string, AppellationRefRow>();
  for (const row of (data ?? []) as unknown as AppellationRefRow[]) {
    const probe = probes[row.idx - 1];
    if (!probe) continue;
    if (Number(row.score) < REF_THRESHOLD) continue;
    const prev = best.get(probe.itemId);
    if (!prev || Number(row.score) > Number(prev.score)) best.set(probe.itemId, row);
  }

  for (const item of needs) {
    const ref = best.get(item.id);
    if (!ref) continue;
    const refGrapes = toGrapeArray(ref.grapes);
    const wantGrapes = !item.grapes?.length && refGrapes.length > 0;
    const wantType = !item.wine_type && !!ref.typical_colour;
    if (!wantGrapes && !wantType) continue;
    out.set(item.id, {
      grapes: wantGrapes ? refGrapes : (item.grapes ?? []),
      wine_type: wantType ? (ref.typical_colour ?? null) : item.wine_type,
      fill: { appellation: ref.name, grapes: wantGrapes, wine_type: wantType },
    });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Scoring
 * ------------------------------------------------------------------ */

/** Words printed on the line, used to recognise a region or country the parser didn't split out. */
function lineText(item: MenuItemRow) {
  return normalise(
    `${item.parsed_name ?? ""} ${item.parsed_producer ?? ""} ${item.section_heading ?? ""} ${item.raw_text ?? ""}`,
  );
}

function monthOf(date: string) {
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-GB", { month: "long" });
}

function praise(e: DiaryWine) {
  if (e.rating) return `you rated ${e.rating}`;
  const m = monthOf(e.tasted_on);
  return m ? `you enjoyed in ${m}` : "you enjoyed";
}

export function scoreItem(
  item: MenuItemRow,
  profile: TasteProfile,
  filled: { grapes: string[]; wine_type: string | null; fill: ReferenceFill } | undefined,
): ScoredItem {
  const grapes = filled?.grapes.length ? filled.grapes : (item.grapes ?? []);
  const wine_type = filled?.wine_type ?? item.wine_type ?? null;
  const text = lineText(item);

  // The parser doesn't return region/country columns, so recognise them from
  // the printed words, plus anything the appellation reference told us.
  const findInText = (facet: Facet) => {
    let best: ReturnType<typeof facetHit> = null;
    for (const key of facet.weight.keys()) {
      if (key.length < 4 || !text.includes(key)) continue;
      const hit = facetHit(facet, key);
      if (hit && (!best || hit.share > best.share)) best = hit;
    }
    return best;
  };

  const grapeHits = grapes
    .map((g) => facetHit(profile.grapes, g))
    .filter((h): h is NonNullable<typeof h> => !!h)
    .sort((a, b) => b.share - a.share);
  const grapeHit = grapeHits[0] ?? findInText(profile.grapes);
  const regionHit = findInText(profile.regions);
  const countryHit = findInText(profile.countries);
  const typeHit = wine_type ? facetHit(profile.types, wine_type) : null;

  const score =
    (grapeHit ? W_GRAPE * grapeHit.share : 0) +
    (regionHit ? W_REGION * regionHit.share : 0) +
    (countryHit ? W_COUNTRY * countryHit.share : 0) +
    (typeHit ? W_TYPE * typeHit.share : 0);

  // A recommendation must always name the diary wine behind it.
  const primary = grapeHit ?? regionHit ?? countryHit ?? typeHit;
  const exemplar = primary?.exemplar ?? null;
  let reason: string | null = null;
  if (exemplar) {
    const where = regionHit?.label ?? countryHit?.label ?? null;
    const what = grapeHit
      ? titleCase(grapeHit.label)
      : wine_type
        ? `${titleCase(COLOUR_WORDS[wine_type] ?? wine_type)} wine`
        : "Wine";
    const head = where ? `${what} from ${titleCase(where)}` : what;
    reason = `${head}, like the ${exemplar.name} ${praise(exemplar)}`;
  }

  return {
    item,
    grapes,
    wine_type,
    region: regionHit?.label ?? null,
    country: countryHit?.label ?? null,
    filled: filled?.fill ?? null,
    score: Math.round(Math.min(1, score) * 1000) / 1000,
    reason,
    diary: null,
  };
}

/**
 * Score every readable line on the list. Never touches the wines table, so the
 * suggestions stand up even when catalogue matching is unavailable.
 */
export async function recommendMenu(
  items: MenuItemRow[],
  profile: TasteProfile,
): Promise<ScoredItem[]> {
  let filled = new Map<
    string,
    { grapes: string[]; wine_type: string | null; fill: ReferenceFill }
  >();
  try {
    filled = await fillFromAppellations(items);
  } catch (err) {
    // The reference is a bonus, not a dependency.
    console.error("Appellation fill failed", err);
  }
  return items.map((item) => scoreItem(item, profile, filled.get(item.id)));
}

/**
 * Log every scored item, not only the ones shown, so the suggestions can be
 * measured later against what the user actually ordered.
 */
export async function logRecommendations(args: {
  userId: string;
  scanId: string;
  scored: ScoredItem[];
  ratedCount: number;
}): Promise<void> {
  if (!args.scored.length) return;
  const ranked = [...args.scored].sort((a, b) => b.score - a.score);
  const rankOf = new Map(ranked.map((s, i) => [s.item.id, i + 1]));
  const rows = args.scored.map((s) => ({
    user_id: args.userId,
    menu_scan_id: args.scanId,
    menu_item_id: s.item.id,
    score: s.score,
    reason: s.reason,
    rank: rankOf.get(s.item.id) ?? null,
    profile_entry_count: args.ratedCount,
  }));
  const { error } = await supabase
    .from("recommendations" as never)
    .upsert(rows as never, { onConflict: "menu_item_id" });
  if (error) console.error("recommendations log failed", error);
}

/** The direct measure of whether a suggestion was any good. */
export async function markRecommendationActedOn(menuItemId: string): Promise<void> {
  const { error } = await supabase
    .from("recommendations" as never)
    .update({ acted_on: true } as never)
    .eq("menu_item_id", menuItemId);
  if (error) console.error("recommendation acted_on failed", error);
}

/**
 * The "you've had this" note. This is the ONLY part that depends on catalogue
 * matching, and it is layered on top of already-scored items.
 */
export function attachDiary(scored: ScoredItem[], entries: DiaryWine[]): ScoredItem[] {
  const byWineId = new Map<string, DiaryWine>();
  for (const e of entries) {
    const prev = byWineId.get(e.wineId);
    if (!prev || (e.rating ?? 0) > (prev.rating ?? 0)) byWineId.set(e.wineId, e);
  }
  return scored.map((s) => {
    let diary: DiaryWine | null = s.item.matched_wine_id
      ? (byWineId.get(s.item.matched_wine_id) ?? null)
      : null;
    if (!diary) {
      const t = lineText(s.item);
      for (const e of entries) {
        const n = normalise(e.name);
        if (n.length >= 6 && t.includes(n)) {
          if (!diary || (e.rating ?? 0) > (diary.rating ?? 0)) diary = e;
        }
      }
    }
    return diary ? { ...s, diary } : s;
  });
}
