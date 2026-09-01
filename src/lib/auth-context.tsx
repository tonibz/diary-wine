import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type AuthCtx = { user: User | null; session: Session | null; loading: boolean };
const Ctx = createContext<AuthCtx>({ user: null, session: null, loading: true });

/** True when the provider redirect dropped tokens in the URL (hash or query). */
export function hasOAuthTokensInUrl(): boolean {
  if (typeof window === "undefined") return false;
  const hash = window.location.hash.replace(/^#/, "");
  const search = window.location.search.replace(/^\?/, "");
  const hasToken = (s: string) =>
    s.includes("access_token=") || s.includes("refresh_token=") || s.includes("code=");
  return hasToken(hash) || hasToken(search);
}

/** Remove auth tokens from the address bar once the session is stored. */
export function cleanAuthTokensFromUrl() {
  if (typeof window === "undefined") return;
  if (!hasOAuthTokensInUrl()) return;
  const url = new URL(window.location.href);
  url.hash = "";
  for (const key of ["access_token", "refresh_token", "expires_at", "expires_in", "token_type", "type", "provider_token", "code", "state"]) {
    url.searchParams.delete(key);
  }
  window.history.replaceState({}, "", url.pathname + url.search);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      setLoading(false);
      if (s) cleanAuthTokensFromUrl();
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
      if (data.session) cleanAuthTokensFromUrl();
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <Ctx.Provider value={{ user: session?.user ?? null, session, loading }}>
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
