import { createFileRoute } from "@tanstack/react-router";

import { captureServerError } from "@/lib/sentry.server";

/**
 * Deliberate server-side error, used once to prove reporting works end to end.
 * Reports nothing but a synthetic error; no user data involved.
 */
export const Route = createFileRoute("/api/public/sentry-test")({
  server: {
    handlers: {
      GET: async () => {
        const error = new Error("Wine Diary server test error (deliberate)");
        await captureServerError(error, { route: "/api/public/sentry-test" });
        return new Response(JSON.stringify({ reported: true }), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
