/**
 * Country name canonicalisation for comparing two renderings of the same
 * country ("USA" vs "United States"). Lowercases, strips accents and
 * punctuation, then resolves aliases in both directions.
 */

function strip(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** canonical form -> every accepted spelling (each entry also maps to itself) */
const ALIASES: Record<string, string[]> = {
  "united states": [
    "united states",
    "usa",
    "us",
    "united states of america",
    "estados unidos",
  ],
  "united kingdom": ["united kingdom", "uk", "great britain", "england", "reino unido"],
  germany: ["germany", "deutschland", "alemania"],
  spain: ["spain", "espana"],
  italy: ["italy", "italia"],
  france: ["france", "francia"],
  portugal: ["portugal"],
  "south africa": ["south africa", "republica de sudafrica", "sudafrica"],
  "new zealand": ["new zealand", "nueva zelanda"],
  australia: ["australia"],
  austria: ["austria", "osterreich"],
  argentina: ["argentina"],
  chile: ["chile"],
  brazil: ["brazil", "brasil"],
  mexico: ["mexico", "mejico"],
  switzerland: ["switzerland", "suiza", "schweiz"],
  hungary: ["hungary", "hungria", "magyarorszag"],
  greece: ["greece", "grecia"],
  romania: ["romania", "rumania"],
  moldova: ["moldova", "moldavia"],
  croatia: ["croatia", "croacia"],
  lebanon: ["lebanon", "libano", "liban"],
  georgia: ["georgia"],
  canada: ["canada"],
};

const LOOKUP = new Map<string, string>();
for (const [canonical, spellings] of Object.entries(ALIASES)) {
  for (const s of spellings) LOOKUP.set(strip(s), canonical);
}

/**
 * Canonical country form. Never throws and never returns empty for a
 * non-empty input: unknown values fall back to their normalised spelling.
 */
export function canonicalCountry(value: string): string {
  const normalised = strip(value);
  if (!normalised) return normalised;
  return LOOKUP.get(normalised) ?? normalised;
}
