'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { segmentDurations, serverSegments, summarizeArtifacts } = require('./today-ttui-runtime-v2');

test('TTUI segments derive client state and usable paint from Today ledger stages', () => {
  const result = segmentDurations({ stages: { todayOnShow: 100, firstCardMounted: 160, firstImageLoaded: 220, responseAdaptStart: 120, responseAdaptEnd: 150 }, durations: {} });
  assert.equal(result.firstCardPaintMs, 60);
  assert.equal(result.firstImagePaintMs, 120);
  assert.equal(result.usablePaintMs, 120);
  assert.equal(result.clientStateMs, 30);
});

test('TTUI server segments prefer runtime V2 proxies and retain persistence separately', () => {
  const result = serverSegments({ serverTotalMs: 100, runtimeV2: { tReadServerProxyMs: 8, tCorePhaseProxyMs: 20, tSafeMs: 3, tAiNecessaryCriticalPathMs: 0 }, phases: [{ phase: 'snapshotPersistence', duration: 40 }] });
  assert.deepEqual(result, { readMs: 8, coreMs: 20, safeMs: 3, criticalPersistenceMs: 40, totalMs: 100, aiMs: 0 });
});

test('TTUI summary reports P50/P95 for all required client/server segments', () => {
  const result = summarizeArtifacts([{ clientToCloudMs: 10, readMs: 2, coreMs: 4, safeMs: 1, criticalPersistenceMs: 2, clientTotalMs: 20, serverTotalMs: 10, clientStateMs: 3, usablePaintMs: 8 }, { clientToCloudMs: 20, readMs: 3, coreMs: 5, safeMs: 2, criticalPersistenceMs: 4, clientTotalMs: 30, serverTotalMs: 20, clientStateMs: 5, usablePaintMs: 12 }]);
  assert.equal(result.coreMs.p50Ms, 4);
  assert.equal(result.coreMs.p95Ms, 5);
  assert.equal(result.cloudToClientMs.p95Ms, 10);
  assert.equal(result.usablePaintMs.p95Ms, 12);
});
