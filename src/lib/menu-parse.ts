/** Shapes and cleanup shared by the menu reader and the client. */
export type MenuPriceSize = "glass" | "carafe" | "half_bottle" | "bottle" | "unknown";

export type MenuPrice = { size: MenuPriceSize; amount: number };

/**
 * What one printed price actually buys. 'unknown' is deliberate: a price whose
 * serving we cannot establish is honest, whereas assuming a bottle silently
 * corrupts every later comparison between restaurants.
 */
export type ServingBasis = "glass" | "bottle" | "half_bottle" | "magnum" | "unknown";

export type MenuWineAttributes = {
  organic?: boolean;
  biodynamic?: boolean;
  natural?: boolean;
  vegan?: boolean;
};

export type MenuParsedItem = {
  raw_text: string | null;
  name: string | null;
  producer: string | null;
  vintage: number | null;
  grapes: string[];
  prices: MenuPrice[];
  price: number | null;
  glass_price: number | null;
  by_the_glass: boolean;
  wine_type: string | null;
  section_heading: string | null;
  /** e.g. "WINE BY THE GLASS" — governs the serving, across colour sub-headings */
  page_heading: string | null;
  serving_basis: ServingBasis;
  /** organic / biodynamic / natural / vegan markers, kept out of the wine name */
  attributes: MenuWineAttributes;
  confidence: number | null;
  truncated: boolean;
  /** true when the line describes a cocktail, spirit, beer or other non-wine */
  rejected: boolean;
};

const WINE_TYPES = ["red", "white", "rose", "sparkling", "dessert", "fortified"];

const PRICE_SIZES: MenuPriceSize[] = ["glass", "carafe", "half_bottle", "bottle", "unknown"];


/**
 * Last line of defence: the model is told to skip non-wine, but a cocktail, a
 * sake or a beer that slipped through is recognisable from its own words. A
 * section heading never counts here — a heading can never make a non-wine into
 * a wine, and mixed headings such as "SAKE, WHITE & ROSÉ BY THE GLASS" would
 * otherwise reject the wines printed underneath.
 */
const NON_WINE_WORDS =
  /\b(vodka|gin|rum|rhum|tequila|mezcal|whisk(?:e)?y|bourbon|rye|scotch|cognac|armagnac|brandy|absinthe|aperol|campari|bitters?|amaro|liqueu?r|schnapps|sake|saké|junmai|ginjo|daiginjo|honjozo|nigori|soju|shochu|makgeolli|cachaca|cachaça|pisco|triple sec|curacao|curaçao|soda|tonic|juice|puree|purée|syrup|sirop|cordial|spritzer|spritz|punch|cooler|beer|lager|pilsner|\bipa\b|stout|porter|ale\b|cerveza|birra|bier|cider|cidre|sidra|seltzer|kombucha|espresso|coffee|cold brew)\b/i;

export function isNonWineText(text: string | null | undefined): boolean {
  if (!text) return false;
  return NON_WINE_WORDS.test(text);
}

/** Any of the printed text that could betray a cocktail, sake or beer. */
export function looksNonWine(item: MenuParsedItem): boolean {
  return (
    isNonWineText(item.raw_text) || isNonWineText(item.name) || isNonWineText(item.producer)
  );
}

/**
 * Words that are never a wine name on their own: an angled photo with a cut-off
 * column produces fragments such as "at" or "la Figuera".
 */
/** Articles and prepositions a cut-off name is often left starting with. */
const LEADING_PARTICLES = new Set([
  "a", "al", "at", "the", "and", "of", "or", "by", "de", "del", "della", "delle", "di", "du",
  "des", "da", "do", "la", "le", "les", "el", "els", "lo", "los", "las", "il", "i", "y", "e",
  "en", "con", "und", "van", "von",
]);

const FRAGMENT_WORDS = new Set([
  "a", "al", "at", "the", "and", "of", "or", "by", "de", "del", "della", "delle", "di", "du",
  "des", "da", "do", "la", "le", "les", "el", "els", "lo", "los", "las", "il", "i", "y", "e",
  "en", "con", "und", "van", "von", "st", "ste", "san", "santa", "chateau", "château", "domaine",
  "bodega", "bodegas", "cantina", "celler", "cellers", "vino", "vin", "vins", "vi", "wine",
  "wines", "glass", "bottle", "copa", "botella", "ampolla", "cl", "ml", "nv",
]);

/**
 * A truncated line is not a wine we can trust. Reject names shorter than three
 * characters, and short fragments that are only common label filler or start
 * with an article, unless a producer was also read off the line.
 */
export function looksTruncatedName(
  name: string | null | undefined,
  producer: string | null | undefined,
): boolean {
  const n = (name ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!n) return true;
  if (producer && producer.trim()) return false;
  if (n.replace(/\s/g, "").length < 3) return true;
  const words = n.split(" ");
  if (words.every((w) => FRAGMENT_WORDS.has(w))) return true;
  // "la Figuera": an article or preposition plus one word is a cut-off name.
  if (words.length <= 2 && LEADING_PARTICLES.has(words[0]!)) return true;
  return false;
}



const SYMBOL_CURRENCY: Record<string, string> = {
  "€": "EUR",
  $: "USD",
  "£": "GBP",
  "¥": "JPY",
  "CHF": "CHF",
};

export function normaliseCurrency(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (!t) return null;
  for (const [sym, code] of Object.entries(SYMBOL_CURRENCY)) {
    if (t.includes(sym)) return code;
  }
  const letters = t.replace(/[^A-Za-z]/g, "").toUpperCase();
  return letters.length === 3 ? letters : null;
}

/** Handles decimal commas ("24,50") and stray currency symbols. */
export function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  let t = value.replace(/[^\d.,-]/g, "").trim();
  if (!t) return null;
  const lastComma = t.lastIndexOf(",");
  const lastDot = t.lastIndexOf(".");
  if (lastComma > lastDot) {
    t = t.replace(/\./g, "").replace(",", ".");
  } else {
    t = t.replace(/,/g, "");
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function normaliseWineType(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  if (WINE_TYPES.includes(t)) return t;
  // Section headings across the languages these lists are printed in.
  if (/\bros(e|at|ado|ados)\b|rosado|rosat|orange/.test(t)) return "rose";
  if (/champagne|cava|espumos|burbuja|spark|cremant|prosecco|escumos/.test(t)) return "sparkling";
  if (/blanc|blanco|bianco|white|weiss/.test(t)) return "white";
  if (/tinto|negre|rouge|rosso|\bred\b|rot/.test(t)) return "red";
  if (/dulce|dolc|dessert|postre|moscatel|sauternes/.test(t)) return "dessert";
  if (/jerez|sherry|oporto|\bport\b|fortified|generoso|vermut/.test(t)) return "fortified";
  return null;
}

/**
 * A heading is only usable when it names exactly one kind of drink:
 * "SAKE, WHITE & ROSÉ BY THE GLASS" tells us nothing about any single line.
 */
function headingWineType(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (/sake|soju|beer|cerveza|birra|cocktail|coctel|cider|spirit|gin|vodka|whisk/.test(t)) {
    return null;
  }
  const tests: Array<[string, RegExp]> = [
    ["white", /blanc|blanco|bianco|white|weiss/],
    ["red", /tinto|negre|rouge|rosso|\bred\b|rot/],
    ["rose", /\bros(e|at|ado|ados)\b|rosado|rosat|orange/],
    ["sparkling", /champagne|cava|espumos|burbuja|spark|cremant|prosecco|escumos/],
    ["dessert", /dulce|dolc|dessert|postre|moscatel|sauternes/],
    ["fortified", /jerez|sherry|oporto|\bport\b|fortified|generoso/],
  ];
  const hits = tests.filter(([, re]) => re.test(t)).map(([k]) => k);
  return hits.length === 1 ? hits[0]! : null;
}

function normalisePrices(value: unknown): MenuPrice[] {
  if (!Array.isArray(value)) return [];
  const out: MenuPrice[] = [];
  for (const p of value) {
    if (typeof p === "number" || typeof p === "string") {
      const amount = toNumber(p);
      if (amount !== null) out.push({ size: "unknown", amount });
      continue;
    }
    if (!p || typeof p !== "object") continue;
    const row = p as Record<string, unknown>;
    const amount = toNumber(row.amount ?? row.price);
    if (amount === null) continue;
    const rawSize = typeof row.size === "string" ? row.size.trim().toLowerCase() : "";
    const size = (PRICE_SIZES as string[]).includes(rawSize)
      ? (rawSize as MenuPriceSize)
      : /quartino|carafe/.test(rawSize)
        ? "carafe"
        : /half/.test(rawSize)
          ? "half_bottle"
          : /glass|copa|verre/.test(rawSize)
            ? "glass"
            : /bottle|botella|ampolla/.test(rawSize)
              ? "bottle"
              : "unknown";
    out.push({ size, amount });
  }
  return out;
}


/**
 * A page-level heading governs the serving of every wine below it. Nothing else
 * may decide the serving — in particular never the size of the number, since a
 * Barolo at 29 by the glass and a cheap bottle at 29 look identical.
 */
export function servingBasisFromHeading(heading: string | null | undefined): ServingBasis {
  if (!heading) return "unknown";
  const t = heading
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (/magnum/.test(t)) return "magnum";
  if (/half\s*bottle|demi\s*bouteille|media\s*botella|mitja\s*ampolla|375/.test(t)) {
    return "half_bottle";
  }
  if (/by the glass|\bglass(es)?\b|\bcopas?\b|\bverre\b|per bicchiere|al bicchiere/.test(t)) {
    return "glass";
  }
  if (/bottle|botellas?|ampolles?|ampolla|bouteille/.test(t)) return "bottle";
  return "unknown";
}

const ATTRIBUTE_PATTERNS: Array<[keyof MenuWineAttributes, RegExp]> = [
  ["biodynamic", /\b(biodynamic|biodinamic\w*|biodynamique|demeter)\b/i],
  ["organic", /\b(organic|ecologic\w*|ecol[oó]gico|biologic\w*|\bbio\b|\borg\b)\b/i],
  ["natural", /\b(natural|natural wine|vin naturel|vino naturale|nat\b)\b/i],
  ["vegan", /\b(vegan|vegano|veg[aà])\b/i],
];

/** Markers printed with the wine, taken from the model's list and the raw line. */
export function readAttributes(value: unknown, texts: Array<string | null>): MenuWineAttributes {
  const words: string[] = [];
  if (Array.isArray(value)) {
    for (const v of value) if (typeof v === "string") words.push(v);
  } else if (typeof value === "string") {
    words.push(value);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === true || v === "true") words.push(k);
    }
  }
  // Bracketed annotations only, from the printed line: a Château "Bio" is a name.
  for (const t of texts) {
    if (!t) continue;
    for (const m of t.matchAll(/[([{]([^)\]}]{2,40})[)\]}]/g)) words.push(m[1]!);
  }
  const joined = words.join(" | ");
  const out: MenuWineAttributes = {};
  for (const [key, re] of ATTRIBUTE_PATTERNS) if (re.test(joined)) out[key] = true;
  return out;
}

/**
 * "Clos Lentiscus (natural)" must be stored as "Clos Lentiscus": leaving the
 * marker in the name makes the same wine look different across restaurants.
 */
export function stripAttributeMarkers(name: string | null): string | null {
  if (!name) return name;
  let out = name;
  for (const m of [...name.matchAll(/\s*[([{]([^)\]}]{2,40})[)\]}]/g)]) {
    if (ATTRIBUTE_PATTERNS.some(([, re]) => re.test(m[1]!))) out = out.replace(m[0], " ");
  }
  out = out
    .replace(/\s*[-–,]?\s*\b(organic|biodynamic|biodynamique|natural wine|vegan)\b\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return out || null;
}

export function normaliseMenuItem(it: Record<string, unknown>): MenuParsedItem {
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const vintageRaw = toNumber(it.vintage);
  const thisYear = new Date().getUTCFullYear();
  const vintage =
    vintageRaw !== null && Number.isInteger(vintageRaw) && vintageRaw >= 1900 && vintageRaw <= thisYear
      ? vintageRaw
      : null;

  const grapes = Array.isArray(it.grapes)
    ? it.grapes.flatMap((g) => (typeof g === "string" && g.trim() ? [g.trim()] : []))
    : typeof it.grapes === "string"
      ? it.grapes
          .split(/,| i | y | and /i)
          .map((g) => g.trim())
          .filter(Boolean)
      : [];

  const prices = normalisePrices(it.prices);
  const amounts = prices.map((p) => p.amount);
  const bottle = prices.find((p) => p.size === "bottle")?.amount ?? null;
  const glassSized = prices.find((p) => p.size === "glass")?.amount ?? null;

  const pageHeading = str(it.page_heading);
  const headingBasis = servingBasisFromHeading(pageHeading);

  // The largest is the bottle and the smallest the glass, as printed.
  let price = toNumber(it.price) ?? bottle ?? (amounts.length ? Math.max(...amounts) : null);
  let glass =
    toNumber(it.glass_price) ??
    glassSized ??
    (amounts.length > 1 ? Math.min(...amounts) : null);

  // A by-the-glass page means a lone price is a glass price. Recorded as a
  // bottle price it is nonsense and would dominate any cross-venue comparison.
  if (headingBasis === "glass" && glass === null && price !== null && amounts.length <= 1) {
    glass = price;
    price = null;
  }

  const servingBasis: ServingBasis =
    headingBasis !== "unknown"
      ? headingBasis
      : bottle !== null
        ? "bottle"
        : glassSized !== null && price === null
          ? "glass"
          : "unknown";

  const confidence = toNumber(it.confidence);
  const rawName = str(it.name);

  const item: MenuParsedItem = {
    raw_text: str(it.raw_text),
    name: stripAttributeMarkers(rawName),
    producer: str(it.producer),
    vintage,
    grapes,
    prices: prices.length
      ? prices
      : glass !== null && price === null
        ? [{ size: "glass", amount: glass }]
        : price !== null
          ? [{ size: servingBasis === "bottle" || servingBasis === "half_bottle" || servingBasis === "glass" ? servingBasis : "unknown", amount: price }]
          : [],
    price,
    glass_price: glass,
    by_the_glass: it.by_the_glass === true || glass !== null || servingBasis === "glass",
    wine_type: normaliseWineType(it.wine_type) ?? headingWineType(it.section_heading),
    section_heading: str(it.section_heading),
    page_heading: pageHeading,
    serving_basis: servingBasis,
    attributes: readAttributes(it.attributes, [rawName, str(it.raw_text)]),
    confidence: confidence !== null ? Math.min(1, Math.max(0, confidence)) : null,
    // The model's own truncated flag is kept, and we add our own judgement: a
    // fragment of a name is never saved as a confident wine.
    truncated: it.truncated === true || looksTruncatedName(rawName, str(it.producer)),
    rejected: false,
  };
  item.rejected = looksNonWine(item);
  return item;


}
