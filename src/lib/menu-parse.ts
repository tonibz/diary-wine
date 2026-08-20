/** Shapes and cleanup shared by the menu reader and the client. */
export type MenuPriceSize = "glass" | "carafe" | "half_bottle" | "bottle" | "unknown";

export type MenuPrice = { size: MenuPriceSize; amount: number };

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
  confidence: number | null;
  truncated: boolean;
  /** true when the line describes a cocktail, spirit, beer or other non-wine */
  rejected: boolean;
};

const WINE_TYPES = ["red", "white", "rose", "sparkling", "dessert", "fortified"];

const PRICE_SIZES: MenuPriceSize[] = ["glass", "carafe", "half_bottle", "bottle", "unknown"];

/**
 * Last line of defence: the model is told to skip non-wine, but a cocktail that
 * slipped through is recognisable from the spirits and mixers in its description.
 */
const NON_WINE_WORDS =
  /\b(vodka|gin|rum|rhum|tequila|mezcal|whisk(?:e)?y|bourbon|rye|scotch|cognac|armagnac|brandy|absinthe|aperol|campari|bitters?|amaro|liqueu?r|schnapps|sake|soju|cachaca|cachaça|pisco|triple sec|curacao|curaçao|soda|tonic|juice|puree|purée|syrup|sirop|cordial|lager|pilsner|\bipa\b|stout|ale\b|cerveza|birra|cider|seltzer|kombucha|espresso|coffee|cold brew)\b/i;

export function isNonWineText(text: string | null | undefined): boolean {
  if (!text) return false;
  return NON_WINE_WORDS.test(text);
}

/** Any of the printed text that could betray a cocktail. */
export function looksNonWine(item: MenuParsedItem): boolean {
  return (
    isNonWineText(item.raw_text) || isNonWineText(item.name) || isNonWineText(item.producer)
  );
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

  const price = toNumber(it.price);
  const glass = toNumber(it.glass_price);
  const confidence = toNumber(it.confidence);

  return {
    raw_text: str(it.raw_text),
    name: str(it.name),
    producer: str(it.producer),
    vintage,
    grapes,
    price,
    glass_price: glass,
    by_the_glass: it.by_the_glass === true || glass !== null,
    wine_type: normaliseWineType(it.wine_type) ?? normaliseWineType(it.section_heading),
    section_heading: str(it.section_heading),
    confidence: confidence !== null ? Math.min(1, Math.max(0, confidence)) : null,
    truncated: it.truncated === true,
  };
}
