const assert = require('node:assert/strict');
const test = require('node:test');

const { buildOutfitCopyFacts } = require('./outfitCopyFacts');
const { planRecommendationNarrative } = require('./recommendationNarrativePlanner');

function item(id, category, subcategory, extra = {}) {
  return {
    clothingId: id,
    category,
    subcategory,
    confidence: 0.95,
    color: category === 'top' ? '白色' : '黑色',
    ...extra,
  };
}

function plan(scene, items, weather = { temp: 22, weather: '晴' }, batchContext) {
  const facts = buildOutfitCopyFacts({ outfit: { items, scene, weatherSnapshot: weather }, scene, weather });
  return planRecommendationNarrative({ facts, scene, weather, batchContext });
}

function groundedItems(scene) {
  return [
    item('top-1', 'top', '衬衫', {
      fit: '宽松',
      shoulderFit: '宽松',
      patternType: scene === 'date' ? '印花' : '纯色',
      styleComplexity: '简洁',
      productFacts: ['soft_material', 'movement', 'shoulder_mobility'],
    }),
    item('bottom-1', 'bottom', '直筒裤', {
      fit: '直筒宽松',
      patternType: '纯色',
      styleComplexity: '简洁',
      productFacts: ['flexible_fit', 'movement'],
    }),
    item('shoes-1', 'shoes', scene === 'sport' ? '运动鞋' : '乐福鞋', {
      styleComplexity: '简洁',
      productFacts: ['secure_fit'],
    }),
  ];
}

test('four scenes produce their mandatory core Claim groups', () => {
  const expected = { home: 'H01', work: 'W01', date: 'D01', sport: 'S01' };
  for (const scene of Object.keys(expected)) {
    const result = plan(scene, groundedItems(scene));
    assert.equal(result.qualification.qualified, true, scene);
    assert.equal(result.todayClaim.group, expected[scene], scene);
    assert.ok(result.todayClaim.subjectItemIds.length > 0, scene);
    assert.deepEqual(result.todayClaim.requiredFactIds, result.todayClaim.evidenceFactIds, scene);
  }
});

test('home does not require shoes and rejects restrictive main clothing', () => {
  const withoutShoes = groundedItems('home').slice(0, 2);
  assert.equal(plan('home', withoutShoes).qualification.qualified, true);

  const restrictive = groundedItems('home');
  restrictive[1].structuredAiFacts = ['stiff'];
  const result = plan('home', restrictive);
  assert.equal(result.qualification.qualified, false);
  assert.ok(result.qualification.reasons.includes('HOME_RESTRICTIVE_ITEM'));
  assert.equal(result.todayClaim, null);
});

test('work comfort and W01-04 helper cannot replace a missing core W01 Claim', () => {
  const result = plan('work', [
    item('top-1', 'top', '衬衫'),
    item('bottom-1', 'bottom', '裤子', { productFacts: ['flexible_fit'] }),
    item('shoes-1', 'shoes', '乐福鞋', { styleComplexity: '简洁' }),
  ]);
  assert.equal(result.qualification.qualified, false);
  assert.ok(result.qualification.reasons.includes('WORK_W01_MISSING'));
});

test('date comfort and D01-06 helper cannot replace a missing core D01 Claim', () => {
  const result = plan('date', [
    item('top-1', 'top', '上衣', {
      color: '红色', neckline: 'V领', productFacts: ['soft_material'],
    }),
    item('bottom-1', 'bottom', '裤子', { color: '蓝色', productFacts: ['flexible_fit'] }),
    item('shoes-1', 'shoes', '乐福鞋', { color: '绿色' }),
  ]);
  assert.equal(result.eligibleClaims.some((claim) => claim.group === 'D02'), true);
  assert.equal(result.eligibleClaims.some((claim) => claim.group === 'D01'), false);
  assert.equal(result.qualification.qualified, false);
  assert.ok(result.qualification.reasons.includes('DATE_D01_MISSING'));
});

test('sport shoe facts cannot replace the mandatory S01 movement Claim', () => {
  const result = plan('sport', [
    item('top-1', 'top', '运动上衣'),
    item('bottom-1', 'bottom', '运动裤'),
    item('shoes-1', 'shoes', '运动鞋', { productFacts: ['secure_fit', 'cushioning', 'grip'] }),
  ]);
  assert.equal(result.eligibleClaims.some((claim) => claim.group === 'S03'), true);
  assert.equal(result.eligibleClaims.some((claim) => claim.group === 'S01'), false);
  assert.equal(result.qualification.qualified, false);
  assert.ok(result.qualification.reasons.includes('SPORT_S01_MISSING'));
});

test('sport selects S01-01 when shoulder mobility pants and flexible fit are supported', () => {
  const result = plan('sport', [
    item('top-1', 'top', '训练上衣', {
      careLabelFacts: [{ fact: 'shoulder_mobility', confidence: 0.91 }],
    }),
    item('bottom-1', 'bottom', '训练长裤', {
      productFacts: [{ fact: 'flexible_fit', confidence: 0.9 }],
    }),
    item('shoes-1', 'shoes', '运动鞋', { productFacts: ['secure_fit'] }),
  ]);

  assert.equal(result.qualification.qualified, true);
  assert.equal(result.eligibleClaims.some((claim) => claim.claimId === 'S01-01'), true);
  assert.equal(result.todayClaim.claimId, 'S01-01');
  assert.equal(result.detailClaim === null || /^S0[23]-/.test(result.detailClaim.claimId), true);
});

test('sport falls back to S01-02 only when reliable flexible fit is missing', () => {
  const result = plan('sport', [
    item('top-1', 'top', '训练上衣', {
      careLabelFacts: [{ fact: 'shoulder_mobility', confidence: 0.91 }],
    }),
    item('bottom-1', 'bottom', '训练长裤'),
    item('shoes-1', 'shoes', '运动鞋', { productFacts: ['secure_fit'] }),
  ]);

  assert.equal(result.qualification.qualified, true);
  assert.equal(result.todayClaim.claimId, 'S01-02');
  assert.equal(result.detailClaim === null || /^S0[23]-/.test(result.detailClaim.claimId), true);
});

test('sport falls back to S01-03 only when reliable shoulder mobility is missing', () => {
  const result = plan('sport', [
    item('top-1', 'top', '训练上衣'),
    item('bottom-1', 'bottom', '训练长裤', {
      productFacts: [{ fact: 'flexible_fit', confidence: 0.9 }],
    }),
    item('shoes-1', 'shoes', '运动鞋', { productFacts: ['secure_fit'] }),
  ]);

  assert.equal(result.qualification.qualified, true);
  assert.equal(result.todayClaim.claimId, 'S01-03');
  assert.equal(result.detailClaim === null || /^S0[23]-/.test(result.detailClaim.claimId), true);
});

test('sport rejects when shoulder mobility and flexible fit are both missing', () => {
  const result = plan('sport', [
    item('top-1', 'top', '训练上衣'),
    item('bottom-1', 'bottom', '训练长裤'),
    item('shoes-1', 'shoes', '运动鞋', { productFacts: ['secure_fit'] }),
  ]);

  assert.equal(result.eligibleClaims.some((claim) => claim.group === 'S01'), false);
  assert.equal(result.qualification.qualified, false);
  assert.ok(result.qualification.reasons.includes('SPORT_S01_MISSING'));
  assert.equal(result.todayClaim, null);
  assert.equal(result.detailClaim, null);
});

test('secondary weather value cannot replace a qualification-core Claim', () => {
  const work = groundedItems('work');
  work[0].thickness = '轻薄';
  work[0].productFacts.push('lightweight');
  const result = plan('work', work, { temp: 31, weather: '晴' });
  assert.equal(result.qualification.qualified, true);
  assert.equal(result.todayClaim.claimId, 'W01-01');
  assert.equal(result.detailClaim.group, 'W03');
});

test('detail is optional and must use a different value and disjoint evidence', () => {
  const home = plan('home', [item('top-1', 'top', '上衣', { productFacts: ['soft_material'] })]);
  assert.equal(home.todayClaim.claimId, 'H01-04');
  assert.equal(home.detailClaim, null);

  const work = plan('work', groundedItems('work'));
  if (work.detailClaim) {
    assert.notEqual(work.detailClaim.claimId, work.todayClaim.claimId);
    assert.notEqual(work.detailClaim.userValue, work.todayClaim.userValue);
    assert.equal(
      work.detailClaim.evidenceFactIds.some((factId) => work.todayClaim.evidenceFactIds.includes(factId)),
      false,
    );
  }
});

test('batch diversity is a tie-breaker and never disqualifies the best Claim', () => {
  const items = groundedItems('home');
  const first = plan('home', items);
  const repeated = plan('home', items, { temp: 22, weather: '晴' }, {
    usedClaimIds: [first.todayClaim.claimId],
  });
  assert.equal(first.todayClaim.claimId, 'H01-01');
  assert.equal(repeated.todayClaim.claimId, 'H01-01');
  assert.equal(repeated.qualification.qualified, true);
});

test('weak sources and forbidden mappings never become copy evidence', () => {
  const facts = buildOutfitCopyFacts({
    outfit: {
      items: [
        item('top-1', 'top', '长袖上衣', {
          sleeveLength: '长袖',
          thickness: '轻薄',
          contractFacts: ['breathability'],
          factConfidences: { breathability: 0.55 },
        }),
        item('shoes-1', 'shoes', '运动鞋'),
      ],
    },
  });
  const topFacts = facts.itemFactsById['top-1'].factRecords;
  const shoeFacts = facts.itemFactsById['shoes-1'].factRecords;
  assert.equal(topFacts.some((record) => record.fact === 'warmth'), false);
  assert.equal(topFacts.some((record) => record.fact === 'breathability' && record.confidence >= 0.85), false);
  assert.equal(shoeFacts.some((record) => ['cushioning', 'sole_grip', 'anti_slip'].includes(record.fact)), false);
});
