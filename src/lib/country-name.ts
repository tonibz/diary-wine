import type { TFunction } from "i18next";
import { i18next } from "@/i18n";
import en from "@/i18n/locales/en.json";
import { countryCode } from "@/lib/currency";

/** Canonical English spelling per ISO code; en.json's country block is the source of truth. */
const CANONICAL: Record<string, string> = en.country;

/**
 * Display-only: a stored country in the user's language. Unmapped values
 * show exactly as stored. Never use on an editable input.
 */
export function countryName(value: string | null | undefined, t: TFunction): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return "";
  const code = countryCode(trimmed);
  if (code && i18next.exists(`country.${code}`)) return t(`country.${code}`);
  return trimmed;
}

/** Persist-time: canonical English name, so "USA" and "United States" are one country. */
export function canonicalCountry(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  const code = countryCode(trimmed);
  return (code && CANONICAL[code]) || trimmed;
}
