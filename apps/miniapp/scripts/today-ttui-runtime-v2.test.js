'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { segmentDurations, serverSegments, summarizeArtifacts, transportSegments } = require('./today-ttui-runtime-v2');

test('TTUI segments derive client state and usable paint from Today ledger stages', () => {
  const result = segmentDurations({ stages: { todayOnShow: 100, firstCardMounted: 160, firstImageLoaded: 220, responseAdaptStart: 120, responseAdaptEnd: 150, setOutfitsCalled: 170 }, durations: {} });
  assert.equal(result.firstCardPaintMs, 60);
  assert.equal(result.firstImagePaintMs, 120);
  assert.equal(result.usablePaintMs, 120);
  assert.equal(result.clientStateMs, 50);
});

test('TTUI refresh segments start at the user action instead of page entry', () => {
  const result = segmentDurations({ stages: { todayOnShow: 100, userActionStart: 500, firstCardMounted: 650, firstImageLoaded: 800 }, durations: {} });
  assert.equal(result.firstCardPaintMs, 150);
  assert.equal(result.firstImagePaintMs, 300);
  assert.equal(result.usablePaintMs, 300);
});

test('TTUI server segments prefer runtime V2 proxies and retain persistence separately', () => {
  const result = serverSegments({ serverTotalMs: 100, runtimeV2: { tReadServerProxyMs: 8, tCorePhaseProxyMs: 20, tSafeMs: 3, tAiNecessaryCriticalPathMs: 0 }, phases: [{ phase: 'snapshotPersistence', duration: 40 }], snapshotPersistence: { snapshotBuildMs: 2, serializationMs: 3, queryReadMs: 4, writeWallMs: 5, commitMs: 6 }, responseFinalization: { buildMs: 7, serializationMs: 8 } });
  assert.deepEqual(result, { readMs: 8, coreMs: 20, safeMs: 3, criticalPersistenceMs: 40, snapshotBuildMs: 2, snapshotSerializationMs: 3, snapshotDbReadMs: 4, snapshotDbWriteMs: 5, snapshotCommitMs: 6, responseBuildMs: 7, responseSerializationMs: 8, totalMs: 100, totalThroughResponseReadyMs: 100, aiMs: 0 });
});

test('TTUI client segments split normalize, state scheduling, and first usable render', () => {
  const result = segmentDurations({ stages: { clientNormalizeStart: 100, clientNormalizeEnd: 112, stateCommitStart: 115, stateCommitEnd: 118, setOutfitsCalled: 116, reactCommitAfterOutfits: 130, firstCardMounted: 132 }, durations: {} });
  assert.equal(result.normalizeMs, 12);
  assert.equal(result.stateCommitMs, 3);
  assert.equal(result.reactCommitMs, 14);
  assert.equal(result.firstUsableRenderMs, 16);
});

test('transport split applies the adjacent probe clock-offset estimate', () => {
  const result = transportSegments({
    transport: { immediatelyBeforeCallFunction: 1000, callFunctionPromiseResolved: 2500, clientTotalMs: 1500 },
    performance: { handlerStart: 1300, serverResponseReadyAt: 2400, serverTotalMs: 1100 },
    transportCalibration: { clockOffsetEstimateMs: 100 },
  });
  assert.deepEqual(result, { clientToHandlerMs: 200, returnToClientMs: 200, transportResidualMs: 400 });
});

test('TTUI summary reports P50/P95 for all required client/server segments', () => {
  const result = summarizeArtifacts([{ clientToCloudMs: 10, readMs: 2, coreMs: 4, safeMs: 1, criticalPersistenceMs: 2, clientTotalMs: 20, serverTotalMs: 10, clientStateMs: 3, usablePaintMs: 8 }, { clientToCloudMs: 20, readMs: 3, coreMs: 5, safeMs: 2, criticalPersistenceMs: 4, clientTotalMs: 30, serverTotalMs: 20, clientStateMs: 5, usablePaintMs: 12 }]);
  assert.equal(result.coreMs.p50Ms, 4);
  assert.equal(result.coreMs.p95Ms, 5);
  assert.equal(result.cloudToClientMs.p95Ms, 10);
  assert.equal(result.usablePaintMs.p95Ms, 12);
});
