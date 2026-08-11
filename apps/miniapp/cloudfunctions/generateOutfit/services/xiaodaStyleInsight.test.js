const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { evaluateCopyNaturalness } = require('./copyNaturalnessGate');
const { inspectXiaodaPersonaCopy } = require('./xiaodaPersonaContract');
const { buildPresentationFactModel } = require('./presentationFactModel');
const { buildNaturalDetailCopyPlan, buildNaturalTodayCopyPlan } = require('./recommendationNaturalLanguage');
const {
  XIAODA_STYLE_INSIGHT_VERSION,
  buildXiaodaStyleInsight,
} = require('./xiaodaStyleInsight');
const {
  XIAODA_STYLE_INSIGHT_FIXTURES,
  XIAODA_STYLE_INSIGHT_WEAK_FIXTURES,
} = require('./xiaodaStyleInsight.fixtures');

test('Style Insight fixture matrix chooses the highest-value supported insight', () => {
  for (const fixture of XIAODA_STYLE_INSIGHT_FIXTURES) {
    const plan = buildXiaodaStyleInsight(fixture.model);
    assert.equal(plan.version, XIAODA_STYLE_INSIGHT_VERSION, fixture.id);
    assert.equal(plan.primary?.code, fixture.expectedPrimaryCode, fixture.id);
    assert.equal(plan.primary?.rank, 'PRIMARY', fixture.id);
    assert.ok(plan.primary?.evidenceFactIds.length > 0, fixture.id);
    assert.ok(plan.primary?.subjectItemIds.length > 0, fixture.id);
    assert.ok(plan.primary?.ranking.factAvailable, fixture.id);
    assert.ok(plan.primary?.ranking.userValue >= 2, fixture.id);
    assert.ok(plan.primary?.ranking.naturalExpressibility >= 2, fixture.id);
  }
});

test('Today and Detail share one primary insight while Detail adds explanation', () => {
  for (const fixture of XIAODA_STYLE_INSIGHT_FIXTURES) {
    const today = buildNaturalTodayCopyPlan(fixture.model, fixture.model.relations[0] || {});
    const detail = buildNaturalDetailCopyPlan(fixture.model, { relationCode: today.relationCode });
    assert.equal(today.xiaodaStyleInsight?.primary?.code, fixture.expectedPrimaryCode, fixture.id);
    assert.equal(detail.xiaodaStyleInsight?.primary?.code, fixture.expectedPrimaryCode, fixture.id);
    assert.notEqual(detail.text, today.text, fixture.id);
    assert.ok(Array.from(detail.text).length > Array.from(today.text).length, fixture.id);
    assert.equal(evaluateCopyNaturalness(today).result, 'PASS', fixture.id);
    assert.equal(evaluateCopyNaturalness(detail).result, 'PASS', fixture.id);
    assert.equal(inspectXiaodaPersonaCopy(today.text).passed, true, fixture.id);
    assert.equal(inspectXiaodaPersonaCopy(detail.text).passed, true, fixture.id);
  }
});

test('weak facts use an honest fallback and missing authorization stays empty', () => {
  for (const fixture of XIAODA_STYLE_INSIGHT_WEAK_FIXTURES) {
    const primary = buildXiaodaStyleInsight(fixture.model).primary;
    assert.equal(primary?.code || null, fixture.expectedPrimaryCode, fixture.id);
    const today = buildNaturalTodayCopyPlan(fixture.model, fixture.model.relations[0] || {});
    assert.equal(Boolean(today.text), Boolean(fixture.expectedPrimaryCode), fixture.id);
    if (today.text) assert.doesNotMatch(today.text, /印花.*重点|视觉|结构完整度/, fixture.id);
  }
});

test('aesthetic relations are read-only projections of existing positive evidence', () => {
  const source = {
    scene: 'work',
    items: [
      {
        itemId: 'top-1', category: 'top', subcategory: '针织上衣',
        aestheticFeatures: { fit: 'fitted', length: 'cropped' },
        factRecords: [{ fact: 'category', value: 'top', authorized: true }],
      },
      {
        itemId: 'bottom-1', category: 'bottom', subcategory: '阔腿裤',
        aestheticFeatures: { silhouette: 'wideLeg', length: 'long' },
        factRecords: [{ fact: 'category', value: 'bottom', authorized: true }],
      },
    ],
    aestheticEvaluation: {
      evidence: [
        { code: 'SILHOUETTE_BALANCED_CONTRAST', polarity: 'positive', strength: 3, itemIds: ['top-1', 'bottom-1'] },
        { code: 'PROPORTION_CLEAR_LAYERING', polarity: 'positive', strength: 3, itemIds: ['top-1', 'bottom-1'] },
        { code: 'FORMALITY_LARGE_GAP', polarity: 'negative', strength: 1, itemIds: ['top-1', 'bottom-1'] },
      ],
    },
  };
  const model = buildPresentationFactModel(source);
  assert.ok(model.relations.some((entry) => entry.relationCode === 'SILHOUETTE_BALANCED_CONTRAST'));
  assert.ok(model.relations.some((entry) => entry.relationCode === 'PROPORTION_CLEAR_LAYERING'));
  assert.equal(model.relations.some((entry) => entry.relationCode === 'FORMALITY_LARGE_GAP'), false);
  assert.equal(model.items.find((entry) => entry.role === 'top')?.fit, 'fitted');
  assert.equal(model.items.find((entry) => entry.role === 'bottom')?.silhouette, 'wideLeg');
});

test('neutral garments are never promoted as a color focal point', () => {
  const neutralModel = {
    scene: 'home',
    items: [
      { itemId: 'top', role: 'top', canonicalSubtype: '短袖T恤', normalizedColor: '白色', authorizedFactIds: ['top:color'] },
      { itemId: 'bottom', role: 'bottom', canonicalSubtype: '短裤', normalizedColor: '灰色', authorizedFactIds: ['bottom:color'] },
    ],
    relations: [{
      relationCode: 'COLOR_NEUTRAL_ACCENT',
      subjectItemIds: ['top', 'bottom'],
      evidenceFactIds: ['aesthetic:neutral-accent'],
      polarity: 'positive',
      strength: 3,
    }],
  };
  const neutralPlan = buildXiaodaStyleInsight(neutralModel);
  assert.notEqual(neutralPlan.primary?.code, 'COLOR_FOCUS_WITH_NEUTRAL_SUPPORT');

  const accentModel = {
    ...neutralModel,
    scene: 'work',
    items: [
      { ...neutralModel.items[0], normalizedColor: '灰色' },
      { ...neutralModel.items[1], normalizedColor: '绿色', canonicalSubtype: '阔腿裤' },
    ],
  };
  const accentPlan = buildXiaodaStyleInsight(accentModel);
  assert.equal(accentPlan.primary?.code, 'COLOR_FOCUS_WITH_NEUTRAL_SUPPORT');
  assert.deepEqual(accentPlan.primary?.subjectItemIds, ['bottom', 'top']);
});

test('an optional accessory never displaces the core garments as the primary color insight', () => {
  const model = {
    scene: 'work',
    items: [
      { itemId: 'top', role: 'top', canonicalSubtype: '短袖T恤', normalizedColor: '白色', authorizedFactIds: ['top:category'] },
      { itemId: 'bottom', role: 'bottom', canonicalSubtype: '阔腿裤', normalizedColor: '灰色', authorizedFactIds: ['bottom:category'] },
      { itemId: 'shoes', role: 'shoes', canonicalSubtype: '运动鞋', normalizedColor: '白色', authorizedFactIds: ['shoes:category'] },
      { itemId: 'bag', role: 'accessory', canonicalSubtype: '手提袋', normalizedColor: '蓝色', authorizedFactIds: ['bag:category'] },
    ],
    qualification: {
      reasonCode: 'WORK_BASELINE_PRESENTABLE',
      subjectItemIds: ['top', 'bottom', 'shoes'],
      supportingFactIds: ['top:category', 'bottom:category', 'shoes:category'],
    },
    relations: [{
      relationCode: 'COLOR_NEUTRAL_ACCENT',
      subjectItemIds: ['bag', 'shoes'],
      evidenceFactIds: ['aesthetic:neutral-accent'],
      polarity: 'positive',
      strength: 3,
    }],
  };

  const plan = buildXiaodaStyleInsight(model);
  assert.equal(plan.primary?.code, 'WORK_DAILY_READY');
  assert.equal(plan.primary?.subjectItemIds.includes('bag'), false);
});

test('direct work eligibility outranks weak neutral-accent inference with deterministic varied phrasing', () => {
  const model = {
    scene: 'work',
    items: [
      { itemId: 'top', role: 'top', canonicalSubtype: '短袖T恤', normalizedColor: '白色', authorizedFactIds: ['top:category'] },
      { itemId: 'bottom', role: 'bottom', canonicalSubtype: '阔腿裤', normalizedColor: '绿色', authorizedFactIds: ['bottom:category'] },
      { itemId: 'shoes', role: 'shoes', canonicalSubtype: '运动鞋', normalizedColor: '白色', authorizedFactIds: ['shoes:category'] },
    ],
    qualification: {
      reasonCode: 'WORK_BASELINE_PRESENTABLE',
      subjectItemIds: ['top', 'bottom', 'shoes'],
      supportingFactIds: ['top:category', 'bottom:category', 'shoes:category'],
    },
    relations: [{
      relationCode: 'COLOR_NEUTRAL_ACCENT',
      subjectItemIds: ['top', 'bottom', 'shoes'],
      evidenceFactIds: ['aesthetic:neutral-accent'],
      polarity: 'positive',
      strength: 3,
    }],
  };
  const plan = buildXiaodaStyleInsight(model);
  assert.equal(plan.primary?.code, 'WORK_DAILY_READY');
  const first = buildNaturalTodayCopyPlan(model, model.relations[0]);
  const second = buildNaturalTodayCopyPlan(model, model.relations[0]);
  assert.equal(first.text, second.text);
  assert.match(first.text, /上班|办公|办公室/);
});

test('Today Style Insight and voice realization stay synchronous and network-free', () => {
  for (const file of ['xiaodaStyleInsight.js', 'recommendationNaturalLanguage.js']) {
    const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
    assert.doesNotMatch(source, /\b(?:fetch|callFunction)\s*\(|node-fetch|openai|siliconflow|dashscope/iu, file);
    assert.doesNotMatch(source, /\basync\s+function\b|=>\s*Promise\b/u, file);
  }
});
