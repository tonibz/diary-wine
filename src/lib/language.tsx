import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { i18next, detectBrowserLanguage, LANGUAGE_STORAGE_KEY, type LanguageCode } from "@/i18n";
import { FALLBACK_LANGUAGE, resolveLanguage } from "@/i18n/locales";
import { supabase } from "@/integrations/supabase/client";

type LanguageCtx = {
  language: LanguageCode;
  setLanguage: (code: LanguageCode) => void;
};

const Ctx = createContext<LanguageCtx>({ language: FALLBACK_LANGUAGE, setLanguage: () => {} });

function readStored(): LanguageCode | null {
  try {
    const v = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return v ? resolveLanguage(v) : null;
  } catch {
    return null;
  }
}

async function readProfileLanguage(): Promise<LanguageCode | null> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("language")
    .eq("id", data.user.id)
    .maybeSingle();
  const value = (profile as { language?: string | null } | null)?.language;
  return value ? resolveLanguage(value) : null;
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<LanguageCode>(FALLBACK_LANGUAGE);

  const apply = useCallback((code: LanguageCode) => {
    setLanguageState(code);
    if (i18next.language !== code) void i18next.changeLanguage(code);
    if (typeof document !== "undefined") document.documentElement.lang = code;
  }, []);

  // After hydration: saved choice wins, then the browser's language.
  useEffect(() => {
    apply(readStored() ?? detectBrowserLanguage());
    readProfileLanguage()
      .then((fromProfile) => {
        if (fromProfile) {
          apply(fromProfile);
          try {
            localStorage.setItem(LANGUAGE_STORAGE_KEY, fromProfile);
          } catch {
            /* storage unavailable */
          }
        }
      })
      .catch(() => {
        /* not signed in yet */
      });
  }, [apply]);

  const setLanguage = useCallback(
    (code: LanguageCode) => {
      apply(code);
      try {
        localStorage.setItem(LANGUAGE_STORAGE_KEY, code);
      } catch {
        /* storage unavailable */
      }
      void supabase.auth.getUser().then(({ data }) => {
        if (!data.user) return;
        void supabase.from("profiles").upsert({ id: data.user.id, language: code });
      });
    },
    [apply],
  );

  return <Ctx.Provider value={{ language, setLanguage }}>{children}</Ctx.Provider>;
}

export const useLanguage = () => useContext(Ctx);
