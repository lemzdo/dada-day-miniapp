'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { assertExactKeys, assertRepeatableResponses, buildFixedGenerateRequest, extractOutfitKeys, validateSnapshotPath } = require('./snapshot-fixed-cohort-harness');

test('fixed request includes the exact candidate pool and diagnostic correlation', () => {
  const request = buildFixedGenerateRequest({ recommendationBatchId: 'pool-1', date: '2026-08-20', acceptanceRunId: 'run-1', captureId: 'run-1-capture' });
  assert.equal(request.recommendationBatchId, 'pool-1');
  assert.equal(request.maxResults, 8);
  assert.equal(request.diagnostics, true);
  assert.equal(request.trigger, 'diagnostic-fixed-cohort');
});

test('repeat gate requires identical key sequence', () => {
  const first = { data: { outfits: [{ outfitKey: 'a' }, { outfitKey: 'b' }] } };
  assert.deepEqual(extractOutfitKeys(first), ['a', 'b']);
  assert.deepEqual(assertRepeatableResponses(first, first), { count: 2, keys: ['a', 'b'] });
  assert.throws(() => assertExactKeys(['b', 'a'], ['a', 'b'], 'repeat'), /REPEAT_KEY_SEQUENCE_MISMATCH/);
});

test('mixed and all-new gates reject wrong persistence accounting', () => {
  const response = { data: { outfits: Array.from({ length: 8 }, (_, i) => ({ outfitKey: `k${i}` })) } };
  const keys = extractOutfitKeys(response);
  assert.deepEqual(validateSnapshotPath({ path: 'mixed', targetKeys: keys, response, existingRecordCount: 4, newRecordCount: 4, writeRoundTrips: 5, dbRoundTrips: 7 }).path, 'mixed');
  assert.throws(() => validateSnapshotPath({ path: 'all-new', targetKeys: keys, response, existingRecordCount: 4, newRecordCount: 4, writeRoundTrips: 5, dbRoundTrips: 7 }), /ALL-NEW_EXISTINGRECORDCOUNT_GATE_FAILED/);
});
