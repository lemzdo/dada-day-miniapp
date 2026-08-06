const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const {
  assertFinalPresentation,
  canonicalizeRecommendation,
} = require('./services/recommendationPresentation');

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

function canonicalCard(scene) {
  return canonicalizeRecommendation({
    outfitKey: `${scene}-top_bottom_shoes`,
    scene,
    snapshotItems: [
      { itemId: `${scene}-top`, category: 'top', subcategory: 'T恤', color: '白色' },
      { itemId: `${scene}-bottom`, category: 'bottom', subcategory: '长裤', color: '灰色' },
      { itemId: `${scene}-shoes`, category: 'shoes', subcategory: '运动鞋', color: '白色' },
    ],
    styleTags: [],
    contentPlan: {
      version: 'xiaoda-content-plan-v1',
      sceneIntent: `${scene}:fixture`,
      primaryBenefit: 'fixture',
      items: [{ id: `${scene}-top`, slot: 'top', role: 'core', displayName: 'T恤' }],
    },
    copyContract: {
      todayReason: '基于当前衣物事实生成的有效理由。',
      coreEligibilityReasonCode: 'SPORT_LIGHT_ACTIVITY_SET',
    },
  }, { scene });
}

test('new recommendation enrichment keeps canonical title authoritative across all scenes', () => {
  const { resolveEnrichedTitleState } = loadGenerateOutfitInternals();
  for (const scene of ['home', 'work', 'date', 'sport']) {
    const card = canonicalCard(scene);
    const resolved = resolveEnrichedTitleState(card, {
      title: '旧资产标题',
      userTitle: '用户保存的自定义标题',
    }, 'new_recommendation');
    const enriched = { ...card, ...resolved };

    assert.equal(enriched.outfitKey, card.outfitKey);
    assert.equal(enriched.title, card.presentationPlan.titleConcept);
    assert.equal(enriched.displayTitle, card.presentationPlan.titleConcept);
    assert.equal(enriched.userTitle, '用户保存的自定义标题');
    assert.doesNotThrow(() => assertFinalPresentation([enriched], scene));
  }
});

test('saved snapshot enrichment still presents a user title without changing the canonical title', () => {
  const { resolveEnrichedTitleState } = loadGenerateOutfitInternals();
  const card = canonicalCard('sport');
  const resolved = resolveEnrichedTitleState(card, { userTitle: '周末跑步' }, 'saved_snapshot');

  assert.equal(resolved.title, card.title);
  assert.equal(resolved.userTitle, '周末跑步');
  assert.equal(resolved.displayTitle, '周末跑步');
});

test('snapshot persistence keeps the final presentation plan and existing user title together', () => {
  const { buildOutfitSaveData } = loadGenerateOutfitInternals();
  const card = canonicalCard('sport');
  card.clothingIds = card.snapshotItems.map((item) => item.itemId);
  const saved = buildOutfitSaveData(card, {
    outfitKey: card.outfitKey,
    now: '2026-08-04T00:00:00.000Z',
    patch: {},
    current: { userTitle: '周末跑步' },
  });

  assert.equal(saved.userTitle, '周末跑步');
  assert.equal(saved.displayTitle, '周末跑步');
  assert.equal(saved.source, 'presentation_plan');
  assert.deepEqual(saved.presentationPlan, card.presentationPlan);
  assert.equal(saved.copyContract.todayReason, card.presentationPlan.todayReason);
  assert.equal(saved.contentPlan.defaultTodayReason, card.presentationPlan.todayReason);
});

test('missing, empty, or invalid canonical titles are not masked by persisted asset titles', () => {
  const { resolveEnrichedTitleState } = loadGenerateOutfitInternals();
  const card = canonicalCard('sport');
  for (const invalidTitle of [undefined, '', '   ', { invalid: true }]) {
    const resolved = resolveEnrichedTitleState(
      { ...card, title: invalidTitle },
      { title: '旧资产标题', userTitle: '用户保存的自定义标题' },
      'new_recommendation',
    );
    const enriched = { ...card, title: invalidTitle, ...resolved };

    assert.equal(resolved.title, '');
    assert.equal(resolved.displayTitle, '');
    assert.throws(
      () => assertFinalPresentation([enriched], 'sport'),
      /canonical recommendation title invariant failed/,
    );
  }
});
