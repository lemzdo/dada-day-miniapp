const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const { buildQaAuditSummaries, serializedBytes } = require('./services/qaBatchAudit');
const { adaptCompositionCandidate, hydrateCanonicalScore } = require('./services/canonicalCandidate');
const { buildRecommendationCountContract } = require('./shared/countContract');

function loadInternals() {
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
    delete require.cache[require.resolve('./index.js')];
    return require('./index.js').__test;
  } finally {
    Module._load = originalLoad;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
}

function makeCandidate(id, score) {
  const candidate = adaptCompositionCandidate({
    outfitKey: `key-${id}`,
    items: [{ _id: id, category: 'top', outfitSlot: 'top', outfitRole: 'core', styleTags: ['casual'] }],
  }, { scene: 'home', weather: {} });
  candidate.rankingScore = score;
  candidate.eligibilityReason = { code: 'HOME_COMFORT', subjectItemIds: [id] };
  hydrateCanonicalScore(candidate, { title: `title-${id}`, scores: { total: score } });
  return candidate;
}

function makeOutfit(index) {
  return {
    id: `outfit-${index}`,
    clothingIds: [`item-${index}`],
    title: `outfit ${index}`,
    imageUrl: `https://cdn.example/${index}.jpg`,
    copyContract: { todayReason: `reason-${index}` },
  };
}

test('native Light response remains diagnostics-free', () => {
  const source = fs.readFileSync(path.resolve(__dirname, 'index.js'), 'utf8');
  assert.doesNotMatch(source, /response\.diagnostics|projectRecommendationResponseOutfits|PUBLIC_OUTFIT_RESPONSE_FIELDS/);
  assert.match(source, /RecommendationRuntimeObservation/);
  assert.match(source, /batch: projectBatchCoreV2\(persisted\.batch\)/);
  assert.match(source, /light,/);
});

test('native light measurements remain observation-only and bounded to cards', () => {
  const internals = loadInternals();
  const cards = Array.from({ length: 8 }, (_, index) => ({ outfitKey: `key-${index}`, batchId: 'batch-1', items: [{ _id: `item-${index}`, clothingId: `item-${index}`, displayImageUrl: `https://cdn.example/${index}.jpg` }] }));
  const batch = internals.measureCanonicalBatchInput(cards);
  const light = internals.measureHomeLightMaterialization(cards, Date.now());
  const planned = internals.measurePlannedHomeLightMaterialization({ recommendations: cards, canonicalCopyBatch: { copies: cards.map(() => ({ text: 'safe' })) }, handlerStartedAt: Date.now() });
  assert.equal(batch.cardBytes.length, 8);
  assert.equal(light.homeLightCardBytes.length, 8);
  assert.equal(planned.homeLightCardBytes.length, 8);
  assert.equal(planned.persistedDetailDocumentReady, false);
});

test('favorite and worn status diagnostics remain independent observation records', () => {
  const internals = loadInternals();
  const diagnostics = { diagnosticsRequested: true };
  internals.recordStatusQueryDiagnostic(diagnostics, 'favorite', { data: [{ _id: 'fav-1', outfitKey: 'key-1' }] }, Date.now());
  internals.recordStatusQueryDiagnostic(diagnostics, 'worn', { data: [{ _id: 'wear-1', outfitKey: 'key-1' }] }, Date.now());
  assert.equal(diagnostics.statusQueries.favorite.recordCount, 1);
  assert.equal(diagnostics.statusQueries.worn.recordCount, 1);
  assert.equal(diagnostics.statusQueries.favorite.projected, false);
  assert.equal(diagnostics.statusQueries.worn.projected, false);
});

test('AI comment canonicalization carries the canonical Style Insight into a legacy content plan', () => {
  const internals = loadInternals();
  const xiaodaStyleInsight = {
    version: 'xiaoda-style-insight-v3',
    personaVersion: 'xiaoda-persona-v6',
    primary: { code: 'HOME_EASY_DAY_SET', rank: 'PRIMARY' },
    secondary: [],
    optional: [],
    forbiddenClaims: ['显瘦'],
  };
  const result = internals.canonicalizeAiCommentSource({
    scene: '居家',
    copyContractVersion: 'recommendation-copy-contract-v8',
    voiceBankVersion: 'xiaoda-fixed-claim-catalog-v2',
    copyContract: {
      copyContractVersion: 'recommendation-copy-contract-v8',
      voiceBankVersion: 'xiaoda-fixed-claim-catalog-v2',
      gateResult: 'PASS',
      riskFlags: [],
      todayReason: '白色上衣配灰色下装，今天在家穿很省心。',
      xiaodaStyleInsight,
    },
    contentPlan: {
      version: 'xiaoda-content-plan-v3',
      sceneIntent: 'home:clean_daily',
      primaryBenefit: 'clean_daily',
      items: [{ id: 'top-1', slot: 'top', role: 'core', displayName: '白色上衣' }],
    },
  });

  assert.equal(result.contentPlan.xiaodaStyleInsight.primary.code, 'HOME_EASY_DAY_SET');
});

test('AI review regeneration update data never attempts to overwrite cloud _openid', () => {
  const internals = loadInternals();
  const data = internals.buildAiReviewGeneratingData({
    openid: 'openid-user',
    outfitKey: 'bottom|top',
    scene: '居家',
    inputHash: 'hash',
    inputDigest: 'digest',
    reviewVersion: 'stylist-explanation-v5',
    promptVersion: 'stylist-prompt-v5',
    copyPolicyVersion: 'human-copy-v2',
    voicePolicyVersion: 'xiaoda-voice-v6',
    evidenceVersion: 'stylist-evidence-v2',
    provider: 'aliyun-bailian',
    model: 'qwen-flash',
  }, {
    generationToken: 'token',
    now: '2026-08-11T08:30:00.000Z',
    previousReview: { source: 'ai', optionalUndefined: undefined },
  });

  assert.equal(Object.hasOwn(data, '_openid'), false);
  assert.equal(data.userId, 'openid-user');
  assert.equal(data.status, 'generating');
  assert.equal(Object.hasOwn(data.previousReview, 'optionalUndefined'), false);
});

test('AI review ready persistence replaces null aiComment with a full document set', () => {
  const internals = loadInternals();
  const result = internals.buildAiReviewReadyDocument({
    _id: 'review-id',
    _openid: 'openid-user',
    aiComment: null,
    createdAt: '2026-08-11T08:00:00.000Z',
  }, {
    status: 'ready',
    aiComment: { reason: '真实 AI 点评', tip: '', source: 'ai' },
  }, { openid: 'openid-user' });

  assert.equal(Object.hasOwn(result, '_id'), false);
  assert.equal(result._openid, 'openid-user');
  assert.equal(result.aiComment.reason, '真实 AI 点评');
  assert.equal(result.createdAt, '2026-08-11T08:00:00.000Z');
});

test('AI review generating persistence replaces nested review state with a full document set', () => {
  const internals = loadInternals();
  const result = internals.buildAiReviewStoredDocument({
    _id: 'review-id',
    _openid: 'openid-user',
    previousReview: { aiComment: null },
    createdAt: '2026-08-11T08:00:00.000Z',
  }, {
    status: 'generating',
    previousReview: {
      aiComment: { reason: '上一版点评', source: 'ai' },
      adviceRejectReasons: [],
    },
  }, { openid: 'openid-user' }, { createdAt: '2026-08-11T09:00:00.000Z' });

  assert.equal(Object.hasOwn(result, '_id'), false);
  assert.equal(result._openid, 'openid-user');
  assert.equal(result.previousReview.aiComment.reason, '上一版点评');
  assert.deepEqual(result.previousReview.adviceRejectReasons, []);
  assert.equal(result.createdAt, '2026-08-11T08:00:00.000Z');
});

test('Detail adopts only a current Today plan whose primary matches its copy contract', () => {
  const internals = loadInternals();
  const source = {
    contentPlan: {
      version: 'xiaoda-content-plan-v3',
      sceneIntent: 'home:clean_daily',
      primaryBenefit: 'clean_daily',
      items: [{ id: 'top-1', slot: 'top', role: 'core', displayName: '白色上衣' }],
      xiaodaStyleInsight: { version: 'xiaoda-style-insight-v3', primary: { code: 'COLOR_FOCUS_WITH_NEUTRAL_SUPPORT' } },
    },
  };
  const requestedPlan = {
    version: 'xiaoda-content-plan-v3',
    sceneIntent: 'home:clean_daily',
    primaryBenefit: 'clean_daily',
    items: [{ id: 'top-1', slot: 'top', role: 'core', displayName: '白色上衣' }],
    xiaodaStyleInsight: { version: 'xiaoda-style-insight-v3', primary: { code: 'HOME_EASY_DAY_SET' } },
  };
  const payload = {
    copyContractVersion: 'recommendation-copy-contract-v8',
    copyContract: {
      copyContractVersion: 'recommendation-copy-contract-v8',
      xiaodaStyleInsight: { version: 'xiaoda-style-insight-v3', primary: { code: 'HOME_EASY_DAY_SET' } },
    },
    contentPlan: requestedPlan,
  };

  const aligned = internals.alignAiCommentSourceWithRequestedPresentation(source, payload);
  assert.equal(aligned.contentPlan.xiaodaStyleInsight.primary.code, 'HOME_EASY_DAY_SET');
  const rejected = internals.alignAiCommentSourceWithRequestedPresentation(source, {
    ...payload,
    copyContract: {
      ...payload.copyContract,
      xiaodaStyleInsight: { version: 'xiaoda-style-insight-v3', primary: { code: 'OTHER' } },
    },
  });
  assert.equal(rejected, source);
});
