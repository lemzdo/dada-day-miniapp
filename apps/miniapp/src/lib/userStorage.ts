import {
  getActiveAuthContext,
  isAuthContextCurrent,
  type ActiveAuthContext,
} from '@/stores/userStore';

type UserStorageKeyPart = string | number | boolean;

interface UserStorageOptions {
  authContext?: ActiveAuthContext | null;
}

const USER_STORAGE_PREFIX = 'd1d:userStorage:v1';
const MAX_RUNTIME_SIGNAL_ENTRIES = 64;
const runtimeSignals = new Map<string, unknown>();

export type { ActiveAuthContext };

export function buildUserStorageBusinessKey(...parts: UserStorageKeyPart[]) {
  return parts.map((part) => encodeUserStorageKeyPart(part)).join(':');
}

export function buildUserStorageKey(
  businessKey: string | readonly UserStorageKeyPart[],
  options: UserStorageOptions = {},
) {
  const authContext = resolveUsableAuthContext(options.authContext);
  if (!authContext) return null;

  const normalizedBusinessKey = Array.isArray(businessKey)
    ? buildUserStorageBusinessKey(...businessKey)
    : businessKey;

  return `${USER_STORAGE_PREFIX}:${authContext.userScope}:${normalizedBusinessKey}`;
}

export function getUserStorageSync<T>(
  businessKey: string | readonly UserStorageKeyPart[],
  options: UserStorageOptions = {},
): T | null {
  const storageKey = buildUserStorageKey(businessKey, options);
  if (!storageKey) return null;

  return runtimeSignals.has(storageKey) ? runtimeSignals.get(storageKey) as T : null;
}

export function setUserStorageSync<T>(
  businessKey: string | readonly UserStorageKeyPart[],
  value: T,
  options: UserStorageOptions = {},
) {
  const storageKey = buildUserStorageKey(businessKey, options);
  if (!storageKey) return;

  if (value === null || value === undefined) {
    runtimeSignals.delete(storageKey);
    return;
  }
  runtimeSignals.delete(storageKey);
  runtimeSignals.set(storageKey, value);
  while (runtimeSignals.size > MAX_RUNTIME_SIGNAL_ENTRIES) {
    const oldest = runtimeSignals.keys().next().value as string | undefined;
    if (!oldest) break;
    runtimeSignals.delete(oldest);
  }
}

export function removeUserStorageSync(
  businessKey: string | readonly UserStorageKeyPart[],
  options: UserStorageOptions = {},
) {
  const storageKey = buildUserStorageKey(businessKey, options);
  if (!storageKey) return;

  runtimeSignals.delete(storageKey);
}

export const getUserStorage = getUserStorageSync;
export const setUserStorage = setUserStorageSync;
export const removeUserStorage = removeUserStorageSync;

function resolveUsableAuthContext(authContext?: ActiveAuthContext | null): ActiveAuthContext | null {
  if (authContext !== undefined) {
    return authContext && isAuthContextCurrent(authContext) ? authContext : null;
  }

  return getActiveAuthContext();
}

function encodeUserStorageKeyPart(part: UserStorageKeyPart) {
  return encodeURIComponent(String(part));
}
