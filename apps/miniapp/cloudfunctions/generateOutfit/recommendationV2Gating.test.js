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
