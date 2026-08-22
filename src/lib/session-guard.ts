import { supabase } from "@/integrations/supabase/client";

/**
 * A long menu read can outlive the access token. Any database call made straight
 * afterwards then fires with an expired (or not yet restored) JWT and comes back
 * 401 — which is what "find_wine_match 401" really was: not a grant problem.
 *
 * Everything here is about the token, never about permissions.
 */

export class SignedOutError extends Error {
  constructor() {
    super("Please sign in again");
    this.name = "SignedOutError";
  }
}

function looksLikeAuthFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; status?: unknown; message?: unknown };
  if (e.status === 401 || e.code === "401" || e.code === "PGRST301") return true;
  const message = typeof e.message === "string" ? e.message.toLowerCase() : "";
  return (
    message.includes("jwt") ||
    message.includes("unauthorized") ||
    message.includes("token is expired")
  );
}

/** Wait for a usable session, refreshing it when it is about to expire. */
export async function ensureFreshSession(): Promise<boolean> {
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session) return false;
  const expiresInMs = (session.expires_at ?? 0) * 1000 - Date.now();
  if (expiresInMs > 60_000) return true;
  const { data: refreshed } = await supabase.auth.refreshSession();
  return !!refreshed.session;
}

/**
 * Run a Supabase call with a valid token. On a 401 the session is refreshed
 * once and the call retried; if that fails the caller gets SignedOutError so it
 * can say "Please sign in again" instead of spinning.
 */
export async function withValidSession<T>(
  run: () => Promise<{ data: T; error: unknown }>,
): Promise<{ data: T; error: unknown }> {
  if (!(await ensureFreshSession())) throw new SignedOutError();
  const first = await run();
  if (!looksLikeAuthFailure(first.error)) return first;

  const { data: refreshed } = await supabase.auth.refreshSession();
  if (!refreshed.session) throw new SignedOutError();
  const second = await run();
  if (looksLikeAuthFailure(second.error)) throw new SignedOutError();
  return second;
}
