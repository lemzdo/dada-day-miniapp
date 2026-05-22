import { useState, useCallback, useRef, useEffect } from 'react';
import type { RequestState } from '@starter-template/types';

export function useAsync<T, P extends unknown[] = []>(
  fn: (...args: P) => Promise<T>,
): [RequestState<T>, (...args: P) => Promise<T | null>, () => void] {
  const [state, setState] = useState<RequestState<T>>({
    data: null,
    loading: false,
    error: null,
  });
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const execute = useCallback(
    async (...args: P): Promise<T | null> => {
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const data = await fn(...args);
        if (mountedRef.current) {
          setState({ data, loading: false, error: null });
        }
        return data;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        if (mountedRef.current) {
          setState({ data: null, loading: false, error: message });
        }
        return null;
      }
    },
    [fn],
  );

  const reset = useCallback(() => {
    setState({ data: null, loading: false, error: null });
  }, []);

  return [state, execute, reset];
}
