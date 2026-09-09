import * as Sentry from "@sentry/react";

let started = false;

/**
 * Browser-side error reporting. The DSN is public by design: it only allows
 * sending events, never reading them, so it ships in the bundle.
 */
export function initSentryClient() {
  if (started) return;
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return;
  started = true;
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    // Uncaught errors and unhandled promise rejections are captured by default.
    sendDefaultPii: false,
    tracesSampleRate: 0,
  });
}

/** Attach non-sensitive context: never photos, notes or menu content. */
export function setSentryUserContext(ctx: {
  userId?: string | null;
  language?: string | null;
}) {
  if (!started) return;
  if (ctx.userId) Sentry.setUser({ id: ctx.userId });
  else Sentry.setUser(null);
  if (ctx.language) Sentry.setTag("language", ctx.language);
}

export function captureClientError(error: unknown, context?: Record<string, unknown>) {
  if (!started) return;
  Sentry.captureException(error, context ? { extra: context } : undefined);
}
