const assert = require('node:assert/strict');
const test = require('node:test');

const { buildOutfitCopyFacts } = require('./outfitCopyFacts');
const {
  COPY_CONTRACT_VERSION,
  buildRecommendationCopyContract,
  collectAuthorizedFacts,
} = require('./recommendationCopyContract');
const { CLAIM_CATALOG, VOICE_BANK_VERSION } = require('./xiaodaVoiceBankV2');
const { ELIGIBILITY_REASON_CATALOG } = require('./recommendationEligibilityReason');
const { evaluateSceneEligibilityV3 } = require('./sceneEligibilityV3');

function item(id, category, subcategory, extra = {}) {
  return { clothingId: id, category, subcategory, confidence: 0.95, ...extra };
}

function itemsFor(scene) {
  return [
    item('top-1', 'top', scene === 'sport' ? '运动训练上衣' : '衬衫', {
      fit: '宽松', shoulderFit: '宽松', styleComplexity: '简洁',
      patternType: scene === 'date' ? '印花' : '纯色',
      styleTags: scene === 'sport' ? ['运动'] : [],
      sceneTags: scene === 'sport' ? ['运动'] : [scene],
      productFacts: ['soft_material', 'movement', 'shoulder_mobility'],
    }),
    item('bottom-1', 'bottom', scene === 'sport' ? '运动直筒裤' : '直筒裤', {
      fit: '直筒宽松', patternType: '纯色', styleComplexity: '简洁',
      pantsLength: 'long',
      styleTags: scene === 'sport' ? ['运动'] : [],
      sceneTags: scene === 'sport' ? ['运动'] : [scene],
      productFacts: ['flexible_fit', 'movement'],
    }),
    item('shoes-1', 'shoes', scene === 'sport' ? '运动鞋' : '乐福鞋', {
      styleComplexity: '简洁', productFacts: ['secure_fit'],
    }),
  ];
}

function contract(scene, items = itemsFor(scene), weather = { temp: 22, weather: '晴' }, extra = {}) {
  const sceneEligibility = evaluateSceneEligibilityV3({ scene, items, weather });
  const facts = buildOutfitCopyFacts({
    outfit: { items, scene, weatherSnapshot: weather, eligibility: { scene: sceneEligibility } },
    scene,
    weather,
  });
  return buildRecommendationCopyContract({
    facts,
    scene,
    weather,
    eligibilityReason: sceneEligibility.eligibilityReason,
    ...extra,
  });
}

test('Contract publishes the new versions and complete canonical Claim metadata', () => {
  const result = contract('work');
  assert.equal(COPY_CONTRACT_VERSION, 'recommendation-copy-contract-v8');
  assert.equal(result.copyContractVersion, COPY_CONTRACT_VERSION);
  assert.equal(result.voiceBankVersion, VOICE_BANK_VERSION);
  assert.equal(result.gateResult, 'PASS');
  assert.ok(result.todayReason);
  assert.ok(result.todayClaim);
  assert.equal(result.todayClaimId, result.todayClaim.claimId);
  assert.deepEqual(result.todayClaim.requiredFactIds, result.todayClaim.evidenceFactIds);
  assert.equal(result.todayClaim.subjectItemIds.every((id) => ['top-1', 'bottom-1', 'shoes-1'].includes(id)), true);
  assert.equal(result.riskFlags.length, 0);
});

test('all four scenes return only approved fixed Catalog strings', () => {
  const approved = new Set([
    ...CLAIM_CATALOG.map((entry) => entry.text),
    ...ELIGIBILITY_REASON_CATALOG.map((entry) => entry.text),
  ]);
  for (const scene of ['home', 'work', 'date', 'sport']) {
    const result = contract(scene);
    assert.equal(result.gateResult, 'PASS', scene);
    assert.ok(approved.has(result.todayReason), scene);
    if (result.detailExplanation) assert.ok(approved.has(result.detailExplanation), scene);
  }
});

test('detailExplanation is omitted when there is no independent second Claim', () => {
  const result = contract('home', [
    item('top-1', 'top', '无袖上衣', { sleeveLength: 'sleeveless' }),
    item('bottom-1', 'bottom', '短裤', { pantsLength: 'short' }),
  ], { temp: 31, weather: '晴' });
  assert.equal(result.todayClaimId, '');
  assert.equal(result.todayReasonSource, 'core_eligibility');
  assert.equal(Object.hasOwn(result, 'detailExplanation'), false);
  assert.equal(result.detailClaim, null);
  assert.equal(result.detailClaimId, '');
});

test('a fact-bound work baseline reason stays accepted while an enhanced Claim remains optional', () => {
  const result = contract('work', [
    item('top-1', 'top', '卫衣', { fit: '宽松' }),
    item('bottom-1', 'bottom', '裤子', { productFacts: ['flexible_fit'] }),
    item('shoes-1', 'shoes', '乐福鞋'),
  ]);
  assert.equal(result.gateResult, 'PASS');
  assert.ok(result.todayReason);
  assert.equal(result.todayClaim, null);
  assert.equal(result.todayReasonSource, 'core_eligibility');
  assert.equal(result.riskFlags.includes('CORE_REASON_COVERAGE_GAP'), false);

  const relationItems = [
    item('top-pattern', 'top', '图案上衣', { patternType: '印花' }),
    item('bottom-solid', 'bottom', '纯色裤子', { patternType: '纯色' }),
    item('shoes-simple', 'shoes', '乐福鞋', { styleComplexity: '简洁' }),
  ];
  const weather = { temp: 22, weather: '晴' };
  const withoutEligibilityFacts = buildOutfitCopyFacts({
    outfit: { items: relationItems, scene: 'work', weatherSnapshot: weather },
    scene: 'work',
    weather,
  });
  const withoutEligibility = buildRecommendationCopyContract({ facts: withoutEligibilityFacts, scene: 'work', weather });
  assert.equal(withoutEligibility.gateResult, 'REJECT');
  const sceneEligibility = evaluateSceneEligibilityV3({ scene: 'work', items: relationItems, weather });
  const facts = buildOutfitCopyFacts({
    outfit: {
      items: relationItems,
      scene: 'work',
      weatherSnapshot: weather,
      eligibility: {
        scene: {
          ...sceneEligibility,
        },
      },
    },
    scene: 'work',
    weather,
  });
  const withEligibility = buildRecommendationCopyContract({
    facts,
    scene: 'work',
    weather,
    eligibilityReason: sceneEligibility.eligibilityReason,
  });
  assert.equal(withEligibility.gateResult, 'PASS');
  assert.equal(withEligibility.todayClaimId, 'W01-02');
  const relationEvidence = withEligibility.todayClaim.evidenceSources
    .find((entry) => entry.factId === 'outfit:work_eligible');
  assert.equal(relationEvidence.sourceRule, 'sceneEvidenceV4');
  assert.equal(relationEvidence.sourceVersion, 'scene-evidence-v4');
  assert.deepEqual(relationEvidence.subjectItemIds, ['top-pattern', 'bottom-solid', 'shoes-simple']);
  assert.ok(relationEvidence.supportingFactIds.length > 0);
});

test('Contract derives outfit membership only from selected items, never injected fact scopes', () => {
  const result = buildRecommendationCopyContract({
    scene: 'home',
    facts: {
      items: [{ id: 'inside-top', slot: 'top' }],
      itemFactsById: {
        'inside-top': { category: 'top', factRecords: [] },
        'outside-top': {
          category: 'top',
          factRecords: [{
            factId: 'item:outside-top:soft_material',
            itemId: 'outside-top',
            fact: 'soft_material',
            value: true,
            source: 'user',
            confidence: 1,
            authorized: true,
          }],
        },
      },
    },
  });

  assert.equal(result.gateResult, 'REJECT');
  assert.equal(result.todayReason, '');
  assert.ok(result.riskFlags.includes('CORE_REASON_COVERAGE_GAP'));
});

test('weak structured AI facts do not authorize enhanced functional copy but keep the core reason', () => {
  const result = contract('home', [
    item('top-1', 'top', '无袖上衣', {
      sleeveLength: 'sleeveless',
      contractFacts: ['soft_material'],
      factConfidences: { soft_material: 0.6 },
    }),
    item('bottom-1', 'bottom', '短裤', { pantsLength: 'short' }),
  ], { temp: 31, weather: '晴' });
  assert.equal(result.gateResult, 'PASS');
  assert.equal(result.todayReasonSource, 'core_eligibility');
  assert.equal(result.enhancedReason, undefined);
});

test('authorized facts are collected only from item-scoped records', () => {
  const weather = { temp: 22, weather: '晴' };
  const facts = buildOutfitCopyFacts({ outfit: { items: itemsFor('home') }, scene: 'home', weather });
  const values = collectAuthorizedFacts({ facts });
  assert.ok(values.includes('soft_material'));
  assert.ok(values.includes('flexible_fit'));
  assert.equal(values.includes('weather_hot'), false);
});

test('Contract is deterministic serializable and does not mutate input', () => {
  const weather = { temp: 22, weather: '晴' };
  const facts = buildOutfitCopyFacts({ outfit: { items: itemsFor('date') }, scene: 'date', weather });
  const input = { facts, scene: 'date', weather };
  const before = JSON.stringify(input);
  const first = buildRecommendationCopyContract(input);
  const second = buildRecommendationCopyContract(input);
  assert.deepEqual(second, first);
  assert.equal(JSON.stringify(input), before);
  assert.doesNotThrow(() => JSON.stringify(first));
});
