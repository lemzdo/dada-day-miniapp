const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

function loadGenerateOutfitInternals() {
  const originalLoad = Module._load;
  Module._load = function loadWithCloudStub(request, parent, isMain) {
    if (request === 'wx-server-sdk') {
      return {
        DYNAMIC_CURRENT_ENV: 'test',
        init() {},
        database() { return { command: { in: (values) => values } }; },
        getWXContext() { return { OPENID: 'test-openid' }; },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  try {
    delete require.cache[require.resolve('../index.js')];
    return require('../index.js').__test;
  } finally {
    Module._load = originalLoad;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
}

test('Scene Evidence V4 fit and penalties change final ranking', () => {
  const { buildRankingScore } = loadGenerateOutfitInternals();
  const base = {
    outfitKey: 'same-candidate-for-deterministic-jitter',
    eligibility: { weather: { penalty: 0 } },
  };
  const strong = buildRankingScore({
    ...base,
    scores: { weatherAdaptation: 7, total: 7.9, sceneMatch: 8, sceneFitScore: 8 },
  });
  const negative = buildRankingScore({
    ...base,
    scores: { weatherAdaptation: 7, total: 6.7, sceneMatch: 4, sceneFitScore: 4 },
  });
  assert.ok(strong > negative);
});

test('weather penalty remains visible in final ranking', () => {
  const { buildRankingScore } = loadGenerateOutfitInternals();
  const candidate = {
    outfitKey: 'same-weather-candidate',
    scores: { weatherAdaptation: 7, total: 7, sceneFitScore: 7 },
  };
  const clean = buildRankingScore({ ...candidate, eligibility: { weather: { penalty: 0 } } });
  const penalized = buildRankingScore({ ...candidate, eligibility: { weather: { penalty: 1.5 } } });
  assert.equal(Math.round((clean - penalized) * 10) / 10, 1.5);
});

test('acceptance diagnostics expose bounded V4 counts families scores and cross-scene rank keys', () => {
  const { buildSceneEvidenceAcceptanceDiagnostics } = loadGenerateOutfitInternals();
  const accepted = [{
    outfitKey: 'top-a|bottom-a|shoe-a',
    rankingScore: 7.5,
    sceneEligibility: {
      sceneFitScore: 6.2,
      sceneEvidence: [
        { id: 'WORK_COMPLETE_DAILY_SET', severity: 'WEAK_POSITIVE', evidenceFamily: 'completeness' },
        { id: 'WORK_CASUAL_SHORTS_NEGATIVE', severity: 'NEGATIVE_SIGNAL', evidenceFamily: 'casual_penalty' },
      ],
    },
  }];
  const recommendations = [accepted[0]];
  recommendations.debug = {
    candidateCount: 3,
    _auditGuardAcceptedCandidates: accepted,
    _auditGuardRejectedCandidates: [
      { rejectionStage: 'scene_hard_conflict' },
      { rejectionStage: 'wearability_guard' },
    ],
  };
  const result = buildSceneEvidenceAcceptanceDiagnostics(recommendations);
  assert.equal(result.generated, 3);
  assert.equal(result.eligible, 1);
  assert.equal(result.hardRejected, 1);
  assert.equal(result.wearabilityRejected, 1);
  assert.equal(result.selected, 1);
  assert.deepEqual(result.topEvidenceFamilies, [{ family: 'completeness', count: 1 }]);
  assert.deepEqual(result.negativeFamilies, [{ family: 'casual_penalty', count: 1 }]);
  assert.deepEqual(result.candidates[0], {
    outfitKey: 'top-a|bottom-a|shoe-a',
    sceneFitScore: 6.2,
    rankingScore: 7.5,
    positiveFamilies: ['completeness'],
    negativeFamilies: ['casual_penalty'],
    evidenceIds: ['WORK_CASUAL_SHORTS_NEGATIVE', 'WORK_COMPLETE_DAILY_SET'],
    rank: 1,
    selected: true,
  });
});
