import Taro from '@tarojs/taro';
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

  try {
    const value = Taro.getStorageSync(storageKey) as T | '';
    return value === '' ? null : value;
  } catch (err) {
    console.warn('[userStorage] get failed:', err);
    return null;
  }
}

export function setUserStorageSync<T>(
  businessKey: string | readonly UserStorageKeyPart[],
  value: T,
  options: UserStorageOptions = {},
) {
  const storageKey = buildUserStorageKey(businessKey, options);
  if (!storageKey) return;

  try {
    Taro.setStorageSync(storageKey, value);
  } catch (err) {
    console.warn('[userStorage] set failed:', err);
  }
}

export function removeUserStorageSync(
  businessKey: string | readonly UserStorageKeyPart[],
  options: UserStorageOptions = {},
) {
  const storageKey = buildUserStorageKey(businessKey, options);
  if (!storageKey) return;

  try {
    Taro.removeStorageSync(storageKey);
  } catch (err) {
    console.warn('[userStorage] remove failed:', err);
  }
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
