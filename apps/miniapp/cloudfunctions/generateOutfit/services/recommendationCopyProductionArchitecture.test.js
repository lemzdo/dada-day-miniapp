'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const indexSource = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
const orchestratorSource = fs.readFileSync(
  path.join(__dirname, '..', 'runtime', 'recommendationOrchestrator.js'),
  'utf8',
);
const streamSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'recommendationStream', 'index.js'),
  'utf8',
);
const todaySource = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'src', 'pages', 'today', 'index.tsx'),
  'utf8',
);

function bodyBetween(start, end) {
  return indexSource.slice(indexSource.indexOf(start), indexSource.indexOf(end));
}

test('C2 starts pure card0 rendering while the orchestrator owns deadline and persistence', () => {
  const prepareBody = bodyBetween(
    'async function prepareProductionRecommendationWork',
    'async function persistAndAssembleProductionRecommendation',
  );
  assert.match(indexSource, /runRecommendationStylingShadowV2Safely/);
  assert.match(prepareBody, /prepareRecommendationCopyJob/);
  assert.match(prepareBody, /executionMode: 'interactive'/);
  assert.match(prepareBody, /const firstCardEntries = entries\.slice\(0, 1\)/);
  assert.match(prepareBody, /firstCardInteractive = \{/);
  assert.match(prepareBody, /persistValidatedCanonicalCopy/);
  assert.match(prepareBody, /materializeFirstCard/);
  assert.match(prepareBody, /settleInteractiveRecommendationCopyJob/);
  assert.doesNotMatch(prepareBody, /dispatchPreparedRecommendationCopyJob|dispatchScfEvent/);
  assert.match(orchestratorSource, /SERVER_RESPONSE_DEADLINE_MS = 2300/);
  assert.match(orchestratorSource, /renderFirstCardCanonical/);
  assert.match(orchestratorSource, /persistCanonicalCopy/);
  assert.doesNotMatch(streamSource, /consumeProductionRendererStream|persistCanonicalCopy\(copy\)/);
});

test('first-card provider admission waits for the durable card0 job reservation', () => {
  const runtimeBody = bodyBetween(
    'async function runProductionRecommendationRuntime',
    'async function computeProductionRecommendationCore',
  );
  const prepareBody = bodyBetween(
    'async function prepareProductionRecommendationWork',
    'async function persistAndAssembleProductionRecommendation',
  );
  assert.match(runtimeBody, /firstCardCopyJobPromise \|\|= prepareRecommendationCopyJob/);
  assert.match(runtimeBody, /resolveAdmission: async \(\) => \{[\s\S]*await firstCardCopyJobPromise/);
  const firstCardBody = orchestratorSource.slice(
    orchestratorSource.indexOf('async function runFirstCard'),
    orchestratorSource.indexOf('function buildResult'),
  );
  assert.ok(
    firstCardBody.indexOf('await interactive.resolveAdmission()')
      < firstCardBody.indexOf('await context.renderFirstCardCanonical'),
  );
  assert.match(runtimeBody, /markCopyJobRetryable: markFirstCardCopyJobRetryable/);
  assert.match(runtimeBody, /firstCardCopyJobSettlementPromise/);
  assert.match(runtimeBody, /settleFirstCardCopyJob = \(outcome = \{\}\)/);
  assert.match(runtimeBody, /settleInteractiveRecommendationCopyJob\(db, job\.jobId/);
  assert.match(prepareBody, /context\.settleFirstCardCopyJob\(\{ status: 'SUCCESS' \}\)/);
});

test('production success and retry cleanup share one first-call-wins durable settlement', () => {
  const runtimeBody = bodyBetween(
    'async function runProductionRecommendationRuntime',
    'async function computeProductionRecommendationCore',
  );
  const prepareBody = bodyBetween(
    'async function prepareProductionRecommendationWork',
    'async function persistAndAssembleProductionRecommendation',
  );
  assert.match(runtimeBody, /settleFirstCardCopyJob\(\{\s*status: 'FAIL'/);
  assert.match(prepareBody, /context\.settleFirstCardCopyJob\(\{ status: 'SUCCESS' \}\)/);
  assert.match(runtimeBody, /if \(firstCardCopyJobSettlementPromise\) return firstCardCopyJobSettlementPromise/);
});

test('SCF Event worker remains available only as a recovery action', () => {
  const mainBody = bodyBetween('exports.main = async', 'function buildRecommendationV2TodayReason');
  assert.match(mainBody, /action === 'bootstrapRecommendationCopyStorageV2'/);
  assert.match(mainBody, /confirmRendererVersion !== PRODUCTION_RENDERER_VERSION/);
  assert.match(mainBody, /action === 'materializeRecommendationCopyJobV2'/);
  const workerBody = bodyBetween('async function runRecommendationCopyJobV2', 'async function getRecommendationCopyOverlayV2');
  assert.match(workerBody, /consumeStream\(/);
  assert.match(workerBody, /persistValidatedCanonicalCopy/);
});

test('V2 detail, favorite and wear resolve the same late canonical overlay', () => {
  const loadBody = bodyBetween('async function loadV2OutfitPayload', 'async function getOutfitDetailV2');
  assert.match(loadBody, /readRecommendationCopyOverlay/);
  assert.match(loadBody, /canonicalCopy\?\.text \|\| envelopeCard\.todayReason/);
  const consumers = bodyBetween('async function getOutfitDetailV2', 'async function generateAiComment');
  assert.match(consumers, /getOutfitDetailV2[\s\S]*loadV2OutfitPayload/);
  assert.match(consumers, /updateFavoriteV2[\s\S]*loadV2OutfitPayload/);
  assert.match(consumers, /confirmWearV2[\s\S]*loadV2OutfitPayload/);
});

test('Today late-arrival consumer is bounded and patches canonical text only', () => {
  assert.match(todaySource, /runBoundedCanonicalCopyRefresh\(/);
  assert.doesNotMatch(todaySource, /EventSource|text\/event-stream|new WebSocket/);
  assert.match(todaySource, /applyCanonicalCopyOverlay\(current, overlay\)/);
  assert.match(todaySource, /ai:firstCanonicalAvailable/);
  assert.match(todaySource, /ai:firstCanonicalApplied/);
  assert.match(todaySource, /ai:refreshAttempt/);
});
