const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

function loadInternals() {
  const originalLoad = Module._load;
  Module._load = function loadWithCloudStub(request, parent, isMain) {
    if (request === 'wx-server-sdk') {
      return {
        DYNAMIC_CURRENT_ENV: 'test',
        init() {},
        database() { return { command: { in: (values) => values } }; },
        getWXContext() { return { OPENID: 'test-openid' }; },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  try {
    delete require.cache[require.resolve('./index.js')];
    return require('./index.js').__test;
  } finally {
    Module._load = originalLoad;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
}

test('RecommendationServerDone emits the complete server timing envelope', () => {
  const internals = loadInternals();
  const diagnostics = internals.createRecommendationDiagnostics({ auditId: 'timing-test' }, Date.now() - 5);
  diagnostics.timings.batchPersistence = { sequential: true, readCount: 9, writeCount: 9 };
  const entries = [];
  const originalLog = console.log;
  console.log = (...args) => entries.push(args);
  try {
    const result = internals.emitRecommendationServerDone({
      diagnostics,
      executionMode: 'full_compute',
      response: { code: 0, data: { light: { cards: [] } }, message: 'ok' },
    });
    assert.equal(entries.length, 1);
    assert.equal(entries[0][0], '[RecommendationServerDone]');
    assert.equal(entries[0][1].executionMode, 'full_compute');
    assert.equal(typeof entries[0][1].timings.totalMs, 'number');
    assert.equal(entries[0][1].responseBytes, result.responseBytes);
    assert.ok(result.responseBytes > 0);
    assert.ok(Object.hasOwn(entries[0][1].timings, 'cardCompilationMs'));
    assert.ok(Object.hasOwn(entries[0][1].timings, 'batchPersistenceMs'));
    assert.deepEqual(entries[0][1].timings.batchPersistence, { sequential: true, readCount: 9, writeCount: 9 });
    assert.ok(Object.hasOwn(entries[0][1].timings, 'serializationMs'));
  } finally {
    console.log = originalLog;
  }
});

test('diagnostic C2 is recorded only for eight complete materialized plans and C4 is monotonic', () => {
  const internals = loadInternals();
  const monotonicOrigin = process.hrtime.bigint();
  const diagnostics = internals.createRecommendationDiagnostics({ auditId: 'c2-c4-test', diagnostics: true }, Date.now(), monotonicOrigin);
  assert.equal(diagnostics.monotonicOriginAt, monotonicOrigin);
  const recommendations = Array.from({ length: 8 }, (_, index) => ({
    outfitKey: `outfit-${index}`, items: [{ _id: `item-${index}` }], itemIds: [`item-${index}`], reasoning: 'reason',
  }));
  const shadow = {
    diagnostics: { status: 'completed' },
    plans: recommendations.map((recommendation, index) => ({
      planId: `plan-${index}`,
      identity: { outfitComposition: { key: recommendation.outfitKey, itemIds: recommendation.itemIds.slice() } },
    })),
  };
  assert.equal(internals.recordNarrativePlansReady(diagnostics, recommendations, shadow), true);
  assert.equal(typeof diagnostics.narrativePlansReadyMs, 'number');
  assert.equal(diagnostics.narrativePlanCount, 8);
  const entries = [];
  const originalLog = console.log;
  console.log = (...args) => entries.push(args);
  try {
    const result = internals.emitRecommendationServerDone({ diagnostics, executionMode: 'full_compute', response: { code: 0, data: {}, message: 'ok' } });
    const payload = entries[0][1];
    assert.equal(typeof payload.C2_MS, 'number');
    assert.equal(typeof payload.C4_MS, 'number');
    assert.equal(payload.C4_MS >= payload.C2_MS, true);
    assert.equal(payload.C4_MINUS_C2_MS, diagnostics.c4MinusC2Ms);
    assert.equal(payload.TOTAL_SERVER_MS, payload.C4_MS);
    assert.equal(result.responseBytes > 0, true);
  } finally {
    console.log = originalLog;
  }
  const incomplete = internals.createRecommendationDiagnostics({ auditId: 'c2-incomplete', diagnostics: true });
  assert.equal(internals.recordNarrativePlansReady(incomplete, recommendations.slice(0, 7), shadow), false);
  assert.equal(incomplete.narrativePlansReadyMs, null);
  const mismatch = internals.createRecommendationDiagnostics({ auditId: 'c2-mismatch', diagnostics: true }, Date.now(), monotonicOrigin);
  const mismatchedShadow = { ...shadow, plans: shadow.plans.map((plan, index) => index === 1 ? { ...plan, identity: { outfitComposition: { key: 'wrong-index', itemIds: plan.identity.outfitComposition.itemIds } } } : plan) };
  assert.equal(internals.recordNarrativePlansReady(mismatch, recommendations, mismatchedShadow), false);
  assert.equal(mismatch.narrativePlansReadyMs, null);
});

test('stage diagnostics reuse the request monotonic origin and required identity fields', () => {
  const internals = loadInternals();
  const entries = [];
  const diagnostics = internals.createRecommendationDiagnostics({ auditId: 'stage-test' });
  diagnostics.batchId = 'batch-stage';
  diagnostics.executionMode = 'full_compute';
  diagnostics.stageLogger = (_label, entry) => entries.push(entry);
  const first = internals.recordRecommendationStage(diagnostics, 'runtime:inputReady', {
    elapsedMs: 12.34567,
    fields: { auditId: 'must-not-override', safeCount: 1 },
  });
  const second = internals.recordRecommendationStage(diagnostics, 'runtime:selectionDone');
  assert.equal(first.elapsedMs, 12.346);
  assert.equal(first.auditId, 'stage-test');
  assert.equal(first.batchId, 'batch-stage');
  assert.equal(first.executionState, 'full_compute');
  assert.equal(first.safeCount, 1);
  assert.equal(second.elapsedMs >= 0, true);
  assert.deepEqual(entries, diagnostics.stageDiagnostics);
  diagnostics.stageLogger = () => { throw new Error('logger unavailable'); };
  assert.doesNotThrow(() => internals.recordRecommendationStage(diagnostics, 'runtime:c2'));
});
