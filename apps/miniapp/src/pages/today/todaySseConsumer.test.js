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
