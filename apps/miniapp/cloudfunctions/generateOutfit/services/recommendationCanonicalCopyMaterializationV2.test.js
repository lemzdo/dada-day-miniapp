const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');
const { buildRecommendationNarrativePlanV2 } = require('./recommendationNarrativePlanV2');
const {
  materializeFixture,
  recommendationStylingShadowV2Fixtures,
} = require('./recommendationStylingShadowV2.fixtures');
const runtime = require('./recommendationCanonicalCopyRuntimeV2');

function loadInternals() {
  const originalLoad = Module._load;
  Module._load = function loadWithCloudStub(request, parent, isMain) {
    if (request === 'wx-server-sdk') {
      return {
        DYNAMIC_CURRENT_ENV: 'test',
        init() {},
        database() { return { command: { in: (values) => values, set: (value) => value } }; },
        getWXContext() { return { OPENID: 'materialization-user' }; },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  try {
    delete require.cache[require.resolve('../index.js')];
    return require('../index.js').__test;
  } finally {
    Module._load = originalLoad;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
}

function makeRecord() {
  const fixture = recommendationStylingShadowV2Fixtures.find((entry) => entry.id === 'primary-pattern-focus');
  const recommendation = materializeFixture(fixture);
  const plan = buildRecommendationNarrativePlanV2(recommendation, { scene: fixture.scene });
  const batch = runtime.buildRecommendationCanonicalCopyBatchV2({
    plans: [plan],
    recommendations: [recommendation],
    aiMaterializationRequested: true,
  });
  const outfit = runtime.attachRecommendationCanonicalCopiesV2(
    [{ ...recommendation, copyContract: { todayReason: 'legacy' } }],
    batch,
    [plan],
  )[0];
  return {
    ...outfit,
    _id: 'outfit-1',
    _openid: 'materialization-user',
    recommendationBatchId: 'batch-1',
    outfitKey: outfit.outfitKey || 'outfit-key-1',
    snapshotItems: recommendation.items.map((item) => ({
      itemId: item._id,
      name: item.customName || item.subCategory || item.category,
      category: item.category,
    })),
  };
}

function createDatabase(records) {
  const store = new Map(records.map((record) => [record._id, structuredClone(record)]));
  const command = {
    in: (values) => values,
    set: (value) => ({ __replace: structuredClone(value) }),
  };
  const collection = () => ({
    where: (filter) => ({
      limit: () => ({
        get: async () => ({
          data: [...store.values()].filter((record) => Object.entries(filter)
            .every(([key, value]) => record[key] === value)),
        }),
      }),
    }),
    doc: (id) => ({
      update: async ({ data }) => {
        const current = store.get(id);
        const next = { ...current };
        for (const [key, value] of Object.entries(data)) {
          next[key] = value?.__replace === undefined ? value : value.__replace;
        }
        store.set(id, next);
      },
    }),
  });
  return { command, collection, read: (id) => structuredClone(store.get(id)) };
}

test('background materialization persists AI copy and a retry is an idempotent cache hit', async () => {
  const internals = loadInternals();
  const database = createDatabase([makeRecord()]);
  let providerCalls = 0;
  const runVoiceRenderer = async ({ preparedEntries }) => {
    providerCalls += 1;
    const current = database.read('outfit-1').canonicalRecommendationCopyV2;
    return {
      status: 'completed',
      cacheHitCount: 0,
      latencyMs: 12,
      ttftMs: 4,
      materializedCopies: [{
        planId: preparedEntries[0].plan.planId,
        text: 'AI copy ready',
        renderInputFingerprint: current.renderInputFingerprint,
      }],
    };
  };
  const previousFlag = process.env.RECOMMENDATION_CANONICAL_COPY_V2_ENABLED;
  process.env.RECOMMENDATION_CANONICAL_COPY_V2_ENABLED = 'true';
  try {
    const first = await internals.materializeRecommendationCanonicalCopyV2({
      recommendationBatchId: 'batch-1',
    }, { database, runVoiceRenderer });
    assert.equal(first.status, 'ready');
    assert.equal(first.materializedCount, 1);
    assert.equal(database.read('outfit-1').canonicalRecommendationCopyV2.aiState, 'ready');
    assert.equal(database.read('outfit-1').copyContract.todayReason, 'AI copy ready');

    const second = await internals.materializeRecommendationCanonicalCopyV2({
      recommendationBatchId: 'batch-1',
    }, { database, runVoiceRenderer });
    assert.equal(second.status, 'ready_cache_hit');
    assert.equal(providerCalls, 1);
  } finally {
    if (previousFlag === undefined) delete process.env.RECOMMENDATION_CANONICAL_COPY_V2_ENABLED;
    else process.env.RECOMMENDATION_CANONICAL_COPY_V2_ENABLED = previousFlag;
  }
});

test('provider failure keeps safe copy visible and records a retryable failure state', async () => {
  const internals = loadInternals();
  const original = makeRecord();
  const database = createDatabase([original]);
  const previousFlag = process.env.RECOMMENDATION_CANONICAL_COPY_V2_ENABLED;
  process.env.RECOMMENDATION_CANONICAL_COPY_V2_ENABLED = 'true';
  try {
    const result = await internals.materializeRecommendationCanonicalCopyV2({
      recommendationBatchId: 'batch-1',
    }, {
      database,
      runVoiceRenderer: async () => ({
        status: 'failed_open',
        failureCodes: { VOICE_RENDERER_TIMEOUT: 1 },
        latencyMs: 25,
      }),
    });
    const stored = database.read('outfit-1');
    assert.equal(result.status, 'failed_open');
    assert.equal(stored.canonicalRecommendationCopyV2.aiState, 'failed');
    assert.equal(stored.canonicalRecommendationCopyV2.aiFailureCode, 'VOICE_RENDERER_TIMEOUT');
    assert.equal(stored.canonicalRecommendationCopyV2.text, original.canonicalRecommendationCopyV2.text);
    assert.equal(stored.copyContract.todayReason, original.canonicalRecommendationCopyV2.text);
  } finally {
    if (previousFlag === undefined) delete process.env.RECOMMENDATION_CANONICAL_COPY_V2_ENABLED;
    else process.env.RECOMMENDATION_CANONICAL_COPY_V2_ENABLED = previousFlag;
  }
});

test('missing provider copy keeps safe text and records a retryable mismatch', async () => {
  const internals = loadInternals();
  const original = makeRecord();
  const database = createDatabase([original]);
  const previousFlag = process.env.RECOMMENDATION_CANONICAL_COPY_V2_ENABLED;
  process.env.RECOMMENDATION_CANONICAL_COPY_V2_ENABLED = 'true';
  try {
    const result = await internals.materializeRecommendationCanonicalCopyV2({
      recommendationBatchId: 'batch-1',
    }, {
      database,
      runVoiceRenderer: async () => ({
        status: 'completed',
        materializedCopies: [],
      }),
    });
    const stored = database.read('outfit-1');
    assert.equal(result.status, 'partially_failed_open');
    assert.equal(result.mismatchCount, 1);
    assert.equal(stored.canonicalRecommendationCopyV2.aiState, 'failed');
    assert.equal(stored.canonicalRecommendationCopyV2.aiFailureCode, 'VOICE_RENDERER_COPY_MISMATCH');
    assert.equal(stored.canonicalRecommendationCopyV2.text, original.canonicalRecommendationCopyV2.text);
  } finally {
    if (previousFlag === undefined) delete process.env.RECOMMENDATION_CANONICAL_COPY_V2_ENABLED;
    else process.env.RECOMMENDATION_CANONICAL_COPY_V2_ENABLED = previousFlag;
  }
});

test('snapshot persistence reuses durable AI copy only while fingerprint stays valid', () => {
  const internals = loadInternals();
  const base = makeRecord();
  const aiCopy = runtime.buildMaterializedCanonicalCopy(base.canonicalRecommendationCopyV2, {
    text: 'durable AI copy',
    renderInputFingerprint: base.canonicalRecommendationCopyV2.renderInputFingerprint,
  });
  const current = {
    ...base,
    canonicalRecommendationCopyV2: aiCopy,
    reason: aiCopy.text,
    copyContract: { ...base.copyContract, todayReason: aiCopy.text },
  };
  const reused = internals.buildOutfitSaveData(base, {
    outfitKey: base.outfitKey,
    now: '2026-08-14T00:00:00.000Z',
    patch: {},
    current,
  });
  assert.equal(reused.canonicalRecommendationCopyV2.source, 'ai_cache');
  assert.equal(reused.reason, 'durable AI copy');

  const invalidated = internals.buildOutfitSaveData({
    ...base,
    canonicalRecommendationCopyV2: {
      ...base.canonicalRecommendationCopyV2,
      renderInputFingerprint: 'changed-input',
    },
  }, {
    outfitKey: base.outfitKey,
    now: '2026-08-14T00:00:01.000Z',
    patch: {},
    current,
  });
  assert.equal(invalidated.canonicalRecommendationCopyV2.source, 'safe');
  assert.equal(invalidated.canonicalRecommendationCopyV2.renderInputFingerprint, 'changed-input');
});
