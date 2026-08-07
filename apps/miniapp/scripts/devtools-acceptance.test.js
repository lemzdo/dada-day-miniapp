'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { parseNetstatListeners, summarizeLedger, isHot, classification } = require('./devtools-acceptance');

test('accepts IPv4 wildcard and IPv6 listeners', () => {
  const rows = parseNetstatListeners('TCP    0.0.0.0:9420    0.0.0.0:0    LISTENING    123\nTCP    [::]:9420    [::]:0    LISTENING    456', 9420);
  assert.deepEqual(rows.map((row) => [row.address, row.pid]), [['0.0.0.0', 123], ['::', 456]]);
});

test('classifies a live snapshot as automator hot path', () => {
  const summary = summarizeLedger({ active: { runId: 'run', ledgerSchemaVersion: 3, executionMode: 'HOT', finalCardCount: 8, generateOutfitRequestCount: 0, complete: true, stages: { snapshotFound: true, snapshotValid: true, snapshotCardCount: 8 }, durations: { onShowToFirstCard: 400, onShowToFirstImage: 800 } } });
  assert.equal(isHot(summary), true);
  assert.equal(classification(summary.firstCardMs), 'HOTLOAD_EXCELLENT');
  assert.equal(classification(summary.firstImageMs), 'SNAPSHOT_HOTLOAD_OPTIMIZED');
});

test('preserves a real snapshot rejection', () => {
  const summary = summarizeLedger({ active: { runId: 'run', ledgerSchemaVersion: 3, finalCardCount: 8, generateOutfitRequestCount: 1, stages: { snapshotFound: false, snapshotValid: false, snapshotRejectReason: 'FINGERPRINT' }, durations: {} } });
  assert.equal(isHot(summary), false);
  assert.equal(summary.snapshotRejectReason, 'FINGERPRINT');
});
