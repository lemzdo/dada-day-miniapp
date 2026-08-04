const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');
const { CLOUD_BUILD_VERSION } = require('./services/buildVersions');
const {
  assertRecommendationCountContract,
  assertReturnedCardCount,
  buildRecommendationCountContract,
} = require('./shared/countContract');

function loadGenerateOutfitInternals() {
  const originalLoad = Module._load;
  Module._load = function loadWithCloudStub(request, parent, isMain) {
    if (request === 'wx-server-sdk') {
      return {
        DYNAMIC_CURRENT_ENV: 'test',
        init() {},
        database() {
          return { command: { in: (values) => values } };
        },
        getWXContext() { return { OPENID: 'test-openid' }; },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  try {
    delete require.cache[require.resolve('./index.js')];
    return require('./index.js').__test;
  } finally {
    Module._load = originalLoad;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
}

function buildResponsePayload(outfits, extra = {}) {
  const executionMode = extra.executionMode || 'full_compute';
  const countContract = extra.countContract || buildRecommendationCountContract({
    returnedCardCount: outfits.length,
    remainingUniqueBeforeConsume: outfits.length,
    executionMode,
  });
  return {
    outfits,
    countContract,
    weatherMode: 'disabled',
    recommendationNotice: '',
    recommendationBatchId: 'batch-scene-contract',
    missingRoles: [],
    limited: false,
    exhausted: false,
    debug: { cloudBuildVersion: 'test-build' },
    meta: { cloudBuildVersion: 'test-build' },
    ...extra,
  };
}

function assertRecommendationSceneContract(data, expectedSceneKey, expectedScene) {
  const keys = Object.keys(data);
  assert.equal(keys.includes('sceneKey'), true);
  assert.equal(keys.includes('scene'), true);
  assert.equal(keys.includes('outfits'), true);
  assert.equal(data.sceneKey, expectedSceneKey);
  assert.equal(data.scene, expectedScene);
  assertRecommendationCountContract(data.countContract);
  assertReturnedCardCount(data.countContract, data.outfits.length);
}

test('actual generate response builder supplies canonical scene contract for every scene', () => {
  const internals = loadGenerateOutfitInternals();
  const eightOutfits = Array.from({ length: 8 }, (_, index) => ({ id: `outfit-${index + 1}` }));
  const cases = [
    ['居家', 'home', '居家'],
    ['通勤', 'work', '上班'],
    ['约会', 'date', '约会'],
    ['运动', 'sport', '运动'],
  ];

  for (const [requestScene, expectedSceneKey, expectedScene] of cases) {
    const sceneContract = internals.createRecommendationSceneContract(requestScene);
    const finalData = internals.buildRecommendationResponseData(
      sceneContract,
      buildResponsePayload(eightOutfits),
    );
    assertRecommendationSceneContract(finalData, expectedSceneKey, expectedScene);
    assert.equal(finalData.outfits.length, 8);
    assert.deepEqual(internals.ok(finalData), { code: 0, data: finalData, message: 'ok' });
  }
});

test('actual generate response builder preserves the scene contract for empty successful results', () => {
  const internals = loadGenerateOutfitInternals();
  const sceneContract = internals.createRecommendationSceneContract('通勤');
  const cases = [
    { name: 'empty', limited: false, exhausted: false, missingRoles: [] },
    { name: 'limited', limited: true, exhausted: false, missingRoles: ['shoes'] },
    { name: 'exhausted', limited: false, exhausted: true, missingRoles: [] },
    { name: 'wardrobe-insufficient', limited: true, exhausted: true, missingRoles: ['top', 'shoes'] },
  ];

  for (const scenario of cases) {
    const finalData = internals.buildRecommendationResponseData(
      sceneContract,
      buildResponsePayload([], scenario),
    );
    assertRecommendationSceneContract(finalData, 'work', '上班');
    assert.deepEqual(finalData.outfits, []);
    assert.equal(finalData.limited, scenario.limited, scenario.name);
    assert.equal(finalData.exhausted, scenario.exhausted, scenario.name);
    assert.equal(internals.ok(finalData).code, 0, scenario.name);
  }
});

for (const [executionMode, count] of [
  ['full_compute', 8],
  ['candidate_pool_hit', 8],
  ['candidate_pool_hit', 1],
  ['candidate_pool_hit', 5],
  ['candidate_pool_hit', 7],
  ['candidate_pool_hit', 0],
  ['fallback_recompute', 8],
]) {
  test(`formal response keeps one authoritative count contract for ${executionMode} ${count}`, () => {
    const internals = loadGenerateOutfitInternals();
    const outfits = Array.from({ length: count }, (_, index) => ({ id: `outfit-${index + 1}` }));
    const countContract = buildRecommendationCountContract({
      returnedCardCount: count,
      remainingUniqueBeforeConsume: count,
      executionMode,
    });
    const finalData = internals.buildRecommendationResponseData(
      internals.createRecommendationSceneContract('sport'),
      buildResponsePayload(outfits, { countContract, executionMode }),
    );
    const cloudReturn = internals.ok(finalData);
    assert.strictEqual(cloudReturn.data.countContract, countContract);
    assert.equal(cloudReturn.data.countContract.executionMode, executionMode);
    assertReturnedCardCount(cloudReturn.data.countContract, cloudReturn.data.outfits.length);
  });
}

test('actual generate response builder preserves canonical cloud build version in debug', () => {
  const internals = loadGenerateOutfitInternals();
  const sceneContract = internals.createRecommendationSceneContract('work');
  const finalData = internals.buildRecommendationResponseData(
    sceneContract,
    buildResponsePayload([], {
      debug: { cloudBuildVersion: CLOUD_BUILD_VERSION },
      meta: { cloudBuildVersion: CLOUD_BUILD_VERSION },
    }),
  );

  assert.equal(finalData.debug.cloudBuildVersion, CLOUD_BUILD_VERSION);
  assert.equal(finalData.meta.cloudBuildVersion, CLOUD_BUILD_VERSION);
});
