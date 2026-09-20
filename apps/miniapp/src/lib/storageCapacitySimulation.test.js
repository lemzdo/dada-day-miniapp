const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const KiB = 1024;

test('production-shaped PB-04 workload converges below the stable-state target', async () => {
  const { createStorageCore, serializedByteSize } = await import('./localStorage/core.mjs');
  const runtimeCache = loadTypeScriptModule(path.join(__dirname, 'runtimeQueryCache.ts'));
  runtimeCache.clearRuntimeQueryCache();
  const values = new Map();
  const adapter = {
    keys: () => [...values.keys()],
    get: (key) => values.get(key),
    set: (key, value) => values.set(key, value),
    remove: (key) => values.delete(key),
  };
  const registry = createRegistry();
  let now = 1_000;
  const core = createStorageCore({ registry, adapter, now: () => now });
  const measure = () => [...values.entries()].reduce(
    (sum, [key, value]) => sum + serializedByteSize(key) + serializedByteSize(value),
    0,
  );

  const metrics = { COLD_START_STORAGE: measure() };
  core.write('authResume:v2', longAuth(), { now });
  core.write('profileBootstrap:v2', profile(), { now });
  core.write('weatherLastKnown:v2', weather(), { now });
  core.write('todayBootstrap:v2', today(), { scope: 'user-scope', now });
  core.write('wardrobeBootstrap:v2', wardrobe(), { scope: 'user-scope', now });
  metrics.NORMAL_STEADY_STATE = measure();

  // Exercise the production Detail L0 adapter and namespace/cap shape. Distinct
  // Detail visits may fill the bounded runtime cache but must never append L1.
  const detailNamespace = `outfitDetail:${longId('scope')}`;
  for (let index = 0; index < 20; index += 1) {
    now += 100;
    runtimeCache.setRuntimeQueryCache(
      detailNamespace,
      `v2:${longId('batch')}:${longId('outfit', index)}:${longId('reference', index)}`,
      detailResponse(index),
      { ttl: 5 * 60 * 1000, maxEntries: 16, now },
    );
  }
  metrics.AFTER_20_DETAIL_NAVIGATIONS = measure();
  assert.equal(runtimeCache.getRuntimeQueryCacheSize(detailNamespace, now), 16);

  // Re-enter the same Details through the same production key form. Replacement
  // remains in L0, bounded at 16, and still cannot change L1 storage bytes.
  for (let index = 0; index < 20; index += 1) {
    now += 100;
    const repeated = index % 4;
    runtimeCache.setRuntimeQueryCache(
      detailNamespace,
      `v2:${longId('batch')}:${longId('outfit', repeated)}:${longId('reference', repeated)}`,
      detailResponse(repeated),
      { ttl: 5 * 60 * 1000, maxEntries: 16, now },
    );
  }
  metrics.AFTER_REPEATED_DETAIL_REENTRY = measure();
  assert.equal(runtimeCache.getRuntimeQueryCacheSize(detailNamespace, now), 16);

  for (let index = 0; index < 50; index += 1) now += 100;
  metrics.AFTER_HISTORY_FLOW = measure();

  core.write('uploadWorkflow:v2', uploadWorkflow(), { scope: 'user-scope', now });
  metrics.AFTER_UPLOAD_FLOW = measure();
  core.write('storageMeta:v2', {
    checkpoint: 'post-auth-complete',
    completedVersion: 4,
    updatedAt: new Date(now).toISOString(),
    sizeSummary: { beforeKiB: 8192, afterKiB: Math.ceil(measure() / KiB) },
  }, { entryId: 'post-auth', now });
  metrics.AFTER_MIGRATION = measure();

  assert.equal(metrics.AFTER_20_DETAIL_NAVIGATIONS, metrics.NORMAL_STEADY_STATE);
  assert.equal(metrics.AFTER_REPEATED_DETAIL_REENTRY, metrics.NORMAL_STEADY_STATE);
  assert.equal(metrics.AFTER_HISTORY_FLOW, metrics.NORMAL_STEADY_STATE);
  assert.ok(metrics.NORMAL_STEADY_STATE <= 384 * KiB);
  assert.ok(metrics.AFTER_UPLOAD_FLOW <= 512 * KiB);
  assert.ok(metrics.AFTER_MIGRATION <= 512 * KiB);

  for (const [name, bytes] of Object.entries(metrics)) {
    process.stdout.write(`${name}=${bytes} bytes (${(bytes / KiB).toFixed(2)} KiB)\n`);
  }
});

function loadTypeScriptModule(file) {
  const source = fs.readFileSync(file, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = new Module(file, module);
  loaded.filename = file;
  loaded.paths = Module._nodeModulePaths(path.dirname(file));
  loaded._compile(output, file);
  return loaded.exports;
}

function createRegistry() {
  const cache = (maxBytes, ttlMs) => ({
    enabled: true,
    owner: 'simulation',
    classification: 'BOOTSTRAP_CACHE',
    sourceOfTruth: 'cloud',
    crossSessionNeed: 'bootstrap',
    recomputable: true,
    ttlMs,
    maxEntries: 1,
    maxBytes,
    evictable: true,
    evictionPolicy: 'EXPIRE_THEN_LRU',
    migrationVersion: 2,
  });
  const protectedEntry = (maxBytes, classification = 'USER_CRITICAL') => ({
    enabled: true,
    owner: 'simulation',
    classification,
    sourceOfTruth: 'cloud',
    crossSessionNeed: 'recovery',
    recomputable: false,
    ttlMs: null,
    maxEntries: classification === 'MIGRATION_META' ? 4 : 1,
    maxBytes,
    evictable: false,
    evictionPolicy: classification === 'WORKFLOW_REF' ? 'TERMINAL_DELETE' : 'PROTECTED',
    migrationVersion: 2,
  });
  return {
    'authResume:v2': protectedEntry(16 * KiB),
    'profileBootstrap:v2': cache(32 * KiB, 24 * 60 * 60 * 1000),
    'weatherLastKnown:v2': cache(16 * KiB, 24 * 60 * 60 * 1000),
    'todayBootstrap:v2': cache(96 * KiB, 6 * 60 * 60 * 1000),
    'wardrobeBootstrap:v2': cache(96 * KiB, 30 * 60 * 1000),
    'uploadWorkflow:v2': protectedEntry(32 * KiB, 'WORKFLOW_REF'),
    'storageMeta:v2': protectedEntry(16 * KiB, 'MIGRATION_META'),
  };
}

function longId(prefix, index = 0) {
  return `${prefix}-${index}-${'x'.repeat(64)}`;
}

function longAuth() {
  return {
    userId: longId('user'),
    confirmedOpenid: longId('openid'),
    userScope: longId('scope'),
    updatedAt: '2026-09-16T00:00:00.000Z',
  };
}

function profile() {
  return {
    userScope: longId('scope'),
    userId: longId('user'),
    nickname: '每天都想穿得舒服又好看的搭搭用户',
    avatarUrl: `cloud://${'avatar/'.repeat(20)}`,
    avatarType: 'wechat',
    profileCompleted: true,
    recommendationProfile: {
      genderPreference: 'all',
      styleTags: ['通勤简约', '日常休闲', '干净温和'],
      fitPreference: 'regular',
      colorPreference: ['米白', '深蓝'],
      avoidTags: ['夸张'],
      temperatureSensitivity: 'normal',
    },
    capacityTotal: 200,
    capacityUsed: 168,
    membershipTier: 'free',
  };
}

function weather() {
  return {
    location: { city: '杭州市西湖区', latitude: 30.2741, longitude: 120.1551 },
    weather: { weather: '多云转小雨', temperature: 23, humidity: 72, windPower: '3级', reportTime: '2026-09-16T00:00:00.000Z' },
    source: 'cache',
    cacheHit: true,
    fetchedAt: '2026-09-16T00:00:00.000Z',
    updatedAt: '2026-09-16T00:00:00.000Z',
  };
}

function today() {
  return {
    schemaVersion: 2,
    batchId: longId('batch'),
    cards: Array.from({ length: 8 }, (_, index) => ({
      ref: {
        schemaVersion: 1,
        source: 'recommendation',
        outfitKey: longId('outfit', index),
        batchId: longId('batch'),
        referenceId: longId('reference', index),
      },
      displayTitle: `适合今天通勤与晚间散步的第${index + 1}套`,
      thumbnailRefs: Array.from({ length: 8 }, (_, item) => `cloud://${longId('thumbnail', index * 10 + item)}`),
      isFavorite: index % 2 === 0,
      isWornToday: false,
    })),
  };
}

function wardrobe() {
  return {
    schemaVersion: 2,
    items: Array.from({ length: 20 }, (_, index) => ({
      id: longId('clothing', index),
      category: ['top', 'bottom', 'shoes', 'outerwear'][index % 4],
      displayImageRef: `cloud://${longId('wardrobe-thumbnail', index)}`,
    })),
  };
}

function uploadWorkflow() {
  return {
    schemaVersion: 2,
    refs: Array.from({ length: 10 }, (_, index) => ({
      batchId: longId('upload-batch', index),
      cloudImageIds: Array.from({ length: 9 }, (_, image) => longId(`upload-image-${index}`, image)),
      phase: 'processing',
      createdAt: 1_000,
      updatedAt: 2_000,
      needsServerVerification: true,
    })),
  };
}

function detailResponse(index) {
  return {
    schemaVersion: 2,
    batchId: longId('batch'),
    outfitKey: longId('outfit', index),
    referenceId: longId('reference', index),
    persistedDetailDocumentReady: true,
    detail: {
      title: `第${index + 1}套穿搭详情`,
      todayReason: '这套组合适合今天的通勤安排。',
      detailExplanation: '上衣和下装的明暗关系清楚，鞋子保持简洁。',
      clothingIds: Array.from({ length: 4 }, (_, item) => longId('clothing', index * 10 + item)),
    },
  };
}
