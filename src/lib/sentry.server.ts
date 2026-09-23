/**
 * Server-side error reporting for the Worker runtime.
 *
 * The Node/browser Sentry SDKs assume a host runtime we do not have, so this
 * posts a minimal envelope straight to the Sentry ingest endpoint with fetch.
 * Reads SENTRY_DSN from the environment at call time (never at module scope).
 */

import { errorFields, toError } from "./to-error";

type Dsn = { host: string; projectId: string; publicKey: string };

function parseDsn(dsn: string): Dsn | null {
  try {
    const url = new URL(dsn);
    const projectId = url.pathname.replace(/^\//, "");
    if (!projectId || !url.username) return null;
    return { host: url.host, projectId, publicKey: url.username };
  } catch {
    return null;
  }
}


export async function captureServerError(
  thrown: unknown,
  context?: Record<string, unknown>,
): Promise<void> {
  // Supabase rejects with plain { message, details, hint, code } objects, so
  // normalise first and keep the diagnostic fields as extra context.
  const error = toError(thrown);
  context = { ...context, ...errorFields(thrown) };
  const raw = process.env['SENTRY_DSN'];
  if (!raw) return;
  const dsn = parseDsn(raw);
  if (!dsn) return;

  const eventId = crypto.randomUUID().replace(/-/g, "");
  const sentAt = new Date().toISOString();
  const event = {
    event_id: eventId,
    timestamp: Date.now() / 1000,
    platform: "javascript",
    level: "error",
    server_name: undefined,
    environment: process.env['NODE_ENV'] ?? "production",
    tags: { runtime: "server" },
    extra: context,
    exception: {
      values: [
        {
          type: error instanceof Error ? error.name : "Error",
          value: error instanceof Error ? error.message : messageOf(error),
          stacktrace: undefined,
          mechanism: { type: "generic", handled: false },
        },
      ],
    },
    message: error instanceof Error ? undefined : { formatted: messageOf(error) },
    breadcrumbs: undefined,
    logentry: undefined,
    // Keep the raw stack readable in the issue body.
    contexts: { stack: { value: error instanceof Error ? error.stack : undefined } },
  };

  const envelope =
    JSON.stringify({ event_id: eventId, sent_at: sentAt, dsn: raw }) +
    "\n" +
    JSON.stringify({ type: "event" }) +
    "\n" +
    JSON.stringify(event) +
    "\n";

  try {
    await fetch(`https://${dsn.host}/api/${dsn.projectId}/envelope/`, {
      method: "POST",
      headers: {
        "content-type": "application/x-sentry-envelope",
        "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${dsn.publicKey}, sentry_client=wine-diary/1.0`,
      },
      body: envelope,
    });
  } catch {
    // Never let reporting break the request.
  }
}
