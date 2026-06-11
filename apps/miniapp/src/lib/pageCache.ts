import Taro from '@tarojs/taro';

export interface PageCacheRecord<T> {
  key: string;
  data: T;
  createdAt: number;
  ttl: number;
  schemaVersion: string;
  namespace: string;
  meta?: Record<string, unknown>;
}

interface PageCacheOptions {
  namespace?: string;
}

interface PageCacheSetOptions extends PageCacheOptions {
  ttl: number;
  meta?: Record<string, unknown>;
}

interface PageCacheGetOptions extends PageCacheOptions {
  allowExpired?: boolean;
}

interface PageCacheResult<T> {
  hit: boolean;
  expired: boolean;
  record?: PageCacheRecord<T>;
  data?: T;
}

const PAGE_CACHE_SCHEMA_VERSION = 'page-cache-v1';
const PAGE_CACHE_STORAGE_PREFIX = 'd1d:pageCache:';
const DEFAULT_NAMESPACE = 'default';

const memoryCache = new Map<string, PageCacheRecord<unknown>>();

export function buildPageCacheKey(parts: Array<string | number | boolean | null | undefined>): string {
  return parts
    .filter((part) => part !== null && part !== undefined && String(part).trim() !== '')
    .map((part) => String(part))
    .join(':');
}

export async function getPageCache<T>(
  key: string,
  options: PageCacheGetOptions = {},
): Promise<PageCacheResult<T>> {
  const namespace = normalizeNamespace(options.namespace);
  const storageKey = getStorageKey(key, namespace);

  const memoryRecord = memoryCache.get(storageKey);
  if (memoryRecord) {
    const result = await resolveRecord<T>(memoryRecord, key, namespace, storageKey, options.allowExpired);
    if (result) return result;
  }

  const storageRecord = readStorageRecord(storageKey);
  if (!storageRecord) {
    return { hit: false, expired: false };
  }

  const result = await resolveRecord<T>(storageRecord, key, namespace, storageKey, options.allowExpired);
  if (!result) {
    return { hit: false, expired: false };
  }

  memoryCache.set(storageKey, storageRecord);
  return result;
}

export async function setPageCache<T>(
  key: string,
  data: T,
  options: PageCacheSetOptions,
): Promise<void> {
  const namespace = normalizeNamespace(options.namespace);
  const storageKey = getStorageKey(key, namespace);
  const record: PageCacheRecord<T> = {
    key,
    data,
    createdAt: Date.now(),
    ttl: options.ttl,
    schemaVersion: PAGE_CACHE_SCHEMA_VERSION,
    namespace,
    ...(options.meta ? { meta: options.meta } : {}),
  };

  memoryCache.set(storageKey, record);

  try {
    Taro.setStorageSync(storageKey, record);
  } catch (error) {
    console.warn('[pageCache] write storage failed', { key, namespace, error });
  }
}

export async function removePageCache(
  key: string,
  options: PageCacheOptions = {},
): Promise<void> {
  const namespace = normalizeNamespace(options.namespace);
  const storageKey = getStorageKey(key, namespace);
  memoryCache.delete(storageKey);
  removeStorageKey(storageKey);
}

export async function clearPageCacheByPrefix(
  prefix: string,
  options: PageCacheOptions = {},
): Promise<void> {
  const namespace = normalizeNamespace(options.namespace);
  const storagePrefix = getStorageKey(prefix, namespace);

  for (const key of memoryCache.keys()) {
    if (key.startsWith(storagePrefix)) {
      memoryCache.delete(key);
    }
  }

  clearStorageKeysByPrefix(storagePrefix);
}

export async function clearAllPageCache(options: PageCacheOptions = {}): Promise<void> {
  const storagePrefix = options.namespace
    ? `${PAGE_CACHE_STORAGE_PREFIX}${normalizeNamespace(options.namespace)}:`
    : PAGE_CACHE_STORAGE_PREFIX;

  for (const key of memoryCache.keys()) {
    if (key.startsWith(storagePrefix)) {
      memoryCache.delete(key);
    }
  }

  clearStorageKeysByPrefix(storagePrefix);
}

export function isPageCacheExpired(record: PageCacheRecord<unknown>): boolean {
  return Date.now() >= record.createdAt + record.ttl;
}

async function resolveRecord<T>(
  record: PageCacheRecord<unknown>,
  key: string,
  namespace: string,
  storageKey: string,
  allowExpired = false,
): Promise<PageCacheResult<T> | null> {
  if (!isValidPageCacheRecord(record) || record.schemaVersion !== PAGE_CACHE_SCHEMA_VERSION || record.namespace !== namespace) {
    await removePageCache(key, { namespace });
    return null;
  }

  const expired = isPageCacheExpired(record);
  if (expired && !allowExpired) {
    return { hit: false, expired: true };
  }

  memoryCache.set(storageKey, record);
  const typedRecord = record as PageCacheRecord<T>;
  return {
    hit: true,
    expired,
    record: typedRecord,
    data: typedRecord.data,
  };
}

function readStorageRecord(storageKey: string): PageCacheRecord<unknown> | null {
  try {
    const value = Taro.getStorageSync(storageKey) as unknown;
    if (!isValidPageCacheRecord(value)) {
      if (value !== '' && value !== null && value !== undefined) {
        removeStorageKey(storageKey);
      }
      return null;
    }
    return value;
  } catch (error) {
    console.warn('[pageCache] read storage failed', { storageKey, error });
    return null;
  }
}

function clearStorageKeysByPrefix(prefix: string) {
  try {
    const info = Taro.getStorageInfoSync();
    info.keys
      .filter((key) => key.startsWith(prefix))
      .forEach((key) => removeStorageKey(key));
  } catch (error) {
    console.warn('[pageCache] list storage keys failed', { prefix, error });
  }
}

function removeStorageKey(storageKey: string) {
  try {
    Taro.removeStorageSync(storageKey);
  } catch (error) {
    console.warn('[pageCache] remove storage failed', { storageKey, error });
  }
}

function getStorageKey(key: string, namespace: string) {
  return `${PAGE_CACHE_STORAGE_PREFIX}${namespace}:${key}`;
}

function normalizeNamespace(namespace?: string) {
  const normalized = namespace?.trim();
  return normalized || DEFAULT_NAMESPACE;
}

function isValidPageCacheRecord(value: unknown): value is PageCacheRecord<unknown> {
  if (!value || typeof value !== 'object') return false;

  const record = value as Record<string, unknown>;
  return (
    typeof record.key === 'string'
    && Object.prototype.hasOwnProperty.call(record, 'data')
    && typeof record.createdAt === 'number'
    && typeof record.ttl === 'number'
    && typeof record.schemaVersion === 'string'
    && typeof record.namespace === 'string'
    && (record.meta === undefined || isRecord(record.meta))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
