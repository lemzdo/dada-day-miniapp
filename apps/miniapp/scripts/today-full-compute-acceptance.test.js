'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  businessMutationPaths,
  inferSnapshotMode,
  responsePayloadBreakdown,
  stripDiagnostics,
  summarizeQuality,
  validateProductionRequest,
} = require('./today-full-compute-acceptance');

test('production request validation accepts the real retry builder shape plus diagnostics', () => {
  const result = validateProductionRequest({
    date: '2026-08-08',
    scene: '居家',
    timeOfDay: 'all_day',
    maxResults: 8,
    auditId: 'audit-1',
    weatherMode: 'disabled',
    trigger: 'retry',
    performanceDiagnostics: true,
    acceptanceRunId: 'run-1',
    captureId: 'capture-1',
  });
  assert.equal(result.equivalentToRetryProductionBuilder, true);
  assert.equal(result.businessRequest.scene, '居家');
  assert.equal(result.businessRequest.performanceDiagnostics, undefined);
});

test('refresh-only business fields make a full-compute request non-equivalent', () => {
  const result = validateProductionRequest({
    date: '2026-08-08', scene: '居家', timeOfDay: 'all_day', maxResults: 8,
    auditId: 'audit-1', weatherMode: 'disabled', trigger: 'retry', recommendationBatchId: 'pool-1',
  });
  assert.equal(result.equivalentToRetryProductionBuilder, false);
  assert.deepEqual(result.forbiddenRefreshFields, ['recommendationBatchId']);
});

test('only diagnostic request changes are allowed', () => {
  const diff = [
    { path: '$.performanceDiagnostics', before: undefined, after: true },
    { path: '$.captureId', before: undefined, after: 'capture' },
    { path: '$.scene', before: '居家', after: '运动' },
  ];
  assert.deepEqual(businessMutationPaths(diff), ['$.scene']);
});

test('snapshot mode is inferred from explicit record counts', () => {
  assert.equal(inferSnapshotMode({ existingRecordCount: 8, newRecordCount: 0 }, 8), 'ALL_EXISTING');
  assert.equal(inferSnapshotMode({ existingRecordCount: 0, newRecordCount: 8 }, 8), 'ALL_NEW');
  assert.equal(inferSnapshotMode({ existingRecordCount: 3, newRecordCount: 5 }, 8), 'MIXED');
});

test('business size strips only the diagnostics envelope', () => {
  const data = { outfits: [{ id: '1' }], debug: { executionMode: 'full_compute' }, diagnostics: { performance: { serverTotalMs: 1 } } };
  assert.deepEqual(stripDiagnostics(data), { outfits: [{ id: '1' }], debug: { executionMode: 'full_compute' } });
  assert.equal(responsePayloadBreakdown(data, 1)[0].path, '$');
});

test('quality summary requires eight unique consistent PASS cards', () => {
  const outfits = Array.from({ length: 8 }, (_, index) => ({
    outfitKey: `outfit-${index}`,
    scene: '居家',
    clothingIds: [`top-${index}`, `bottom-${index}`],
    items: [{ clothingId: `top-${index}` }, { clothingId: `bottom-${index}` }],
    copyContract: { gateResult: 'PASS' },
    aestheticEvaluation: { score: 80 },
    scores: { preference: 80, freshness: 80 },
    reason: '简洁且适合当前场景',
  }));
  const quality = summarizeQuality({
    outfits,
    countContract: { expectedCardCount: 8, returnedCardCount: 8 },
  }, { scene: '居家' });
  assert.equal(quality.passed, true);
  assert.equal(quality.unsupportedClaimCount, 0);
});
