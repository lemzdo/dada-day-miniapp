const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8');

test('Today has one light runtime and no V1/V2 selector', () => {
  assert.doesNotMatch(source, /isTodayV2Enabled|TARO_APP_RECOMMENDATION_V2_ENABLED|todayV2Enabled|v2MemoryOnly/);
  assert.match(source, /generateCloudOutfitV2/);
  assert.match(source, /toTodayV2Snapshot/);
});

test('acceptance metadata is forwarded without a strict business branch', () => {
  assert.doesNotMatch(source, /isStrictV2Acceptance/);
  assert.match(source, /acceptanceRunId/);
  assert.match(source, /captureId/);
  assert.match(source, /return handleV2Refresh\(acceptanceDiagnostics\)/);
});

test('Today persists only the Home Light snapshot', () => {
  assert.match(source, /setUserStorageSync\(TODAY_V2_SNAPSHOT_KEY, nextSnapshot/);
  assert.match(source, /setUserStorageSync\(TODAY_V2_SNAPSHOT_KEY, next/);
  assert.match(source, /HomeLightCardV2/);
});

test('passive cold telemetry remains observation-only', () => {
  assert.match(source, /isRecommendationDiagnosticEnvironment\(\)/);
  assert.match(source, /requestKind !== 'refresh'/);
  assert.match(source, /markTodayV2ColdUsable/);
});
