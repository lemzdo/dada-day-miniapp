'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { runCandidatePoolBenchmark } = require('./candidatePoolBenchmark');

test('compact candidate pool benchmark measures real 96-entry reservoir serialization', () => {
  const report = runCandidatePoolBenchmark({ runs: 2 });
  assert.equal(report.candidateCount, 96);
  assert.equal(report.hydratedCount, 96);
  assert.ok(report.serializedBytes > 0);
  assert.ok(report.manifestBytes > 0);
  assert.ok(report.chunksBytes > 0);
  assert.ok(report.chunkCount > 0);
  assert.ok(Number.isFinite(report.serializationP50Ms));
  assert.ok(Number.isFinite(report.serializationP95Ms));
  assert.ok(report.heapPeakBytes > 0);
  assert.equal(report.compactPayload, true);
  assert.equal(report.identityAndRoles, true);
  assert.equal(report.noRepeat, true);
  assert.equal(report.refreshCount, 8);
  assert.equal(report.poolSave, 'not_measured; collect from production smoke');
});
