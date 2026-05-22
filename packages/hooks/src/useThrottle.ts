import { useRef, useCallback } from 'react';

export function useThrottle<T extends (...args: unknown[]) => void>(fn: T, interval: number): T {
  const lastRef = useRef(0);
  return useCallback(
    ((...args: unknown[]) => {
      const now = Date.now();
      if (now - lastRef.current >= interval) {
        lastRef.current = now;
        fn(...args);
      }
    }) as T,
    [fn, interval],
  );
}
