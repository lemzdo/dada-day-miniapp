const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  TODAY_SCENE_COPY_VERSION,
  TODAY_SCENE_SNAPSHOT_TTL_MS,
  buildExhaustedSnapshotState,
  buildSceneSnapshotKey,
  chooseSceneTransitionState,
  isNoMoreRecommendationState,
  shouldUseSceneSnapshot,
} = require('./sceneSnapshot');

const COPY_CONTRACT_VERSION = 'recommendation-copy-contract-v3';
const VOICE_BANK_VERSION = 'xiaoda-fixed-claim-catalog-v2';

function currentOutfit(id = 'current') {
  return {
    id,
    copyContractVersion: COPY_CONTRACT_VERSION,
    voiceBankVersion: VOICE_BANK_VERSION,
    copyContract: {
      copyContractVersion: COPY_CONTRACT_VERSION,
      voiceBankVersion: VOICE_BANK_VERSION,
      gateResult: 'PASS',
      todayReason: '衬衫配直筒裤，上班穿比较利落。',
      riskFlags: [],
    },
  };
}

function countContractFor(count = 1) {
  return {
    requestedBatchSize: 8,
    expectedCardCount: count,
    returnedCardCount: count,
    remainingUniqueBeforeConsume: count,
    remainingUniqueAfterConsume: 0,
    tailBatchAuthorized: count > 0 && count < 8,
    poolExhaustedAfterConsume: true,
    executionMode: 'candidate_pool_hit',
    candidatePoolId: null,
  };
}

function snapshotFor(key, outfits, count = outfits.length, extra = {}) {
  return {
    key,
    outfits,
    countContract: countContractFor(count),
    generatedAt: 1000,
    ...extra,
  };
}

test('scene snapshot key includes runtime date scene weather and copy version', () => {
  assert.equal(TODAY_SCENE_COPY_VERSION, COPY_CONTRACT_VERSION);
  const key = buildSceneSnapshotKey({
    userRuntimeKey: 'user-a',
    date: '2026-07-09',
    timeOfDay: 'all_day',
    scene: '上班',
    weatherFingerprint: '26:cloudy',
    wardrobeVersion: 'wardrobe-3',
    profileVersion: 'profile-2',
    reasonVersion: 'recommendation-reason-v3',
    copyVersion: 'page-copy-v4',
  });

  assert.equal(key, 'user-a|2026-07-09|all_day|上班|26:cloudy|wardrobe-3|profile-2|recommendation-reason-v3|page-copy-v4');
});

test('scene snapshot requires every outfit to carry the current Contract and Catalog versions', () => {
  const key = buildSceneSnapshotKey({ scene: '上班' });
  const expected = { key };
  const current = currentOutfit();
  const stale = { id: 'stale', copyContractVersion: 'recommendation-copy-contract-v0' };

  assert.equal(shouldUseSceneSnapshot(snapshotFor(key, [current]), { ...expected, now: 1000 }), true);
  assert.equal(shouldUseSceneSnapshot(snapshotFor(key, [current, stale], 2), { ...expected, now: 1000 }), false);
  assert.equal(shouldUseSceneSnapshot({
    key,
    countContract: countContractFor(),
    outfits: [{
      ...currentOutfit('stale-voice'),
      voiceBankVersion: 'xiaoda-voice-bank-v2',
    }],
    generatedAt: 1000,
  }, { ...expected, now: 1000 }), false);
  assert.equal(shouldUseSceneSnapshot(snapshotFor(key, [{ id: 'missing' }]), { ...expected, now: 1000 }), false);
  assert.equal(shouldUseSceneSnapshot({
    key,
    outfits: [currentOutfit('short-1'), currentOutfit('short-2'), currentOutfit('short-3'), currentOutfit('short-4')],
    countContract: countContractFor(5),
    generatedAt: 1000,
  }, { ...expected, now: 1000 }), false);
});

test('scene snapshot preserves current outfits whose default copy is hidden', () => {
  const key = buildSceneSnapshotKey({ scene: '居家' });
  const hidden = currentOutfit('hidden');
  hidden.copyContract = {
    ...hidden.copyContract,
    gateResult: 'REJECT',
    todayReason: '',
    riskFlags: ['NO_ACCEPTED_CORE_CLAIM'],
  };

  assert.equal(shouldUseSceneSnapshot(snapshotFor(key, [hidden]), { key, now: 1000 }), true);
});

test('scene snapshot is rejected when cache invalidation inputs change', () => {
  const snapshot = {
    key: buildSceneSnapshotKey({
      userRuntimeKey: 'user-a',
      date: '2026-07-09',
      timeOfDay: 'all_day',
      scene: '居家',
      weatherFingerprint: '26:cloudy',
      reasonVersion: 'recommendation-reason-v3',
      copyVersion: 'page-copy-v4',
    }),
    outfits: [currentOutfit('outfit-1')],
    countContract: countContractFor(),
    generatedAt: 1000,
  };

  assert.equal(shouldUseSceneSnapshot(snapshot, { key: snapshot.key, now: 1000 }), true);
  assert.equal(shouldUseSceneSnapshot(snapshot, { key: snapshot.key.replace('居家', '约会'), now: 1000 }), false);
});

test('scene snapshot expires on TTL and preserves a valid zero-card exhausted state', () => {
  const key = buildSceneSnapshotKey({ scene: 'sport' });
  const zeroSnapshot = {
    key,
    outfits: [],
    countContract: countContractFor(0),
    generatedAt: 1000,
    hasRecommendations: false,
    batchExhausted: true,
  };

  assert.equal(shouldUseSceneSnapshot(zeroSnapshot, { key, now: 1000 }), true);
  assert.equal(shouldUseSceneSnapshot(zeroSnapshot, {
    key,
    now: 1000 + TODAY_SCENE_SNAPSHOT_TTL_MS + 1,
  }), false);
  assert.equal(shouldUseSceneSnapshot({
    ...zeroSnapshot,
    batchExhausted: false,
  }, { key, now: 1000 }), false);
});

test('8 to 5 to 0 keeps the last visible tail batch and persists terminal exhaustion', () => {
  const key = buildSceneSnapshotKey({
    userRuntimeKey: 'user-a',
    scene: 'date',
    weatherFingerprint: 'live:26:clear',
    wardrobeVersion: 'wardrobe-3',
    profileVersion: 'profile-2',
  });
  const tail = Array.from({ length: 5 }, (_, index) => currentOutfit(`date-tail-${index + 1}`));
  const exhausted = buildExhaustedSnapshotState({
    outfits: tail,
    currentIndex: 3,
    recommendationBatchId: 'date-pool-1',
    countContract: countContractFor(0),
    recommendationNotice: '这一轮暂时没有更多新搭配了',
  });
  const snapshot = { key, generatedAt: 1000, ...exhausted };

  assert.equal(exhausted.outfits.length, 5);
  assert.equal(exhausted.currentIndex, 3);
  assert.equal(exhausted.hasRecommendations, true);
  assert.equal(exhausted.noMoreRecommendations, true);
  assert.equal(exhausted.countContract.returnedCardCount, 0);
  assert.equal(exhausted.lastVisibleBatch.returnedCardCount, 5);
  assert.deepEqual(exhausted.lastVisibleBatch.outfitKeys, tail.map((outfit) => outfit.id));
  assert.equal(shouldUseSceneSnapshot(snapshot, { key, now: 1000 }), true);
  assert.equal(isNoMoreRecommendationState(snapshot), true);
});

test('retained exhaustion rejects stale identity, TTL, input versions, and other users', () => {
  const key = buildSceneSnapshotKey({
    userRuntimeKey: 'user-a', scene: 'date', weatherFingerprint: 'weather-a',
    wardrobeVersion: 'wardrobe-1', profileVersion: 'profile-1',
  });
  const exhausted = buildExhaustedSnapshotState({
    outfits: [currentOutfit('tail-1')],
    recommendationBatchId: 'pool-a',
    countContract: countContractFor(0),
  });
  const snapshot = { key, generatedAt: 1000, ...exhausted };
  assert.equal(shouldUseSceneSnapshot({
    ...snapshot,
    lastVisibleBatch: { ...snapshot.lastVisibleBatch, recommendationBatchId: 'pool-b' },
  }, { key, now: 1000 }), false);
  assert.equal(shouldUseSceneSnapshot(snapshot, { key, now: 1000 + TODAY_SCENE_SNAPSHOT_TTL_MS + 1 }), false);
  for (const changed of [
    key.replace('user-a', 'user-b'),
    key.replace('weather-a', 'weather-b'),
    key.replace('wardrobe-1', 'wardrobe-2'),
    key.replace('profile-1', 'profile-2'),
  ]) {
    assert.equal(shouldUseSceneSnapshot(snapshot, { key: changed, now: 1000 }), false);
  }
});

test('initial zero and request errors cannot impersonate retained exhaustion', () => {
  const initialZero = buildExhaustedSnapshotState({ outfits: [], countContract: countContractFor(0) });
  assert.equal(initialZero.hasRecommendations, false);
  assert.equal(initialZero.lastVisibleBatch, null);
  assert.equal(buildExhaustedSnapshotState({
    outfits: [currentOutfit('old')],
    countContract: countContractFor(5),
  }), null);
  assert.equal(isNoMoreRecommendationState({
    batchExhausted: true,
    countContract: countContractFor(5),
  }), false);
});

test('restored retained exhaustion keeps cards and suppresses another pool request', () => {
  const outfits = Array.from({ length: 5 }, (_, index) => currentOutfit(`tail-${index}`));
  const snapshot = buildExhaustedSnapshotState({
    outfits,
    recommendationBatchId: 'pool-a',
    countContract: countContractFor(0),
    recommendationNotice: '这一轮暂时没有更多新搭配了',
  });
  const transition = chooseSceneTransitionState({ snapshot, nextSceneKey: 'date' });
  assert.deepEqual(transition.outfits, outfits);
  assert.equal(transition.noMoreRecommendations, true);
  assert.equal(transition.batchExhausted, true);
  assert.equal(isNoMoreRecommendationState(transition), true);
});

test('Today commits legal zero responses to both snapshots before suppressing repeated refresh', () => {
  const source = fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8');
  const refreshStart = source.indexOf('async function handleRefresh()');
  const refreshEnd = source.indexOf('async function handleToggleFavorite()', refreshStart);
  const refreshSource = source.slice(refreshStart, refreshEnd);
  const suppression = refreshSource.indexOf('isNoMoreRecommendationState({');
  const cloudCall = refreshSource.indexOf('const data = await generateCloudOutfit({');
  const exhaustedCommit = refreshSource.indexOf('const exhaustedState = buildExhaustedSnapshotState({');
  assert.ok(suppression >= 0 && suppression < cloudCall, 'exhausted state must suppress a repeated cloud call');
  assert.ok(exhaustedCommit > cloudCall, 'only a validated cloud response may create exhaustion');
  assert.match(refreshSource.slice(exhaustedCommit), /storeSceneSnapshot\(\{/);
  assert.match(refreshSource.slice(exhaustedCommit), /storeTodayRestoreSnapshot\(\{/);
  assert.match(refreshSource.slice(exhaustedCommit), /countContract: data\.countContract/);
  assert.match(refreshSource.slice(exhaustedCommit), /lastVisibleBatch: exhaustedState\.lastVisibleBatch/);
});

test('scene transition shows empty loading state when requested scene has no snapshot', () => {
  const currentOutfits = [{ id: 'home-1' }];
  const result = chooseSceneTransitionState({
    currentOutfits,
    snapshot: null,
    nextSceneKey: 'work',
  });

  assert.deepEqual(result.outfits, []);
  assert.equal(result.currentIndex, 0);
  assert.equal(result.hasRecommendations, true);
  assert.equal(result.keepPreviousWhileLoading, false);
});

test('scene transition never shows previous scene cards under new tab', () => {
  const homeOutfits = [{ id: 'home-1' }, { id: 'home-2' }];
  const result = chooseSceneTransitionState({
    currentOutfits: homeOutfits,
    snapshot: null,
    nextSceneKey: 'date',
  });

  assert.equal(result.outfits.length, 0);
  assert.equal(result.selectedSceneKey, 'date');
  assert.equal(result.keepPreviousWhileLoading, false);
});

test('cross-scene without snapshot: outfits empty, keepPreviousWhileLoading false', () => {
  const result = chooseSceneTransitionState({
    currentOutfits: [{ id: 'home-1' }],
    snapshot: null,
    nextSceneKey: 'work',
  });
  assert.equal(result.outfits.length, 0);
  assert.equal(result.keepPreviousWhileLoading, false);
  assert.equal(result.hasRecommendations, true);
});

test('with snapshot: keepPreviousWhileLoading false, outfits from snapshot', () => {
  const snapshotOutfits = [{ id: 'work-1' }];
  const result = chooseSceneTransitionState({
    currentOutfits: [{ id: 'home-1' }],
    snapshot: {
      outfits: snapshotOutfits,
      currentIndex: 0,
      hasRecommendations: true,
      recommendationBatchId: 'batch-1',
      batchLimited: false,
      batchExhausted: false,
      recommendationNotice: '',
    },
    nextSceneKey: 'work',
  });
  assert.deepEqual(result.outfits, snapshotOutfits);
  assert.equal(result.keepPreviousWhileLoading, false);
});
