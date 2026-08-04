const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildPresentationEvidence,
  measurePresentationEvidence,
  PRESENTATION_EVIDENCE_MAX_BYTES,
} = require('./presentationEvidence');
const {
  buildPresentationFactModel,
  canonicalizeRecommendationBatch,
} = require('./recommendationPresentation');
const { adaptCompositionCandidate } = require('./canonicalCandidate');
const { buildQaAuditSummaries } = require('./qaBatchAudit');
const { buildRecommendationCountContract } = require('../shared/countContract');

function authorizedItem(category, subcategory, color, options = {}) {
  return {
    category,
    subcategory,
    factRecords: [
      { fact: 'color', value: color, authorized: true, source: 'legacy_snapshot' },
      ...(options.pattern
        ? [{ fact: 'pattern_visible', value: 'print', authorized: true, source: 'legacy_snapshot' }]
        : []),
    ],
  };
}

function productionPresentationFixture() {
  const makeCard = (top, topColor, bottomColor, options = {}) => ({
    scene: 'sport',
    items: [
      authorizedItem('top', top, topColor, options),
      authorizedItem('bottom', '短裤', bottomColor),
      authorizedItem('shoes', '运动鞋', options.shoesColor || '白色'),
    ],
    styleTags: ['运动'],
    contentPlan: {
      version: 'xiaoda-content-plan-v1',
      sceneIntent: 'sport:light_activity',
    },
    copyContract: {
      copyContractVersion: 'recommendation-copy-contract-v3',
      coreEligibilityReasonCode: 'SPORT_LIGHT_ACTIVITY_SET',
      todayReason: 'fixture copy replaced by presentation plan',
    },
  });

  return [
    makeCard('短袖T恤', '粉色', '灰色', { shoesColor: '白色' }),
    makeCard('短袖T恤', '白色', '灰色', { shoesColor: '白色' }),
    makeCard('短袖T恤', '白色', '灰色', { shoesColor: '白色' }),
    makeCard('短袖T恤', '白色', '白色', { shoesColor: '白色' }),
    makeCard('短袖T恤', '灰色', '灰色', { shoesColor: '白色' }),
    makeCard('短袖T恤', '绿色', '灰色', { shoesColor: '白色' }),
    makeCard('短袖T恤', '白色', '灰色', { shoesColor: '白色' }),
    makeCard('短袖T恤', '白色', '白色', { shoesColor: '白色' }),
  ];
}

test('authorized subtype normalization removes role and style noise', () => {
  const cases = [
    ['top T恤 T恤 top 休闲', 'T恤', false],
    ['上衣 短袖T恤 短袖T恤 简约 休闲 日常 校园 通勤', '短袖T恤', false],
    ['top T恤 T恤 top 印花 休闲', '印花T恤', true],
  ];
  for (const [subcategory, expected, printed] of cases) {
    const model = buildPresentationFactModel({
      scene: 'sport',
      items: [authorizedItem('top', subcategory, '白色', { pattern: printed })],
    });
    assert.equal(model.items[0].canonicalSubtype, expected);
    assert.equal(model.items[0].visibleFeatureTags.includes('印花'), printed);
  }
});

test('real production-shaped eight-card fixture uses semantic presentation facts', () => {
  const cards = canonicalizeRecommendationBatch(productionPresentationFixture(), { scene: 'sport' });
  assert.deepEqual(cards.map((card) => card.title), [
    '粉灰轻运动',
    '白灰轻运动',
    '白灰轻运动',
    '全白轻运动',
    '灰白轻运动',
    '绿灰轻运动',
    '白灰轻运动',
    '全白轻运动',
  ]);
  assert.deepEqual(cards.map((card) => card.presentationPlan.primaryRelation.relationCode), [
    'TOP_ACCENT_WITH_NEUTRAL_BOTTOM',
    'COLOR_ECHO_TOP_SHOES',
    'COLOR_ECHO_TOP_SHOES',
    'SAME_COLOR_ALL_ROLES',
    'SAME_COLOR_TOP_BOTTOM',
    'TOP_ACCENT_WITH_NEUTRAL_BOTTOM',
    'COLOR_ECHO_TOP_SHOES',
    'SAME_COLOR_ALL_ROLES',
  ]);
  assert.deepEqual(cards.map((card) => card.copyContract.todayReason), [
    '粉色短袖T恤和灰色短裤拉开颜色层次，白色运动鞋收尾，适合日常轻运动。',
    '白色短袖T恤与白色运动鞋上下呼应，灰色短裤放在中间，适合日常轻运动。',
    '白色短袖T恤与白色运动鞋上下呼应，灰色短裤放在中间，适合日常轻运动。',
    '白色短袖T恤、短裤和运动鞋保持同色，整体统一，适合日常轻运动。',
    '灰色短袖T恤与灰色短裤顺色衔接，白色运动鞋形成对比，适合日常轻运动。',
    '绿色短袖T恤和灰色短裤拉开颜色层次，白色运动鞋收尾，适合日常轻运动。',
    '白色短袖T恤与白色运动鞋上下呼应，灰色短裤放在中间，适合日常轻运动。',
    '白色短袖T恤、短裤和运动鞋保持同色，整体统一，适合日常轻运动。',
  ]);
  assert.equal(cards.every((card) => !/活动方便|稳定包脚|\(\d+\)|第\d+套/.test(`${card.title}${card.copyContract.todayReason}`)), true);
  assert.equal(new Set(cards.map((card) => card.title)).size, 5);
  assert.equal(new Set(cards.map((card) => card.copyContract.presentationFactSignature)).size, 5);
});

test('presentation evidence records authorized role colors and semantic equivalence groups', () => {
  const cards = canonicalizeRecommendationBatch(productionPresentationFixture(), { scene: 'sport' });
  const countContract = buildRecommendationCountContract({ returnedCardCount: cards.length, remainingUniqueBeforeConsume: cards.length });
  const evidence = buildPresentationEvidence({
    scene: 'sport',
    selectedCandidates: cards,
    canonicalCards: cards,
    finalCards: cards,
    countContract,
  });

  assert.equal(evidence.version, 'presentation-evidence-v3');
  assert.equal(evidence.cards[0].outfitKeyHash, null);
  assert.notEqual(evidence.cards[0].presentationFactSignatureHash, evidence.cards[1].presentationFactSignatureHash);
  assert.deepEqual(evidence.cards[0].itemRoles.map((item) => item.normalizedColor), ['粉色', '灰色', '白色']);
  assert.equal(evidence.cards[0].selectedDifferentiator.relationCode, 'TOP_ACCENT_WITH_NEUTRAL_BOTTOM');
  assert.deepEqual(evidence.cards[0].selectedDifferentiator.roles, ['top', 'bottom']);
  assert.deepEqual(evidence.cards[0].selectedDifferentiator.authorizedValues, ['粉色', '灰色']);
  assert.equal(evidence.cards.every((card) => card.binding.factSignaturesEqual), true);
  assert.equal(evidence.cards.every((card) => card.binding.relationCodesEqual), true);
  assert.equal(evidence.cards.every((card) => card.binding.titleMatchesPlan), true);
  assert.equal(evidence.cards.every((card) => card.binding.reasonMatchesPlan), true);
  const groupCount = (signature) => evidence.cards.filter((card) => card.presentationFactSignatureHash === signature).length;
  assert.equal(groupCount(evidence.cards[0].presentationFactSignatureHash), 1);
  assert.equal(groupCount(evidence.cards[1].presentationFactSignatureHash), 3);
  assert.equal(evidence.cards[2].primaryRelationCode, 'COLOR_ECHO_TOP_SHOES');
  assert.equal(groupCount(evidence.cards[2].presentationFactSignatureHash), 3);
  const measurement = measurePresentationEvidence(evidence);
  assert.equal(measurement.cardBytes.length, 8);
  assert.ok(measurement.totalBytes < PRESENTATION_EVIDENCE_MAX_BYTES);
  assert.equal(Object.prototype.hasOwnProperty.call(evidence.cards[0], 'factModel'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(evidence.cards[0], 'contentPlan'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(evidence.cards[0], 'copyContract'), false);
});

test('production-shaped fixture yields semantic QA warnings only for equivalent cards', () => {
  const cards = canonicalizeRecommendationBatch(productionPresentationFixture(), { scene: 'sport' });
  const candidates = cards.map((card, cardIndex) => {
    const items = card.items.map((item, itemIndex) => ({
      ...item,
      _id: `fixture-item-${cardIndex}-${itemIndex}`,
    }));
    const candidate = adaptCompositionCandidate({ items }, { scene: 'sport', weather: {} });
    candidate.outfitKey = `fixture-C${String(cardIndex + 1).padStart(2, '0')}`;
    candidate.itemIds = items.map((item) => item._id);
    candidate.archetype = 'top+bottom+shoes';
    candidate.eligibilityReason = { code: 'SPORT_LIGHT_ACTIVITY_SET' };
    candidate.rankingScore = 100 - cardIndex;
    return candidate;
  });
  const finalCards = cards.map((card, cardIndex) => ({
    ...card,
    outfitKey: `fixture-C${String(cardIndex + 1).padStart(2, '0')}`,
    items: card.items.map((item, itemIndex) => ({
      ...item,
      itemId: `fixture-item-${cardIndex}-${itemIndex}`,
    })),
  }));
  const { clientAudit } = buildQaAuditSummaries({
    selectedOutfits: candidates,
    acceptedCandidates: candidates,
    finalOutfits: finalCards,
    counts: { generated: 8, candidate: 8, accepted: 8, rejected: 0, selected: 8 },
  });

  assert.equal(clientAudit.duplicateCause, 'FACT_EQUIVALENCE');
  assert.equal(clientAudit.gateStatus, 'passed_with_warnings');
  assert.deepEqual(clientAudit.qaBlockReasons, []);
  assert.equal(clientAudit.semanticEquivalentGroupCount, 2);
  assert.equal(clientAudit.syntheticSuffixCount, 0);
  assert.equal(clientAudit.finalCards.every((card) => card.unsupportedClaimCount === 0), true);
});

module.exports = { productionPresentationFixture };
