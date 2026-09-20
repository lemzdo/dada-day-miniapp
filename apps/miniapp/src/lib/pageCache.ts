import {
  clearRuntimeQueryCache,
  clearRuntimeQueryCacheByPrefix,
  getRuntimeQueryCache,
  removeRuntimeQueryCache,
  setRuntimeQueryCache,
} from './runtimeQueryCache';

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
const DEFAULT_NAMESPACE = 'default';

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
  const runtimeRecord = getRuntimeQueryCache<T>(namespace, key);
  if (!runtimeRecord) return { hit: false, expired: false };
  const record: PageCacheRecord<T> = {
    key: runtimeRecord.key,
    data: runtimeRecord.data,
    createdAt: runtimeRecord.createdAt,
    ttl: runtimeRecord.ttl,
    schemaVersion: PAGE_CACHE_SCHEMA_VERSION,
    namespace: runtimeRecord.namespace,
    ...(runtimeRecord.meta ? { meta: runtimeRecord.meta } : {}),
  };
  return { hit: true, expired: false, record, data: record.data };
}

export async function setPageCache<T>(
  key: string,
  data: T,
  options: PageCacheSetOptions,
): Promise<void> {
  const namespace = normalizeNamespace(options.namespace);
  setRuntimeQueryCache(namespace, key, data, {
    ttl: options.ttl,
    ...(options.meta ? { meta: options.meta } : {}),
  });
}

export async function removePageCache(
  key: string,
  options: PageCacheOptions = {},
): Promise<void> {
  const namespace = normalizeNamespace(options.namespace);
  removeRuntimeQueryCache(namespace, key);
}

export async function clearPageCacheByPrefix(
  prefix: string,
  options: PageCacheOptions = {},
): Promise<void> {
  const namespace = normalizeNamespace(options.namespace);
  clearRuntimeQueryCacheByPrefix(namespace, prefix);
}

export async function clearAllPageCache(options: PageCacheOptions = {}): Promise<void> {
  clearRuntimeQueryCache(options.namespace ? normalizeNamespace(options.namespace) : undefined);
}

export function isPageCacheExpired(record: PageCacheRecord<unknown>): boolean {
  return Date.now() >= record.createdAt + record.ttl;
}

function normalizeNamespace(namespace?: string) {
  const normalized = namespace?.trim();
  return normalized || DEFAULT_NAMESPACE;
}
