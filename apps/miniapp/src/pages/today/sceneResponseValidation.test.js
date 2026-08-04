const assert = require('node:assert/strict');
const test = require('node:test');

const {
  validateSceneContract,
  validateRecommendationCountContract,
  normalizeScene,
  DEFAULT_SCENES,
} = require('./sceneResponseValidation');

const SCENES = DEFAULT_SCENES;

function makeRequestContext(sceneKey, seq = 1) {
  const labelMap = { home: '居家', work: '上班', date: '约会', sport: '运动' };
  return {
    requestSeq: seq,
    sceneKey,
    sceneLabel: labelMap[sceneKey] || sceneKey,
    weatherMode: 'disabled',
    requestedAt: Date.now(),
  };
}

function makeResponse(sceneKey, scene) {
  return {
    sceneKey,
    scene: scene || '',
    outfits: [{ id: 'o1' }],
  };
}

test('STALE_REQUEST_SEQ: stale request is rejected with request context', () => {
  const workContext = makeRequestContext('work', 1);
  const data = makeResponse('work', '上班');
  assert.deepEqual(validateSceneContract(workContext, data, 2, 'work'), {
    ok: false,
    reason: 'STALE_REQUEST_SEQ',
    requestSeq: 1,
    currentSeq: 2,
    requestSceneKey: 'work',
    currentSceneKey: 'work',
    responseSceneKey: 'work',
    responseScene: '上班',
  });
});

test('ACTIVE_SCENE_CHANGED: scene switch is rejected with response diagnostics', () => {
  const workContext = makeRequestContext('work', 1);
  const data = makeResponse('work', '上班');
  assert.deepEqual(validateSceneContract(workContext, data, 1, 'date'), {
    ok: false,
    reason: 'ACTIVE_SCENE_CHANGED',
    requestSeq: 1,
    currentSeq: 1,
    requestSceneKey: 'work',
    currentSceneKey: 'date',
    responseSceneKey: 'work',
    responseScene: '上班',
  });
});

test('MISSING_RESPONSE_SCENE_KEY: top-level sceneKey remains required', () => {
  const workContext = makeRequestContext('work', 2);
  const data = { scene: '上班', outfits: [{ id: 'o1', scene: '上班' }] };
  assert.deepEqual(validateSceneContract(workContext, data, 2, 'work'), {
    ok: false,
    reason: 'MISSING_RESPONSE_SCENE_KEY',
    requestSeq: 2,
    currentSeq: 2,
    requestSceneKey: 'work',
    currentSceneKey: 'work',
    responseSceneKey: undefined,
    responseScene: '上班',
  });
});

test('UNKNOWN_RESPONSE_SCENE_KEY: labels and arbitrary values do not satisfy the key contract', () => {
  const workContext = makeRequestContext('work', 2);
  const data = makeResponse('通勤', '通勤');
  assert.deepEqual(validateSceneContract(workContext, data, 2, 'work'), {
    ok: false,
    reason: 'UNKNOWN_RESPONSE_SCENE_KEY',
    requestSeq: 2,
    currentSeq: 2,
    requestSceneKey: 'work',
    currentSceneKey: 'work',
    responseSceneKey: '通勤',
    responseScene: '通勤',
  });
});

test('RESPONSE_SCENE_MISMATCH: known but different sceneKey is rejected', () => {
  const workContext = makeRequestContext('work', 2);
  const data = makeResponse('date', '约会');
  assert.deepEqual(validateSceneContract(workContext, data, 2, 'work'), {
    ok: false,
    reason: 'RESPONSE_SCENE_MISMATCH',
    requestSeq: 2,
    currentSeq: 2,
    requestSceneKey: 'work',
    currentSceneKey: 'work',
    responseSceneKey: 'date',
    responseScene: '约会',
  });
});

test('matching top-level sceneKey is accepted', () => {
  const workContext = makeRequestContext('work', 2);
  const data = makeResponse('work', '上班');
  assert.deepEqual(validateSceneContract(workContext, data, 2, 'work'), { ok: true });
});

test('normalizeScene maps labels and keys correctly', () => {
  assert.equal(normalizeScene('上班', SCENES), 'work');
  assert.equal(normalizeScene('居家', SCENES), 'home');
  assert.equal(normalizeScene('约会', SCENES), 'date');
  assert.equal(normalizeScene('运动', SCENES), 'sport');
  assert.equal(normalizeScene(undefined, SCENES), null);
  assert.equal(normalizeScene('unknown', SCENES), null);
});

for (const count of [1, 5, 7, 8]) {
  test(`count contract accepts exact ${count}-card response`, () => {
    const data = {
      outfits: Array.from({ length: count }, (_, index) => ({ id: `o${index}` })),
      countContract: {
        requestedBatchSize: 8,
        expectedCardCount: count,
        returnedCardCount: count,
        remainingUniqueBeforeConsume: count,
        remainingUniqueAfterConsume: 0,
        tailBatchAuthorized: count < 8,
        poolExhaustedAfterConsume: true,
        executionMode: 'candidate_pool_hit',
        candidatePoolId: null,
      },
    };
    assert.equal(validateRecommendationCountContract(data).ok, true);
  });
}

test('count contract rejects one missing card even when a tail is declared', () => {
  const data = {
    outfits: Array.from({ length: 4 }, (_, index) => ({ id: `o${index}` })),
    countContract: {
      requestedBatchSize: 8,
      expectedCardCount: 5,
      returnedCardCount: 5,
      remainingUniqueBeforeConsume: 5,
      remainingUniqueAfterConsume: 0,
      tailBatchAuthorized: true,
      poolExhaustedAfterConsume: true,
      executionMode: 'candidate_pool_hit',
      candidatePoolId: null,
    },
  };
  assert.equal(validateRecommendationCountContract(data).reason, 'COUNT_CONTRACT_MISMATCH');
});

test('count contract accepts the explicit zero-card exhausted product state', () => {
  const data = {
    outfits: [],
    countContract: {
      requestedBatchSize: 8,
      expectedCardCount: 0,
      returnedCardCount: 0,
      remainingUniqueBeforeConsume: 0,
      remainingUniqueAfterConsume: 0,
      tailBatchAuthorized: false,
      poolExhaustedAfterConsume: true,
      executionMode: 'candidate_pool_hit',
      candidatePoolId: null,
    },
  };
  assert.deepEqual(validateRecommendationCountContract(data), { ok: true });
});

test('client reads only data.countContract and rejects missing, null, or nested alternatives', () => {
  const valid = {
    requestedBatchSize: 8,
    expectedCardCount: 1,
    returnedCardCount: 1,
    remainingUniqueBeforeConsume: 1,
    remainingUniqueAfterConsume: 0,
    tailBatchAuthorized: true,
    poolExhaustedAfterConsume: true,
    executionMode: 'candidate_pool_hit',
    candidatePoolId: null,
  };
  for (const data of [
    { outfits: [{}] },
    { outfits: [{}], countContract: null },
    { outfits: [{}], debug: { countContract: valid } },
    { outfits: [{}], qaBatchAudit: { countContract: valid } },
    { outfits: [{}], recommendation: { countContract: valid } },
  ]) {
    assert.equal(validateRecommendationCountContract(data).reason, 'MISSING_COUNT_CONTRACT');
  }
});
