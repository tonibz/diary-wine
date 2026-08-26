import { i18next } from "@/i18n";

/** Stored values — never translated, only their display labels are. */
export const WINE_TYPES = [
  "red",
  "white",
  "rose",
  "sparkling",
  "dessert",
  "fortified",
] as const;

export type WineType = (typeof WINE_TYPES)[number];

/** Display label for a stored wine_type value in the active language. */
export function wineTypeLabel(value: string | null | undefined): string {
  if (!value) return "";
  const key = `wineType.${value}`;
  const label = i18next.t(key);
  return label === key ? value : label;
}

/** Options for pickers: stored value + translated label. */
export function wineTypeOptions(): Array<{ value: WineType; label: string }> {
  return WINE_TYPES.map((value) => ({ value, label: wineTypeLabel(value) }));
}
