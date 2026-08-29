import en from "./en.json";
import es from "./es.json";

/**
 * Adding a language: create ./<code>.json with the same shape as en.json,
 * import it here and add one entry below. Nothing else in the app changes.
 */
export const resources = {
  en: { translation: en },
  es: { translation: es },
} as const;

export const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]["code"];

export const FALLBACK_LANGUAGE: LanguageCode = "en";

/** Maps a browser language tag such as "es-419" onto a supported language. */
export function resolveLanguage(tag: string | undefined | null): LanguageCode {
  const base = (tag ?? "").toLowerCase().split("-")[0];
  const found = LANGUAGES.find((l) => l.code === base);
  return found ? found.code : FALLBACK_LANGUAGE;
}
