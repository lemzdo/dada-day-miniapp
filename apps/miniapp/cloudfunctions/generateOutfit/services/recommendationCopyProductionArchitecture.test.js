'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const indexSource = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
const todaySource = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'src', 'pages', 'today', 'index.tsx'),
  'utf8',
);

function bodyBetween(start, end) {
  return indexSource.slice(indexSource.indexOf(start), indexSource.indexOf(end));
}

test('C2 dispatch is accepted before persistence and never awaits the provider worker', () => {
  const generateBody = bodyBetween('async function generate(event,', 'async function materializeRecommendationCanonicalCopyV2');
  assert.ok(generateBody.indexOf('runRecommendationStylingShadowV2Safely')
    < generateBody.indexOf('prepareRecommendationCopyJob'));
  assert.ok(generateBody.indexOf('prepareRecommendationCopyJob')
    < generateBody.indexOf('persistGeneratedCandidatePool'));
  assert.doesNotMatch(generateBody, /consumeProductionRendererStream|runRecommendationCopyJobV2\(/);
  assert.match(generateBody, /recommendations\.length > 0/);
  assert.match(generateBody, /latestCopyOverlay = await readRecommendationCopyOverlay/);
});

test('provider streaming is owned by the separately dispatched worker action', () => {
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
});
