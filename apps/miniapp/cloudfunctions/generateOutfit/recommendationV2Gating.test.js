const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');

test('Today has one Recommendation Runtime entry and no V1/V2 selector', () => {
  assert.doesNotMatch(source, /RECOMMENDATION_V2_ENABLED/);
  assert.doesNotMatch(source, /shouldUseRecommendationV2/);
  assert.match(source, /return generateRecommendationV2\(\{/);
});

test('normal generation uses minimal atomic batch persistence before legacy helpers', () => {
  const entry = source.indexOf('return generateRecommendationV2({');
  assert.ok(entry >= 0);
  const runtime = source.slice(source.indexOf('async function generateRecommendationV2'), source.indexOf('function validateCandidatePoolAvailability'));
  assert.match(runtime, /persistRecommendationBatchV2/);
});

test('FULL_COMPUTE schedules existing candidate-pool persistence while cache hits do not', () => {
  assert.match(source, /candidatePoolPersistenceInput = \{/);
  assert.match(source, /persistGeneratedCandidatePool\(\{/);
  assert.match(source, /await candidatePoolPersistPromise/);
  assert.match(source, /tryPersistCandidatePool/);
  assert.doesNotMatch(source, /upsertRecommendationOutfitsBatch|projectRecommendationResponseOutfits/);
});

test('V2 reasons use the deterministic safe renderer and do not start AI renderer', () => {
  const start = source.indexOf('async function generateRecommendationV2');
  const end = source.indexOf('function validateCandidatePoolAvailability', start);
  const branch = source.slice(start, end);
  assert.match(branch, /compileRecommendationReasonsV2/);
  assert.match(branch, /V2_SAFE_REASON_INCOMPLETE/);
  assert.doesNotMatch(branch, /buildRecommendationVoiceRendererExecution|runRecommendationVoiceRenderer/);
});

test('acceptance metadata only observes the same light runtime', () => {
  const start = source.indexOf('async function generateRecommendationV2');
  const end = source.indexOf('function validateCandidatePoolAvailability', start);
  const branch = source.slice(start, end);
  assert.match(branch, /RecommendationRuntimeObservation/);
  assert.doesNotMatch(branch, /response\.diagnostics/);
  assert.doesNotMatch(branch, /responseSerializationBytes|copyContract|snapshotItems|evidence/);
});

test('V2 status queries and immutable action seed remain projected', () => {
  assert.match(source, /findV2FavoriteKeys\(openid, order\)/);
  assert.match(source, /findV2WornKeys\(openid, order, targetDate\)/);
  assert.match(source, /const core = envelope\.core/);
  assert.match(source, /todayReason: envelopeCard\.todayReason/);
  assert.match(source, /recommendationBatchId: core\.batchId/);
});
