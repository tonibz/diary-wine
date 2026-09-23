import { useCallback, useEffect, useRef, useState } from "react";

import { captureClientError } from "./sentry-browser";
import { errorFields, toError } from "./to-error";
import { withTimeout } from "./with-timeout";

/** Every screen read gets the same ceiling, so nothing can spin forever. */
export const READ_TIMEOUT_MS = 15_000;

/**
 * One shared way to load a screen's data: hard timeout, an error that reaches
 * the user, a retry, and a loading flag that is always cleared. Failures are
 * reported with the route only — never any of the user's own content.
 */
export function useAsyncData<T>(
  route: string,
  load: () => Promise<T>,
  deps: unknown[] = [],
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    withTimeout(loadRef.current(), READ_TIMEOUT_MS)
      .then((value) => {
        if (!alive) return;
        setData(value);
        setError(null);
      })
      .catch((e) => {
        if (!alive) return;
        const err = toError(e);
        setData(null);
        setError(err);
        captureClientError(err, { route, ...errorFields(e) });
      })
      .finally(() => {
        // Always: a failure must never leave the spinner running.
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, nonce, ...deps]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { data, error, loading, reload, setData };
}
