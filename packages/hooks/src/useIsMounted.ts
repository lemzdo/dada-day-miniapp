import { useRef, useEffect } from 'react';

export function useIsMounted(): () => boolean {
  const ref = useRef(true);
  useEffect(() => {
    ref.current = true;
    return () => {
      ref.current = false;
    };
  }, []);
  return () => ref.current;
}
