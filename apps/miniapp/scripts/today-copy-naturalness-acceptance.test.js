const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SCENES,
  auditDetailSamples,
  auditFinalTodayCopy,
  buildCrossSceneComparisons,
  summarizeNaturalnessMetrics,
} = require('./today-copy-naturalness-acceptance');
const {
  SCENE_EVIDENCE_FINGERPRINT,
  SCENE_EVIDENCE_VERSION,
} = require('../cloudfunctions/generateOutfit/services/sceneEvidenceRegistryV4');

function acceptanceData(outfits, candidates = []) {
  return {
    outfits,
    meta: {
      sceneEvidenceVersion: SCENE_EVIDENCE_VERSION,
      sceneEvidenceFingerprint: SCENE_EVIDENCE_FINGERPRINT,
    },
    debug: {
      sceneEvidenceAcceptance: {
        version: SCENE_EVIDENCE_VERSION,
        fingerprint: SCENE_EVIDENCE_FINGERPRINT,
        candidates,
      },
    },
  };
}

function outfit(scene, index, todayReason = '上身这件粉色上衣已经很有存在感了，下身搭灰色裤子会清爽很多，其他地方不用再加太多颜色。') {
  const topId = `${scene}-top-${index}`;
  const bottomId = `${scene}-bottom-${index}`;
  return {
    scene,
    clothingIds: [topId, bottomId],
    copyContractVersion: 'recommendation-copy-contract-v8',
    copyContract: {
      copyContractVersion: 'recommendation-copy-contract-v8',
      coreEligibilityReasonCode: `${scene.toUpperCase()}_BASELINE`,
      todayReason,
      unsupportedClaimCount: 0,
      naturalnessGateVersion: 'copy-naturalness-gate-v3',
      naturalnessGateResult: 'PASS',
      naturalnessRiskFlags: [],
      structuralNaturalnessVersion: 'batch-editorial-review-v2',
      structuralNaturalnessResult: 'PASS',
      structuralNaturalnessRiskFlags: [],
      todayCopyProvenance: {
        version: 'recommendation-natural-language-v4',
        surface: 'today',
        scene,
        relationCode: 'TOP_ACCENT_WITH_NEUTRAL_BOTTOM',
        messageIntent: 'color_focal_support',
        messageCandidateId: 'xiaoda:COLOR_FOCUS_WITH_NEUTRAL_SUPPORT:TOP_ACCENT_WITH_NEUTRAL_BOTTOM',
        messageDimension: 'color',
        openingFamily: 'bright_subject',
        endingFamily: 'quiet_support',
        valueAssessment: { factAvailable: true, userValue: 3, novelInformation: 3, sceneRelevance: 1, naturalExpressibility: 3, total: 12 },
        availableMessageCount: 1,
        compositionPattern: 'natural_message',
        text: todayReason,
        clauses: [{
          slot: 'message',
          templateId: 'xiaoda.today.color-focus-with-neutral-support',
          messageIntent: 'color_focal_support',
          text: todayReason.replace(/。$/, ''),
          informationKey: 'xiaoda:COLOR_FOCUS_WITH_NEUTRAL_SUPPORT:TOP_ACCENT_WITH_NEUTRAL_BOTTOM',
          subjectItemIds: [topId, bottomId],
          evidenceFactIds: [`item:${topId}:color`, `item:${bottomId}:color`],
          authorizationIds: [],
          relationCode: 'TOP_ACCENT_WITH_NEUTRAL_BOTTOM',
          scene,
          source: 'style_insight',
          valueAssessment: { factAvailable: true, userValue: 3, novelInformation: 3, sceneRelevance: 1, naturalExpressibility: 3, total: 12 },
        }],
      },
    },
  };
}

test('real Today audit requires eight cards per scene and compares final UI text with public DTO canonical copy', () => {
  assert.deepEqual(SCENES, ['home', 'work', 'date', 'sport']);
  for (const scene of SCENES) {
    const outfits = Array.from({ length: 8 }, (_, index) => outfit(scene, index));
    const uiCards = outfits.map((entry, index) => ({ index, todayReason: entry.copyContract.todayReason }));
    const result = auditFinalTodayCopy(scene, acceptanceData(outfits), uiCards);
    assert.equal(result.passed, true, scene);
    assert.equal(result.samples.length, 8);
    assert.equal(result.genericSceneFallbackCount, 0);
    assert.equal(result.lowValueFinalReasonCount, 0);
    assert.equal(result.decisionValueCount, 8);
    assert.equal(result.omittedLowValueClauseCount, 8);
  }
});

test('refresh audit accepts omitted full-compute scene diagnostics while retaining public Scene V4 meta', () => {
  const outfits = Array.from({ length: 8 }, (_, index) => outfit('home', index));
  const uiCards = outfits.map((entry, index) => ({ index, todayReason: entry.copyContract.todayReason }));
  const data = acceptanceData(outfits);
  delete data.debug;
  assert.equal(auditFinalTodayCopy('home', data, uiCards).passed, false);
  assert.equal(auditFinalTodayCopy('home', data, uiCards, {
    requireSceneEvidenceDiagnostics: false,
  }).passed, true);
});

test('real Today audit rejects stale editorial copy and UI binding drift independently', () => {
  const outfits = Array.from({ length: 8 }, (_, index) => outfit('home', index));
  outfits[0] = outfit('home', 0, '白色短袖T恤与灰色短裤用中性色过渡，适合居家场景，配色简洁。');
  const uiCards = outfits.map((entry, index) => ({ index, todayReason: index === 1 ? '页面读了旧 reason' : entry.copyContract.todayReason }));
  const result = auditFinalTodayCopy('home', acceptanceData(outfits), uiCards);
  assert.equal(result.passed, false);
  assert.ok(result.failures.includes('editorial_copy:0'));
  assert.ok(result.failures.includes('ui_binding:1'));
});

test('real Today audit rejects scene semantics repeated across composed slots', () => {
  const repeated = '白色短袖T恤和灰色短裤都是中性色，日常轻运动可以直接这样穿，下装和运动鞋符合这次轻运动的需要。';
  const outfits = Array.from({ length: 8 }, (_, index) => outfit('sport', index, index === 0 ? repeated : undefined));
  const uiCards = outfits.map((entry, index) => ({ index, todayReason: entry.copyContract.todayReason }));
  const result = auditFinalTodayCopy('sport', acceptanceData(outfits), uiCards);
  assert.equal(result.passed, false);
  assert.ok(result.failures.includes('repeated_scene_semantics:0'));
  assert.ok(result.failures.includes('generic_scene_fallback:0'));
});

test('cross-scene comparison keeps shared candidates and orders by scene-fit spread', () => {
  const result = buildCrossSceneComparisons([
    { scene: 'home', sceneEvidence: { candidates: [{ outfitKey: 'shared', rank: 1, sceneFitScore: 8, selected: true, positiveFamilies: ['home_comfort'] }] } },
    { scene: 'work', sceneEvidence: { candidates: [{ outfitKey: 'shared', rank: 8, sceneFitScore: 4, selected: false, negativeFamilies: ['casual_penalty'] }] } },
    { scene: 'date', sceneEvidence: { candidates: [{ outfitKey: 'date-only', rank: 1, sceneFitScore: 7 }] } },
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].outfitKey, 'shared');
  assert.equal(result[0].sceneFitSpread, 4);
  assert.deepEqual(result[0].scenes.map((entry) => entry.scene), ['home', 'work']);
});

test('naturalness metrics measure exact repetition without random wording', () => {
  const metrics = summarizeNaturalnessMetrics([
    {
      finalCopies: ['A。', 'A。', 'B。', 'C。'],
      sceneClauses: [],
      genericSceneFallbackCount: 0,
      lowValueFinalReasonCount: 0,
      omittedLowValueClauseCount: 4,
    },
  ]);
  assert.equal(metrics.exactSceneClauseDuplicateRate, 0);
  assert.equal(metrics.exactFullCopyDuplicateRate, 0.25);
  assert.equal(metrics.genericSceneFallbackUsageRate, 0);
  assert.equal(metrics.lowValueFinalReasonRate, 0);
  assert.equal(metrics.fullReasonDuplicateRate, 0.25);
  assert.equal(metrics.omittedLowValueClauseCount, 4);
});

test('Detail audit requires two real AI UI comments per scene with Today binding and Xiaoda persona', () => {
  const samples = SCENES.flatMap((scene) => [0, 1].map((index) => ({
    scene,
    cardIndex: index + 1,
    todayReason: '这件印花T恤已经够有内容了，这条直筒裤简单一点刚刚好。',
    coreReason: '这件印花T恤已经够有内容了，这条直筒裤简单一点刚刚好。',
    defaultDetail: '这件印花T恤本身已经把重点放在上身。',
    paragraphs: ['印花T恤本身已经够有内容，直筒裤没有再加第二种图案，所以整身只有一个重点。'],
    advice: '',
  })));
  assert.deepEqual(auditDetailSamples(samples), {
    passed: true,
    failures: [],
    sampleCount: 8,
    sceneCounts: { home: 2, work: 2, date: 2, sport: 2 },
  });

  const broken = samples.slice(1).map((sample, index) => (
    index === 0 ? { ...sample, coreReason: '页面读了另一条理由' } : sample
  ));
  const result = auditDetailSamples(broken);
  assert.equal(result.passed, false);
  assert.ok(result.failures.includes('today_detail_binding:0'));
  assert.ok(result.failures.includes('detail_scene_count:home:1'));
});
