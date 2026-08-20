const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');

test('V2 generation is server-flag and client-runtime gated', () => {
  assert.match(source, /RECOMMENDATION_V2_ENABLED === 'true'/);
  assert.match(source, /runtimeVersion === RECOMMENDATION_V2_RUNTIME_VERSION/);
  assert.match(source, /runId\.startsWith\('ttui-v2-'\)/);
  assert.match(source, /captureId === `\$\{runId\}-capture`/);
});

test('V2 branch is before Legacy presentation and persistence barriers', () => {
  const branch = source.indexOf('if (shouldUseRecommendationV2(event))');
  const legacyBarrier = source.indexOf('const cardCompilationPromise');
  assert.ok(branch >= 0 && branch < legacyBarrier);
  assert.match(source, /persistRecommendationBatchV2/);
  assert.doesNotMatch(source.slice(branch, legacyBarrier), /upsertRecommendationOutfitsBatch|enrichOutfitsState|saveOutfitExposures/);
});

test('V2 reasons use the deterministic safe renderer and do not start AI renderer', () => {
  const start = source.indexOf('async function generateRecommendationV2');
  const end = source.indexOf('function validateCandidatePoolAvailability', start);
  const branch = source.slice(start, end);
  assert.match(branch, /compileRecommendationReasonsV2/);
  assert.match(branch, /V2_SAFE_REASON_INCOMPLETE/);
  assert.doesNotMatch(branch, /buildRecommendationVoiceRendererExecution|runRecommendationVoiceRenderer/);
  assert.doesNotMatch(branch, /recommendation\?\.reasoning/);
});

test('V2 status queries use projected fields and parallel execution', () => {
  assert.match(source, /findV2FavoriteKeys\(openid, order\)/);
  assert.match(source, /findV2WornKeys\(openid, order, targetDate\)/);
  assert.match(source, /typeof query\.field === 'function'/);
  assert.match(source, /query\.field\(\{ outfitKey: true/);
});

test('V2 action snapshot seed comes from immutable envelope context', () => {
  assert.match(source, /const core = envelope\.core/);
  assert.match(source, /todayReason: envelopeCard\.todayReason/);
  assert.match(source, /weatherSnapshot: core\.weatherSnapshot/);
  assert.match(source, /recommendationBatchId: core\.batchId/);
  assert.match(source, /JSON\.stringify\(ref\.clothingIds\) !== JSON\.stringify\(envelopeCard\.clothingIds\)/);
});

test('V2 generation accepts refresh exclusions without invoking Legacy response parsing', () => {
  assert.match(source, /excludedOutfitKeys/);
  assert.match(source, /shouldUseRecommendationV2\(event\)/);
});

test('V2 performance ledger is acceptance-only and records safety gates', () => {
  const start = source.indexOf('async function generateRecommendationV2');
  const end = source.indexOf('function validateCandidatePoolAvailability', start);
  const branch = source.slice(start, end);
  assert.match(branch, /isRecommendationV2Acceptance\(event\)/);
  assert.match(branch, /legacyPersistenceCalled: false/);
  assert.match(branch, /aiStarted: false/);
  assert.match(branch, /responseSerializationBytes/);
});
