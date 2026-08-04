const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const { buildRecommendationCopyInput } = require('./pageCopyComposer');

test('buildRecommendationCopyInput preserves structural inputs without producing copy', () => {
  const outfit = { id: 'outfit-1', items: [{ id: 'top-1' }] };
  const facts = { items: [{ clothingId: 'top-1' }], scene: { normalized: 'home' } };
  const insights = [{ code: 'color_echo', evidenceIds: ['top-1'] }];
  const scene = { id: 'home' };
  const weather = { temperature: 22 };
  const narrativePlan = { todayClaimId: 'H01-04' };
  const batchConstraints = { usedClaimIds: ['H01-04'] };
  const diagnostics = { source: 'test' };

  const result = buildRecommendationCopyInput({
    outfit,
    facts,
    insights,
    scene,
    weather,
    narrativePlan,
    batchConstraints,
    seed: 17,
    diagnostics,
  });

  assert.deepEqual(Object.keys(result), [
    'facts',
    'insights',
    'scene',
    'weather',
    'plan',
    'batchConstraints',
    'seed',
    'diagnostics',
  ]);
  assert.equal(Object.hasOwn(result, 'outfit'), false);
  assert.strictEqual(result.facts, facts);
  assert.strictEqual(result.insights, insights);
  assert.strictEqual(result.scene, scene);
  assert.strictEqual(result.weather, weather);
  assert.strictEqual(result.plan, narrativePlan);
  assert.strictEqual(result.batchConstraints, batchConstraints);
  assert.equal(result.seed, 17);
  assert.strictEqual(result.diagnostics, diagnostics);

  for (const field of [
    'todayReason',
    'detailExplanation',
    'aiExtraDefault',
    'reason',
    'reasoning',
  ]) {
    assert.equal(Object.hasOwn(result, field), false, field);
  }
});

test('buildRecommendationCopyInput does not infer labels or mutate source structures', () => {
  const input = {
    outfit: { items: [{ clothingId: 'missing-label' }] },
    facts: { items: [{ clothingId: 'missing-label' }] },
    insights: [],
    narrativePlan: { evidenceIds: ['missing-label'] },
    seed: 'stable-seed',
  };
  const snapshot = structuredClone(input);

  const result = buildRecommendationCopyInput(input);

  assert.deepEqual(input, snapshot);
  assert.equal(Object.hasOwn(result, 'outfit'), false);
  assert.strictEqual(result.facts, input.facts);
  assert.strictEqual(result.insights, input.insights);
  assert.strictEqual(result.plan, input.narrativePlan);
  assert.equal(result.seed, 'stable-seed');
  assert.equal(JSON.stringify(result).includes('itemLabel'), false);
});

test('buildRecommendationCopyInput ignores copy fields on raw outfit', () => {
  const input = {
    outfit: {
      id: 'outfit-1',
      todayReason: 'VISIBLE OUTFIT TODAY COPY',
      detailExplanation: 'VISIBLE OUTFIT DETAIL COPY',
      aiExtraDefault: 'VISIBLE OUTFIT AI COPY',
      reason: 'VISIBLE OUTFIT REASON',
      reasoning: 'VISIBLE OUTFIT REASONING',
      contentPlan: { defaultTodayReason: 'VISIBLE CONTENT PLAN COPY' },
      detailNarrativeViewModel: { defaultText: 'VISIBLE DETAIL VIEW COPY' },
      aiComment: {
        overallComment: 'VISIBLE AI COMMENT',
        advice: 'VISIBLE AI ADVICE',
      },
    },
    facts: { allowedFacts: ['scene:home'] },
    insights: [],
    narrativePlan: { todayAction: 'home_relax' },
    seed: 4,
  };
  const snapshot = structuredClone(input);

  const result = buildRecommendationCopyInput(input);
  const serialized = JSON.stringify(result);

  assert.notEqual(result, null);
  assert.equal(Object.hasOwn(result, 'outfit'), false);
  for (const value of collectForbiddenValues(input.outfit)) {
    assert.equal(serialized.includes(value), false, value);
  }
  assert.deepEqual(input, snapshot);
});

test('buildRecommendationCopyInput fails closed on nested copy-owned keys in structural sources', () => {
  const attacks = [
    ['facts', { detailExplanation: 'VISIBLE FACT COPY' }],
    ['insights', [{ nested: { todayReason: 'VISIBLE INSIGHT COPY' } }]],
    ['scene', { reason: 'VISIBLE SCENE REASON' }],
    ['weather', { reasoning: 'VISIBLE WEATHER REASONING' }],
    ['narrativePlan', { contentPlan: { defaultTodayReason: 'VISIBLE PLAN COPY' } }],
    ['batchConstraints', { detailNarrativeViewModel: { defaultText: 'VISIBLE BATCH COPY' } }],
    ['diagnostics', { aiComment: { overallComment: 'VISIBLE DIAGNOSTIC COPY' } }],
    ['facts', { aiComment: { advice: 'VISIBLE ADVICE' } }],
    ['facts', { aiExtraDefault: 'VISIBLE DEFAULT COPY' }],
  ];

  for (const [field, attack] of attacks) {
    const input = {
      facts: { allowedFacts: ['scene:home'] },
      insights: [],
      scene: { id: 'home' },
      weather: { temperature: 22 },
      narrativePlan: { todayAction: 'home_relax' },
      batchConstraints: { usedClaimIds: [] },
      diagnostics: { source: 'test' },
      [field]: attack,
    };
    const snapshot = structuredClone(input);

    assert.equal(buildRecommendationCopyInput(input), null, field);
    assert.deepEqual(input, snapshot, field);
  }
});

function collectForbiddenValues(source) {
  const values = [];
  for (const value of Object.values(source)) {
    if (typeof value === 'string' && value.startsWith('VISIBLE')) values.push(value);
    if (value && typeof value === 'object') values.push(...collectForbiddenValues(value));
  }
  return values;
}

test('page copy composer source owns no sentence generation or copy sanitizing', () => {
  const source = fs.readFileSync(require.resolve('./pageCopyComposer'), 'utf8');

  assert.doesNotMatch(source, /copyQualityGate/);
  assert.doesNotMatch(source, /replace|fallback|sanitize|cleanSentence|joinItemNames|itemLabel/);
});
