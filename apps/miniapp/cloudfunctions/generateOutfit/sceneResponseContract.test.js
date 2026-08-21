const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');

test('all scenes use the same native Home Light response contract', () => {
  assert.match(source, /projectHomeLightV2/);
  assert.match(source, /runtimeVersion: RECOMMENDATION_V2_RUNTIME_VERSION/);
  assert.match(source, /schemaVersion: RECOMMENDATION_V2_SCHEMA_VERSION/);
  assert.match(source, /batch: projectBatchCoreV2\(persisted\.batch\)/);
  assert.match(source, /light,/);
  assert.doesNotMatch(source, /buildRecommendationResponseData|PUBLIC_OUTFIT_RESPONSE_FIELDS/);
});

test('native response excludes legacy diagnostics and full snapshot payloads', () => {
  const start = source.indexOf('const response = {');
  const end = source.indexOf('return response;', start);
  const responseBlock = source.slice(start, end);
  assert.doesNotMatch(responseBlock, /response\.diagnostics|snapshotItems|copyContract|evidence/);
  assert.doesNotMatch(source, /upsertRecommendationOutfitsBatch|projectRecommendationResponseOutfits/);
});
