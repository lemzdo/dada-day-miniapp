import { useEffect, useRef, type MutableRefObject } from 'react';
import { useAuthRuntime } from '@/hooks/useAuthRuntime';
import type { AuthStatus } from '@/stores/userStore';

interface BoundUserFlowOptions {
  onBind?: (runtimeKey: string) => void;
  onInvalidate?: () => void;
}

interface BoundUserFlow {
  authStatus: AuthStatus;
  runtimeKey: string | null;
  isAuthenticated: boolean;
  boundRuntimeKeyRef: MutableRefObject<string | null>;
  flowInvalidatedRef: MutableRefObject<boolean>;
  isFlowActive: (flowRuntimeKey?: string | null) => boolean;
}

export function useBoundUserFlow(options: BoundUserFlowOptions = {}): BoundUserFlow {
  const { authStatus, runtimeKey, isAuthenticated } = useAuthRuntime();
  const boundRuntimeKeyRef = useRef<string | null>(null);
  const flowInvalidatedRef = useRef(false);
  const invalidationHandledRef = useRef(false);
  const onBindRef = useRef(options.onBind);
  const onInvalidateRef = useRef(options.onInvalidate);

  useEffect(() => {
    onBindRef.current = options.onBind;
    onInvalidateRef.current = options.onInvalidate;
  }, [options.onBind, options.onInvalidate]);

  useEffect(() => {
    if (isAuthenticated && runtimeKey) {
      if (!boundRuntimeKeyRef.current && !flowInvalidatedRef.current) {
        boundRuntimeKeyRef.current = runtimeKey;
        onBindRef.current?.(runtimeKey);
        return;
      }

      if (boundRuntimeKeyRef.current !== runtimeKey) {
        invalidateFlow();
      }
      return;
    }

    if (authStatus === 'anonymous' || authStatus === 'failed') {
      invalidateFlow();
    }
  }, [authStatus, isAuthenticated, runtimeKey]);

  function invalidateFlow() {
    flowInvalidatedRef.current = true;
    if (invalidationHandledRef.current) return;
    invalidationHandledRef.current = true;
    onInvalidateRef.current?.();
  }

  function isFlowActive(flowRuntimeKey: string | null = boundRuntimeKeyRef.current) {
    return Boolean(
      flowRuntimeKey
        && !flowInvalidatedRef.current
        && boundRuntimeKeyRef.current === flowRuntimeKey,
    );
  }

  return {
    authStatus,
    runtimeKey,
    isAuthenticated,
    boundRuntimeKeyRef,
    flowInvalidatedRef,
    isFlowActive,
  };
}
