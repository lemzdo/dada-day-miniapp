export interface RuntimeQueryCacheRecord<T> {
  key: string;
  data: T;
  createdAt: number;
  lastAccessedAt: number;
  expiresAt: number;
  ttl: number;
  namespace: string;
  meta?: Record<string, unknown>;
}

interface RuntimeQueryCacheSetOptions {
  ttl: number;
  maxEntries?: number;
  meta?: Record<string, unknown>;
  now?: number;
}

interface RuntimeQueryCacheGetOptions {
  now?: number;
}

const DEFAULT_MAX_ENTRIES = 32;
const cache = new Map<string, RuntimeQueryCacheRecord<unknown>>();

export function getRuntimeQueryCache<T>(
  namespace: string,
  key: string,
  options: RuntimeQueryCacheGetOptions = {},
): RuntimeQueryCacheRecord<T> | null {
  const now = options.now ?? Date.now();
  pruneExpiredRuntimeQueryCache(now);
  const storageKey = buildRuntimeStorageKey(namespace, key);
  const record = cache.get(storageKey);
  if (!record) return null;

  const touched = { ...record, lastAccessedAt: now };
  cache.delete(storageKey);
  cache.set(storageKey, touched);
  return touched as RuntimeQueryCacheRecord<T>;
}

export function setRuntimeQueryCache<T>(
  namespace: string,
  key: string,
  data: T,
  options: RuntimeQueryCacheSetOptions,
): RuntimeQueryCacheRecord<T> {
  const now = options.now ?? Date.now();
  const ttl = Math.max(0, options.ttl);
  const normalizedNamespace = normalizeNamespace(namespace);
  const storageKey = buildRuntimeStorageKey(normalizedNamespace, key);
  pruneExpiredRuntimeQueryCache(now);

  const record: RuntimeQueryCacheRecord<T> = {
    key,
    data,
    createdAt: now,
    lastAccessedAt: now,
    expiresAt: now + ttl,
    ttl,
    namespace: normalizedNamespace,
    ...(options.meta ? { meta: options.meta } : {}),
  };
  cache.delete(storageKey);
  cache.set(storageKey, record);
  enforceNamespaceCap(normalizedNamespace, Math.max(1, options.maxEntries ?? DEFAULT_MAX_ENTRIES));
  return record;
}

export function removeRuntimeQueryCache(namespace: string, key: string): void {
  cache.delete(buildRuntimeStorageKey(namespace, key));
}

export function clearRuntimeQueryCacheByPrefix(namespace: string, prefix: string): void {
  const normalizedNamespace = normalizeNamespace(namespace);
  for (const [storageKey, record] of cache) {
    if (record.namespace === normalizedNamespace && record.key.startsWith(prefix)) {
      cache.delete(storageKey);
    }
  }
}

export function clearRuntimeQueryCache(namespace?: string): void {
  if (!namespace) {
    cache.clear();
    return;
  }
  clearRuntimeQueryCacheByPrefix(namespace, '');
}

export function pruneExpiredRuntimeQueryCache(now = Date.now()): number {
  let removed = 0;
  for (const [storageKey, record] of cache) {
    if (now >= record.expiresAt) {
      cache.delete(storageKey);
      removed += 1;
    }
  }
  return removed;
}

export function getRuntimeQueryCacheSize(namespace?: string, now = Date.now()): number {
  pruneExpiredRuntimeQueryCache(now);
  if (!namespace) return cache.size;
  const normalizedNamespace = normalizeNamespace(namespace);
  let count = 0;
  for (const record of cache.values()) {
    if (record.namespace === normalizedNamespace) count += 1;
  }
  return count;
}

function enforceNamespaceCap(namespace: string, maxEntries: number): void {
  const entries = [...cache.entries()].filter(([, record]) => record.namespace === namespace);
  const removeCount = entries.length - maxEntries;
  if (removeCount <= 0) return;
  entries
    .sort(([, left], [, right]) => left.lastAccessedAt - right.lastAccessedAt)
    .slice(0, removeCount)
    .forEach(([storageKey]) => cache.delete(storageKey));
}

function buildRuntimeStorageKey(namespace: string, key: string): string {
  return `${normalizeNamespace(namespace)}\u0000${key}`;
}

function normalizeNamespace(namespace: string): string {
  const normalized = namespace.trim();
  return normalized || 'default';
}
