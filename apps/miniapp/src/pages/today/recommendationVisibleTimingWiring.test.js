'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const todaySource = fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8');
const cardSource = fs.readFileSync(path.join(__dirname, 'HomeLightCardV2.tsx'), 'utf8');

function functionBody(startMarker, endMarker) {
  const start = todaySource.indexOf(startMarker);
  const end = todaySource.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `missing source range: ${startMarker}`);
  return todaySource.slice(start, end);
}

test('real recommendation commit owns create, response, and commit timing stages', () => {
  const body = functionBody('async function fetchRecommendations', 'async function handleV2Refresh');
  assert.match(body, /visibleTimingRecorder\.create\(/);
  assert.match(body, /visibleTimingRecorder\.response\(/);
  assert.match(body, /await commitCanonicalSnapshotForRender/);
  assert.match(body, /visibleTimingRecorder\.commit\(/);
});

test('pull refresh and scene switch both enter the instrumented request path', () => {
  const pull = functionBody('usePullDownRefresh(() =>', 'useDidShow(() =>');
  const scene = functionBody('function handleSceneSelect', 'async function handleV2Favorite');
  assert.match(pull, /requestRecommendations\(/);
  assert.match(pull, /trigger: 'pull-down'/);
  assert.match(scene, /requestRecommendations\(/);
  assert.match(scene, /trigger: 'scene-change'/);
});

test('next-batch refresh has its own visible timing lifecycle', () => {
  const body = functionBody('async function handleV2Refresh', 'async function handleRefresh');
  assert.match(body, /visibleTimingRecorder\.create\(/);
  assert.match(body, /visibleTimingRecorder\.response\(/);
  assert.match(body, /visibleTimingRecorder\.commit\(/);
  assert.match(body, /auditId: refreshAuditId/);
});

test('first image reports both load and failure lifecycle to Today', () => {
  assert.match(cardSource, /onLoad=.*onFirstImageLoad/s);
  assert.match(cardSource, /onError=.*onFirstImageError/s);
  assert.match(todaySource, /onFirstImageLoad=\{handleFirstCardImageLoad\}/);
  assert.match(todaySource, /onFirstImageError=\{handleFirstCardImageError\}/);
  assert.match(todaySource, /IMAGE_ONLOAD_NOT_FIRED/);
});

test('an unchanged rendered first image is measured for the new batch without requiring duplicate onLoad', () => {
  assert.match(cardSource, /onFirstImageLoad\?\.\([\s\S]*visibleTimingIdentity,[\s\S]*resolveGarmentAsset\(/);
  assert.match(todaySource, /loadedFirstImageSourceRef\.current = imageSource/);
  assert.match(todaySource, /loadedFirstImageSourceRef\.current !== firstCard\.items\[0\]\?\.displayImageUrl/);
  assert.match(todaySource, /visibleTimingRecorder\.imageLoad\(identity, visibleAt\)/);
  assert.match(todaySource, /visibleTimingRecorder\.imageVisible\(identity, visibleAt\)/);
});

test('visibility probes query the current batch identity instead of the first stale node', () => {
  assert.match(cardSource, /buildVisibleTimingSelectorClass\(visibleTimingIdentity, 'content'\)/);
  assert.match(cardSource, /buildVisibleTimingSelectorClass\(visibleTimingIdentity, 'image'\)/);
  assert.match(todaySource, /query\.selectAll\(selector\)\.boundingClientRect/);
  assert.match(todaySource, /selectorIdentityMatched: true/);
  assert.match(todaySource, /if \(current\.batchId !== identity\.batchId\) \{[\s\S]*?return;[\s\S]*?\}/);
});

test('diagnostics bridge is read-only and not a timing prerequisite', () => {
  const requestBody = functionBody('async function fetchRecommendations', 'async function handleV2Refresh');
  assert.doesNotMatch(requestBody, /__d1dTodayDiagnostics|readRecommendationVisibleTimings/);
  assert.match(todaySource, /readRecommendationVisibleTimings: \(\) => visibleTimingRecorder\.read\(\)/);
});

test('preserved in-flight recommendation keeps its visible timing lifecycle', () => {
  const resetBody = functionBody('const resetUserState = useCallback', 'useUnload(() =>');
  assert.match(
    resetBody,
    /if \(!preserveRecommendationLifecycle\) \{[\s\S]*?visibleTimingRecorder\.reset\(\);[\s\S]*?\}/,
  );
  assert.equal(
    (resetBody.match(/visibleTimingRecorder\.reset\(\)/g) ?? []).length,
    1,
  );
});
