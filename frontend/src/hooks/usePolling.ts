import { useCallback, useEffect, useRef, useState } from 'react';

export interface PollingResult<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** Re-run immediately and restart the interval. */
  refresh: () => void;
}

/**
 * Polls an async loader, aborts in-flight requests when dependencies change,
 * pauses while the tab is hidden, and keeps the last good data on errors so a
 * transient failure does not blank the dashboard.
 */
export function usePolling<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  intervalMs: number,
  deps: readonly unknown[],
): PollingResult<T> {
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    let controller: AbortController | null = null;
    let timer: number | undefined;

    const run = async () => {
      controller?.abort();
      controller = new AbortController();
      try {
        const next = await loaderRef.current(controller.signal);
        if (cancelled) return;
        setData(next);
        setError(null);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Request failed');
        setLoading(false);
      }
    };

    const startTimer = () => {
      window.clearInterval(timer);
      timer = window.setInterval(() => {
        if (!document.hidden) void run();
      }, intervalMs);
    };

    void run();
    startTimer();

    const onVisibilityChange = () => {
      if (!document.hidden) {
        void run();
        startTimer();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      controller?.abort();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
    // The caller owns the dependency list; `nonce` is an explicit refresh trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, nonce, ...deps]);

  return { data, error, loading, refresh };
}
