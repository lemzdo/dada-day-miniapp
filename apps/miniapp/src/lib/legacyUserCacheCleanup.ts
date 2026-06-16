import Taro from '@tarojs/taro';
import { CLOUD_ENV_ID } from '@/config/cloud';
import { clearAllPageCache } from '@/lib/pageCache';
import { buildCacheEnvironmentScope } from '@/lib/userScope';

const LEGACY_PAGE_CACHE_NAMESPACE = 'default';
const LEGACY_PAGE_CACHE_STORAGE_PREFIX = 'd1d:pageCache:default:';
const MIGRATION_MARKER_PREFIX = 'd1d:migration:user-cache-isolation:v1';

const LEGACY_EXACT_STORAGE_KEYS = [
  'today:outfitReturnSnapshot',
  'outfitStateSync',
  'wardrobeNeedsRefresh',
  'detailNeedsRefresh',
] as const;

const LEGACY_STORAGE_PREFIXES = [
  'outfitDetailDraft:',
  'uploadBatchImages:',
] as const;

type TaroWithAccountInfo = typeof Taro & {
  getAccountInfoSync?: () => { miniProgram?: { envVersion?: string } };
};

let cleanupPromise: Promise<void> | null = null;

export function cleanupLegacyUserCaches(): Promise<void> {
  if (cleanupPromise) return cleanupPromise;

  cleanupPromise = runCleanupLegacyUserCaches().finally(() => {
    cleanupPromise = null;
  });

  return cleanupPromise;
}

async function runCleanupLegacyUserCaches(): Promise<void> {
  try {
    const markerKey = getLegacyUserCacheMigrationMarkerKey();
    if (hasMigrationMarker(markerKey)) return;

    await clearAllPageCache({ namespace: LEGACY_PAGE_CACHE_NAMESPACE });

    const initialKeys = getStorageKeys();
    const legacyStorageKeys = collectLegacyStorageKeys(initialKeys);
    removeStorageKeys(legacyStorageKeys);

    const remainingLegacyKeys = collectLegacyStorageKeys(getStorageKeys());
    if (remainingLegacyKeys.length > 0) {
      console.warn('[legacyUserCacheCleanup] legacy keys remain; will retry on next launch', {
        keys: remainingLegacyKeys,
      });
      return;
    }

    Taro.setStorageSync(markerKey, true);
  } catch (error) {
    console.warn('[legacyUserCacheCleanup] cleanup failed; will retry on next launch', error);
  }
}

export function getLegacyUserCacheMigrationMarkerKey(): string {
  const envVersion = getMiniProgramEnvVersion();
  const environmentScope = buildCacheEnvironmentScope({
    envVersion,
    cloudEnvId: CLOUD_ENV_ID,
  });

  if (!environmentScope) {
    console.warn('[legacyUserCacheCleanup] failed to build environment scope; using unknown fallback');
    return `${MIGRATION_MARKER_PREFIX}:unknown:cloud:unknown`;
  }

  return `${MIGRATION_MARKER_PREFIX}:${environmentScope}`;
}

export function collectLegacyStorageKeys(keys: string[]): string[] {
  return keys.filter(isLegacyStorageKey);
}

function isLegacyStorageKey(key: string): boolean {
  return (
    key.startsWith(LEGACY_PAGE_CACHE_STORAGE_PREFIX)
    || LEGACY_EXACT_STORAGE_KEYS.includes(key as (typeof LEGACY_EXACT_STORAGE_KEYS)[number])
    || LEGACY_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))
  );
}

function hasMigrationMarker(markerKey: string): boolean {
  try {
    return Boolean(Taro.getStorageSync(markerKey));
  } catch (error) {
    console.warn('[legacyUserCacheCleanup] read migration marker failed; attempting cleanup', error);
    return false;
  }
}

function getStorageKeys(): string[] {
  const info = Taro.getStorageInfoSync();
  return Array.isArray(info.keys) ? info.keys : [];
}

function removeStorageKeys(keys: string[]) {
  const failedKeys: string[] = [];

  keys.forEach((key) => {
    try {
      Taro.removeStorageSync(key);
    } catch (error) {
      failedKeys.push(key);
      console.warn('[legacyUserCacheCleanup] remove storage key failed', { key, error });
    }
  });

  if (failedKeys.length > 0) {
    throw new Error(`Failed to remove legacy storage keys: ${failedKeys.join(', ')}`);
  }
}

function getMiniProgramEnvVersion(): string {
  try {
    const envVersion = (Taro as TaroWithAccountInfo).getAccountInfoSync?.().miniProgram?.envVersion;
    if (typeof envVersion === 'string' && envVersion) return envVersion;
  } catch (error) {
    console.warn('[legacyUserCacheCleanup] get envVersion failed; using unknown fallback', error);
    return 'unknown';
  }

  console.warn('[legacyUserCacheCleanup] envVersion unavailable; using unknown fallback');
  return 'unknown';
}
