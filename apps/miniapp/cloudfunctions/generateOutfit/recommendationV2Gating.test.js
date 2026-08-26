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
  assert.doesNotMatch(source, /await candidatePoolPersistPromise/);
  assert.match(source, /tryPersistCandidatePool/);
  assert.doesNotMatch(source, /upsertRecommendationOutfitsBatch|projectRecommendationResponseOutfits/);
});

test('C2 launches noncritical copy, candidate-pool and overlay work without putting it on ready path', () => {
  const c2Start = source.indexOf("recordRecommendationStage(diagnostics, 'runtime:c2'");
  const readyInput = source.indexOf('return generateRecommendationV2({', c2Start);
  const postC2 = source.slice(c2Start, readyInput);
  assert.ok(c2Start >= 0 && readyInput > c2Start);
  assert.match(postC2, /candidatePoolPersistPromise = Promise\.resolve\(\)\.then/);
  assert.match(postC2, /copyJobPromise = prepareRecommendationCopyJob/);
  assert.match(postC2, /copyOverlayPromise = copyJobPromise\.then/);
  assert.match(postC2, /onPostC2TasksScheduled/);
  assert.doesNotMatch(postC2, /copyJob\s*=\s*await copyJobPromise|await candidatePoolPersistPromise|await copyOverlayPromise/);
});

test('required batch persistence remains the only post-C2 durability barrier before ready', () => {
  const start = source.indexOf('async function generateRecommendationV2');
  const end = source.indexOf('function validateCandidatePoolAvailability', start);
  const runtime = source.slice(start, end);
  assert.match(runtime, /const persisted = await persistRecommendationBatchV2\(/);
  assert.ok(runtime.indexOf('await persistRecommendationBatchV2') < runtime.indexOf('return response'));
});

test('event parity and HTTP lifecycle both settle post-C2 persistence safely', () => {
  const start = source.indexOf('async function runProductionRecommendationRuntime');
  const end = source.indexOf('async function generate(', start);
  const runtime = source.slice(start, end);
  assert.match(runtime, /runtime\.backgroundDone = backgroundPromise/);
  assert.match(runtime, /if \(!context\.interactive\) await backgroundPromise/);
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
  assert.match(source, /const core = storedBatch\.envelope\.core/);
  assert.match(source, /const reason = canonicalCopy\?\.text \|\| envelopeCard\.todayReason/);
  assert.match(source, /todayReason: reason/);
  assert.match(source, /recommendationBatchId: core\.batchId/);
});
