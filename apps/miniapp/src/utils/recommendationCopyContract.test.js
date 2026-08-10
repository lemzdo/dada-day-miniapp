const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const MODULE_PATH = './recommendationCopyContract';
const implementation = fs.existsSync(path.join(__dirname, 'recommendationCopyContract.js'))
  ? require(MODULE_PATH)
  : {};

const EXPECTED_VERSION = 'recommendation-copy-contract-v4';
const EXPECTED_VOICE_VERSION = 'xiaoda-fixed-claim-catalog-v2';

function currentOutfit(overrides = {}) {
  return {
    id: 'outfit-1',
    title: '用户标题',
    userTitle: '用户标题',
    clothingIds: ['top-1', 'bottom-1'],
    copyContractVersion: EXPECTED_VERSION,
    voiceBankVersion: EXPECTED_VOICE_VERSION,
    copyContract: {
      copyContractVersion: EXPECTED_VERSION,
      voiceBankVersion: EXPECTED_VOICE_VERSION,
      gateResult: 'PASS',
      todayReason: '衬衫配直筒裤，上班穿比较利落。',
      riskFlags: [],
      naturalnessGateVersion: 'copy-naturalness-gate-v1',
      naturalnessGateResult: 'PASS',
      naturalnessRiskFlags: [],
      todayCopyProvenance: { version: 'recommendation-natural-language-v1' },
    },
    reason: '衬衫配直筒裤，上班穿比较利落。',
    reasoning: '这条裤子弹性不错，坐着办公久一点也不容易勒。',
    ...overrides,
  };
}

test('only the exact Contract and fixed Claim Catalog versions make default copy current', () => {
  assert.equal(implementation.COPY_CONTRACT_VERSION, EXPECTED_VERSION);
  assert.equal(implementation.VOICE_BANK_VERSION, EXPECTED_VOICE_VERSION);
  assert.equal(implementation.hasCurrentDefaultCopy(currentOutfit()), true);
  assert.equal(implementation.hasCurrentCopyContract(currentOutfit()), true);

  for (const outfit of [
    currentOutfit({ copyContractVersion: undefined, reasonVersion: 'recommendation-reason-v3' }),
    currentOutfit({ copyContractVersion: 'recommendation-copy-contract-v0', voiceBankVersion: 'xiaoda-voice-bank-v2' }),
    currentOutfit({ copyContractVersion: ' recommendation-copy-contract-v4 ' }),
    currentOutfit({ voiceBankVersion: 'xiaoda-voice-bank-v2' }),
    currentOutfit({ copyContract: {
      ...currentOutfit().copyContract,
      voiceBankVersion: 'xiaoda-voice-bank-v2',
    } }),
    currentOutfit({ copyContract: { gateResult: 'REJECT', todayReason: '', riskFlags: ['REJECTED'] } }),
    currentOutfit({ copyContract: { gateResult: 'PASS', todayReason: '', riskFlags: [] } }),
    currentOutfit({ copyContractVersion: 1 }),
    null,
    [],
  ]) {
    assert.equal(implementation.hasCurrentDefaultCopy(outfit), false);
  }
});

test('current copy REJECT keeps the outfit contract while hiding every default-copy surface', () => {
  const hidden = currentOutfit({
    copyContract: {
      ...currentOutfit().copyContract,
      gateResult: 'REJECT',
      todayReason: '',
      riskFlags: ['NO_ACCEPTED_CORE_CLAIM'],
    },
    reason: '不应显示',
    reasoning: '不应显示',
  });
  assert.equal(implementation.hasCurrentCopyContract(hidden), true);
  assert.equal(implementation.hasCurrentDefaultCopy(hidden), false);

  const result = implementation.stripStaleDefaultCopy(hidden);
  assert.equal(result.id, hidden.id);
  assert.equal(result.copyContractVersion, EXPECTED_VERSION);
  assert.equal(result.copyContract.gateResult, 'REJECT');
  assert.equal(result.copyContract.todayReason, '');
  assert.equal(Object.hasOwn(result.copyContract, 'detailExplanation'), false);
  assert.equal(result.copyDisplay, 'hidden');
  assert.equal(result.reason, '');
  assert.equal(result.reasoning, undefined);
});

test('current input is returned by reference and is not mutated', () => {
  const outfit = currentOutfit();
  assert.equal(implementation.stripStaleDefaultCopy(outfit), outfit);
});

test('saved snapshot copy helper hides unsafe copy and prefers independent detail copy', () => {
  const current = currentOutfit();
  assert.equal(implementation.getSavedSnapshotDefaultCopy(current), current.copyContract.todayReason);
  const withDetail = currentOutfit({
    copyContract: {
      ...current.copyContract,
      detailExplanation: '独立详情固定文案',
    },
  });
  assert.equal(implementation.getSavedSnapshotDefaultCopy(withDetail), '独立详情固定文案');
  assert.equal(implementation.getSavedSnapshotDefaultCopy(currentOutfit({
    copyContract: { gateResult: 'REJECT', todayReason: '', riskFlags: ['REJECTED'] },
  })), '');
  assert.equal(implementation.getSavedSnapshotDefaultCopy({ reason: '旧 128 条文案' }), '');
});

test('stale input loses every default-copy field while preserving product facts and status', () => {
  const realAi = {
    source: 'cached_ai',
    reason: '真实 AI 正文',
    tip: '真实 AI 建议',
    nested: { keep: true },
  };
  const outfit = currentOutfit({
    copyContractVersion: 'old-contract',
    voiceBankVersion: 'old-voice',
    reasonVersion: 'recommendation-reason-v3',
    copyContract: { todayReason: '旧 Contract' },
    todayAction: 'weather_fit',
    todayDimension: 'weather',
    todayEvidenceIds: ['weather:temp'],
    todaySentenceClusterId: 'today-old',
    detailAction: 'color_relation',
    detailDimension: 'color',
    detailEvidenceIds: ['fact:color'],
    detailSentenceClusterId: 'detail-old',
    riskFlags: ['OLD'],
    primaryDimension: 'weather',
    evidenceCodes: ['weather:temp'],
    validatorRejectReasons: ['OLD'],
    primaryInsightCode: 'weather_fit',
    contentPlanVersion: 'xiaoda-content-plan-v1',
    contentPlan: {
      version: 'xiaoda-content-plan-v1',
      sceneIntent: 'work:commute',
      items: [{ id: 'top-1', displayName: '白衬衫' }],
      defaultCopy: { todayReason: '旧首页', detailExplanation: '旧详情' },
      defaultTodayReason: '旧首页',
      defaultDetailExplanation: '旧详情',
    },
    detailNarrativeViewModel: {
      defaultText: '旧详情',
      source: 'copy_contract',
      aiStatus: 'default',
      keep: 'structural',
    },
    reviewSource: 'cached_ai',
    enhanced: true,
    aiComment: realAi,
    isFavorite: true,
    isWornToday: true,
    weatherSnapshot: { temp: 26, weather: '多云' },
    snapshotItems: [{ itemId: 'top-1', name: '白衬衫' }],
  });
  const before = structuredClone(outfit);
  const result = implementation.stripStaleDefaultCopy(outfit);

  assert.notEqual(result, outfit);
  assert.deepEqual(outfit, before);
  for (const field of [
    'reason', 'reasoning', 'reasonVersion', 'copyContractVersion', 'voiceBankVersion', 'copyContract',
    'todayClaim', 'todayClaimId', 'todayAction', 'todayDimension', 'todayEvidenceIds',
    'todayRequiredFactIds', 'todayEvidenceSources',
    'todaySentenceClusterId', 'todaySubjectItemId', 'todaySubjectItemIds', 'todaySlotBindings',
    'detailClaim', 'detailClaimId', 'detailAction', 'detailDimension', 'detailEvidenceIds',
    'detailRequiredFactIds', 'detailEvidenceSources',
    'detailSentenceClusterId', 'detailSubjectItemId', 'detailSubjectItemIds', 'detailSlotBindings',
    'riskFlags', 'qualification', 'primaryDimension', 'evidenceCodes', 'validatorRejectReasons', 'primaryInsightCode',
  ]) {
    assert.equal(Object.hasOwn(result, field), false, field);
  }
  assert.deepEqual(result.contentPlan, {
    version: 'xiaoda-content-plan-v1',
    sceneIntent: 'work:commute',
    items: [{ id: 'top-1', displayName: '白衬衫' }],
  });
  assert.deepEqual(result.detailNarrativeViewModel, { keep: 'structural' });
  assert.equal(result.aiComment, realAi);
  assert.equal(result.reviewSource, 'cached_ai');
  assert.equal(result.enhanced, true);
  assert.equal(result.title, '用户标题');
  assert.equal(result.isFavorite, true);
  assert.equal(result.isWornToday, true);
  assert.deepEqual(result.weatherSnapshot, outfit.weatherSnapshot);
  assert.deepEqual(result.snapshotItems, outfit.snapshotItems);
  assert.equal(result.contentPlanVersion, 'xiaoda-content-plan-v1');
});

test('fallback-first provenance removes conflicting, rule-default, legacy, and ambiguous ai aliases', () => {
  const cases = [
    { reviewSource: 'ai', aiComment: { source: 'cached_fallback', reason: '不应保留' }, enhanced: true },
    { reviewSource: 'cached_ai', aiComment: { reviewSource: 'rule_fallback', reason: '不应保留' } },
    { reviewSource: 'rule_default', aiComment: { reason: '规则别名' } },
    { reviewSource: 'legacy', aiComment: { reason: '旧别名' } },
    { aiComment: { reason: '来源不明' } },
  ];

  for (const value of cases) {
    const result = implementation.stripStaleDefaultCopy(currentOutfit({
      copyContractVersion: 'old',
      ...value,
    }));
    assert.equal(Object.hasOwn(result, 'aiComment'), false);
    assert.equal(Object.hasOwn(result, 'reviewSource'), false);
    assert.equal(Object.hasOwn(result, 'enhanced'), false);
  }
});

test('stale stripping is null, array, and malformed-nesting safe', () => {
  assert.equal(implementation.stripStaleDefaultCopy(null), null);
  const array = [currentOutfit()];
  assert.equal(implementation.stripStaleDefaultCopy(array), array);

  const malformed = { copyContractVersion: 'old', reason: '旧', contentPlan: [], detailNarrativeViewModel: 'bad' };
  assert.doesNotThrow(() => implementation.stripStaleDefaultCopy(malformed));
  assert.deepEqual(implementation.stripStaleDefaultCopy(malformed), {
    contentPlan: [],
    detailNarrativeViewModel: 'bad',
  });
});

test('all client cache and storage boundaries include the exact Contract version', () => {
  const sources = [
    ['../lib/cloud.ts', /generateOutfit[^\n]*recommendation-copy-contract-v4|recommendation-copy-contract-v4[^\n]*generateOutfit/s],
    ['outfitSnapshot.ts', /outfitDetailDraft[^\n]*recommendation-copy-contract-v4|recommendation-copy-contract-v4[^\n]*outfitDetailDraft/s],
    ['../pages/today/index.tsx', /today:outfitReturnSnapshot[^\n]*recommendation-copy-contract-v4|recommendation-copy-contract-v4[^\n]*today:outfitReturnSnapshot/s],
    ['../pages/outfit-detail/index.tsx', /outfitDetail[\s\S]{0,160}recommendation-copy-contract-v4/],
    ['../pages/favorite-outfits/index.tsx', /favorites[\s\S]{0,160}recommendation-copy-contract-v4/],
    ['../pages/outfit-history/index.tsx', /history[\s\S]{0,160}recommendation-copy-contract-v4/],
  ];

  for (const [relativePath, expected] of sources) {
    const source = fs.readFileSync(path.join(__dirname, relativePath), 'utf8');
    assert.match(source, expected, relativePath);
  }
});

test('Today, Favorites, and History have no local recommendation fallback or unversioned reason display', () => {
  const pages = [
    '../pages/today/index.tsx',
    '../pages/favorite-outfits/index.tsx',
    '../pages/outfit-history/index.tsx',
  ];
  for (const relativePath of pages) {
    const source = fs.readFileSync(path.join(__dirname, relativePath), 'utf8');
    assert.doesNotMatch(source, /getFallbackReason|reasoning\s*\|\|\s*reason|reason\s*\|\|\s*reasoning|outfit\.reason\s*\|\|/);
  }

  const todaySource = fs.readFileSync(path.join(__dirname, '../pages/today/index.tsx'), 'utf8');
  assert.match(todaySource, /hasCurrentNewRecommendationCopy/);
  assert.match(todaySource, /data\.outfits\.filter\(hasCurrentNewRecommendationCopy\)/);
  assert.doesNotMatch(todaySource, /data\.outfits\.filter\(hasCurrentDefaultCopy\)/);
  assert.match(todaySource, /outfit\.copyContract\.todayReason/);
  assert.doesNotMatch(todaySource, /适合今天|适合\$\{getSceneText/);

  for (const relativePath of ['../pages/favorite-outfits/index.tsx', '../pages/outfit-history/index.tsx']) {
    const source = fs.readFileSync(path.join(__dirname, relativePath), 'utf8');
    assert.match(source, /getSavedSnapshotDefaultCopy/);
    assert.match(source, /getSavedSnapshotDefaultCopy\([^)]*\)\s*\?\s*\(/);
    assert.doesNotMatch(source, /\.filter\([^\n]*(todayReason|getSavedSnapshotDefaultCopy)/);
  }
});

test('client snapshot normalization preserves item-scoped evidence for later rehydration', () => {
  const source = fs.readFileSync(path.join(__dirname, 'outfitSnapshot.ts'), 'utf8');
  for (const field of [
    'factRecords', 'factEvidence', 'factsWithSource', 'contractFacts', 'userFacts',
    'careLabelFacts', 'productFacts', 'structuredAiFacts', 'visualFacts',
    'factSources', 'factConfidences',
  ]) {
    assert.match(source, new RegExp(`${field}:`), field);
  }
  assert.match(source, /pickCopyEvidenceFields\(item\)/);
});
