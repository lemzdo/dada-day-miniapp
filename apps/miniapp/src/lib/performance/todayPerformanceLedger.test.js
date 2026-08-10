const assert = require('node:assert/strict');
const test = require('node:test');

test('performance ledger contract keeps production disabled and records a bounded run', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, 'todayPerformanceLedger.ts'), 'utf8');
  assert.match(source, /TODAY_PERFORMANCE_LEDGER_KEY/);
  assert.match(source, /HISTORY_LIMIT = 5/);
  assert.match(source, /isRecommendationDiagnosticEnvironment/);
  assert.match(source, /NOT_OBSERVED/);
  assert.match(source, /TODAY_PERFORMANCE_LEDGER_SCHEMA_VERSION = 3/);
  assert.match(source, /PUBLISH_DEBOUNCE_MS = 250/);
  assert.match(source, /publishNow\(\)/);
  assert.match(source, /stage === 'finalCardCount' \|\| stage === 'snapshotRejectReason'/);
  assert.match(source, /restoreDispatchAttempt/);
  assert.match(source, /restoreFunctionEntered/);
  assert.match(source, /authContextCurrentResult/);
  assert.match(source, /restoreReturnReason/);
  assert.match(source, /restoreException/);
  assert.doesNotMatch(source, /openid|userId|imageUrl|thumbnailUrl/);
});

test('restore decisions use fixed privacy-safe reasons and preserve exceptions', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, 'todayPerformanceLedger.ts'), 'utf8');
  for (const reason of ['NO_LOCAL_AUTH', 'AUTH_CONTEXT_STALE', 'RETURN_INTENT_REQUIRED', 'SNAPSHOT_EMPTY', 'SNAPSHOT_INVALID', 'RESTORE_COMPLETED']) {
    assert.match(source, new RegExp(reason));
  }
  assert.match(source, /recordTodayRestoreException/);
  const today = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../pages/today/index.tsx'), 'utf8');
  assert.match(today, /recordTodayRestoreException\(error\);[\s\S]*?throw error/);
});

test('ledger does not add privacy fields to its schema', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, 'todayPerformanceLedger.ts'), 'utf8');
  assert.doesNotMatch(source, /userScope|confirmedOpenid|openid|userId|clothingId|outfitId/);
});

test('Today starts one fresh run for each resumed onShow lifecycle', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../pages/today/index.tsx'), 'utf8');
  assert.match(source, /useDidShow\(\(\) => \{/);
  assert.match(source, /useDidShow\(\(\) => \{[\s\S]{0,300}startTodayPerformanceRun\(\)/);
  assert.match(source, /useLoad\(\(\) => \{[\s\S]{0,100}markTodayPerformanceStage\('todayOnLoad'\)/);
});

test('permission wait is recorded independently from weather and recommendation stages', () => {
  const ledger = require('node:fs').readFileSync(require('node:path').join(__dirname, 'todayPerformanceLedger.ts'), 'utf8');
  const weather = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../components/WeatherCard/index.tsx'), 'utf8');
  assert.match(ledger, /locationPermissionPromptStart/);
  assert.match(ledger, /locationPermissionResolved/);
  assert.match(ledger, /permissionUserWaitMs/);
  assert.match(weather, /onLocationPermissionPrompt/);
  assert.match(weather, /onLocationPermissionResolved/);
});
