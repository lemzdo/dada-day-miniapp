const {
  assertHumanCopy,
  findHumanCopyPolicyViolations,
  hasRepeatedSentenceParts,
  isTooSimilar,
} = require('./humanCopyPolicy');

const RECOMMENDATION_REASON_VERSION_V3 = 'recommendation-reason-v3';
const CATEGORY_ORDER = ['top', 'outerwear', 'onepiece', 'bottom', 'skirt', 'shoes', 'accessory', 'other'];
const DIMENSION_PRIORITY = {
  pattern: 0,
  color: 1,
  silhouette: 2,
  proportion: 3,
  formality: 4,
  detail: 5,
  style: 6,
  scene: 7,
  weather: 8,
};
const STYLE_ALLOWLIST = ['休闲', '简约', '运动', '通勤', '甜美', '复古', '街头', '优雅'];
const PATTERN_TAGS = {
  graphic: '印花',
  floral: '印花',
  print: '印花',
  printed: '印花',
  stripe: '条纹',
  striped: '条纹',
  plaid: '格纹',
  check: '格纹',
  solid: '纯色',
  plain: '纯色',
};
const FIT_TAGS = {
  relaxed: '宽松',
  loose: '宽松',
  oversized: '宽松',
  straight: '利落',
  clean: '利落',
  fitted: '修身',
  slim: '修身',
  layered: '层次',
};
const SCENE_LABELS = {
  home: '居家',
  work: '上班',
  date: '约会',
  sport: '运动',
  sports: '运动',
};

function compileRecommendationLanguageV3({ outfits = [], scene, weather } = {}) {
  if (!Array.isArray(outfits) || outfits.length === 0) return [];
  const plans = planBatchCopyV3(outfits.map((outfit) => ({ outfit, scene, weather })));
  return plans.map((plan) => {
    const copy = renderRecommendationCopyV3(plan);
    return stripNonFinite({
      ...plan.outfit,
      reasonVersion: RECOMMENDATION_REASON_VERSION_V3,
      reason: copy.reason,
      reasoning: copy.reasoning,
      primaryDimension: plan.primaryInsight.dimension,
      primaryInsightCode: plan.primaryInsight.code,
      evidenceCodes: plan.detailInsights.map((insight) => insight.code),
      styleTags: deriveDisplayTagsV3(plan.facts),
      aiComment: {
        ...(plan.outfit.aiComment && typeof plan.outfit.aiComment === 'object' ? plan.outfit.aiComment : {}),
        overallComment: copy.aiComment.overallComment,
        advice: copy.aiComment.advice,
        reviewVersion: 'stylist-explanation-v3',
        promptVersion: 'stylist-prompt-v3',
        copyPolicyVersion: 'human-copy-v1',
      },
    });
  });
}

function extractOutfitFactsV3(input = {}, context = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const items = normalizeItems(readItems(source));
  const scene = normalizeScene(context.scene || source.scene);
  const weather = context.weather || source.weatherSnapshot || source.weather || {};
  const scores = sanitizeScores(source.scores);
  const aesthetic = sanitizeAesthetic(source.aestheticEvaluation);
  const categories = uniqueStrings(items.map((item) => item.slot)).sort();
  const colorFamilies = uniqueStrings(items.flatMap((item) => item.colors.map(classifyColorFamily))).filter(Boolean).sort();
  const styleTags = uniqueStrings(items.flatMap((item) => item.styleTags)).sort();

  return stripNonFinite({
    items,
    outfit: {
      itemCount: items.length,
      categories,
      colorFamilies,
      styleTags,
    },
    context: {
      scene,
      temperatureBand: getTemperatureBand(weather),
      conditionBucket: getConditionBucket(weather),
    },
    scores,
    aesthetic,
  });
}

function deriveOutfitInsightsV3(facts = {}) {
  const items = Array.isArray(facts.items) ? facts.items : [];
  const insights = [];
  addPatternInsights(insights, items);
  addColorInsights(insights, items);
  addSilhouetteInsights(insights, items);
  addFormalityInsights(insights, items);
  addDetailInsights(insights, items);
  addStyleInsights(insights, items);
  addSceneInsights(insights, facts, items);
  addWeatherInsights(insights, facts, items);
  return uniqueInsights(insights).sort(compareInsights);
}

function planBatchCopyV3(outfitPlans = []) {
  const usedCodes = new Set();
  const usedDimensions = new Set();
  const usedFamilies = new Set();
  const usedReasons = new Set();
  let weatherPrimaryCount = 0;
  let scenePrimaryCount = 0;

  return outfitPlans.map((entry, index) => {
    const outfit = entry.outfit || entry;
    const facts = extractOutfitFactsV3(outfit, { scene: entry.scene, weather: entry.weather });
    const insights = deriveOutfitInsightsV3(facts);
    const primaryInsight = choosePrimaryInsight(insights, {
      usedCodes,
      usedDimensions,
      weatherPrimaryCount,
      scenePrimaryCount,
    }) || buildFallbackInsight(facts);
    const detailInsights = chooseDetailInsights(insights, primaryInsight);
    const family = chooseSentenceFamily(primaryInsight, usedFamilies, index);
    let plan = {
      outfit,
      facts,
      insights,
      primaryInsight,
      detailInsights,
      sentenceFamily: family,
      batchIndex: index,
    };
    plan = ensureUniquePlanReason(plan, usedReasons);
    usedCodes.add(primaryInsight.code);
    usedDimensions.add(primaryInsight.dimension);
    usedFamilies.add(plan.sentenceFamily);
    usedReasons.add(renderTodayReasonV3(plan));
    if (primaryInsight.dimension === 'weather') weatherPrimaryCount += 1;
    if (primaryInsight.dimension === 'scene') scenePrimaryCount += 1;
    return plan;
  });
}

function renderRecommendationCopyV3(plan) {
  const reason = renderTodayReasonV3(plan);
  const reasoning = renderDetailReasoningV3(plan);
  const aiComment = renderStylistFallbackCopyV3(plan, { reasoning });
  assertHumanCopy(reason);
  assertHumanCopy(reasoning, { compareWith: reason });
  assertHumanCopy(aiComment.overallComment);
  assertHumanCopy(aiComment.advice, { compareWith: aiComment.overallComment });
  if (isTooSimilar(aiComment.overallComment, reasoning)) {
    const fallback = renderBasicStylistCopy(plan.facts, plan.primaryInsight);
    assertHumanCopy(fallback.overallComment);
    assertHumanCopy(fallback.advice);
    return {
      reasonVersion: RECOMMENDATION_REASON_VERSION_V3,
      reason,
      reasoning,
      aiComment: fallback,
    };
  }
  return {
    reasonVersion: RECOMMENDATION_REASON_VERSION_V3,
    reason,
    reasoning,
    aiComment,
  };
}

function renderTodayReasonV3(plan) {
  const text = renderTodayByInsight(plan, plan.primaryInsight, plan.sentenceFamily);
  return ensureCopy(text, () => renderFallbackToday(plan.facts, plan.batchIndex));
}

function renderDetailReasoningV3(plan) {
  const insights = [plan.primaryInsight, ...plan.detailInsights]
    .filter(Boolean)
    .filter((insight, index, array) => array.findIndex((entry) => entry.code === insight.code) === index)
    .slice(0, 3);
  const text = renderDetailByInsights(plan.facts, insights);
  const today = renderTodayReasonV3(plan);
  if (text.includes(today) || isTooSimilar(today, text, 0.82)) {
    const alternate = renderAlternateDetail(plan.facts, insights);
    return ensureCopy(alternate, () => renderFallbackDetail(plan.facts));
  }
  return ensureCopy(text, () => renderFallbackDetail(plan.facts));
}

function renderStylistFallbackCopyV3(planOrFacts, options = {}) {
  const plan = planOrFacts && planOrFacts.facts ? planOrFacts : {
    facts: planOrFacts,
    primaryInsight: buildFallbackInsight(planOrFacts),
    detailInsights: [],
    batchIndex: 0,
  };
  const facts = plan.facts;
  const pattern = findInsight([plan.primaryInsight, ...plan.detailInsights], 'PATTERN_FOCUS_WITH_SIMPLE_BOTTOM');
  if (pattern) {
    return {
      overallComment: ensureCopy('这套整体偏轻松活泼。上衣和运动鞋都有一点存在感，浅色下装把它们稳住了，所以看起来有重点但不会太满。', () => renderBasicStylistCopy(facts, plan.primaryInsight).overallComment),
      advice: ensureCopy('想让整体更清爽，可以让鞋子或配饰只保留一个明显的色彩重点。', () => renderBasicStylistCopy(facts, plan.primaryInsight).advice),
      reviewVersion: 'stylist-explanation-v3',
      promptVersion: 'stylist-prompt-v3',
      copyPolicyVersion: 'human-copy-v1',
    };
  }
  const copy = renderBasicStylistCopy(facts, plan.primaryInsight);
  if (options.reasoning && isTooSimilar(copy.overallComment, options.reasoning)) {
    return {
      overallComment: ensureCopy(`整体偏${styleMood(facts)}，单品之间没有明显冲突。`, () => '整体偏轻松日常，适合不需要太正式的场合。'),
      advice: copy.advice,
      reviewVersion: 'stylist-explanation-v3',
      promptVersion: 'stylist-prompt-v3',
      copyPolicyVersion: 'human-copy-v1',
    };
  }
  return {
    ...copy,
    reviewVersion: 'stylist-explanation-v3',
    promptVersion: 'stylist-prompt-v3',
    copyPolicyVersion: 'human-copy-v1',
  };
}

function deriveDisplayTagsV3(facts = {}) {
  const tags = [];
  const items = Array.isArray(facts.items) ? facts.items : [];
  for (const tag of uniqueStrings(items.flatMap((item) => item.styleTags))) {
    if (STYLE_ALLOWLIST.includes(tag)) tags.push(tag);
  }
  for (const item of items) {
    const patternTag = PATTERN_TAGS[String(item.patternType || '').toLowerCase()];
    if (patternTag) tags.push(patternTag);
  }
  for (const item of items) {
    const fitTag = FIT_TAGS[String(item.fit || item.silhouette || '').toLowerCase()];
    if (fitTag) tags.push(fitTag);
  }
  const scene = facts.context?.scene;
  if (scene === '上班') tags.push('通勤');
  if (scene === '运动') tags.push('运动');
  return uniqueStrings(tags).filter((tag) => [
    ...STYLE_ALLOWLIST,
    '印花',
    '纯色',
    '条纹',
    '格纹',
    '宽松',
    '利落',
    '修身',
    '层次',
  ].includes(tag)).slice(0, 3);
}

function addPatternInsights(insights, items) {
  const patterned = items.filter((item) => isPatterned(item.patternType));
  if (patterned.length >= 2) {
    insights.push(insight('PATTERN_COMPETITION', 'pattern', 2, patterned.map((item) => item.slot), { patternedItems: patterned.map(toFactRef) }));
    return;
  }
  if (patterned.length === 1) {
    const patternItem = patterned[0];
    const solidItems = items.filter((item) => item.id !== patternItem.id && isSimplePattern(item.patternType));
    if (solidItems.length > 0) {
      insights.push(insight('PATTERN_FOCUS_WITH_SIMPLE_BOTTOM', 'pattern', 3, [patternItem.slot, ...solidItems.map((item) => item.slot)], {
        patternItem: toFactRef(patternItem),
        supportItems: solidItems.map(toFactRef),
      }));
    }
    insights.push(insight('PATTERN_SINGLE_FOCUS', 'pattern', 2, [patternItem.slot], { patternItem: toFactRef(patternItem) }));
  }
}

function addColorInsights(insights, items) {
  const colors = uniqueStrings(items.flatMap((item) => item.colors));
  if (colors.length === 0) return;
  const lightCount = colors.filter(isLightColor).length;
  const neutralCount = colors.filter(isNeutralColor).length;
  const accentColors = colors.filter((color) => !isNeutralColor(color));
  if (colors.length >= 3 && accentColors.length >= 3) {
    insights.push(insight('COLOR_TOO_MANY_COMPETING_ACCENTS', 'color', 1, items.map((item) => item.slot), { colors }));
  }
  if (colors.length >= 2 && lightCount === colors.length) {
    insights.push(insight('COLOR_SOFT_HARMONY', 'color', 3, items.map((item) => item.slot), { colors }));
  }
  if (neutralCount >= 2 && lightCount >= 1) {
    insights.push(insight('COLOR_LIGHT_NEUTRAL_BALANCE', 'color', 3, items.map((item) => item.slot), { colors }));
  }
  if (neutralCount >= 1 && accentColors.length === 1) {
    insights.push(insight('COLOR_NEUTRAL_BALANCES_ACCENT', 'color', 3, items.map((item) => item.slot), { colors, accentColor: accentColors[0] }));
  }
  if (colors.some(isDarkColor) && colors.some(isLightColor)) {
    insights.push(insight('COLOR_CLEAR_LIGHT_DARK_CONTRAST', 'color', 2, items.map((item) => item.slot), { colors }));
  }
  if (accentColors.length === 1) {
    insights.push(insight('COLOR_SINGLE_ACCENT', 'color', 2, items.map((item) => item.slot), { colors, accentColor: accentColors[0] }));
  }
}

function addSilhouetteInsights(insights, items) {
  const top = findSlot(items, 'top') || findSlot(items, 'outerwear');
  const bottom = findSlot(items, 'bottom') || findSlot(items, 'skirt');
  if (!top || !bottom) return;
  if (isRelaxed(top.fit || top.silhouette) && isClean(bottom.fit || bottom.silhouette)) {
    insights.push(insight('SILHOUETTE_TOP_RELAXED_BOTTOM_CLEAN', 'silhouette', 3, [top.slot, bottom.slot], { top: toFactRef(top), bottom: toFactRef(bottom) }));
  }
  if (isRelaxed(top.fit || top.silhouette) && isRelaxed(bottom.fit || bottom.silhouette)) {
    insights.push(insight('SILHOUETTE_RELAXED_BALANCE', 'silhouette', 2, [top.slot, bottom.slot], { top: toFactRef(top), bottom: toFactRef(bottom) }));
  }
  if (isClean(top.fit || top.silhouette) && isClean(bottom.fit || bottom.silhouette)) {
    insights.push(insight('SILHOUETTE_UNIFIED', 'silhouette', 2, [top.slot, bottom.slot], { top: toFactRef(top), bottom: toFactRef(bottom) }));
  }
  if (isShort(top.length) && isLong(bottom.length)) {
    insights.push(insight('PROPORTION_SHORT_TOP_LONG_BOTTOM', 'proportion', 3, [top.slot, bottom.slot], { top: toFactRef(top), bottom: toFactRef(bottom) }));
  } else if (top.length && bottom.length) {
    insights.push(insight('PROPORTION_LAYERED_BALANCE', 'proportion', 2, [top.slot, bottom.slot], { top: toFactRef(top), bottom: toFactRef(bottom) }));
  }
}

function addFormalityInsights(insights, items) {
  const levels = items.map((item) => item.formalityLevel).filter(Number.isFinite);
  if (levels.length < 2) return;
  const max = Math.max(...levels);
  const min = Math.min(...levels);
  if (max - min <= 1) insights.push(insight('FORMALITY_ALIGNED', 'formality', 3, items.map((item) => item.slot), { levels }));
  if (max <= 2) insights.push(insight('FORMALITY_CASUAL_BALANCE', 'formality', 2, items.map((item) => item.slot), { levels }));
  if (max >= 3 && min <= 1) insights.push(insight('FORMALITY_SOFTENED_BY_CASUAL_ITEM', 'formality', 3, items.map((item) => item.slot), { levels }));
  if (max - min >= 3) insights.push(insight('FORMALITY_CONFLICT', 'formality', 2, items.map((item) => item.slot), { levels }));
}

function addDetailInsights(insights, items) {
  const detailed = items.filter((item) => item.designElements.length > 0);
  if (detailed.length === 1) insights.push(insight('DETAIL_SINGLE_FOCUS', 'detail', 2, [detailed[0].slot], { item: toFactRef(detailed[0]), details: detailed[0].designElements }));
  if (detailed.length === 2) insights.push(insight('DETAIL_BALANCED', 'detail', 1, detailed.map((item) => item.slot), { items: detailed.map(toFactRef) }));
  if (detailed.length > 2) insights.push(insight('DETAIL_COMPETITION', 'detail', 1, detailed.map((item) => item.slot), { items: detailed.map(toFactRef) }));
}

function addStyleInsights(insights, items) {
  const tags = uniqueStrings(items.flatMap((item) => item.styleTags));
  const casualCount = tags.filter((tag) => ['休闲', '运动'].includes(tag)).length;
  for (const tag of tags) {
    const count = items.filter((item) => item.styleTags.includes(tag)).length;
    if (count >= 2) insights.push(insight('STYLE_COHERENT', 'style', 2, items.filter((item) => item.styleTags.includes(tag)).map((item) => item.slot), { style: tag }));
  }
  if (casualCount > 0 || items.some((item) => /T恤|卫衣|牛仔|短裤|运动鞋/.test(item.name))) {
    insights.push(insight('STYLE_CASUAL_EASY', 'style', 2, items.map((item) => item.slot), { styles: tags }));
  }
}

function addSceneInsights(insights, facts, items) {
  const scene = facts.context?.scene;
  if (scene === '居家') insights.push(insight('SCENE_HOME_EASY', 'scene', 1, items.map((item) => item.slot), { scene }));
  if (scene === '上班') insights.push(insight('SCENE_WORK_CLEAN', 'scene', 1, items.map((item) => item.slot), { scene }));
  if (scene === '约会') insights.push(insight('SCENE_DATE_SOFT', 'scene', 1, items.map((item) => item.slot), { scene }));
  if (scene === '运动') insights.push(insight('SCENE_SPORT_ACTIVE', 'scene', 1, items.map((item) => item.slot), { scene }));
}

function addWeatherInsights(insights, facts, items) {
  const band = facts.context?.temperatureBand;
  if (!band) return;
  const weatherItems = items.filter((item) => item.thickness || item.material);
  if (band === 'mild') insights.push(insight('WEATHER_MILD_COMFORT', 'weather', weatherItems.length ? 2 : 1, weatherItems.map((item) => item.slot), { band }));
  if (weatherItems.length >= 2) insights.push(insight('WEATHER_THICKNESS_MATCH', 'weather', 1, weatherItems.map((item) => item.slot), { band }));
  if (['cool', 'cold'].includes(band) && weatherItems.length > 0) insights.push(insight('WEATHER_LAYERING_MATCH', 'weather', 1, weatherItems.map((item) => item.slot), { band }));
}

function renderTodayByInsight(plan, insightEntry, family) {
  const facts = plan.facts;
  const top = findSlot(facts.items, 'top') || facts.items[0];
  const bottom = findSlot(facts.items, 'bottom') || findSlot(facts.items, 'skirt');
  const shoes = findSlot(facts.items, 'shoes');
  const colors = uniqueStrings(facts.items.flatMap((item) => item.colors));
  const code = insightEntry.code;
  if (code === 'PATTERN_FOCUS_WITH_SIMPLE_BOTTOM') {
    const support = [bottom && lightItemLabel(bottom), shoes && itemKind(shoes)].filter(Boolean).join('和');
    return family === 'focus'
      ? `${patternTopLabel(top)}做主角，${support || '基础单品'}让整体轻松但不杂乱。`
      : `${patternTopLabel(top)}先抓住视线，${support || '其它单品'}负责把整体稳住。`;
  }
  if (code === 'PATTERN_COMPETITION') return `${itemKind(top)}和${itemKind(bottom)}都很醒目，搭在一起时视觉重点会比较多。`;
  if (code === 'COLOR_NEUTRAL_BALANCES_ACCENT') return `${neutralColorName(colors)}${itemKind(top)}把${accentColorName(colors)}${itemKind(shoes || bottom)}稳住，亮色有存在感但不会抢得太满。`;
  if (code === 'COLOR_SOFT_HARMONY') return `${colors.slice(0, 2).join('和')}放在一起很柔和，整体显得轻快又干净。`;
  if (code === 'COLOR_LIGHT_NEUTRAL_BALANCE') return `${itemLabel(top)}和${itemLabel(bottom)}都很克制，整体看起来干净稳定。`;
  if (code === 'COLOR_CLEAR_LIGHT_DARK_CONTRAST') return `${colors.find(isLightColor) || '浅色'}和${colors.find(isDarkColor) || '深色'}分区明确，整体层次直接不含糊。`;
  if (code === 'SILHOUETTE_TOP_RELAXED_BOTTOM_CLEAN') return `${itemLabel(top)}配${itemLabel(bottom)}，上半身轻松，下半身把线条收住。`;
  if (code === 'PROPORTION_SHORT_TOP_LONG_BOTTOM') return `${itemLabel(top)}和${itemLabel(bottom)}形成清楚的长短关系，整体比例更有秩序。`;
  if (code === 'FORMALITY_SOFTENED_BY_CASUAL_ITEM') return `${itemLabel(top)}偏正式，${itemKind(shoes)}把整体拉回更轻松的日常感。`;
  if (code === 'FORMALITY_ALIGNED') return `${itemLabel(top)}和${itemLabel(bottom)}正式度接近，${scenePhrase(facts)}看起来稳定利落。`;
  if (code === 'DETAIL_SINGLE_FOCUS') return `${itemLabel(top)}带来细节重点，${itemLabel(bottom)}让整体保持安静。`;
  if (code === 'STYLE_COHERENT') return `${itemLabel(top)}和${itemLabel(bottom)}风格一致，整体方向很稳定。`;
  if (code === 'STYLE_CASUAL_EASY') return `${itemLabel(top)}配${itemLabel(bottom)}，整体是很直接的轻松日常感。`;
  if (code === 'SCENE_HOME_EASY') return `${itemLabel(top)}和${itemLabel(bottom)}组合简单，居家场景里不会显得过分正式。`;
  if (code === 'SCENE_WORK_CLEAN') return `${itemLabel(top)}和${itemLabel(bottom)}放在一起，通勤时更干净利落。`;
  if (code === 'SCENE_DATE_SOFT') return `${colors.slice(0, 2).join('和') || '柔和颜色'}放在一起，约会场景里看起来温和自然。`;
  if (code === 'SCENE_SPORT_ACTIVE') return `${itemLabel(top)}和${itemLabel(bottom)}风格一致，整体就是轻松好活动的方向。`;
  if (code === 'WEATHER_MILD_COMFORT') return `${itemLabel(top)}和${itemLabel(bottom)}厚薄不重，二十多度穿起来更轻松。`;
  return renderFallbackToday(facts, plan.batchIndex);
}

function renderDetailByInsights(facts, insights) {
  const codes = insights.map((entry) => entry.code);
  const top = findSlot(facts.items, 'top') || facts.items[0];
  const bottom = findSlot(facts.items, 'bottom') || findSlot(facts.items, 'skirt');
  const shoes = findSlot(facts.items, 'shoes');
  const colors = uniqueStrings(facts.items.flatMap((item) => item.colors));
  if (codes.includes('PATTERN_FOCUS_WITH_SIMPLE_BOTTOM')) {
    return `${patternTopLabel(top)}是整套最明显的视觉重点，${lightItemLabel(bottom)}没有再增加复杂元素，所以层次比较清楚。${shoes ? `${itemKind(shoes)}延续了休闲感，` : ''}${facts.context.scene === '居家' ? '居家穿或临时出门都比较自然。' : '日常穿也比较自然。'}`;
  }
  if (codes.includes('PATTERN_COMPETITION')) {
    return `${itemLabel(top)}和${itemLabel(bottom)}都带图案，两个重点同时出现时会更热闹。颜色保持在${colors.slice(0, 2).join('和') || '相近范围'}内，能稍微减轻这种复杂感。`;
  }
  if (codes.includes('SILHOUETTE_TOP_RELAXED_BOTTOM_CLEAN')) {
    return `${itemLabel(top)}带来放松感，${itemLabel(bottom)}把下半身线条整理得更清楚，所以整体不会显得松散。${primaryColor(bottom) || '下装'}也能压住上衣的轻快感。`;
  }
  if (codes.includes('PROPORTION_SHORT_TOP_LONG_BOTTOM')) {
    return `${itemLabel(top)}把上半身留得轻一些，${itemLabel(bottom)}负责拉出主要纵向线条，两件放在一起比例关系很直接。${colors.slice(0, 2).join('和') || '上下颜色'}也让分区更明确。`;
  }
  if (codes.includes('FORMALITY_SOFTENED_BY_CASUAL_ITEM')) {
    return `${itemLabel(top)}本身更利落，${itemLabel(shoes)}降低了整套的正式感，所以不会太严肃。${colors.slice(0, 2).join('和') || '基础配色'}也比较基础，能让这种混搭更稳。`;
  }
  if (codes.includes('FORMALITY_ALIGNED') || codes.includes('STYLE_COHERENT')) {
    return `${itemLabel(top)}和${itemLabel(bottom)}的正式度接近，风格也落在同一方向，组合起来比较稳。${colors.length ? `${colors.slice(0, 2).join('和')}不跳，` : ''}${scenePhrase(facts)}也自然。`;
  }
  if (codes.includes('COLOR_SOFT_HARMONY')) {
    return `${itemLabel(top)}和${itemLabel(bottom)}都属于浅色，视觉重量接近，组合起来会比较柔和。两件单品也没有复杂图案，整体层次安静清楚。`;
  }
  if (codes.includes('COLOR_NEUTRAL_BALANCES_ACCENT')) {
    return `${neutralColorName(colors)}${itemKind(top)}可以承接${accentColorName(colors)}${itemKind(shoes || bottom)}的亮点，让色彩重点更集中。两件都没有复杂图案，整体不会显得杂乱。`;
  }
  if (codes.includes('DETAIL_SINGLE_FOCUS')) {
    return `${itemLabel(top)}有小面积细节，${itemLabel(bottom)}没有再增加复杂元素，所以重点集中。${codes.includes('PROPORTION_SHORT_TOP_LONG_BOTTOM') ? '短上衣和长下装也形成长短层次，整体关系比较清楚。' : '其它单品保持简单，整体关系比较清楚。'}`;
  }
  if (codes.includes('SCENE_HOME_EASY') || codes.includes('STYLE_CASUAL_EASY')) {
    return `${itemLabel(top)}和${itemLabel(bottom)}都是基础单品，搭在一起不会有明显冲突。${colors.length ? `颜色以${colors.slice(0, 2).join('和')}为主，` : ''}适合不需要太正式的场合。`;
  }
  return renderFallbackDetail(facts);
}

function renderAlternateDetail(facts, insights) {
  const withoutPrimary = insights.slice(1);
  if (withoutPrimary.length > 0) {
    return renderDetailByInsights(facts, withoutPrimary);
  }
  return renderFallbackDetail(facts);
}

function renderBasicStylistCopy(facts, primaryInsight) {
  const top = findSlot(facts.items, 'top') || facts.items[0];
  const bottom = findSlot(facts.items, 'bottom') || findSlot(facts.items, 'skirt');
  const code = primaryInsight?.code || '';
  if (code.includes('FORMALITY')) {
    return {
      overallComment: ensureCopy(`整体偏${facts.context?.scene === '上班' ? '通勤利落' : '稳定日常'}，单品之间的正式感比较接近。`, () => '整体偏轻松日常，适合不需要太正式的场合。'),
      advice: ensureCopy('想更轻松，可以把鞋包换成更简洁的浅色款式。', () => '想更完整，可以让鞋子或配饰延续其中一个主色。'),
    };
  }
  if (code.includes('COLOR')) {
    return {
      overallComment: ensureCopy('整体有清楚的色彩重点，基础颜色负责让它更稳。', () => '整体偏轻松日常，适合不需要太正式的场合。'),
      advice: ensureCopy('想更统一，可以让包或配饰呼应其中一个主色。', () => '想更完整，可以让鞋子或配饰延续其中一个主色。'),
    };
  }
  if (code.includes('SILHOUETTE') || code.includes('PROPORTION')) {
    return {
      overallComment: ensureCopy(`整体比较有秩序，${itemKind(top)}和${itemKind(bottom)}的关系是主要特点。`, () => '整体偏轻松日常，适合不需要太正式的场合。'),
      advice: ensureCopy('想保持这种感觉，可以让外层不要打乱上下单品的分界。', () => '想更完整，可以让鞋子或配饰延续其中一个主色。'),
    };
  }
  return {
    overallComment: ensureCopy(`整体偏${styleMood(facts)}，单品之间没有明显冲突。`, () => '整体偏轻松日常，适合不需要太正式的场合。'),
    advice: ensureCopy('想更完整，可以让鞋子或配饰延续其中一个主色。', () => '想更完整，可以让鞋子或配饰延续其中一个主色。'),
  };
}

function choosePrimaryInsight(insights, state) {
  return insights.find((item) => item.dimension !== 'weather' && item.dimension !== 'scene' && !state.usedCodes.has(item.code))
    || insights.find((item) => item.dimension !== 'weather' && item.dimension !== 'scene' && !state.usedDimensions.has(item.dimension))
    || insights.find((item) => item.dimension === 'scene' && state.scenePrimaryCount < 1 && !state.usedCodes.has(item.code))
    || insights.find((item) => item.dimension === 'weather' && state.weatherPrimaryCount < 1 && !state.usedCodes.has(item.code))
    || insights.find((item) => item.dimension !== 'weather' && item.dimension !== 'scene')
    || insights[0]
    || null;
}

function chooseDetailInsights(insights, primary) {
  const selected = [];
  for (const item of insights) {
    if (selected.length >= 2) break;
    if (item.code === primary.code || item.dimension === primary.dimension) continue;
    selected.push(item);
  }
  for (const item of insights) {
    if (selected.length >= 2) break;
    if (item.code === primary.code || selected.some((entry) => entry.code === item.code)) continue;
    selected.push(item);
  }
  return selected;
}

function ensureUniquePlanReason(plan, usedReasons) {
  const families = ['focus', 'balance', 'shape', 'color', 'item', 'scene', 'plain', 'soft', 'clean', 'easy'];
  for (const family of families) {
    const candidate = { ...plan, sentenceFamily: family };
    const reason = renderTodayReasonV3(candidate);
    if (!usedReasons.has(reason)) return candidate;
  }
  for (const insightEntry of plan.insights) {
    const candidate = { ...plan, primaryInsight: insightEntry, sentenceFamily: 'item' };
    const reason = renderTodayReasonV3(candidate);
    if (!usedReasons.has(reason)) return candidate;
  }
  return {
    ...plan,
    sentenceFamily: 'plain',
    primaryInsight: buildIndexedFallbackInsight(plan.facts, plan.batchIndex),
  };
}

function chooseSentenceFamily(insightEntry, usedFamilies, index) {
  const familiesByDimension = {
    pattern: ['focus', 'balance', 'item'],
    color: ['color', 'soft', 'clean'],
    silhouette: ['shape', 'clean', 'balance'],
    proportion: ['shape', 'balance', 'clean'],
    formality: ['clean', 'easy', 'balance'],
    style: ['easy', 'plain', 'item'],
    scene: ['scene', 'easy', 'plain'],
    weather: ['plain', 'easy', 'scene'],
    detail: ['focus', 'item', 'clean'],
  };
  const families = familiesByDimension[insightEntry.dimension] || ['plain'];
  return families.find((family) => !usedFamilies.has(family)) || families[index % families.length] || 'plain';
}

function buildFallbackInsight(facts = {}) {
  return insight('STYLE_CASUAL_EASY', 'style', 1, (facts.items || []).map((item) => item.slot), {});
}

function buildIndexedFallbackInsight(facts = {}, index = 0) {
  const items = facts.items || [];
  const item = items[index % Math.max(items.length, 1)] || {};
  return insight(`ITEM_FACT_${item.slot || 'outfit'}_${index}`, 'style', 1, [item.slot || 'other'], { item: toFactRef(item) });
}

function renderFallbackToday(facts, index = 0) {
  const items = facts.items || [];
  const item = items[index % Math.max(items.length, 1)] || items[0] || {};
  const top = findSlot(items, 'top') || item;
  const bottom = findSlot(items, 'bottom') || findSlot(items, 'skirt');
  const templates = [
    `${itemLabel(top)}配${itemLabel(bottom)}，整体是很直接的轻松日常感。`,
    `${itemLabel(item)}是这组里最明确的单品，整体保持简单日常。`,
    `${itemLabel(top)}和${itemLabel(bottom)}组合简单，日常穿不会太复杂。`,
  ];
  return templates[index % templates.length];
}

function renderFallbackDetail(facts) {
  const items = facts.items || [];
  const top = findSlot(items, 'top') || items[0];
  const bottom = findSlot(items, 'bottom') || findSlot(items, 'skirt') || items[1];
  if (!top || !bottom) return '这组单品信息比较基础，能确认的是组合本身偏日常。整体适合不需要太正式的场合。';
  return `${itemLabel(top)}和${itemLabel(bottom)}都是基础单品，搭在一起不会有明显冲突。${facts.context?.scene ? `${facts.context.scene}场景里，` : ''}整体会偏轻松日常。`;
}

function insight(code, dimension, strength, subjectSlots, facts) {
  return {
    code,
    dimension,
    strength: Math.max(1, Math.min(3, Math.round(Number(strength) || 1))),
    polarity: code.includes('CONFLICT') || code.includes('COMPETITION') ? 'negative' : 'positive',
    subjectSlots: uniqueStrings(subjectSlots).sort(compareCategory),
    facts: facts || {},
  };
}

function normalizeItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item, index) => normalizeItem(item, index))
    .filter(Boolean)
    .sort((a, b) => {
      const categoryDiff = compareCategory(a.slot, b.slot);
      if (categoryDiff !== 0) return categoryDiff;
      return a.id.localeCompare(b.id);
    });
}

function normalizeItem(source, index) {
  if (!source || typeof source !== 'object') return null;
  const features = source.aestheticFeatures && typeof source.aestheticFeatures === 'object' ? source.aestheticFeatures : {};
  const confidence = normalizeConfidence(source.confidence ?? source.aiConfidence ?? source.recognitionConfidence);
  const advancedReliable = confidence === null || confidence >= 0.55;
  const slot = normalizeCategory(source.category || source.type);
  const colors = readColors(source);
  const patternType = advancedReliable ? normalizeKnown(features.patternType || source.patternType) : '';
  const fit = advancedReliable ? normalizeKnown(features.fit || source.fit) : '';
  const length = advancedReliable ? normalizeKnown(features.length || source.length) : '';
  const silhouette = advancedReliable ? normalizeKnown(features.silhouette || source.silhouette) : '';
  return {
    id: readString(source.clothingId || source.itemId || source.id || source._id) || `item-${index}`,
    slot,
    category: slot,
    subcategory: readString(source.subcategory || source.subCategory || source.type || source.name),
    name: readString(source.subcategory || source.subCategory || source.name || source.type || source.category) || defaultItemName(slot),
    colors,
    primaryColor: colors[0] || '',
    fit,
    length,
    silhouette,
    patternType,
    designElements: advancedReliable ? uniqueStrings([...(toArray(features.designElements)), ...(toArray(source.designElements))]).sort() : [],
    formalityLevel: advancedReliable ? normalizeFiniteNumber(features.formalityLevel ?? source.formalityLevel) : null,
    styleTags: uniqueStrings(toArray(source.styleTags || source.style)).filter((tag) => STYLE_ALLOWLIST.includes(tag) || ['印花'].includes(tag)).sort(),
    material: advancedReliable ? normalizeKnown(source.material || source.materialGuess) : '',
    thickness: advancedReliable ? normalizeKnown(source.thickness) : '',
    confidence,
  };
}

function readItems(source) {
  return source.items || source.itemsSnapshot || source.snapshotItems || [];
}

function readColors(source) {
  const colors = [];
  const palette = Array.isArray(source.colorPalette) ? source.colorPalette : [];
  for (const entry of palette) {
    const color = typeof entry === 'string' ? entry : readString(entry?.name || entry?.color);
    if (isKnown(color)) colors.push(color);
  }
  const fallback = readString(source.color);
  if (isKnown(fallback)) colors.push(fallback);
  return uniqueStrings(colors).sort();
}

function sanitizeScores(scores = {}) {
  return {
    weatherAdaptation: normalizeFiniteNumber(scores.weatherAdaptation),
    styleUnity: normalizeFiniteNumber(scores.styleUnity),
    freshness: normalizeFiniteNumber(scores.freshness),
    preference: normalizeFiniteNumber(scores.preference),
  };
}

function sanitizeAesthetic(value = {}) {
  return {
    score: value.score === null ? null : normalizeFiniteNumber(value.score),
    coverage: normalizeFiniteNumber(value.coverage) ?? 0,
    evidence: Array.isArray(value.evidence)
      ? value.evidence.map((entry) => ({
          code: readString(entry?.code),
          dimension: readString(entry?.dimension),
          polarity: readString(entry?.polarity),
          strength: Math.max(1, Math.min(3, Math.round(Number(entry?.strength) || 1))),
        })).filter((entry) => entry.code)
      : [],
  };
}

function ensureCopy(text, fallbackFactory) {
  const candidates = [text, typeof fallbackFactory === 'function' ? fallbackFactory() : '整体偏轻松日常，适合不需要太正式的场合。'];
  for (const candidate of candidates) {
    const clean = cleanText(candidate);
    if (!clean || findHumanCopyPolicyViolations(clean).length > 0 || hasRepeatedSentenceParts(clean)) continue;
    return clean;
  }
  return '整体偏轻松日常，适合不需要太正式的场合。';
}

function cleanText(value) {
  const text = readString(value).replace(/\s+/g, '');
  if (!text) return '';
  return /[。！？]$/.test(text) ? text : `${text}。`;
}

function compareInsights(a, b) {
  const priorityDiff = (DIMENSION_PRIORITY[a.dimension] ?? 99) - (DIMENSION_PRIORITY[b.dimension] ?? 99);
  if (priorityDiff !== 0) return priorityDiff;
  const strengthDiff = b.strength - a.strength;
  if (strengthDiff !== 0) return strengthDiff;
  return a.code.localeCompare(b.code);
}

function uniqueInsights(values) {
  const result = [];
  const seen = new Set();
  for (const value of values) {
    if (!value || !value.code || seen.has(value.code)) continue;
    seen.add(value.code);
    result.push(value);
  }
  return result;
}

function findInsight(insights, code) {
  return insights.find((entry) => entry && entry.code === code);
}

function findSlot(items, slot) {
  return (items || []).find((item) => item.slot === slot);
}

function toFactRef(item) {
  return item ? {
    slot: item.slot,
    name: item.name,
    colors: item.colors,
    patternType: item.patternType,
  } : {};
}

function itemLabel(item) {
  return item?.name || defaultItemName(item?.slot);
}

function itemKind(item) {
  if (!item) return '单品';
  if (item.slot === 'top') return /T恤|衬衫|卫衣|针织|上衣/.test(item.name) ? item.name : '上衣';
  if (item.slot === 'bottom') return /裤|裙|下装/.test(item.name) ? item.name : '下装';
  if (item.slot === 'shoes') return /运动鞋/.test(item.name) ? '运动鞋' : /鞋/.test(item.name) ? item.name : '鞋子';
  return item.name || defaultItemName(item.slot);
}

function patternTopLabel(item) {
  if (!item) return '印花上衣';
  if (/印花|图案|T恤|上衣/.test(item.name)) return item.name.replace('T恤', '上衣');
  return '印花上衣';
}

function lightItemLabel(item) {
  if (!item) return '浅色单品';
  if (item.colors.some(isLightColor)) return item.slot === 'bottom' ? '浅色下装' : `${primaryLightName(item)}${itemKind(item)}`;
  return itemLabel(item);
}

function primaryLightName(item) {
  const color = item.colors.find(isLightColor) || item.primaryColor || '';
  if (/灰白|浅灰|白|米/.test(color)) return '浅色';
  return color;
}

function primaryColor(item) {
  return item?.primaryColor || item?.colors?.[0] || '';
}

function neutralColorName(colors) {
  return colors.find(isNeutralColor) || '中性色';
}

function accentColorName(colors) {
  return colors.find((color) => !isNeutralColor(color)) || colors[0] || '';
}

function scenePhrase(facts) {
  const scene = facts.context?.scene;
  if (scene === '上班') return '通勤时';
  if (scene === '居家') return '居家时';
  if (scene === '运动') return '运动时';
  if (scene === '约会') return '约会时';
  return '日常穿';
}

function styleMood(facts) {
  const tags = facts.outfit?.styleTags || [];
  if (tags.includes('通勤')) return '通勤利落';
  if (tags.includes('运动')) return '运动日常';
  if (tags.includes('优雅')) return '优雅安静';
  if (tags.includes('甜美')) return '温和柔和';
  return '轻松日常';
}

function defaultItemName(slot) {
  return {
    top: '上衣',
    bottom: '下装',
    skirt: '半裙',
    onepiece: '连衣裙',
    outerwear: '外套',
    shoes: '鞋子',
    accessory: '配饰',
  }[slot] || '单品';
}

function normalizeCategory(value) {
  const raw = readString(value).toLowerCase();
  if (CATEGORY_ORDER.includes(raw)) return raw;
  if (/top|shirt|tee|上衣|衬衫|T恤|卫衣|针织/.test(raw)) return 'top';
  if (/bottom|pants|trouser|jeans|下装|裤/.test(raw)) return 'bottom';
  if (/skirt|裙/.test(raw)) return 'skirt';
  if (/shoe|sneaker|鞋/.test(raw)) return 'shoes';
  if (/outer|coat|jacket|外套|西装/.test(raw)) return 'outerwear';
  return 'other';
}

function compareCategory(a, b) {
  return (CATEGORY_ORDER.indexOf(a) === -1 ? 99 : CATEGORY_ORDER.indexOf(a))
    - (CATEGORY_ORDER.indexOf(b) === -1 ? 99 : CATEGORY_ORDER.indexOf(b));
}

function normalizeScene(value) {
  const raw = readString(value);
  return SCENE_LABELS[raw.toLowerCase()] || raw;
}

function getTemperatureBand(weather) {
  const temp = normalizeFiniteNumber(weather?.temp ?? weather?.temperature);
  if (temp === null) return '';
  if (temp < 12) return 'cold';
  if (temp < 22) return 'cool';
  if (temp <= 28) return 'mild';
  return 'hot';
}

function getConditionBucket(weather) {
  const text = readString(weather?.conditionBucket || weather?.weather || weather?.condition).toLowerCase();
  if (/雨|rain/.test(text)) return 'rain';
  if (/雪|snow/.test(text)) return 'snow';
  if (/晴|sun|clear/.test(text)) return 'clear';
  if (/云|阴|cloud|overcast/.test(text)) return 'cloudy';
  return text ? 'other' : '';
}

function classifyColorFamily(color) {
  if (isLightColor(color)) return 'light';
  if (isDarkColor(color)) return 'dark';
  if (isNeutralColor(color)) return 'neutral';
  return 'accent';
}

function isLightColor(color) {
  return /白|米|浅|灰白|奶|杏|粉|cream|white|light|pink/i.test(color || '');
}

function isDarkColor(color) {
  return /黑|深|藏青|navy|black|dark/i.test(color || '');
}

function isNeutralColor(color) {
  return /黑|白|灰|米|卡其|棕|牛仔|beige|gray|grey|black|white|khaki|brown/i.test(color || '');
}

function isPatterned(value) {
  const text = readString(value).toLowerCase();
  return Boolean(text && !isSimplePattern(text));
}

function isSimplePattern(value) {
  const text = readString(value).toLowerCase();
  return !text || ['solid', 'plain', 'none', '纯色', '无'].includes(text);
}

function isRelaxed(value) {
  return /relaxed|loose|oversized|宽松/.test(readString(value).toLowerCase());
}

function isClean(value) {
  return /straight|clean|slim|regular|利落|直筒|修身/.test(readString(value).toLowerCase());
}

function isShort(value) {
  return /short|短/.test(readString(value).toLowerCase());
}

function isLong(value) {
  return /long|长/.test(readString(value).toLowerCase());
}

function normalizeKnown(value) {
  const text = readString(value);
  return isKnown(text) ? text : '';
}

function isKnown(value) {
  const text = readString(value).toLowerCase();
  return Boolean(text && !['unknown', 'null', 'undefined', 'none', '其他', '未知'].includes(text));
}

function normalizeConfidence(value) {
  if (value === undefined || value === null || value === '') return null;
  if (value === 'high') return 0.9;
  if (value === 'medium') return 0.7;
  if (value === 'low') return 0.3;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return number > 1 ? number / 100 : number;
}

function normalizeFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : null;
}

function readString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return value.split(/[,/，、\s]+/);
  return [];
}

function uniqueStrings(values) {
  const result = [];
  const seen = new Set();
  for (const value of values || []) {
    const text = readString(value);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

function stripNonFinite(value) {
  if (Array.isArray(value)) return value.map(stripNonFinite);
  if (!value || typeof value !== 'object') {
    return typeof value === 'number' && !Number.isFinite(value) ? null : value;
  }
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    const clean = stripNonFinite(entry);
    if (clean !== undefined) result[key] = clean;
  }
  return result;
}

module.exports = {
  RECOMMENDATION_REASON_VERSION_V3,
  compileRecommendationLanguageV3,
  deriveDisplayTagsV3,
  deriveOutfitInsightsV3,
  extractOutfitFactsV3,
  planBatchCopyV3,
  renderDetailReasoningV3,
  renderRecommendationCopyV3,
  renderStylistFallbackCopyV3,
  renderTodayReasonV3,
};
