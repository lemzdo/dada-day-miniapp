const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  compileRecommendationLanguageV3,
  deriveOutfitInsightsV3,
  extractOutfitFactsV3,
  planBatchCopyV3,
} = require('./recommendationLanguageV3');
const { CLAIM_CATALOG } = require('./xiaodaVoiceBankV2');
const { ELIGIBILITY_REASON_CATALOG } = require('./recommendationEligibilityReason');
const { evaluateSceneEligibilityV3 } = require('./sceneEligibilityV3');
const { buildPresentationFactModel, buildPresentationPlan } = require('./presentationFactModel');
const { canonicalizeRecommendationBatch } = require('./recommendationPresentation');

function item(id, category, subcategory, extra = {}) {
  return { clothingId: id, category, subcategory, confidence: 0.95, ...extra };
}

function outfit(scene, index = 1, extra = {}) {
  const weatherSnapshot = extra.weatherSnapshot || { temp: 22, weather: '晴' };
  const base = {
    id: `${scene}-${index}`,
    scene,
    weatherSnapshot,
    items: [
      item(`top-${index}`, 'top', scene === 'sport' ? '运动训练上衣' : '衬衫', {
        fit: '宽松', shoulderFit: '宽松', styleComplexity: '简洁',
        patternType: scene === 'date' ? '印花' : '纯色',
        styleTags: scene === 'sport' ? ['运动'] : [],
        sceneTags: scene === 'sport' ? ['运动'] : [scene],
        productFacts: ['soft_material', 'movement', 'shoulder_mobility'],
      }),
      item(`bottom-${index}`, 'bottom', scene === 'sport' ? '运动直筒裤' : '直筒裤', {
        fit: '直筒宽松', patternType: '纯色', styleComplexity: '简洁',
        pantsLength: 'long',
        styleTags: scene === 'sport' ? ['运动'] : [],
        sceneTags: scene === 'sport' ? ['运动'] : [scene],
        productFacts: ['flexible_fit', 'movement'],
      }),
      item(`shoes-${index}`, 'shoes', scene === 'sport' ? '运动鞋' : '乐福鞋', {
        styleComplexity: '简洁', styleTags: scene === 'sport' ? ['运动'] : [],
        sceneTags: scene === 'sport' ? ['运动'] : [scene], productFacts: ['secure_fit'],
      }),
    ],
    clothingIds: [`top-${index}`, `bottom-${index}`, `shoes-${index}`],
    title: `title-${scene}`,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  };
  const resolved = { ...base, ...extra };
  return {
    ...resolved,
    eligibility: resolved.eligibility || {
      weather: { pass: true, hardRejected: false },
      scene: evaluateSceneEligibilityV3({ scene, items: resolved.items, weather: resolved.weatherSnapshot }),
    },
  };
}

test('structured extraction remains deterministic and non-mutating', () => {
  const source = outfit('work');
  const before = JSON.stringify(source);
  const first = extractOutfitFactsV3(source, { scene: 'work', weather: source.weatherSnapshot });
  const second = extractOutfitFactsV3(source, { scene: 'work', weather: source.weatherSnapshot });
  assert.deepEqual(second, first);
  assert.equal(JSON.stringify(source), before);
  assert.equal(Array.isArray(deriveOutfitInsightsV3(first)), true);
});

test('compiler maps canonical Contract fields without local fallback', () => {
  const source = outfit('work');
  const [result] = compileRecommendationLanguageV3({ outfits: [source], scene: 'work', weather: source.weatherSnapshot });
  const canonical = result.copyContract;
  assert.equal(canonical.gateResult, 'PASS');
  assert.equal(result.reason, canonical.todayReason);
  assert.equal(result.reasoning, canonical.detailExplanation);
  assert.equal(result.todayClaimId, canonical.todayClaimId);
  assert.equal(result.detailClaimId, canonical.detailClaimId);
  assert.deepEqual(result.riskFlags, []);
});

test('compiler leaves final presentation ownership to post-finalization canonicalization', () => {
  const source = outfit('sport', 21, {
    items: [
      item('top-21', 'top', '短袖T恤', {
        color: '粉色',
        factRecords: [{ fact: 'color', value: '粉色', authorized: true }],
      }),
      item('bottom-21', 'bottom', '短裤', {
        color: '灰色',
        factRecords: [{ fact: 'color', value: '灰色', authorized: true }],
      }),
      item('shoes-21', 'shoes', '运动鞋', {
        color: '白色',
        factRecords: [{ fact: 'color', value: '白色', authorized: true }],
      }),
    ],
    clothingIds: ['top-21', 'bottom-21', 'shoes-21'],
  });
  const factModel = buildPresentationFactModel(source);
  const presentationPlan = buildPresentationPlan(factModel);
  const [result] = compileRecommendationLanguageV3({
    outfits: [{ ...source, presentationPlan }],
    scene: 'sport',
    weather: source.weatherSnapshot,
  });

  assert.equal(result.presentationPlan, null);
  assert.notEqual(result.copyContract.todayReasonSource, 'presentation_plan');
  const [canonical] = canonicalizeRecommendationBatch([result], { scene: 'sport' });
  assert.equal(canonical.title, presentationPlan.titleConcept);
  assert.equal(canonical.reason, canonical.presentationPlan.todayReason);
  assert.equal(canonical.copyContract.todayReason, canonical.presentationPlan.todayReason);
  assert.equal(canonical.copyContract.primaryRelationCode, canonical.presentationPlan.primaryRelationCode);
  assert.equal(canonical.copyContract.presentationFactSignature, canonical.presentationPlan.presentationFactSignature);
  assert.equal(canonical.contentPlan.primaryRelationCode, canonical.presentationPlan.primaryRelationCode);
  assert.equal(canonical.contentPlan.presentationFactSignature, canonical.presentationPlan.presentationFactSignature);
});

test('four scenes compile only fixed Catalog strings and allow missing detail', () => {
  const approved = new Set([
    ...CLAIM_CATALOG.map((entry) => entry.text),
    ...ELIGIBILITY_REASON_CATALOG.map((entry) => entry.text),
  ]);
  for (const scene of ['home', 'work', 'date', 'sport']) {
    const source = outfit(scene);
    const [result] = compileRecommendationLanguageV3({ outfits: [source], scene, weather: source.weatherSnapshot });
    assert.equal(result.copyContract.gateResult, 'PASS', scene);
    assert.ok(approved.has(result.reason), scene);
    if (result.reasoning) assert.ok(approved.has(result.reasoning), scene);
  }

  const home = outfit('home', 9, {
    weatherSnapshot: { temp: 31, weather: '晴' },
    items: [
      item('top-9', 'top', '无袖上衣', { sleeveLength: 'sleeveless' }),
      item('bottom-9', 'bottom', '短裤', { pantsLength: 'short' }),
    ],
    clothingIds: ['top-9', 'bottom-9'],
  });
  const [result] = compileRecommendationLanguageV3({ outfits: [home], scene: 'home', weather: home.weatherSnapshot });
  assert.equal(result.copyContract.gateResult, 'PASS');
  assert.equal(result.reasoning, undefined);
  assert.equal(result.detailNarrativeViewModel.defaultText, undefined);
});

test('sparse unsupported input stays versioned rejected and empty', () => {
  const [result] = compileRecommendationLanguageV3({ outfits: [{ id: 'sparse' }], scene: 'work' });
  assert.equal(result.copyContractVersion, 'recommendation-copy-contract-v3');
  assert.equal(result.copyContract.gateResult, 'REJECT');
  assert.equal(result.reason, '');
  assert.equal(result.reasoning, undefined);
  assert.ok(result.riskFlags.length > 0);
});

test('correct duplicate Claims remain accepted and batch diversity is only structural metadata', () => {
  const sources = [outfit('home', 1), outfit('home', 2), outfit('home', 3)];
  const plans = planBatchCopyV3(sources.map((entry) => ({
    outfit: entry, scene: 'home', weather: entry.weatherSnapshot,
  })));
  assert.equal(plans.every((plan) => plan.copyContract.gateResult === 'PASS'), true);
  assert.deepEqual(plans.map((plan) => plan.copyContract.todayClaimId), ['H01-01', 'H01-01', 'H01-01']);
  assert.equal(plans[2].batchConstraints.claimUsage['H01-01'], 2);
});

test('batch duplicate text is preserved without synthetic sequence suffixes', () => {
  const sources = [outfit('work', 1), outfit('work', 2), outfit('work', 3)];
  const first = planBatchCopyV3(sources.map((entry) => ({
    outfit: entry, scene: 'work', weather: entry.weatherSnapshot,
  })));
  const second = planBatchCopyV3(sources.map((entry) => ({
    outfit: entry, scene: 'work', weather: entry.weatherSnapshot,
  })));
  const reasons = first.map((plan) => plan.copyContract.todayReason);

  assert.equal(new Set(reasons).size, 1);
  assert.deepEqual(second.map((plan) => plan.copyContract.todayReason), reasons);
});

test('real AI review remains independent from default-copy compilation', () => {
  const aiComment = { overallComment: '真实 AI 原文', advice: '真实 AI 建议', source: 'cached_ai' };
  const source = outfit('work', 1, { aiComment, reviewSource: 'cached_ai' });
  const [result] = compileRecommendationLanguageV3({ outfits: [source], scene: 'work', weather: source.weatherSnapshot });
  assert.deepEqual(result.aiComment, aiComment);
  assert.equal(result.reviewSource, 'cached_ai');
  assert.notEqual(result.reason, aiComment.overallComment);
});

test('V3 source imports no legacy generator fallback or copy sanitizer', () => {
  const source = fs.readFileSync(path.join(__dirname, 'recommendationLanguageV3.js'), 'utf8');
  for (const forbidden of [
    'recommendationReasonV2', 'renderXiaodaTodayCopy', 'renderXiaodaDetailCopy',
    'applyBatchCopyDiversity', 'sanitizeUserFacingCopy', 'copyQualityGate',
  ]) assert.equal(source.includes(forbidden), false, forbidden);
});
