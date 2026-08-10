const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  buildPresentationEvidence,
  measurePresentationEvidence,
  PRESENTATION_EVIDENCE_MAX_BYTES,
} = require('./presentationEvidence');
const {
  buildPresentationFactModel,
  buildPresentationPlan,
  canonicalizeRecommendation,
  canonicalizeRecommendationBatch,
  hasSyntheticSuffix,
} = require('./recommendationPresentation');
const { adaptCompositionCandidate } = require('./canonicalCandidate');
const { buildQaAuditSummaries } = require('./qaBatchAudit');
const { buildRecommendationCountContract } = require('../shared/countContract');

function authorizedItem(category, subcategory, color, options = {}) {
  return {
    itemId: options.itemId,
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

function eligibilityContract(scene, items) {
  const sceneKey = ({ 居家: 'home', 上班: 'work', 通勤: 'work', 约会: 'date', 运动: 'sport' })[scene] || scene;
  const itemIds = items.map((item) => item.itemId || item.clothingId).filter(Boolean);
  let reasonCode = 'UNMAPPED_TEST';
  let evidence = [];
  let relationFactIds = [];
  if (sceneKey === 'work') {
    reasonCode = 'WORK_BASELINE_PRESENTABLE';
    evidence = [{ factId: 'outfit:work_eligible', fact: 'work_eligible', subjectItemIds: itemIds }];
    relationFactIds = ['outfit:work_eligible'];
  } else if (sceneKey === 'date') {
    reasonCode = 'DATE_COLOR_COORDINATED';
    evidence = [{ factId: 'outfit:color_coordinated', fact: 'color_coordinated', subjectItemIds: itemIds.slice(0, 2) }];
    relationFactIds = ['outfit:color_coordinated'];
  } else if (sceneKey === 'sport') {
    reasonCode = 'SPORT_LIGHT_ACTIVITY_SET';
    evidence = items.map((item) => {
      const itemId = item.itemId || item.clothingId;
      const fact = item.category === 'top' ? 'sport_top' : item.category === 'bottom' ? 'shorts' : 'sport_shoe';
      return { factId: `item:${itemId}:${fact}`, fact, itemId };
    });
  } else if (items.some((item) => item.category === 'onepiece') && items.some((item) => item.category === 'shoes')) {
    reasonCode = 'HOME_DRESS_NORMAL_SHOES';
    evidence = items.map((item) => {
      const itemId = item.itemId || item.clothingId;
      const fact = item.category === 'onepiece' ? 'dress' : 'outing_shoe';
      return { factId: `item:${itemId}:${fact}`, fact, itemId };
    });
  } else if (items.length >= 2) {
    reasonCode = 'HOME_CASUAL_TWO_PIECE';
    evidence = items.map((item) => {
      const itemId = item.itemId || item.clothingId;
      return { factId: `item:${itemId}:casual_style`, fact: 'casual_style', itemId };
    });
  }
  return {
    coreEligibilityReasonCode: reasonCode,
    coreEligibilitySubjectItemIds: itemIds,
    coreEligibilitySupportingFactIds: evidence.map((record) => record.factId),
    coreEligibilityRelationFactIds: relationFactIds,
    coreEligibilityEvidence: evidence,
  };
}

function productionPresentationFixture() {
  let cardIndex = 0;
  const makeCard = (top, topColor, bottomColor, options = {}) => {
    const index = cardIndex++;
    const items = [
      authorizedItem('top', top, topColor, { ...options, itemId: `fixture-${index}-top` }),
      authorizedItem('bottom', '短裤', bottomColor, { itemId: `fixture-${index}-bottom` }),
      authorizedItem('shoes', '运动鞋', options.shoesColor || '白色', { itemId: `fixture-${index}-shoes` }),
    ];
    return {
      scene: 'sport',
      items,
      styleTags: ['运动'],
      contentPlan: {
        version: 'xiaoda-content-plan-v1',
        sceneIntent: 'sport:light_activity',
      },
      copyContract: {
        copyContractVersion: 'recommendation-copy-contract-v4',
        ...eligibilityContract('sport', items),
        todayReason: 'fixture copy replaced by presentation plan',
      },
    };
  };

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

function realSchemaReplayFixture(overrides = {}) {
  const scene = overrides.scene || 'home';
  const items = overrides.items || [
    {
      clothingId: 'replay-dress-01',
      category: 'onepiece',
      subcategory: '吊带裙',
      customName: '吊带裙',
      name: '吊带裙',
      colorPalette: [{ name: '白色', hex: '#ffffff', ratio: 1 }],
      styleTags: ['休闲'],
      sceneTags: ['居家'],
    },
    {
      clothingId: 'replay-shoes-01',
      category: 'shoes',
      subcategory: '运动鞋',
      name: '运动鞋',
      colorPalette: [{ name: '白色', hex: '#ffffff', ratio: 1 }],
      styleTags: ['休闲'],
    },
  ];
  return {
    outfitKey: overrides.outfitKey || items.map((item) => item.clothingId).sort().join('_'),
    scene,
    items,
    outfitItemRoles: items.map((item) => ({
      id: item.clothingId,
      slot: item.category,
      role: 'core',
      displayName: item.subcategory || item.name,
    })),
    styleTags: scene === 'work' ? ['通勤'] : ['休闲'],
    copyContract: {
      ...eligibilityContract(scene, items),
      todayReason: '旧文案应被最终计划替换。',
      riskFlags: [],
    },
  };
}

function readLanguageCloseoutCards() {
  const directory = path.resolve(__dirname, '../../../../../artifacts/recommendation-language-closeout-20260806');
  const cards = fs.readFileSync(path.join(directory, 'cards.jsonl'), 'utf8')
    .trim().split('\\n').filter(Boolean).map((line) => JSON.parse(line));
  const snapshots = fs.readFileSync(path.join(directory, 'snapshots.jsonl'), 'utf8')
    .trim().split('\\n').filter(Boolean).flatMap((line) => {
      const entry = JSON.parse(line);
      return entry.snapshot.outfits.map((outfit) => ({ ...outfit, __scene: entry.scene }));
    });
  return { cards, snapshots };
}

function replaySourceFromCloseoutCard(card) {
  const items = card.presentationPlan.factModel.items.map((item) => ({
    itemId: item.itemId,
    category: item.role,
    subcategory: item.canonicalSubtype,
    name: item.canonicalName,
    colorPalette: item.normalizedColor ? [{ name: item.normalizedColor }] : [],
    factRecords: item.authorizedFactIds.map((factId) => ({
      fact: factId.split(':').slice(2).join(':'),
      authorized: true,
      source: 'legacy_snapshot',
    })),
  }));
  return {
    scene: card.scene,
    items,
    styleTags: card.styleTags,
    copyContract: eligibilityContract(card.scene, items),
  };
}

function bindingMismatches(card) {
  const actualIds = new Set(card.presentationPlan.factModel.items.map((item) => item.itemId));
  const selected = card.presentationPlan.selectedDifferentiator || {};
  const evidenceIds = (selected.evidenceFactIds || [])
    .map((factId) => factId.match(/^item:([^:]+):/)?.[1])
    .filter(Boolean);
  return {
    selectedSubjectItemIds: (selected.subjectItemIds || []).filter((id) => !actualIds.has(id)),
    evidenceFactIds: evidenceIds.filter((id) => !actualIds.has(id)),
    todaySubjectMismatch: [...new Set(selected.subjectItemIds || [])]
      .sort().join('|') !== [...new Set(card.todaySubjectItemIds || [])].sort().join('|'),
  };
}

function qaCandidateFromReplay(card, index) {
  const items = card.items.map((item) => ({ ...item, _id: item.clothingId }));
  const candidate = adaptCompositionCandidate({ items }, { scene: card.scene, weather: {} });
  candidate.outfitKey = card.outfitKey || `replay-${index}`;
  candidate.itemIds = items.map((item) => item._id);
  candidate.archetype = card.presentationPlan.factModel.items.map((item) => item.role).join('+');
  candidate.eligibilityReason = { code: card.copyContract.coreEligibilityReasonCode || 'HOME_COMFORT' };
  candidate.rankingScore = 100 - index;
  return candidate;
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
    'NEUTRAL_COLOR_BRIDGE',
    'NEUTRAL_COLOR_BRIDGE',
    'SAME_COLOR_ALL_ROLES',
    'SAME_COLOR_TOP_BOTTOM',
    'TOP_ACCENT_WITH_NEUTRAL_BOTTOM',
    'NEUTRAL_COLOR_BRIDGE',
    'SAME_COLOR_ALL_ROLES',
  ]);
  assert.deepEqual(cards.map((card) => card.copyContract.todayReason), [
    '粉色短袖T恤配灰色短裤，亮色留在上半身。',
    '短袖T恤配短裤和运动鞋，日常轻运动时走动更方便。',
    '短袖T恤配短裤和运动鞋，日常轻运动时走动更方便。',
    '短袖T恤配短裤和运动鞋，日常轻运动时走动更方便。',
    '短袖T恤配短裤和运动鞋，日常轻运动时走动更方便。',
    '绿色短袖T恤配灰色短裤，亮色留在上半身。',
    '短袖T恤配短裤和运动鞋，日常轻运动时走动更方便。',
    '短袖T恤配短裤和运动鞋，日常轻运动时走动更方便。',
  ]);
  assert.equal(cards.every((card) => card.copyContract.naturalnessGateResult === 'PASS'
    && card.copyContract.naturalnessRiskFlags.length === 0), true);
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
  assert.equal(evidence.cards[2].primaryRelationCode, 'NEUTRAL_COLOR_BRIDGE');
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

test('real-schema replay preserves onepiece and produces authorized relations', () => {
  const source = realSchemaReplayFixture();
  const model = buildPresentationFactModel(source);
  const [card] = canonicalizeRecommendationBatch([source], { scene: 'home' });

  assert.deepEqual(model.items.map((item) => item.role), ['onepiece', 'shoes']);
  assert.equal(model.items[0].canonicalName, '吊带裙');
  assert.equal(model.items[0].canonicalSubtype, '吊带裙');
  assert.deepEqual(model.items.map((item) => item.normalizedColor), ['白色', '白色']);
  assert.ok(model.relations.some((relation) => relation.relationCode === 'COLOR_ECHO_ONEPIECE_SHOES'));
  assert.ok(model.relations.some((relation) => relation.relationCode === 'STRUCTURE_ONEPIECE_SHOES'));
  assert.equal(model.relations.every((relation) => relation.subjectItemIds.length > 0
    && relation.evidenceFactIds.length > 0
    && relation.semanticSkeleton
    && relation.todayExpressionIntent), true);
  assert.ok(model.availableDifferentiators.length >= 2);
  const colorPlan = buildPresentationPlan(model, { selectedDifferentiator: model.availableDifferentiators[0] });
  const structureDifferentiator = model.availableDifferentiators.find((entry) => entry.relationCode === 'STRUCTURE_ONEPIECE_SHOES');
  const structurePlan = buildPresentationPlan(model, { selectedDifferentiator: structureDifferentiator });
  assert.equal(colorPlan.todayReason, structurePlan.todayReason);
  assert.match(structurePlan.todayReason, /吊带裙配运动鞋/);
  assert.equal(card.presentationPlan.selectedDifferentiator.relationCode, card.presentationPlan.primaryRelationCode);
  assert.deepEqual(card.todaySubjectItemIds, card.presentationPlan.selectedDifferentiator.subjectItemIds);
  assert.deepEqual(card.todayEvidenceFactIds, card.presentationPlan.selectedDifferentiator.evidenceFactIds);
  assert.match(card.copyContract.todayReason, /吊带裙.*运动鞋/);
  assert.doesNotMatch(`${card.title}${card.copyContract.todayReason}`, /上衣、下装|组合清楚|吊带裙吊带裙/);
  assert.equal(card.detailDisplay, 'visible');
  assert.notEqual(card.copyContract.detailExplanation, card.copyContract.todayReason);
});

test('real-schema replay canonical labels have one semantic owner', () => {
  const source = realSchemaReplayFixture({
    scene: 'work',
    items: [
      { clothingId: 'replay-knit', category: 'top', subcategory: '毛衣', customName: '毛衣', name: '毛衣', colorPalette: [{ name: '红色' }] },
      { clothingId: 'replay-pants', category: 'bottom', subcategory: '长裤', customName: '长裤', name: '长裤', colorPalette: [{ name: '灰色' }] },
      { clothingId: 'replay-polo', category: 'top', subcategory: 'Polo衫Polo衫', name: 'Polo衫', colorPalette: [{ name: '白色' }] },
    ],
  });
  source.outfitItemRoles = source.items.map((item, index) => ({
    id: item.clothingId,
    slot: index === 2 ? 'outerwear' : item.category,
    role: 'core',
    displayName: item.name,
  }));
  const model = buildPresentationFactModel(source);
  const labels = model.items.flatMap((item) => [item.canonicalName, item.canonicalSubtype]);
  assert.equal(labels.includes('毛衣'), true);
  assert.equal(labels.includes('长裤'), true);
  assert.equal(labels.includes('Polo衫'), true);
  assert.equal(labels.some((value) => /毛衣毛衣|长裤长裤|Polo衫Polo衫/.test(value)), false);
});

test('standalone onepiece uses an authorized structural detail instead of generic fallback', () => {
  const source = realSchemaReplayFixture({
    items: [{
      clothingId: 'replay-single-dress',
      category: 'onepiece',
      subcategory: '连衣裙',
      colorPalette: [{ name: '蓝色' }],
    }],
  });
  const [card] = canonicalizeRecommendationBatch([source], { scene: 'home' });
  assert.equal(card.presentationPlan.availableDifferentiators.length, 2);
  assert.equal(card.presentationPlan.availableDifferentiators[1].relationCode, 'STRUCTURE_ONEPIECE_ONLY');
  assert.equal(card.detailDisplay, 'visible');
  assert.match(card.copyContract.detailExplanation, /单穿就能成一身/);
  assert.equal(card.copyContract.naturalnessGateResult, 'PASS');
});

test('top plus bottom regressions never authorize or mention shoes', () => {
  const source = {
    outfitKey: 'c5c2a88a6a0feea7001cd2e37b4ec037_c5c2a88a6a14191300972784015cb81f',
    scene: 'home',
    items: [
      authorizedItem('top', 'T恤', '白色', { itemId: 'c5c2a88a6a14191300972784015cb81f' }),
      authorizedItem('bottom', '长裤', '灰色', { itemId: 'c5c2a88a6a0feea7001cd2e37b4ec037' }),
    ],
    copyContract: eligibilityContract('home', [
      { itemId: 'c5c2a88a6a14191300972784015cb81f', category: 'top' },
      { itemId: 'c5c2a88a6a0feea7001cd2e37b4ec037', category: 'bottom' },
    ]),
  };
  const [card] = canonicalizeRecommendationBatch([source], { scene: 'home' });
  const canonicalIds = new Set(card.presentationPlan.factModel.items.map((item) => item.itemId));
  const copy = `${card.title}${card.copyContract.todayReason}${card.copyContract.detailExplanation}`;
  assert.doesNotMatch(copy, /鞋|鞋子|运动鞋/);
  assert.ok(card.presentationPlan.selectedDifferentiator);
  assert.ok(card.presentationPlan.availableDifferentiatorCount > 0);
  assert.ok(card.presentationPlan.selectedDifferentiator.subjectItemIds.every((id) => canonicalIds.has(id)));
  assert.equal(card.detailDisplay, 'visible');
  assert.notEqual(card.copyContract.todayReason, card.copyContract.detailExplanation);
});

test('generic scene fallbacks stay omitted while meaningful eligibility evidence is rendered', () => {
  for (const scene of ['home', 'work', 'date', 'sport']) {
    const items = [
      authorizedItem('top', '短袖T恤', '白色', { itemId: `${scene}-top` }),
      authorizedItem('bottom', '短裤', '灰色', { itemId: `${scene}-bottom` }),
      ...(scene === 'sport' ? [authorizedItem('shoes', '运动鞋', '白色', { itemId: `${scene}-shoes` })] : []),
    ];
    const source = {
      scene,
      items,
      copyContract: eligibilityContract(scene, items),
    };
    const [card] = canonicalizeRecommendationBatch([source], { scene });
    assert.doesNotMatch(card.copyContract.todayReason, /可以直接这样穿/);
    const slots = card.copyContract.todayCopyProvenance.clauses.map((clause) => clause.slot);
    assert.deepEqual(slots, scene === 'sport' ? ['relation'] : ['scene_value']);
    assert.equal(card.copyContract.naturalnessGateResult, 'PASS');
    assert.doesNotMatch(`${card.copyContract.todayReason}${card.copyContract.detailExplanation}`, /适合.+场景|配色简洁|整体协调|整体利落|整体更完整|构成明确的上下装关系|分别承担|颜色关系清楚|配色承接关系明确|配色层次明确|是这套搭配的主体/);
  }
});

test('QA uses the final plan signature for equivalence and ignored differentiation', () => {
  const equivalentSources = [0, 1].map((index) => realSchemaReplayFixture({
    outfitKey: `equivalent-${index}`,
    items: [
      { clothingId: `equivalent-${index}-top`, category: 'top', subcategory: 'T恤', colorPalette: [{ name: '白色' }] },
      { clothingId: `equivalent-${index}-bottom`, category: 'bottom', subcategory: '长裤', colorPalette: [{ name: '灰色' }] },
    ],
  }));
  const equivalentCards = canonicalizeRecommendationBatch(equivalentSources, { scene: 'home' });
  const equivalentCandidates = equivalentCards.map(qaCandidateFromReplay);
  const equivalentAudit = buildQaAuditSummaries({
    selectedOutfits: equivalentCandidates,
    acceptedCandidates: equivalentCandidates,
    finalOutfits: equivalentCards,
  }).clientAudit;
  assert.equal(equivalentCards[0].presentationPlan.presentationFactSignature, equivalentCards[1].presentationPlan.presentationFactSignature);
  assert.equal(equivalentAudit.exactReasonDuplicateGroups[0].allowed, true);
  assert.equal(equivalentAudit.duplicateCause, 'FACT_EQUIVALENCE');

  const distinctSources = [
    equivalentSources[0],
    realSchemaReplayFixture({
      outfitKey: 'distinct-1',
      items: [
        { clothingId: 'distinct-top', category: 'top', subcategory: '毛衣', colorPalette: [{ name: '红色' }] },
        { clothingId: 'distinct-bottom', category: 'bottom', subcategory: '长裤', colorPalette: [{ name: '黑色' }] },
      ],
    }),
  ];
  const distinctCards = canonicalizeRecommendationBatch(distinctSources, { scene: 'home' });
  distinctCards[1].copyContract.todayReason = distinctCards[0].copyContract.todayReason;
  distinctCards[1].todayReason = distinctCards[0].todayReason;
  distinctCards[1].reason = distinctCards[0].reason;
  const distinctCandidates = distinctCards.map(qaCandidateFromReplay);
  const distinctAudit = buildQaAuditSummaries({
    selectedOutfits: distinctCandidates,
    acceptedCandidates: distinctCandidates,
    finalOutfits: distinctCards,
  }).clientAudit;
  assert.notEqual(distinctCards[0].presentationPlan.presentationFactSignature, distinctCards[1].presentationPlan.presentationFactSignature);
  assert.equal(distinctAudit.exactReasonDuplicateGroups[0].allowed, false);
  assert.equal(distinctAudit.duplicateCause, 'DIFFERENTIATOR_IGNORED');
  assert.ok(distinctAudit.qaBlockReasons.includes('DIFFERENTIATOR_IGNORED'));
});

test('FACT_EQUIVALENCE rebinds selected differentiator identity per card', () => {
  const sources = [0, 1, 2].map((index) => realSchemaReplayFixture({
    scene: 'sport',
    outfitKey: `binding-equivalent-${index}`,
    items: [
      { clothingId: `binding-${index}-top`, category: 'top', subcategory: 'tee', colorPalette: [{ name: 'white' }] },
      { clothingId: `binding-${index}-bottom`, category: 'bottom', subcategory: 'shorts', colorPalette: [{ name: 'gray' }] },
      { clothingId: `binding-${index}-shoes`, category: 'shoes', subcategory: 'sneakers', colorPalette: [{ name: 'white' }] },
    ],
  }));
  const cards = canonicalizeRecommendationBatch(sources, { scene: 'sport' });
  const initialSubjects = cards.map((card) => card.presentationPlan.selectedDifferentiator.subjectItemIds.slice());
  const initialEvidence = cards.map((card) => card.presentationPlan.selectedDifferentiator.evidenceFactIds.slice());
  const initialReasons = cards.map((card) => [card.title, card.todayReason, card.detailExplanation]);

  assert.equal(cards.every((card) => card.presentationPlan.presentationFactSignature === cards[0].presentationPlan.presentationFactSignature), true);
  assert.equal(cards.every((card) => {
    const mismatch = bindingMismatches(card);
    return mismatch.selectedSubjectItemIds.length === 0
      && mismatch.evidenceFactIds.length === 0
      && !mismatch.todaySubjectMismatch;
  }), true);
  assert.notEqual(cards[0].presentationPlan.selectedDifferentiator, cards[1].presentationPlan.selectedDifferentiator);
  assert.notEqual(cards[1].presentationPlan.selectedDifferentiator, cards[2].presentationPlan.selectedDifferentiator);
  cards[0].presentationPlan.selectedDifferentiator.subjectItemIds[0] = 'mutated';
  cards[0].presentationPlan.selectedDifferentiator.evidenceFactIds[0] = 'mutated';
  assert.deepEqual(cards[1].presentationPlan.selectedDifferentiator.subjectItemIds, initialSubjects[1]);
  assert.deepEqual(cards[2].presentationPlan.selectedDifferentiator.evidenceFactIds, initialEvidence[2]);
  assert.deepEqual(cards.map((card) => [card.title, card.todayReason, card.detailExplanation]), initialReasons);

  const audit = buildQaAuditSummaries({
    selectedOutfits: cards.map(qaCandidateFromReplay),
    acceptedCandidates: cards.map(qaCandidateFromReplay),
    finalOutfits: cards,
  }).clientAudit;
  assert.equal(audit.duplicateCause, 'FACT_EQUIVALENCE');
});

test('production-shaped language closeout replay removes all seven binding mismatches', () => {
  const evidence = readLanguageCloseoutCards();
  const beforeCards = evidence.cards;
  const expectedBefore = [11, 12, 19, 20, 26, 30, 31];
  const beforeMismatches = beforeCards.flatMap((card, index) => {
    const selectedIds = card.selectedDifferentiator?.subjectItemIds || [];
    const actualIds = new Set((card.canonicalRoles || []).map((role) => role.id));
    return selectedIds.some((id) => !actualIds.has(id))
      || (card.selectedDifferentiator?.evidenceFactIds || []).some((factId) => {
        const itemId = factId.match(/^item:([^:]+):/)?.[1];
        return itemId && !actualIds.has(itemId);
      })
      ? [index] : [];
  });
  assert.deepEqual(beforeMismatches, expectedBefore);

  const snapshotsByKey = new Map(evidence.snapshots.map((snapshot) => [`${snapshot.__scene}|${snapshot.outfitKey}`, snapshot]));
  const replayed = beforeCards.map((card) => {
    const snapshot = snapshotsByKey.get(`${card.scene}|${card.outfitKey}`);
    assert.ok(snapshot?.presentationPlan, `missing presentation plan for ${card.outfitKey}`);
    return canonicalizeRecommendation(replaySourceFromCloseoutCard(snapshot), {
      scene: card.scene,
      selectedDifferentiator: card.selectedDifferentiator,
    });
  });
  const afterMismatches = replayed.flatMap((card, index) => {
    const mismatch = bindingMismatches(card);
    return mismatch.selectedSubjectItemIds.length || mismatch.evidenceFactIds.length || mismatch.todaySubjectMismatch
      ? [index] : [];
  });
  assert.deepEqual(afterMismatches, []);
  assert.deepEqual(replayed.map((card) => card.title), beforeCards.map((card) => card.title));
  assert.notDeepEqual(replayed.map((card) => [card.todayReason, card.detailExplanation]),
    beforeCards.map((card) => [card.todayReason, card.detailExplanation]));
  assert.equal(replayed.every((card) => card.copyContract.naturalnessGateResult === 'PASS'
    && card.copyContract.naturalnessRiskFlags.length === 0
    && !/中性色过渡|适合.+场景|配色简洁|整体协调|整体利落|整体更完整/.test(`${card.todayReason}${card.detailExplanation}`)), true);
  assert.equal(replayed.every((card) => card.presentationPlan.unsupportedClaims.length === 0
    && !hasSyntheticSuffix(card.title)
    && !hasSyntheticSuffix(card.todayReason)
    && !hasSyntheticSuffix(card.detailExplanation)), true);
});

module.exports = { productionPresentationFixture };
