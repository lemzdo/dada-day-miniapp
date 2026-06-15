import { buildAuthRuntimeKey } from '@/lib/userRuntimeScope';
import { useUserStore, type AuthStatus } from '@/stores/userStore';

interface AuthRuntime {
  authStatus: AuthStatus;
  userScope: string | null;
  authEpoch: number;
  runtimeKey: string | null;
  isAuthenticated: boolean;
}

export function useAuthRuntime(): AuthRuntime {
  const authStatus = useUserStore((state) => state.authStatus);
  const userScope = useUserStore((state) => state.userScope);
  const confirmedOpenid = useUserStore((state) => state.confirmedOpenid);
  const authEpoch = useUserStore((state) => state.authEpoch);
  const isAuthenticated = authStatus === 'authenticated' && Boolean(userScope && confirmedOpenid);
  const runtimeKey = isAuthenticated
    ? buildAuthRuntimeKey({
        userScope: userScope!,
        confirmedOpenid: confirmedOpenid!,
        authEpoch,
      })
    : null;

  return {
    authStatus,
    userScope,
    authEpoch,
    runtimeKey,
    isAuthenticated,
  };
}
