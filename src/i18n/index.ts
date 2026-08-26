import i18next from "i18next";
import { initReactI18next } from "react-i18next";

import { FALLBACK_LANGUAGE, resources, resolveLanguage, type LanguageCode } from "./locales";

if (!i18next.isInitialized) {
  i18next.use(initReactI18next).init({
    resources,
    // Server render and first paint are always the fallback language; the real
    // language is applied after hydration (see LanguageProvider) so SSR markup
    // and client markup never disagree.
    lng: FALLBACK_LANGUAGE,
    fallbackLng: FALLBACK_LANGUAGE,
    defaultNS: "translation",
    interpolation: { escapeValue: false },
    returnNull: false,
  });
}

export { i18next, resolveLanguage };
export type { LanguageCode };

/** Best-effort browser language, used before we know the user's saved choice. */
export function detectBrowserLanguage(): LanguageCode {
  if (typeof navigator === "undefined") return FALLBACK_LANGUAGE;
  const tags = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of tags) {
    const resolved = resolveLanguage(tag);
    if (resolved !== FALLBACK_LANGUAGE) return resolved;
  }
  return resolveLanguage(navigator.language);
}

export const LANGUAGE_STORAGE_KEY = "wine-diary-language";
