import { useState, useCallback } from 'react';

export function useLoading(initial = false) {
  const [loading, setLoading] = useState(initial);

  const start = useCallback(() => setLoading(true), []);
  const stop = useCallback(() => setLoading(false), []);

  const wrap = useCallback(
    <T extends (...args: unknown[]) => Promise<unknown>>(fn: T): T =>
      ((...args: unknown[]) => {
        start();
        return fn(...args).finally(stop);
      }) as T,
    [start, stop],
  );

  return { loading, start, stop, wrap };
}
