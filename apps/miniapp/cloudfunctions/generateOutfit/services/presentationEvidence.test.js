const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assertPresentationEvidenceBudget,
  assertPresentationEvidenceSafe,
  buildPresentationEvidence,
  isPresentationEvidenceMode,
  PRESENTATION_EVIDENCE_MAX_BYTES,
  PRESENTATION_EVIDENCE_MODE,
} = require('./presentationEvidence');
const { canonicalizeRecommendation, PRESENTATION_DIAGNOSTIC_KEY } = require('./recommendationPresentation');
const { buildRecommendationCountContract } = require('../shared/countContract');

function buildFixtureCard(index) {
  const ids = [`private-top-${index}`, `private-bottom-${index}`, `private-shoes-${index}`];
  const candidate = {
    outfitKey: `private-outfit-${index}`,
    itemIds: ids,
    selectionSignatures: { itemSignature: `private-fact-signature-${index}` },
    archetype: 'top+bottom+shoes',
    reasonCodes: ['SPORT_LIGHT_ACTIVITY_SET'],
    eligibilityReason: {
      code: 'SPORT_LIGHT_ACTIVITY_SET',
      relationFactIds: ['outfit:sport_eligible'],
    },
    items: [
      {
        _id: ids[0], category: 'top', subcategory: 'sport_top', colorPalette: [{ name: 'black' }],
        factRecords: [
          { fact: 'subcategory', value: 'sport_top' },
          { fact: 'color', value: 'black' },
        ],
      },
      {
        _id: ids[1], category: 'bottom', subcategory: 'shorts', colorPalette: [{ name: 'white' }],
        factRecords: [
          { fact: 'subcategory', value: 'shorts' },
          { fact: 'color', value: 'white' },
        ],
      },
      {
        _id: ids[2], category: 'shoes', subcategory: 'sport_shoe', colorPalette: [{ name: 'gray' }],
        factRecords: [
          { fact: 'subcategory', value: 'sport_shoe' },
          { fact: 'color', value: 'gray' },
        ],
      },
    ],
    outfitItemRoles: [
      { id: ids[0], slot: 'top', displayName: 'sport top' },
      { id: ids[1], slot: 'bottom', displayName: 'shorts' },
      { id: ids[2], slot: 'shoes', displayName: 'sport shoes' },
    ],
  };
  const contentPlan = {
    version: 'xiaoda-content-plan-v1',
    sceneIntent: 'sport:light_activity',
    primaryBenefit: 'movement',
    secondaryBenefit: 'comfort',
    observations: ['top:sport top', 'bottom:shorts'],
    defaultTodayReason: 'Sport top with shorts and sport shoes supports movement.',
    defaultDetailExplanation: 'The set stays easy to move in.',
  };
  const copyContract = {
    copyContractVersion: 'recommendation-copy-contract-v8',
    gateResult: 'PASS',
    copyDisplay: 'rule',
    todayReasonSource: 'rule_default',
    todayClaimId: 'S01-01',
    detailClaimId: 'S01-01',
    todayAction: 'movement',
    todayDimension: 'sport',
    detailAction: 'comfort',
    detailDimension: 'movement',
    riskFlags: [],
    qualification: { qualified: true, reasons: [] },
    todayReason: 'Sport top with shorts and sport shoes supports movement.',
  };
  const canonical = {
    outfitKey: candidate.outfitKey,
    title: `Sport set ${index}`,
    displayTitle: `Sport set ${index}`,
    styleTags: ['sport', 'light'],
    items: candidate.items,
    archetype: candidate.archetype,
    contentPlan,
    copyContract,
  };
  Object.defineProperty(canonical, PRESENTATION_DIAGNOSTIC_KEY, {
    value: {
      availableDifferentiators: [
        { key: 'top:color', value: 'black', titleLabel: 'black', reasonLabel: 'top', priority: 0 },
      ],
      selectedDifferentiator: [
        { key: 'top:color', value: 'black', titleLabel: 'black', reasonLabel: 'top', priority: 0 },
      ],
    },
    enumerable: false,
  });
  const finalCard = {
    ...canonical,
    copyContract: { ...copyContract },
    items: canonical.items.map((item) => ({ ...item })),
  };
  return { candidate, plan: { outfitKey: candidate.outfitKey, contentPlan, copyContract }, canonical, finalCard };
}

test('ordinary requests do not opt into presentation evidence', () => {
  assert.equal(isPresentationEvidenceMode(undefined), false);
  assert.equal(isPresentationEvidenceMode(''), false);
  assert.equal(isPresentationEvidenceMode('sanitized_v1 '), false);
  assert.equal(isPresentationEvidenceMode(PRESENTATION_EVIDENCE_MODE), true);
});

test('sanitized evidence captures eight real presentation-shaped cards without changing card copy', () => {
  const fixtures = Array.from({ length: 8 }, (_, index) => buildFixtureCard(index + 1));
  const countContract = buildRecommendationCountContract({ returnedCardCount: 8, remainingUniqueBeforeConsume: 8 });
  const before = fixtures.map(({ finalCard }) => JSON.stringify({
    title: finalCard.title,
    reason: finalCard.copyContract.todayReason,
    tags: finalCard.styleTags,
  }));
  const evidence = buildPresentationEvidence({
    auditId: 'rec_real_sport_audit',
    scene: 'sport',
    selectedCandidates: fixtures.map(({ candidate }) => candidate),
    presentationPlans: fixtures.map(({ plan }) => plan),
    canonicalCards: fixtures.map(({ canonical }) => canonical),
    finalCards: fixtures.map(({ finalCard }) => finalCard),
    countContract,
    expectedCardCount: 8,
  });

  assert.equal(evidence.version, 'presentation-evidence-v3');
  assert.deepEqual(evidence.shared, {
    scene: 'sport',
    planVersion: null,
    copyContractVersion: 'recommendation-copy-contract-v8',
    qaVersion: 'qa-batch-audit-v6-1-semantic-presentation',
  });
  assert.deepEqual(evidence.cards.map((card) => card.cardAlias), ['C01', 'C02', 'C03', 'C04', 'C05', 'C06', 'C07', 'C08']);
  assert.equal(evidence.cards.every((card) => /^[0-9a-f]{16}$/.test(card.outfitKeyHash)), true);
  assert.equal(evidence.cards.every((card) => /^[0-9a-f]{16}$/.test(card.presentationFactSignatureHash)), true);
  assert.deepEqual(evidence.cards[0].itemRoles[0], {
    role: 'top',
    canonicalName: '运动上衣',
    canonicalSubtype: '运动上衣',
    normalizedColor: '黑色',
  });
  assert.equal(evidence.cards[0].primaryRelationCode, 'NEUTRAL_COLOR_BRIDGE');
  assert.equal(evidence.cards[0].selectedDifferentiator.relationCode, 'NEUTRAL_COLOR_BRIDGE');
  assert.equal(evidence.cards[0].contentPlanSummary.sceneIntent, 'sport:light_activity');
  assert.equal(evidence.cards[0].copyContractSummary.gateResult, 'PASS');
  assert.equal(evidence.cards[0].copyContractSummary.todayReasonSource, 'rule_default');
  assert.equal(evidence.cards[0].finalTitle, 'Sport set 1');
  assert.equal(evidence.cards[0].finalReason, 'Sport top with shorts and sport shoes supports movement.');
  assert.deepEqual(evidence.cards[0].finalTags, ['sport', 'light']);
  const serialized = JSON.stringify(evidence);
  assert.equal(JSON.stringify(fixtures[0].canonical).includes('__presentationDiagnostic'), false);
  assert.equal(serialized.includes('private-outfit-'), false);
  assert.equal(serialized.includes('private-top-'), false);
  assert.ok(Buffer.byteLength(serialized, 'utf8') < 24 * 1024);
  assert.deepEqual(fixtures.map(({ finalCard }) => JSON.stringify({
    title: finalCard.title,
    reason: finalCard.copyContract.todayReason,
    tags: finalCard.styleTags,
  })), before);
});

test('missing evidence stays explicit and does not invent facts', () => {
  const countContract = buildRecommendationCountContract({ returnedCardCount: 1, remainingUniqueBeforeConsume: 1 });
  const evidence = buildPresentationEvidence({
    auditId: 'rec_empty_facts',
    scene: 'sport',
    finalCards: [{ outfitKey: 'private-empty-outfit', title: 'Sport set', styleTags: [] }],
    countContract,
    expectedCardCount: 1,
  });
  const card = evidence.cards[0];
  assert.equal(card.presentationFactSignatureHash, null);
  assert.deepEqual(card.itemRoles, []);
  assert.deepEqual(card.availableDifferentiators, []);
  assert.equal(card.selectedDifferentiator, null);
  assert.equal(card.contentPlanSummary.reasonClaim, null);
  assert.equal(card.copyContractSummary.unsupportedClaimCount, 0);
  assert.equal(card.finalReason, null);
});

test('relation binding reports MATCH and MISMATCH while a single item keeps a grounded structure relation', () => {
  const countContract = buildRecommendationCountContract({ returnedCardCount: 1, remainingUniqueBeforeConsume: 1 });
  const withRelation = canonicalizeRecommendation({
    scene: 'sport',
    items: [
      { itemId: 'top-1', category: 'top', subcategory: 'T恤', factRecords: [{ fact: 'color', value: 'red', authorized: true }] },
      { itemId: 'bottom-1', category: 'bottom', subcategory: '短裤', factRecords: [{ fact: 'color', value: 'white', authorized: true }] },
    ],
    copyContract: { coreEligibilityReasonCode: 'SPORT_LIGHT_ACTIVITY_SET', riskFlags: [] },
    contentPlan: { version: 'xiaoda-content-plan-v1', sceneIntent: 'sport:light_activity', primaryBenefit: 'movement', items: [{ id: 'top-1', slot: 'top' }] },
  }, { scene: 'sport' });
  const match = buildPresentationEvidence({ scene: 'sport', finalCards: [withRelation], countContract }).cards[0];
  assert.equal(match.binding.relationBindingStatus, 'MATCH');
  assert.equal(match.binding.relationCodesEqual, true);

  const mismatched = {
    ...withRelation,
    contentPlan: { ...withRelation.contentPlan, primaryRelationCode: 'OTHER_RELATION' },
  };
  const mismatch = buildPresentationEvidence({ scene: 'sport', finalCards: [mismatched], countContract }).cards[0];
  assert.equal(mismatch.binding.relationBindingStatus, 'MISMATCH');
  assert.equal(mismatch.binding.relationCodesEqual, false);

  const withoutRelation = canonicalizeRecommendation({
    scene: 'home',
    items: [{ itemId: 'dress-2', category: 'onepiece', subcategory: '连衣裙' }],
    copyContract: { coreEligibilityReasonCode: 'HOME_COMFORT', riskFlags: [] },
    contentPlan: { version: 'xiaoda-content-plan-v1', sceneIntent: 'home:indoor_relax', primaryBenefit: 'ease', items: [{ id: 'dress-2', slot: 'onepiece' }] },
  }, { scene: 'home' });
  const groundedSingleItem = buildPresentationEvidence({ scene: 'home', finalCards: [withoutRelation], countContract }).cards[0];
  assert.equal(groundedSingleItem.primaryRelationCode, 'STRUCTURE_ONEPIECE_ONLY');
  assert.equal(groundedSingleItem.binding.relationBindingStatus, 'MATCH');
  assert.equal(groundedSingleItem.binding.relationCodesEqual, true);
});

test('PII and evidence budget checks fail instead of dropping fields', () => {
  assert.throws(() => assertPresentationEvidenceSafe({ finalTitle: 'https://private.example/image.jpg' }), /URL or path/);
  assert.throws(() => assertPresentationEvidenceBudget({ text: 'x'.repeat(PRESENTATION_EVIDENCE_MAX_BYTES) }), /exceeds/);
});
