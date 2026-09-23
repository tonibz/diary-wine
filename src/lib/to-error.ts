/**
 * Turn anything that was thrown into a real Error without losing what it said.
 *
 * Supabase does not reject with Error objects. A failed query rejects with a
 * plain object: { message, details, hint, code }. Wrapping one of those with
 * new Error(String(e)) yields the literal string "[object Object]", which is
 * what two of the six issues in Sentry were called: reported, counted and
 * unreadable. Anything that reaches Sentry has to carry its own message.
 */

function readString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number") return String(value);
  return undefined;
}

/** The best Error available for a thrown value. Never throws itself. */
export function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  if (typeof value === "string" && value.trim()) return new Error(value);
  if (typeof value === "object" && value !== null) {
    const source = value as Record<string, unknown>;
    const message =
      readString(source, "message") ??
      readString(source, "error_description") ??
      readString(source, "error");
    if (message) {
      const err = new Error(message);
      const name = readString(source, "name");
      if (name) err.name = name;
      return err;
    }
    // Nothing message-shaped: keep the object's own shape rather than lose it
    // to "[object Object]". JSON.stringify throws on cycles, hence the guard.
    try {
      const json = JSON.stringify(value);
      if (json && json !== "{}") return new Error(json);
    } catch {
      // fall through
    }
    return new Error(Object.prototype.toString.call(value));
  }
  return new Error(String(value));
}

/**
 * The diagnostic fields a Supabase error carries, for Sentry's extra context.
 * Returns an empty object for anything that has none, so it is always safe to
 * spread into a context object.
 */
export function errorFields(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null) return {};
  const source = value as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const key of ["code", "details", "hint", "status", "statusCode"]) {
    const found = readString(source, key);
    if (found) out[key] = found;
  }
  return out;
}
