const assert = require('node:assert/strict');
const test = require('node:test');

const {
  RECOMMENDATION_REASON_VERSION_V3,
  compileRecommendationLanguageV3,
  deriveOutfitInsightsV3,
  extractOutfitFactsV3,
  planBatchCopyV3,
  renderDetailReasoningV3,
  renderRecommendationCopyV3,
  renderStylistFallbackCopyV3,
  renderTodayReasonV3,
} = require('./recommendationLanguageV3');
const {
  assertHumanCopy,
  hasRepeatedSentenceParts,
  isTooSimilar,
} = require('./humanCopyPolicy');
const {
  deriveUserBenefitsV1,
  findXiaodaVoicePolicyViolations,
} = require('./xiaodaVoicePolicy');
const {
  fixtures,
  graphicTeeHome,
  hotWhiteTGrayShortsHome,
  similarGraphicTeeBatch,
} = require('./recommendationLanguageV3.fixtures');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function visibleText(result) {
  return [
    result.reason,
    result.reasoning,
    result.aiComment?.overallComment,
    result.aiComment?.advice,
  ].filter(Boolean).join('\n');
}

test('extractOutfitFactsV3 keeps only structured safe facts and is serializable', () => {
  const source = clone(graphicTeeHome);
  source.items[0].imageUrl = 'cloud://secret';
  source.items[0].fileID = 'cloud://file';
  source.items[0].OPENID = 'openid';
  source.nickname = 'user';
  source.recommendationBatchId = 'batch-secret';
  const before = clone(source);

  const facts = extractOutfitFactsV3(source, { scene: 'home', weather: { temp: 22, weather: '多云' } });
  const json = JSON.stringify(facts);

  assert.deepEqual(source, before);
  assert.deepEqual(facts.outfit.categories, ['bottom', 'shoes', 'top']);
  assert.equal(facts.items[0].slot, 'top');
  assert.equal(facts.items[0].patternType, 'graphic');
  assert.equal(facts.items[0].primaryColor, '白色');
  assert.equal(json.includes('cloud://'), false);
  assert.equal(json.includes('openid'), false);
  assert.equal(json.includes('nickname'), false);
  assert.equal(json.includes('batch-secret'), false);
  assert.doesNotMatch(json, /NaN|Infinity/);
  assert.deepEqual(JSON.parse(json), facts);
});

test('extractOutfitFactsV3 ignores low confidence advanced fields and unknown values', () => {
  const source = clone(graphicTeeHome);
  source.items[0].confidence = 0.2;
  source.items[0].aestheticFeatures = {
    fit: 'unknown',
    length: 'short',
    silhouette: 'wide',
    patternType: 'graphic',
    designElements: ['印花'],
    formalityLevel: 5,
  };
  const facts = extractOutfitFactsV3(source);
  const top = facts.items.find((item) => item.slot === 'top');
  assert.equal(top.patternType, '');
  assert.equal(top.fit, '');
  assert.equal(top.length, '');
  assert.equal(top.formalityLevel, null);
});

test('extractOutfitFactsV3 is stable when item order changes', () => {
  const first = extractOutfitFactsV3(graphicTeeHome);
  const reversed = clone(graphicTeeHome);
  reversed.items = reversed.items.slice().reverse();
  assert.deepEqual(extractOutfitFactsV3(reversed), first);
});

test('deriveOutfitInsightsV3 produces allowlisted structured relations without free copy', () => {
  const facts = extractOutfitFactsV3(graphicTeeHome, { scene: 'home', weather: { temp: 22, weather: '多云' } });
  const insights = deriveOutfitInsightsV3(facts);
  const codes = insights.map((entry) => entry.code);
  assert.ok(codes.includes('PATTERN_FOCUS_WITH_SIMPLE_BOTTOM'));
  assert.ok(codes.includes('STYLE_CASUAL_EASY'));
  assert.ok(codes.includes('SCENE_HOME_EASY'));
  assert.equal(insights.every((entry) => entry.strength >= 1 && entry.strength <= 3), true);
  assert.equal(JSON.stringify(insights).includes('证据'), false);
  assert.equal(JSON.stringify(insights).includes('线索'), false);
});

test('deriveOutfitInsightsV3 covers golden fixture expected codes', () => {
  for (const fixture of fixtures) {
    const facts = extractOutfitFactsV3(fixture.outfit, {
      scene: fixture.outfit.scene,
      weather: fixture.outfit.weatherSnapshot,
    });
    const codes = deriveOutfitInsightsV3(facts).map((entry) => entry.code);
    for (const code of fixture.expectedInsightCodes) {
      assert.ok(codes.includes(code), `${fixture.id} should include ${code}`);
    }
  }
});

test('renderers produce the locked anonymous screenshot sample style', () => {
  const [plan] = planBatchCopyV3([{ outfit: hotWhiteTGrayShortsHome }]);
  const today = renderTodayReasonV3(plan);
  const detail = renderDetailReasoningV3(plan);
  const fallback = renderStylistFallbackCopyV3(plan);

  assert.equal(today, '今天温度高，白T配灰色短裤穿着更轻松，运动鞋也方便临时出门。');
  assert.equal(detail, '白T和灰色短裤放在一起很日常，颜色不会互相抢。今天温度比较高，短袖、短裤这类单品穿起来更轻松，运动鞋也方便临时出门。');
  assert.equal(fallback.overallComment, '白T配灰色短裤很适合今天想穿得简单一点的时候，颜色清爽，出门也不费劲。');
  assert.equal(fallback.advice, '想再利落一点，可以让上衣或小包呼应运动鞋里的颜色。');
});

test('renderRecommendationCopyV3 keeps Today, detail, comment and advice distinct', () => {
  const [plan] = planBatchCopyV3([{ outfit: graphicTeeHome }]);
  const copy = renderRecommendationCopyV3(plan);
  assert.equal(copy.reasonVersion, RECOMMENDATION_REASON_VERSION_V3);
  assert.equal(isTooSimilar(copy.reason, copy.reasoning), false);
  assert.equal(copy.reasoning.includes(copy.reason), false);
  assert.equal(isTooSimilar(copy.aiComment.overallComment, copy.reasoning), false);
  assert.equal(isTooSimilar(copy.aiComment.overallComment, copy.aiComment.advice), false);
  for (const text of [copy.reason, copy.reasoning, copy.aiComment.overallComment, copy.aiComment.advice]) {
    assertHumanCopy(text);
    assert.equal(hasRepeatedSentenceParts(text), false, text);
  }
});

test('compileRecommendationLanguageV3 only changes display fields and preserves recommendation business data', () => {
  const source = [
    {
      ...clone(graphicTeeHome),
      isFavorite: true,
      isWornToday: true,
      scores: { total: 9, weatherAdaptation: 8, styleUnity: 7, freshness: 6, preference: 5 },
      aestheticEvaluation: { score: 81, coverage: 0.5, evidence: [{ code: 'SAFE' }] },
    },
  ];
  const before = clone(source);
  const [result] = compileRecommendationLanguageV3({ outfits: source, scene: 'home', weather: { temp: 22, weather: '多云' } });

  assert.deepEqual(source, before);
  assert.equal(result.id, source[0].id);
  assert.equal(result.outfitKey, source[0].outfitKey);
  assert.equal(result.recommendationBatchId, source[0].recommendationBatchId);
  assert.equal(result.isFavorite, true);
  assert.equal(result.isWornToday, true);
  assert.deepEqual(result.scores, before[0].scores);
  assert.deepEqual(result.aestheticEvaluation, before[0].aestheticEvaluation);
  assert.equal(result.reasonVersion, RECOMMENDATION_REASON_VERSION_V3);
});

test('compileRecommendationLanguageV3 removes old V2 copy from legacy snapshots', () => {
  const fixture = fixtures.find((entry) => entry.id === 'legacy_v2_snapshot');
  const [result] = compileRecommendationLanguageV3({ outfits: [fixture.outfit], scene: 'home' });
  assert.equal(result.reasonVersion, RECOMMENDATION_REASON_VERSION_V3);
  assert.doesNotMatch(visibleText(result), /识别|证据|线索|卡片|详情|重点更清楚|更容易读出来/);
});

test('batch planner avoids exact duplicate reasons, numeric suffixes and weather-heavy batches', () => {
  const source = similarGraphicTeeBatch(10);
  const results = compileRecommendationLanguageV3({ outfits: source, scene: 'home', weather: { temp: 22, weather: '多云' } });
  assert.deepEqual(results.map((entry) => entry.id), source.map((entry) => entry.id));
  assert.equal(new Set(results.map((entry) => entry.reason)).size, results.length);
  assert.equal(new Set(results.map((entry) => entry.aiComment.overallComment)).size, results.length);
  assert.equal(new Set(results.map((entry) => entry.aiComment.advice)).size, results.length);
  assert.equal(results.some((entry) => /\d+$/.test(entry.reason)), false);
  assert.equal(results.some((entry) => /这组线索更突出|整体重点更清楚|识别|证据|线索/.test(visibleText(entry))), false);
  assert.ok(results.filter((entry) => entry.primaryDimension === 'weather').length <= 1);
  assert.ok(new Set(results.map((entry) => entry.primaryInsightCode)).size > 3);
});

test('golden fixtures remain human readable and pass copy policy', () => {
  for (const fixture of fixtures) {
    const [result] = compileRecommendationLanguageV3({
      outfits: [fixture.outfit],
      scene: fixture.outfit.scene,
      weather: fixture.outfit.weatherSnapshot,
    });
    assert.equal(result.reasonVersion, RECOMMENDATION_REASON_VERSION_V3);
    for (const forbidden of fixture.expectedForbiddenTermsAbsent) {
      assert.equal(visibleText(result).includes(forbidden), false, `${fixture.id} contains ${forbidden}`);
    }
    for (const text of [result.reason, result.reasoning, result.aiComment.overallComment, result.aiComment.advice]) {
      assertHumanCopy(text);
      assert.equal(hasRepeatedSentenceParts(text), false, `${fixture.id}: ${text}`);
    }
  }
});

test('persona fixtures cover Xiaoda V1 scenarios with grounded benefits and quality gates', () => {
  const personaFixtures = fixtures.filter((fixture) => fixture.todayPersonaGoal);
  assert.ok(personaFixtures.length >= 16);
  const ids = new Set(personaFixtures.map((fixture) => fixture.id));
  for (const id of [
    'white_t_gray_shorts_sneakers_hot_home',
    'graphic_tee_gray_bottom_red_white_sneakers_home',
    'neutral_with_accent',
    'all_light_colors',
    'home_relaxed',
    'hot_commute',
    'cold_commute',
    'date_soft_colors',
    'sport_set',
    'two_patterns_compete',
    'category_only',
    'missing_color_palette',
    'missing_fit',
    'full_aesthetic_fields',
    'aesthetic_low_coverage',
    'similar_batch_base',
  ]) {
    assert.ok(ids.has(id), `${id} persona fixture missing`);
  }

  for (const fixture of personaFixtures) {
    const facts = extractOutfitFactsV3(fixture.outfit, {
      scene: fixture.outfit.scene,
      weather: fixture.outfit.weatherSnapshot,
    });
    const insights = deriveOutfitInsightsV3(facts);
    const benefitCodes = deriveUserBenefitsV1(facts, insights, {
      scene: fixture.outfit.scene,
      weather: fixture.outfit.weatherSnapshot,
    }).map((benefit) => benefit.code);
    for (const code of fixture.expectedBenefitCodes) {
      assert.ok(benefitCodes.includes(code), `${fixture.id} should include benefit ${code}`);
    }

    const [result] = compileRecommendationLanguageV3({
      outfits: [fixture.outfit],
      scene: fixture.outfit.scene,
      weather: fixture.outfit.weatherSnapshot,
    });
    const text = visibleText(result);
    assert.equal(findXiaodaVoicePolicyViolations(text).length, 0, `${fixture.id}: ${text}`);
    assert.doesNotMatch(text, /灰色灰色|白色白色|黑色黑色/);
    assert.ok(result.reason.length > 0, fixture.id);
    assert.ok(result.reasoning.length > result.reason.length, fixture.id);
    assert.equal(isTooSimilar(result.aiComment.overallComment, result.reasoning), false, fixture.id);
    assert.equal(isTooSimilar(result.aiComment.overallComment, result.aiComment.advice), false, fixture.id);
    if (fixture.id === 'two_patterns_compete') {
      assert.doesNotMatch(text, /不乱|不会显得太乱|没有冲突|明显冲突/);
      assert.match(text, /醒目|热闹|图案|简单/);
    }
    if (fixture.id === 'category_only' || fixture.id === 'missing_color_palette') {
      assert.doesNotMatch(text, /颜色不会互相抢|小面积颜色|颜色方向|灰色|白色|黑色/);
    }
  }
});
