'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8');

test('Today interactive acquisition reuses the existing commit boundary', () => {
  assert.match(source, /acquireRecommendationForInput\(\{[\s\S]*?interactiveLifecycle: createInteractiveLifecycle/);
  assert.match(source, /const committed = await commitCanonicalSnapshotForRender\(canonicalSnapshot/);
  assert.match(source, /flushPendingInteractiveCopies\(nextSnapshot\.batchId, traceGeneration, authContext\)/);
});

test('SSE batches do not run the legacy high-frequency polling path', () => {
  const pollingEffect = source.slice(
    source.indexOf('void runBoundedCanonicalCopyRefresh'),
    source.indexOf('useLoad(() =>'),
  );
  const guard = source.slice(source.lastIndexOf('useEffect(() => {', source.indexOf('void runBoundedCanonicalCopyRefresh')), source.indexOf('void runBoundedCanonicalCopyRefresh'));
  assert.match(guard, /interactiveSseBatchIdsRef\.current\.has\(v2Snapshot\.batchId\)/);
  assert.doesNotMatch(pollingEffect, /sse:/);
});

test('post-ready SSE failure permits one delayed canonical read only', () => {
  const lifecycle = source.slice(
    source.indexOf('function createInteractiveLifecycle'),
    source.indexOf('useEffect(() =>', source.indexOf('function createInteractiveLifecycle')),
  );
  assert.match(lifecycle, /sseFallbackRefreshStartedRef\.current\.has\(readyBatchId\)/);
  assert.match(lifecycle, /getCloudRecommendationCanonicalOverlayV2\(readyBatchId\)/);
  assert.match(lifecycle, /}, 1200\)/);
  assert.doesNotMatch(lifecycle, /runBoundedCanonicalCopyRefresh/);
});

test('SSE failure emits explicit error and fallback diagnostics', () => {
  const lifecycle = source.slice(
    source.indexOf('function createInteractiveLifecycle'),
    source.indexOf('useEffect(() =>', source.indexOf('function createInteractiveLifecycle')),
  );
  assert.match(lifecycle, /traceTodayRuntime\('sse:error'/);
  assert.match(lifecycle, /traceTodayRuntime\('sse:fallback'/);
});

test('scene change enters the interactive acquisition path without a legacy request call', () => {
  const sceneHandler = source.slice(
    source.indexOf('function handleSceneSelect'),
    source.indexOf('async function handleV2Favorite'),
  );
  const fetchPath = source.slice(
    source.indexOf('async function fetchRecommendations'),
    source.indexOf('async function handleV2Refresh'),
  );
  assert.match(sceneHandler, /trigger: 'scene-change'/);
  assert.match(fetchPath, /interactiveLifecycle: createInteractiveLifecycle/);
  assert.doesNotMatch(fetchPath, /generateCloudOutfitV2|callCloudFunction/);
});
