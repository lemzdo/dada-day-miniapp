import {
  clearPageCacheByPrefix,
  getPageCache,
  removePageCache,
  setPageCache,
} from './pageCache';
import {
  getActiveAuthContext,
  isAuthContextCurrent,
  type ActiveAuthContext,
} from '@/stores/userStore';

export { captureAuthContext, isAuthContextCurrent } from '@/stores/userStore';
export type { ActiveAuthContext } from '@/stores/userStore';

interface UserPageCacheOptions {
  authContext?: ActiveAuthContext | null;
}

interface UserPageCacheGetOptions extends UserPageCacheOptions {
  allowExpired?: boolean;
}

interface UserPageCacheSetOptions extends UserPageCacheOptions {
  ttl: number;
  meta?: Record<string, unknown>;
}

interface UserPageCacheResult<T> {
  hit: boolean;
  expired: boolean;
  data?: T;
  record?: {
    key: string;
    data: T;
    createdAt: number;
    ttl: number;
    schemaVersion: string;
    namespace: string;
    meta?: Record<string, unknown>;
  };
}

const CACHE_MISS = { hit: false, expired: false } as const;

export async function getUserPageCache<T>(
  key: string,
  options: UserPageCacheGetOptions = {},
): Promise<UserPageCacheResult<T>> {
  const authContext = resolveUsableAuthContext(options.authContext);
  if (!authContext) return CACHE_MISS;

  return getPageCache<T>(key, {
    namespace: authContext.userScope,
    allowExpired: options.allowExpired,
  });
}

export async function setUserPageCache<T>(
  key: string,
  data: T,
  options: UserPageCacheSetOptions,
): Promise<void> {
  const authContext = resolveUsableAuthContext(options.authContext);
  if (!authContext) return;

  await setPageCache(key, data, {
    namespace: authContext.userScope,
    ttl: options.ttl,
    meta: options.meta,
  });
}

export async function removeUserPageCache(
  key: string,
  options: UserPageCacheOptions = {},
): Promise<void> {
  const authContext = resolveUsableAuthContext(options.authContext);
  if (!authContext) return;

  await removePageCache(key, { namespace: authContext.userScope });
}

export async function clearUserPageCacheByPrefix(
  prefix: string,
  options: UserPageCacheOptions = {},
): Promise<void> {
  const authContext = resolveUsableAuthContext(options.authContext);
  if (!authContext) return;

  await clearPageCacheByPrefix(prefix, { namespace: authContext.userScope });
}

export async function clearCurrentUserPageCache(options: UserPageCacheOptions = {}): Promise<void> {
  await clearUserPageCacheByPrefix('', options);
}

function resolveUsableAuthContext(authContext?: ActiveAuthContext | null): ActiveAuthContext | null {
  if (authContext !== undefined) {
    return authContext && isAuthContextCurrent(authContext) ? authContext : null;
  }

  return getActiveAuthContext();
}
