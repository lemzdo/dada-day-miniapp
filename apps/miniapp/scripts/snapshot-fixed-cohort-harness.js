'use strict';

// Diagnostic-only request/cohort guard.  It deliberately does not mutate the
// database; the caller must perform the separately authorised backup/remove/
// restore steps and pass their evidence to the gate functions below.

const crypto = require('node:crypto');

const DEFAULT_WEATHER = Object.freeze({ condition: '多云', temperature: '26℃', wind: '微风' });

function buildFixedGenerateRequest({ recommendationBatchId, date, scene = '逛街', weather = DEFAULT_WEATHER, acceptanceRunId, captureId }) {
  if (typeof recommendationBatchId !== 'string' || recommendationBatchId.length === 0) {
    throw new Error('FIXED_COHORT_BATCH_ID_REQUIRED');
  }
  if (typeof acceptanceRunId !== 'string' || typeof captureId !== 'string') {
    throw new Error('FIXED_COHORT_ACCEPTANCE_CORRELATION_REQUIRED');
  }
  return {
    date: date || new Date().toISOString().slice(0, 10),
    scene,
    timeOfDay: 'all_day',
    maxResults: 8,
    weatherMode: 'provided',
    weather,
    trigger: 'diagnostic-fixed-cohort',
    recommendationBatchId,
    diagnostics: true,
    performanceDiagnostics: true,
    debugRecommendationAudit: true,
    canonicalCopyRuntimeV2Acceptance: true,
    acceptanceRunId,
    captureId,
  };
}

function extractOutfitKeys(response) {
  const data = response?.result?.data || response?.data || response?.result || {};
  return Array.isArray(data.outfits) ? data.outfits.map((entry) => String(entry?.outfitKey || '')) : [];
}

function assertExactKeys(actual, expected, label = 'snapshot') {
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label.toUpperCase()}_KEY_SEQUENCE_MISMATCH`);
  }
  return { count: actual.length, keys: actual };
}

function assertRepeatableResponses(first, second) {
  return assertExactKeys(extractOutfitKeys(second), extractOutfitKeys(first), 'repeat');
}

function validateSnapshotPath({ path, targetKeys, response, existingRecordCount, newRecordCount, writeRoundTrips, dbRoundTrips }) {
  const actual = extractOutfitKeys(response);
  assertExactKeys(actual, targetKeys, path);
  const expected = path === 'mixed'
    ? { existingRecordCount: 4, newRecordCount: 4, writeRoundTrips: 5, dbRoundTrips: 7 }
    : { existingRecordCount: 0, newRecordCount: 8, writeRoundTrips: 1, dbRoundTrips: 3 };
  for (const [key, value] of Object.entries(expected)) {
    if (Number(arguments[0][key]) !== value) throw new Error(`${path.toUpperCase()}_${key.toUpperCase()}_GATE_FAILED`);
  }
  return { path, targetKeys: actual, existingRecordCount: Number(existingRecordCount), newRecordCount: Number(newRecordCount), writeRoundTrips: Number(writeRoundTrips), dbRoundTrips: Number(dbRoundTrips) };
}

function createCohortId(seed = crypto.randomUUID()) {
  return `diag-fixed-${seed}`;
}

module.exports = { buildFixedGenerateRequest, extractOutfitKeys, assertExactKeys, assertRepeatableResponses, validateSnapshotPath, createCohortId };
