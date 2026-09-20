const test = require('node:test');
const assert = require('node:assert/strict');

const corePromise = import('./core.mjs');

function createMemoryAdapter({ failures = 0 } = {}) {
  const values = new Map();
  let writes = 0;
  let remainingFailures = failures;

  return {
    values,
    get writes() {
      return writes;
    },
    keys: () => [...values.keys()],
    get: (key) => values.get(key),
    set: (key, value) => {
      writes += 1;
      if (remainingFailures > 0) {
        remainingFailures -= 1;
        throw new Error('storage quota exceeded');
      }
      values.set(key, value);
    },
    remove: (key) => values.delete(key),
  };
}

function cacheContract(overrides = {}) {
  return {
    enabled: true,
    owner: 'test',
    classification: 'BOOTSTRAP_CACHE',
    sourceOfTruth: 'test source',
    crossSessionNeed: 'test only',
    recomputable: true,
    ttlMs: 1_000,
    maxEntries: 2,
    maxBytes: 16 * 1024,
    evictable: true,
    evictionPolicy: 'EXPIRE_THEN_LRU',
    migrationVersion: 1,
    ...overrides,
  };
}

test('deny-by-default rejects unregistered long-lived namespaces', async () => {
  const { createStorageCore } = await corePromise;
  const adapter = createMemoryAdapter();
  const storage = createStorageCore({ registry: {}, adapter });

  const result = storage.write('unknown:snapshot', { full: true });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'rejected-unregistered');
  assert.equal(adapter.writes, 0);
});

test('expired records are physically removed on read', async () => {
  const { createStorageCore } = await corePromise;
  const adapter = createMemoryAdapter();
  const storage = createStorageCore({
    registry: { cache: cacheContract({ ttlMs: 100 }) },
    adapter,
    now: () => 0,
  });

  assert.equal(storage.write('cache', { value: 1 }, { now: 0 }).ok, true);
  assert.equal(adapter.values.size, 1);
  assert.equal(storage.read('cache', { now: 101 }), null);
  assert.equal(adapter.values.size, 0);
});

test('UTF-8 byte cap counts multibyte payloads and fails cache open', async () => {
  const { createStorageCore, utf8ByteLength } = await corePromise;
  const adapter = createMemoryAdapter();
  const storage = createStorageCore({
    registry: { cache: cacheContract({ maxBytes: 120 }) },
    adapter,
  });

  assert.equal(utf8ByteLength('搭搭day'), 9);
  const result = storage.write('cache', { text: '搭'.repeat(80) });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'cache-skipped');
  assert.equal(result.reason, 'namespace-byte-cap');
  assert.equal(adapter.writes, 0);
});

test('namespace cap evicts only entries from an evictable namespace', async () => {
  const { createStorageCore } = await corePromise;
  const adapter = createMemoryAdapter();
  const storage = createStorageCore({
    registry: {
      cache: cacheContract({ maxEntries: 2 }),
      auth: cacheContract({
        classification: 'USER_CRITICAL',
        ttlMs: null,
        maxEntries: 1,
        evictable: false,
        evictionPolicy: 'PROTECTED',
      }),
    },
    adapter,
  });

  storage.write('auth', { userId: 'u1' }, { entryId: 'current', now: 1 });
  storage.write('cache', { value: 1 }, { entryId: 'one', now: 1 });
  storage.write('cache', { value: 2 }, { entryId: 'two', now: 2 });
  storage.write('cache', { value: 3 }, { entryId: 'three', now: 3 });

  assert.deepEqual(storage.read('auth', { entryId: 'current', now: 3 })?.payload, { userId: 'u1' });
  assert.equal(storage.read('cache', { entryId: 'one', now: 3 }), null);
  assert.deepEqual(storage.read('cache', { entryId: 'three', now: 3 })?.payload, { value: 3 });
});

test('crossing high-water collects back to the high-water target', async () => {
  const { createStorageCore } = await corePromise;
  const adapter = createMemoryAdapter();
  const storage = createStorageCore({
    registry: { cache: cacheContract({ maxEntries: 10, maxBytes: 16 * 1024 }) },
    adapter,
    highWaterBytes: 800,
    softLimitBytes: 1_200,
  });

  storage.write('cache', { text: 'a'.repeat(260) }, { entryId: 'one', now: 1 });
  storage.write('cache', { text: 'b'.repeat(260) }, { entryId: 'two', now: 2 });
  storage.write('cache', { text: 'c'.repeat(260) }, { entryId: 'three', now: 3 });

  assert.equal(storage.read('cache', { entryId: 'one', now: 3 }), null);
  assert.deepEqual(storage.read('cache', { entryId: 'three', now: 3 })?.payload, { text: 'c'.repeat(260) });
});

test('quota failure cleans permitted cache and retries exactly once', async () => {
  const { createStorageCore } = await corePromise;
  const adapter = createMemoryAdapter({ failures: 1 });
  const storage = createStorageCore({ registry: { cache: cacheContract() }, adapter });

  const result = storage.write('cache', { value: 'remote success' });

  assert.equal(result.ok, true);
  assert.equal(result.attempts, 2);
  assert.equal(adapter.writes, 2);
});

test('second quota failure stops after one retry and returns fail-open cache result', async () => {
  const { createStorageCore } = await corePromise;
  const adapter = createMemoryAdapter({ failures: 2 });
  const storage = createStorageCore({ registry: { cache: cacheContract() }, adapter });

  const result = storage.write('cache', { value: 'remote success' });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'cache-skipped');
  assert.equal(result.reason, 'quota-exhausted');
  assert.equal(result.attempts, 2);
  assert.equal(adapter.writes, 2);
});

test('protected persistence reports an error without changing the remote business result', async () => {
  const { createStorageCore } = await corePromise;
  const adapter = createMemoryAdapter({ failures: 2 });
  const storage = createStorageCore({
    registry: {
      auth: cacheContract({
        classification: 'USER_CRITICAL',
        ttlMs: null,
        maxEntries: 1,
        evictable: false,
        evictionPolicy: 'PROTECTED',
      }),
    },
    adapter,
  });
  const remoteResult = { authenticated: true, userId: 'user-1' };

  const persistence = storage.write('auth', { userId: remoteResult.userId });

  assert.deepEqual(remoteResult, { authenticated: true, userId: 'user-1' });
  assert.equal(persistence.ok, false);
  assert.equal(persistence.status, 'persistence-error');
  assert.equal(persistence.attempts, 2);
});
