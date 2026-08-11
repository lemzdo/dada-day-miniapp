const {
  XIAODA_PERSONA_CONTRACT,
  XIAODA_PERSONA_VERSION,
  inspectXiaodaPersonaCopy,
} = require('./xiaodaPersonaContract');

const XIAODA_STYLE_INSIGHT_VERSION = 'xiaoda-style-insight-v1';

const EFFECT_PROMISES = Object.freeze(XIAODA_PERSONA_CONTRACT.forbiddenClaims.slice());
const CORE_ROLES = new Set(['top', 'bottom', 'onepiece', 'outerwear', 'shoes']);
const GENERIC_SCENE_REASON_CODES = new Set([
  'HOME_V4_EVIDENCE_SUPPORTED',
  'WORK_V4_EVIDENCE_SUPPORTED',
  'DATE_V4_EVIDENCE_SUPPORTED',
  'SPORT_V4_EVIDENCE_SUPPORTED',
]);

const RELATION_INSIGHT_DEFINITIONS = Object.freeze({
  PATTERN_SOLID_BALANCE: definition('PATTERN_FOCUS_WITH_SIMPLE_SUPPORT', 'pattern_balance', 'pattern', 100, 3, 3, 3),
  PATTERN_SINGLE_FOCUS: definition('PATTERN_SINGLE_FOCUS', 'pattern_balance', 'pattern', 96, 3, 3, 3),
  DETAIL_SINGLE_FOCUS: definition('DESIGN_FOCUS_WITH_SIMPLE_SUPPORT', 'design_focus', 'detail', 94, 3, 3, 3),
  TOP_ACCENT_WITH_NEUTRAL_BOTTOM: definition('COLOR_FOCUS_WITH_NEUTRAL_SUPPORT', 'color_focal_support', 'color', 98, 3, 3, 3),
  COLOR_NEUTRAL_ACCENT: definition('COLOR_FOCUS_WITH_NEUTRAL_SUPPORT', 'color_focal_support', 'color', 70, 2, 2, 3),
  COLOR_ECHO_BOTTOM_SHOES: definition('BOTTOM_SHOE_COLOR_CONTINUITY', 'color_echo', 'color', 86, 2, 3, 3),
  COLOR_ECHO_TOP_SHOES: definition('TOP_SHOE_COLOR_ECHO', 'color_echo', 'color', 84, 2, 3, 3),
  COLOR_ECHO_ONEPIECE_SHOES: definition('ONEPIECE_SHOE_COLOR_ECHO', 'color_echo', 'color', 86, 2, 3, 3),
  SAME_COLOR_ALL_ROLES: definition('SAME_COLOR_WHOLE', 'color_unity', 'color', 78, 2, 2, 3),
  SAME_COLOR_TOP_BOTTOM: definition('SAME_COLOR_CORE', 'color_unity', 'color', 76, 2, 2, 3),
  COLOR_MONOCHROMATIC: definition('TONAL_COLOR_RELATION', 'color_unity', 'color', 74, 2, 2, 3),
  COLOR_ANALOGOUS: definition('NEARBY_COLOR_RELATION', 'nearby_color', 'color', 80, 2, 3, 3),
  COLOR_CONTROLLED_CONTRAST: definition('CONTROLLED_COLOR_CONTRAST', 'color_contrast', 'color', 72, 2, 2, 3),
  DISTINCT_TOP_BOTTOM_COLOR: definition('TWO_COLOR_CORE', 'color_contrast', 'color', 62, 2, 2, 3),
  NEUTRAL_COLOR_BRIDGE: definition('QUIET_NEUTRAL_BASE', 'neutral_support', 'color', 64, 2, 2, 3),
  SILHOUETTE_BALANCED_CONTRAST: definition('SILHOUETTE_TENSION_BALANCE', 'silhouette_balance', 'silhouette', 96, 3, 3, 3),
  SILHOUETTE_BALANCED_CONTINUITY: definition('SILHOUETTE_EASY_CONTINUITY', 'silhouette_continuity', 'silhouette', 68, 2, 2, 2),
  PROPORTION_CLEAR_LAYERING: definition('CLEAR_LENGTH_PROPORTION', 'proportion_relation', 'proportion', 92, 3, 3, 3),
  FORMALITY_ALIGNED: definition('FORMALITY_COHERENT', 'formality_relation', 'formality', 76, 2, 2, 3),
  FORMALITY_INTENTIONAL_MIX: definition('FORMALITY_SOFT_MIX', 'formality_mix', 'formality', 70, 2, 2, 3),
  STYLE_COHERENT: definition('STYLE_COHERENT', 'style_relation', 'style', 72, 2, 2, 3),
  STRUCTURE_ONEPIECE_OUTERWEAR: definition('ONEPIECE_LAYERING', 'layering_logic', 'structure', 90, 3, 3, 3),
  STRUCTURE_ONEPIECE_SHOES: definition('ONEPIECE_WITH_SHOES', 'onepiece_decision', 'structure', 84, 3, 2, 3),
  STRUCTURE_ONEPIECE_ONLY: definition('ONEPIECE_SETS_THE_LOOK', 'onepiece_decision', 'structure', 78, 2, 2, 3),
});

const SCENE_SPECIFIC_DEFINITIONS = Object.freeze([
  sceneDefinition(/^HOME_(?:HOT_)?(?:SLEEVELESS|SHORT_SLEEVE)_SHORTS$/, 'HOME_SHORT_EASY_SET', 'home_specific_value', 'activity', 70),
  sceneDefinition(/^(?:HOME_(?:SHORT_SLEEVE_)?LONG_PANTS|HOME_TOP_LONG_PANTS)$/, 'HOME_EASY_DAY_SET', 'home_specific_value', 'scene', 66),
  sceneDefinition(/^HOME_(?:LOOSE_TWO_PIECE|TSHIRT_LOOSE_PANTS|LOOSE_DRESS)$/, 'HOME_RELAXED_MOVEMENT', 'home_specific_value', 'silhouette', 74),
  sceneDefinition(/^WORK_SHIRT_STRAIGHT_PANTS$/, 'WORK_SHIRT_TROUSER_RELATION', 'work_specific_value', 'formality', 82),
  sceneDefinition(/^WORK_(?:SIMPLE_DRESS_SHOES|SIMPLE_TOP_PANTS_SHOES)$/, 'WORK_SIMPLE_POLISH', 'work_specific_value', 'style', 68),
  sceneDefinition(/^WORK_BASELINE_PRESENTABLE$/, 'WORK_DAILY_READY', 'work_specific_value', 'formality', 72),
  sceneDefinition(/^DATE_(?:PATTERN_TOP_SIMPLE_SUPPORT|PATTERN_DRESS_SIMPLE_SHOES)$/, 'DATE_CLEAR_FOCUS', 'date_specific_value', 'pattern', 84),
  sceneDefinition(/^DATE_BRIGHT_(?:TOP_BASIC_SUPPORT|SHOES_BASIC_CLOTHES)$/, 'COLOR_FOCUS_WITH_NEUTRAL_SUPPORT', 'color_focal_support', 'color', 90),
  sceneDefinition(/^DATE_(?:SIMPLE_DRESS_SHOES|SIMPLE_COMPLETE)$/, 'DATE_SIMPLE_ROOM', 'date_specific_value', 'style', 68),
  sceneDefinition(/^SPORT_COMPLETE_SET$/, 'SPORT_COMPLETE_RELATION', 'sport_specific_value', 'activity', 88),
  sceneDefinition(/^SPORT_(?:LIGHT_ACTIVITY_SET|DRESS_SHOES|HOT_SHORT_SLEEVE_SHORTS|COOL_LONG_SLEEVE_PANTS|NORMAL_TOP_PANTS_SHOES)$/, 'SPORT_LIGHT_ACTIVITY_RELATION', 'sport_specific_value', 'activity', 76),
]);

const AESTHETIC_INFERENCE_RULES = Object.freeze({
  CLEAR_FOCUS: Object.freeze({ label: '有重点', relationCodes: ['PATTERN_SOLID_BALANCE', 'PATTERN_SINGLE_FOCUS', 'DETAIL_SINGLE_FOCUS', 'TOP_ACCENT_WITH_NEUTRAL_BOTTOM', 'COLOR_NEUTRAL_ACCENT'] }),
  NOT_BUSY: Object.freeze({ label: '不会太乱', relationCodes: ['PATTERN_SOLID_BALANCE', 'PATTERN_SINGLE_FOCUS', 'DETAIL_SINGLE_FOCUS', 'TOP_ACCENT_WITH_NEUTRAL_BOTTOM', 'COLOR_NEUTRAL_ACCENT'] }),
  CLEAN: Object.freeze({ label: '清爽', relationCodes: ['TOP_ACCENT_WITH_NEUTRAL_BOTTOM', 'COLOR_NEUTRAL_ACCENT', 'COLOR_ECHO_BOTTOM_SHOES', 'SAME_COLOR_ALL_ROLES', 'SAME_COLOR_TOP_BOTTOM', 'COLOR_MONOCHROMATIC'] }),
  SIMPLE: Object.freeze({ label: '简洁', relationCodes: ['NEUTRAL_COLOR_BRIDGE', 'STYLE_COHERENT', 'STRUCTURE_ONEPIECE_ONLY', 'SIMPLE_EVERYDAY_COMBINATION'] }),
  SHARP: Object.freeze({ label: '利落', relationCodes: ['SILHOUETTE_BALANCED_CONTRAST', 'PROPORTION_CLEAR_LAYERING', 'FORMALITY_ALIGNED', 'WORK_SHIRT_STRAIGHT_PANTS'] }),
  APPROPRIATE: Object.freeze({ label: '得体', relationCodes: ['FORMALITY_ALIGNED', 'WORK_SHIRT_STRAIGHT_PANTS', 'WORK_SIMPLE_POLISH'] }),
  LAYERED: Object.freeze({ label: '有层次', relationCodes: ['PROPORTION_CLEAR_LAYERING', 'STRUCTURE_ONEPIECE_OUTERWEAR'] }),
  NATURAL: Object.freeze({ label: '自然', relationCodes: ['COLOR_ANALOGOUS', 'STYLE_COHERENT', 'FORMALITY_INTENTIONAL_MIX', 'SIMPLE_EVERYDAY_COMBINATION'] }),
  RESTRAINED: Object.freeze({ label: '不会太用力', relationCodes: ['FORMALITY_INTENTIONAL_MIX', 'DATE_SIMPLE_ROOM', 'QUIET_NEUTRAL_BASE'] }),
});

const XIAODA_STYLE_MESSAGE_DEFINITIONS = Object.freeze([
  ...uniqueDefinitions(Object.values(RELATION_INSIGHT_DEFINITIONS)),
  ...uniqueDefinitions(SCENE_SPECIFIC_DEFINITIONS),
  definition('SIMPLE_EVERYDAY_COMBINATION', 'simple_everyday', 'style', 50, 2, 2, 3),
].flatMap((entry) => [
  Object.freeze({
    id: todayTemplateId(entry.code),
    intent: entry.intent,
    decisionValue: entry.code === 'SIMPLE_EVERYDAY_COMBINATION'
      ? 'MEANINGFUL_SCENE_EVIDENCE'
      : 'MEANINGFUL_RELATION',
    incrementalInformation: true,
  }),
  Object.freeze({
    id: detailTemplateId(entry.code),
    intent: entry.intent,
    decisionValue: 'MEANINGFUL_RELATION',
    incrementalInformation: true,
  }),
]));

function buildXiaodaStyleInsight(model = {}) {
  const relations = Array.isArray(model.relations) ? model.relations : [];
  const candidates = relations
    .map((relation) => buildRelationInsight(model, relation))
    .filter(Boolean);
  const sceneCandidate = buildSceneSpecificInsight(model);
  if (sceneCandidate) candidates.push(sceneCandidate);
  const fallback = buildSimpleEverydayInsight(model);
  if (fallback) candidates.push(fallback);

  const ranked = dedupeInsights(candidates)
    .sort((left, right) => right.ranking.total - left.ranking.total
      || right.priority - left.priority
      || left.insightId.localeCompare(right.insightId));
  const primary = ranked[0] ? withRank(ranked[0], 'PRIMARY') : null;
  const secondary = ranked.slice(1, 3).map((entry) => withRank(entry, 'SECONDARY'));
  const optional = ranked.slice(3, 6).map((entry) => withRank(entry, 'OPTIONAL'));
  return {
    version: XIAODA_STYLE_INSIGHT_VERSION,
    personaVersion: XIAODA_PERSONA_VERSION,
    primary,
    secondary,
    optional,
    allowedAestheticInferences: primary?.allowedAestheticInferences || [],
    forbiddenClaims: EFFECT_PROMISES.slice(),
  };
}

function buildXiaodaTodayCandidates(model = {}) {
  const plan = buildXiaodaStyleInsight(model);
  const ranked = [plan.primary, ...plan.secondary]
    .filter(Boolean)
    .filter((insight, index) => index === 0 || insight.ranking.total >= (plan.primary?.ranking.total || 0) - 9);
  return ranked.map((insight) => {
    const text = stripTerminalPunctuation(realizeTodayInsight(model, insight));
    const persona = inspectXiaodaPersonaCopy(text);
    if (!text || !persona.passed) return null;
    return {
      candidateId: `xiaoda:${insight.insightId}`,
      templateId: todayTemplateId(insight.code),
      messageIntent: insight.intent,
      relationCode: insight.relationCode,
      dimension: insight.dimension,
      openingFamily: openingFamily(insight.code),
      endingFamily: endingFamily(insight.code),
      priority: insight.priority,
      text,
      subjectItemIds: insight.subjectItemIds.slice(),
      evidenceFactIds: insight.evidenceFactIds.slice(),
      authorizationIds: insight.authorizationIds.slice(),
      informationKey: `xiaoda:${insight.code}:${insight.relationCode}:${insight.subjectItemIds.join('|')}`,
      source: insight.source,
      valueAssessment: copyValueAssessment(insight),
      xiaodaStyleInsight: compactInsightPlan(plan, insight),
    };
  }).filter(Boolean);
}

function buildXiaodaDetailCandidate(model = {}, options = {}) {
  const plan = buildXiaodaStyleInsight(model);
  const ranked = [plan.primary, ...plan.secondary, ...plan.optional].filter(Boolean);
  const insight = ranked.find((entry) => options.insightCode && entry.code === options.insightCode)
    || ranked.find((entry) => options.relationCode && entry.relationCode === options.relationCode)
    || plan.primary;
  if (!insight) return null;
  const text = stripTerminalPunctuation(realizeDetailInsight(model, insight));
  const persona = inspectXiaodaPersonaCopy(text);
  if (!text || !persona.passed) return null;
  return {
    candidateId: `xiaoda-detail:${insight.insightId}`,
    templateId: detailTemplateId(insight.code),
    messageIntent: insight.intent,
    relationCode: insight.relationCode,
    dimension: insight.dimension,
    openingFamily: openingFamily(insight.code),
    endingFamily: 'deeper_same_view',
    priority: insight.priority,
    text,
    subjectItemIds: insight.subjectItemIds.slice(),
    evidenceFactIds: insight.evidenceFactIds.slice(),
    authorizationIds: insight.authorizationIds.slice(),
    informationKey: `xiaoda-detail:${insight.code}:${insight.relationCode}:${insight.subjectItemIds.join('|')}`,
    source: insight.source,
    valueAssessment: copyValueAssessment(insight),
    xiaodaStyleInsight: compactInsightPlan(plan, insight),
  };
}

function buildRelationInsight(model, relation = {}) {
  const definitionValue = RELATION_INSIGHT_DEFINITIONS[relation.relationCode];
  if (!definitionValue || relation.polarity === 'negative') return null;
  const subjectItemIds = normalizeRelationSubjectItemIds(model, relation, definitionValue);
  const evidenceFactIds = uniqueStrings(relation.evidenceFactIds);
  if (subjectItemIds.length === 0 || evidenceFactIds.length === 0) return null;
  const sceneRelevance = relationSceneRelevance(model.scene, relation.relationCode);
  const ranking = rankingAssessment({
    factAvailable: true,
    relationStrength: clampStrength(relation.strength || definitionValue.relationStrength),
    userValue: definitionValue.userValue,
    novelInformation: definitionValue.novelInformation,
    outfitSpecificity: Math.min(3, 1 + subjectItemIds.length),
    sceneRelevance,
    naturalExpressibility: definitionValue.naturalExpressibility,
  });
  const authorizationIds = relation.source === 'scene_evidence'
    ? [`eligibility:${readText(model?.qualification?.reasonCode)}`].filter(Boolean)
    : [];
  const narrative = buildInternalUnderstanding(model, definitionValue.code, relation);
  return {
    insightId: `${definitionValue.code}:${relation.relationCode}:${subjectItemIds.join('|')}`,
    code: definitionValue.code,
    intent: definitionValue.intent,
    dimension: definitionValue.dimension,
    relationCode: relation.relationCode,
    priority: definitionValue.priority,
    subjectItemIds,
    evidenceFactIds,
    authorizationIds,
    source: relation.source === 'scene_evidence' ? 'scene_specific_value' : 'style_insight',
    primaryObservation: narrative.primaryObservation,
    supportingRelation: narrative.supportingRelation,
    humanMeaning: narrative.humanMeaning,
    overallMeaning: narrative.overallMeaning,
    allowedAestheticInferences: authorizedInferences(relation.relationCode, evidenceFactIds),
    forbiddenClaims: EFFECT_PROMISES.slice(),
    ranking,
  };
}

function buildSceneSpecificInsight(model = {}) {
  const qualification = model.qualification || {};
  const reasonCode = readText(qualification.reasonCode);
  if (!reasonCode || GENERIC_SCENE_REASON_CODES.has(reasonCode)) return null;
  const sceneDefinitionValue = SCENE_SPECIFIC_DEFINITIONS.find((entry) => entry.reasonPattern.test(reasonCode));
  if (!sceneDefinitionValue) return null;
  const subjectItemIds = uniqueStrings(qualification.subjectItemIds);
  const evidenceFactIds = uniqueStrings(qualification.supportingFactIds);
  if (subjectItemIds.length === 0 || evidenceFactIds.length === 0) return null;
  const relation = {
    relationCode: reasonCode,
    subjectItemIds,
    evidenceFactIds,
    strength: 2,
    source: 'scene_evidence',
  };
  const base = buildRelationInsightWithDefinition(model, relation, sceneDefinitionValue);
  return base;
}

function buildRelationInsightWithDefinition(model, relation, definitionValue) {
  const subjectItemIds = uniqueStrings(relation.subjectItemIds);
  const evidenceFactIds = uniqueStrings(relation.evidenceFactIds);
  const ranking = rankingAssessment({
    factAvailable: true,
    relationStrength: 2,
    userValue: 2,
    novelInformation: 2,
    outfitSpecificity: Math.min(3, 1 + subjectItemIds.length),
    sceneRelevance: 3,
    naturalExpressibility: 3,
  });
  const narrative = buildInternalUnderstanding(model, definitionValue.code, relation);
  return {
    insightId: `${definitionValue.code}:${relation.relationCode}:${subjectItemIds.join('|')}`,
    code: definitionValue.code,
    intent: definitionValue.intent,
    dimension: definitionValue.dimension,
    relationCode: relation.relationCode,
    priority: definitionValue.priority,
    subjectItemIds,
    evidenceFactIds,
    authorizationIds: [`eligibility:${relation.relationCode}`],
    source: 'scene_specific_value',
    ...narrative,
    allowedAestheticInferences: authorizedInferences(relation.relationCode, evidenceFactIds),
    forbiddenClaims: EFFECT_PROMISES.slice(),
    ranking,
  };
}

function buildSimpleEverydayInsight(model = {}) {
  const items = coreItems(model);
  const qualification = model.qualification || {};
  const evidenceFactIds = uniqueStrings([
    ...uniqueStrings(qualification.supportingFactIds),
    ...items.flatMap((item) => uniqueStrings(item.authorizedFactIds)),
  ]);
  const subjectItemIds = uniqueStrings(items.map((item) => item.itemId));
  const hasSimpleShape = items.length === 1 || items.some((item) => item.role === 'onepiece')
    || (items.some((item) => item.role === 'top') && items.some((item) => item.role === 'bottom'));
  if (!hasSimpleShape || subjectItemIds.length === 0 || evidenceFactIds.length === 0) return null;
  const code = 'SIMPLE_EVERYDAY_COMBINATION';
  const ranking = rankingAssessment({
    factAvailable: true,
    relationStrength: 1,
    userValue: 2,
    novelInformation: 2,
    outfitSpecificity: 2,
    sceneRelevance: 1,
    naturalExpressibility: 3,
  });
  const relation = { relationCode: code, subjectItemIds, evidenceFactIds };
  const narrative = buildInternalUnderstanding(model, code, relation);
  return {
    insightId: `${code}:${subjectItemIds.join('|')}`,
    code,
    intent: 'simple_everyday',
    dimension: 'style',
    relationCode: code,
    priority: 50,
    subjectItemIds,
    evidenceFactIds,
    authorizationIds: readText(qualification.reasonCode)
      ? [`eligibility:${readText(qualification.reasonCode)}`]
      : [],
    source: 'honest_simple_fallback',
    ...narrative,
    allowedAestheticInferences: authorizedInferences(code, evidenceFactIds),
    forbiddenClaims: EFFECT_PROMISES.slice(),
    ranking,
  };
}

function realizeTodayInsight(model, insight) {
  const top = itemForRole(model, 'top');
  const bottom = itemForRole(model, 'bottom');
  const onepiece = itemForRole(model, 'onepiece');
  const outerwear = itemForRole(model, 'outerwear');
  const shoes = itemForRole(model, 'shoes');
  const focus = itemById(model, insight.subjectItemIds[0]) || top || onepiece;
  const support = itemById(model, insight.subjectItemIds[1])
    || [top, bottom, onepiece, shoes, outerwear].find((item) => item && item.itemId !== focus?.itemId);
  switch (insight.code) {
    case 'PATTERN_FOCUS_WITH_SIMPLE_SUPPORT':
    case 'PATTERN_SINGLE_FOCUS':
      if (focus?.role === 'onepiece') return `${bodyItem(focus)}本身已经很有内容了，${shoes ? `${plainLabel(shoes)}简单一点就够` : '其他地方不用再加第二种图案'}，整身有重点，也不会显得太杂`;
      return `${bodyItem(focus)}已经够有内容了，${support ? `${bodyItem(support)}简单一点刚刚好` : '其他地方保持简单就好'}，整身有重点，也不会显得太杂`;
    case 'DESIGN_FOCUS_WITH_SIMPLE_SUPPORT':
      return `${bodyItem(focus)}已经带了明显细节，${support ? `${bodyItem(support)}保持简单就够` : '其他地方不用再加设计感'}，重点清楚，整身也不会堆得太满`;
    case 'COLOR_FOCUS_WITH_NEUTRAL_SUPPORT':
      return `${bodyItem(focus)}的颜色更醒目，${support ? `${bodyItem(support)}简单一点正好` : '其他地方用中性色就好'}，主次已经够清楚，不必再添另一个亮色`;
    case 'BOTTOM_SHOE_COLOR_CONTINUITY':
      return `${plainLabel(bottom || focus)}和${plainLabel(shoes || support)}的颜色接得上，${richerUpper(top) ? `${bodyItem(top)}稍微有点内容也没关系` : '上身留一点变化就好'}，整身不会显得太杂`;
    case 'TOP_SHOE_COLOR_ECHO':
      return `${plainLabel(top || focus)}和${plainLabel(shoes || support)}用了同一个颜色，下装保留自己的颜色，搭配有照应又不会刻意凑成一身同色`;
    case 'ONEPIECE_SHOE_COLOR_ECHO':
      return `${bodyItem(onepiece || focus)}和${plainLabel(shoes || support)}用了同一个颜色，搭起来很干净，外层换个颜色也没关系`;
    case 'SAME_COLOR_WHOLE':
    case 'SAME_COLOR_CORE':
    case 'TONAL_COLOR_RELATION':
      return `${joinPlainItems(subjectItems(model, insight))}选了同一个颜色，主色已经很统一，其他位置换个中性色会更自然`;
    case 'NEARBY_COLOR_RELATION':
      return `${joinBodyItems(subjectItems(model, insight))}的颜色放在一起比较柔和，其他地方用中性色，整身会更自然`;
    case 'CONTROLLED_COLOR_CONTRAST':
      return `${joinBodyItems(subjectItems(model, insight))}的颜色已经有对比了，其他位置简单一点，整身会更清爽`;
    case 'TWO_COLOR_CORE':
      return `${plainLabel(top || focus)}和${plainLabel(bottom || support)}把颜色变化留在衣服上，其他位置简单一点就好`;
    case 'QUIET_NEUTRAL_BASE':
      return `${joinBodyItems(subjectItems(model, insight))}都比较安静，放在一起走简单路线，今天穿不用想太多`;
    case 'SILHOUETTE_TENSION_BALANCE':
      return renderSilhouetteToday(top, bottom);
    case 'SILHOUETTE_EASY_CONTINUITY':
      return `${bodyItem(top || focus)}和${bodyItem(bottom || support)}的线条都比较顺，穿起来自然，不需要再加复杂外层`;
    case 'CLEAR_LENGTH_PROPORTION':
      return `${bodyItem(top || focus)}短一点，${bodyItem(bottom || support)}长一点，穿起来的比例会更清楚，鞋子不用再做太多变化`;
    case 'FORMALITY_COHERENT':
      return `${joinBodyItems(subjectItems(model, insight))}的正式程度很接近，放在一起利落又得体，不用再把其他位置穿得很严肃`;
    case 'FORMALITY_SOFT_MIX':
      return `${joinBodyItems(subjectItems(model, insight))}一个稍正式、一个更日常，放在一起不会太端着，也不会显得随便`;
    case 'STYLE_COHERENT':
      return `${joinBodyItems(subjectItems(model, insight))}都是同一种日常感，穿起来很顺，其他地方不用再加太多装饰`;
    case 'ONEPIECE_LAYERING':
      return `${bodyItem(onepiece || focus)}先把整身定下来，${plainLabel(outerwear || support)}只是多加一层，进室内脱掉也不影响里面的搭配`;
    case 'ONEPIECE_WITH_SHOES':
    case 'ONEPIECE_SETS_THE_LOOK':
      return `${bodyItem(onepiece || focus)}本身已经把整身定下来了，${shoes ? `${plainLabel(shoes)}简单一点就够` : '其他地方不用再加太多东西'}`;
    case 'WORK_SHIRT_TROUSER_RELATION':
      return `${bodyItem(top)}和${bodyItem(bottom)}放在一起很利落，日常办公已经够得体，其他地方保持简单就好`;
    case 'WORK_SIMPLE_POLISH':
      return `${joinBodyItems(subjectItems(model, insight))}都不复杂，穿去上班会比较得体，保持现在的简洁就好`;
    case 'WORK_DAILY_READY':
      return renderWorkDailyToday(model, insight);
    case 'DATE_CLEAR_FOCUS':
      return `${bodyItem(focus)}已经是整身的重点，其他地方简单一点，日常约会这样更自然`;
    case 'DATE_SIMPLE_ROOM':
      return `${joinBodyItems(subjectItems(model, insight))}都比较简单，日常约会这样很自然，不需要再堆很多东西`;
    case 'SPORT_COMPLETE_RELATION':
      return `${sportItemSentence(top, bottom, shoes, insight, model)}，散步或快走时很省心，直接穿就行`;
    case 'SPORT_LIGHT_ACTIVITY_RELATION':
      return `${joinBodyItems(subjectItems(model, insight))}都是运动款，散步或快走时穿很合适，不需要再加复杂东西`;
    case 'HOME_SHORT_EASY_SET':
      return `在家穿${plainLabel(top)}和${plainLabel(bottom)}就够，省得再想外层，临时下楼也能直接沿用`;
    case 'HOME_EASY_DAY_SET':
      return `${bodyItem(top)}和${bodyItem(bottom)}先把日常这一身搭好，在家不用多想，临时下楼也不用重新换`;
    case 'HOME_RELAXED_MOVEMENT':
      return `${joinBodyItems(subjectItems(model, insight))}轮廓都留了些余量，在家不用再叠复杂外层，临时下楼也能接着穿`;
    case 'SIMPLE_EVERYDAY_COMBINATION':
      return renderSimpleToday(model);
    default:
      return renderSimpleToday(model);
  }
}

function realizeDetailInsight(model, insight) {
  const top = itemForRole(model, 'top');
  const bottom = itemForRole(model, 'bottom');
  const onepiece = itemForRole(model, 'onepiece');
  const outerwear = itemForRole(model, 'outerwear');
  const shoes = itemForRole(model, 'shoes');
  const focus = itemById(model, insight.subjectItemIds[0]) || top || onepiece;
  const support = itemById(model, insight.subjectItemIds[1])
    || [top, bottom, onepiece, shoes, outerwear].find((item) => item && item.itemId !== focus?.itemId);
  switch (insight.code) {
    case 'PATTERN_FOCUS_WITH_SIMPLE_SUPPORT':
    case 'PATTERN_SINGLE_FOCUS':
      return `${bodyItem(focus)}本身已经把重点放在上身，${support ? `${bodyItem(support)}没有再加第二种图案，正好给印花留了空间` : '其他地方不用再加第二种图案'}。再加外套或配饰时，别重复堆图案就好`;
    case 'DESIGN_FOCUS_WITH_SIMPLE_SUPPORT':
      return `${bodyItem(focus)}的细节已经够醒目，${support ? `${bodyItem(support)}保持简单，穿起来重点会更清楚` : '其他地方不用再加设计感'}。现在这样就够，不需要每件衣服都有细节`;
    case 'COLOR_FOCUS_WITH_NEUTRAL_SUPPORT':
      return `${bodyItem(focus)}已经是这身的颜色重点，${support ? `${bodyItem(support)}用安静的颜色托住它` : '其他地方保持简单'}。保留这一处颜色变化就好，不必再添第二个亮色`;
    case 'BOTTOM_SHOE_COLOR_CONTINUITY':
      return `${plainLabel(bottom || focus)}配${plainLabel(shoes || support)}，下半身看起来会很干净。上衣保留现在的变化就好，不用把每件都凑成同色`;
    case 'TOP_SHOE_COLOR_ECHO':
      return `${plainLabel(top || focus)}配${plainLabel(shoes || support)}，鞋子的颜色就不是孤零零出现的。下装保留不同颜色，整身有联系，但不会从头到脚都是同一种颜色`;
    case 'ONEPIECE_SHOE_COLOR_ECHO':
      return `${plainLabel(onepiece || focus)}和${plainLabel(shoes || support)}用了同一个颜色，裙子与鞋自然接得上。其他配件安静一点，就能保留现在的清爽感`;
    case 'SAME_COLOR_WHOLE':
    case 'SAME_COLOR_CORE':
    case 'TONAL_COLOR_RELATION':
      return `${joinPlainItems(subjectItems(model, insight))}都用了同一个颜色，穿起来干净，也省得再想配色。其他位置不用继续凑同色，留点变化会更自然`;
    case 'TWO_COLOR_CORE':
    case 'CONTROLLED_COLOR_CONTRAST':
      return `${plainLabel(top || focus)}和${plainLabel(bottom || support)}已经把颜色变化放在衣服上了。剩下的位置保持简单就好，不必再加入新的抢眼颜色`;
    case 'NEARBY_COLOR_RELATION':
      return `${joinPlainItems(subjectItems(model, insight))}的颜色靠得比较近，放在一起会更自然。其他地方用中性色，能让这种柔和变化更容易看出来`;
    case 'QUIET_NEUTRAL_BASE':
      return `${joinPlainItems(subjectItems(model, insight))}都属于安静的颜色，日常穿不会太用力。想留一点变化，只在其中一处加小细节就够`;
    case 'SILHOUETTE_TENSION_BALANCE':
      return `${bodyItem(top)}和${bodyItem(bottom)}一个收、一个松，穿起来会更利落。保持现在这样就好，不需要把上下都穿得很松或很紧`;
    case 'SILHOUETTE_EASY_CONTINUITY':
      return `${bodyItem(top || focus)}和${bodyItem(bottom || support)}的线条都比较顺，穿起来会自然一些。现在的松紧已经够用，不需要再加复杂变化`;
    case 'CLEAR_LENGTH_PROPORTION':
      return `${bodyItem(top || focus)}短一些，${bodyItem(bottom || support)}长一些，长短分工已经很明确。上短下长本身就有层次，今天不用再靠复杂外层增加变化`;
    case 'ONEPIECE_LAYERING':
      return `${bodyItem(onepiece || focus)}单穿就已经完整，${bodyItem(outerwear || support)}只是天气需要时多加一层。进室内脱掉外套，也不影响裙子本身的搭配`;
    case 'ONEPIECE_WITH_SHOES':
    case 'ONEPIECE_SETS_THE_LOOK':
      return `${bodyItem(onepiece || focus)}单穿已经很完整，${shoes ? `${bodyItem(shoes)}简单一点就好` : '其他位置也可以保持简单'}。不用再叠很多东西，裙子本身就够了`;
    case 'FORMALITY_COHERENT':
    case 'WORK_SHIRT_TROUSER_RELATION':
    case 'WORK_SIMPLE_POLISH':
    case 'WORK_DAILY_READY':
      return `${bodyItem(top || focus)}和${bodyItem(bottom || support)}都偏利落，日常办公已经够得体。现在的正式程度刚刚好，不需要再刻意穿得更严肃`;
    case 'SPORT_COMPLETE_RELATION':
    case 'SPORT_LIGHT_ACTIVITY_RELATION':
      return `${sportItemSentence(top, bottom, shoes, insight, model)}，衣服和鞋都选得对路。散步或快走直接穿就行，不用临时换鞋或换衣服`;
    case 'HOME_SHORT_EASY_SET':
    case 'HOME_EASY_DAY_SET':
    case 'HOME_RELAXED_MOVEMENT':
      return `${joinPlainItems(subjectItems(model, insight))}就是简单的日常组合，在家不用再考虑另一套。临时下楼也能接着穿，少做一次选择反而更省心`;
    case 'DATE_CLEAR_FOCUS':
    case 'DATE_SIMPLE_ROOM':
      return `${bodyItem(focus)}已经给了这身明确的重点，其他单品没有一起抢。日常约会保留这一处变化就好，不需要再加第二个重点`;
    case 'SIMPLE_EVERYDAY_COMBINATION':
      return `${top && bottom ? `${plainLabel(top)}和${plainLabel(bottom)}` : bodyItem(onepiece || focus)}都是日常衣服，这套本来就走简单路线。好处是省心，出门前不用反复换来换去`;
    default:
      return `${joinPlainItems(subjectItems(model, insight))}各有作用，又不会互相抢。保留现在的重点就够，额外的颜色和配件都可以少一点`;
  }
}

function buildInternalUnderstanding(model, code, relation) {
  const subjects = uniqueStrings(relation.subjectItemIds)
    .map((itemId) => itemById(model, itemId))
    .filter(Boolean);
  const first = subjects[0];
  const second = subjects[1];
  return {
    primaryObservation: first ? `${bodyItem(first)}承担这套最值得说明的部分` : '这套有明确的穿搭关系',
    supportingRelation: second ? `${bodyItem(second)}与它形成支撑关系` : '其他单品不需要抢同一个重点',
    humanMeaning: humanMeaningFor(code),
    overallMeaning: overallMeaningFor(code),
  };
}

function humanMeaningFor(code) {
  if (/PATTERN|DESIGN_FOCUS/.test(code)) return '有内容的单品旁边保持简单，重点才会清楚。';
  if (/COLOR_FOCUS/.test(code)) return '有存在感的颜色需要安静的单品托住。';
  if (/ECHO|SAME_COLOR|TONAL|NEARBY_COLOR/.test(code)) return '颜色之间有联系，但不需要每件都重复同一个颜色。';
  if (/SILHOUETTE|PROPORTION/.test(code)) return '上下身的松紧或长短各有分工，穿起来会更利落。';
  if (/ONEPIECE/.test(code)) return '连衣裙先把整身定下来，其他单品只做必要补充。';
  if (/FORMALITY|WORK_/.test(code)) return '正式程度接近，日常上班会更得体。';
  if (/SPORT_/.test(code)) return '衣服和鞋子的用途一致，轻活动时更顺手。';
  return '这套不需要硬讲设计概念，简单、日常就是它的价值。';
}

function overallMeaningFor(code) {
  if (/PATTERN|DESIGN_FOCUS|COLOR_FOCUS/.test(code)) return '整身有重点，但不会显得太满。';
  if (/ECHO|SAME_COLOR|TONAL|NEARBY_COLOR/.test(code)) return '整身颜色有联系，也保留了变化。';
  if (/SILHOUETTE|PROPORTION/.test(code)) return '整身线条和比例更清楚。';
  if (/ONEPIECE/.test(code)) return '整身完整，额外选择更少。';
  if (/FORMALITY|WORK_/.test(code)) return '整身利落、得体，不过分正式。';
  if (/SPORT_/.test(code)) return '整身用途一致，适合日常轻活动。';
  return '整身简单、自然，日常穿不用费心。';
}

function authorizedInferences(relationCode, evidenceFactIds) {
  return Object.entries(AESTHETIC_INFERENCE_RULES)
    .filter(([, rule]) => rule.relationCodes.includes(relationCode))
    .map(([code, rule]) => ({
      code,
      label: rule.label,
      authorizedBy: uniqueStrings(evidenceFactIds),
    }));
}

function rankingAssessment(input) {
  const result = {
    factAvailable: input.factAvailable === true,
    relationStrength: clampStrength(input.relationStrength),
    userValue: clampStrength(input.userValue),
    novelInformation: clampStrength(input.novelInformation),
    outfitSpecificity: clampStrength(input.outfitSpecificity),
    sceneRelevance: clampStrength(input.sceneRelevance),
    naturalExpressibility: clampStrength(input.naturalExpressibility),
  };
  result.total = Number(result.factAvailable) * 8
    + result.relationStrength * 4
    + result.userValue * 4
    + result.novelInformation * 3
    + result.outfitSpecificity * 3
    + result.sceneRelevance * 2
    + result.naturalExpressibility * 3;
  return result;
}

function copyValueAssessment(insight) {
  const userValue = clampStrength(insight.ranking.userValue);
  const novelInformation = clampStrength(insight.ranking.novelInformation);
  const sceneRelevance = Math.max(0, Math.min(3, Number(insight.ranking.sceneRelevance) || 0));
  const naturalExpressibility = clampStrength(insight.ranking.naturalExpressibility);
  return {
    factAvailable: true,
    userValue,
    novelInformation,
    sceneRelevance,
    naturalExpressibility,
    total: 2 + userValue + novelInformation + sceneRelevance + naturalExpressibility,
  };
}

function relationSceneRelevance(scene, relationCode) {
  const value = readText(scene);
  if (value === 'work' && /FORMALITY|STYLE|SILHOUETTE|PROPORTION/.test(relationCode)) return 3;
  if (value === 'date' && /PATTERN|DETAIL|COLOR/.test(relationCode)) return 3;
  if (value === 'sport' && /SILHOUETTE|PROPORTION|STYLE/.test(relationCode)) return 2;
  if (value === 'home' && /SILHOUETTE|STYLE|STRUCTURE/.test(relationCode)) return 2;
  return 1;
}

function compactInsightPlan(plan, primary) {
  return {
    version: plan.version,
    personaVersion: plan.personaVersion,
    primary: withRank(primary, 'PRIMARY'),
    secondary: plan.secondary.map((entry) => ({ ...entry })),
    optional: plan.optional.map((entry) => ({ ...entry })),
    allowedAestheticInferences: primary.allowedAestheticInferences.map((entry) => ({ ...entry, authorizedBy: entry.authorizedBy.slice() })),
    forbiddenClaims: plan.forbiddenClaims.slice(),
  };
}

function withRank(insight, rank) {
  return {
    ...insight,
    rank,
    subjectItemIds: insight.subjectItemIds.slice(),
    evidenceFactIds: insight.evidenceFactIds.slice(),
    authorizationIds: insight.authorizationIds.slice(),
    allowedAestheticInferences: insight.allowedAestheticInferences.map((entry) => ({ ...entry, authorizedBy: entry.authorizedBy.slice() })),
    forbiddenClaims: insight.forbiddenClaims.slice(),
    ranking: { ...insight.ranking },
  };
}

function renderSilhouetteToday(top, bottom) {
  const topFit = readText(top?.fit || top?.silhouette).toLowerCase();
  const bottomFit = readText(bottom?.fit || bottom?.silhouette).toLowerCase();
  const topLoose = /oversized|relaxed|loose|boxy|宽松/.test(topFit);
  const bottomLoose = /wideleg|flare|relaxed|loose|阔腿|宽松/.test(bottomFit);
  if (topLoose && !bottomLoose) {
    return `${bodyItem(top)}偏宽松，${bodyItem(bottom)}收得更利落，整套不会从上到下都松`;
  }
  if (!topLoose && bottomLoose) {
    return `${bodyItem(top)}比较收，${bodyItem(bottom)}放开一点，松紧有对比，穿起来会更利落`;
  }
  return `${bodyItem(top)}和${bodyItem(bottom)}一松一收，穿起来不会上下都挤在同一种线条里`;
}

function renderSimpleToday(model) {
  const top = itemForRole(model, 'top');
  const bottom = itemForRole(model, 'bottom');
  const onepiece = itemForRole(model, 'onepiece');
  if (top && bottom) return `${plainLabel(top)}和${plainLabel(bottom)}走的就是简单路线，不用想太多，今天穿很稳`;
  if (onepiece) return `${bodyItem(onepiece)}本身就够完整，其他地方简单一点，今天穿不用想太多`;
  const only = coreItems(model)[0];
  if (only) return `${bodyItem(only)}走的就是简单路线，今天穿不用想太多`;
  return '今天这身走的就是简单路线，不需要硬加搭配概念';
}

function renderWorkDailyToday(model, insight) {
  const top = itemForRole(model, 'top');
  const bottom = itemForRole(model, 'bottom');
  const shoes = itemForRole(model, 'shoes');
  if (!top || !bottom || !shoes) {
    const subjects = subjectItems(model, insight);
    return `${joinPlainItems(subjects)}放在一起够利落，日常去办公室不用再加复杂配件`;
  }
  const variant = stableBucket(insight.subjectItemIds, 3);
  if (variant === 0) {
    return `${bodyItem(top)}和${bodyItem(bottom)}把日常办公需要的利落感撑起来，${bodyItem(shoes)}保持简单就好`;
  }
  if (variant === 1) {
    return `日常上班穿${plainLabel(top)}、${plainLabel(bottom)}和${plainLabel(shoes)}，正式程度刚好，不会显得太严肃`;
  }
  return `${plainLabel(shoes)}接住${plainLabel(top)}和${plainLabel(bottom)}的日常感，这身去办公室够整齐，也不用再加复杂配件`;
}

function stableBucket(values, size) {
  const hash = uniqueStrings(values).join('|').split('')
    .reduce((total, character) => (total * 31 + character.charCodeAt(0)) >>> 0, 0);
  return hash % size;
}

function subjectItems(model, insight) {
  const ids = new Set(uniqueStrings(insight?.subjectItemIds));
  return coreItems(model).filter((item) => ids.has(item.itemId));
}

function coreItems(model) {
  return (Array.isArray(model?.items) ? model.items : []).filter((item) => item?.itemId && CORE_ROLES.has(item.role));
}

function itemForRole(model, role) {
  return (Array.isArray(model?.items) ? model.items : []).find((item) => item?.role === role);
}

function itemById(model, itemId) {
  return (Array.isArray(model?.items) ? model.items : []).find((item) => item?.itemId === itemId);
}

function bodyItem(item) {
  if (!item) return '这件单品';
  const label = plainLabel(item);
  if (item.role === 'top') return `这件${label}`;
  if (item.role === 'bottom') return `这条${label}`;
  if (item.role === 'onepiece') return `这条${label}`;
  if (item.role === 'outerwear') return `这件${label}`;
  if (item.role === 'shoes') return `这双${label}`;
  return `这件${label}`;
}

function sportItemSentence(top, bottom, shoes, insight, model) {
  const parts = [top, bottom, shoes].filter(Boolean).map(bodyItem);
  if (parts.length >= 2) {
    const rest = parts.slice(1);
    return `${parts[0]}搭上${rest.length === 1 ? rest[0] : `${rest.slice(0, -1).join('、')}和${rest.at(-1)}`}`;
  }
  return joinBodyItems(subjectItems(model, insight));
}

function plainLabel(item) {
  if (!item) return '单品';
  const name = readText(item.canonicalSubtype || item.canonicalName) || roleFallback(item.role);
  const color = readText(item.normalizedColor);
  return color && !name.includes(color) ? `${color}${name}` : name;
}

function richerUpper(item) {
  return Boolean(item && ((Array.isArray(item.visibleFeatureTags) && item.visibleFeatureTags.includes('印花'))
    || (item.normalizedColor && !isNeutralColor(item.normalizedColor))));
}

function normalizeRelationSubjectItemIds(model, relation, definitionValue) {
  const subjectItemIds = uniqueStrings(relation.subjectItemIds);
  if (definitionValue.code !== 'COLOR_FOCUS_WITH_NEUTRAL_SUPPORT') return subjectItemIds;
  const items = subjectItemIds
    .map((itemId) => itemById(model, itemId))
    .filter((item) => item && CORE_ROLES.has(item.role));
  const accent = items.find((item) => item.normalizedColor && !isNeutralColor(item.normalizedColor));
  const neutral = items.find((item) => item.normalizedColor && isNeutralColor(item.normalizedColor));
  if (!accent || !neutral) return [];
  return [accent.itemId, neutral.itemId];
}

function isNeutralColor(value) {
  return /黑|白|灰|藏青|米|棕|卡其|black|white|gray|grey|navy|beige|brown/i.test(readText(value));
}

function joinBodyItems(items) {
  const values = uniqueStrings((Array.isArray(items) ? items : []).map(bodyItem));
  if (values.length <= 1) return values[0] || '这套衣服';
  if (values.length === 2) return `${values[0]}和${values[1]}`;
  return `${values.slice(0, -1).join('、')}和${values.at(-1)}`;
}

function joinPlainItems(items) {
  const values = uniqueStrings((Array.isArray(items) ? items : []).map(plainLabel));
  if (values.length <= 1) return values[0] || '这些单品';
  if (values.length === 2) return `${values[0]}和${values[1]}`;
  return `${values.slice(0, -1).join('、')}和${values.at(-1)}`;
}

function roleFallback(role) {
  return { top: '上衣', bottom: '下装', onepiece: '连衣裙', outerwear: '外套', shoes: '鞋子' }[role] || '单品';
}

function openingFamily(code) {
  if (/PATTERN|DESIGN/.test(code)) return 'garment_focus';
  if (/COLOR/.test(code)) return 'color_relationship';
  if (/SILHOUETTE|PROPORTION/.test(code)) return 'wearing_proportion';
  if (/ONEPIECE/.test(code)) return 'onepiece_judgment';
  if (/WORK|FORMALITY/.test(code)) return 'scene_specific_judgment';
  return 'plain_judgment';
}

function endingFamily(code) {
  if (/PATTERN|DESIGN|COLOR_FOCUS/.test(code)) return 'clear_focus_result';
  if (/COLOR/.test(code)) return 'color_relationship_result';
  if (/SILHOUETTE|PROPORTION/.test(code)) return 'wearing_line_result';
  if (/ONEPIECE/.test(code)) return 'fewer_choices_result';
  return 'honest_daily_result';
}

function definition(code, intent, dimension, priority, userValue, novelInformation, naturalExpressibility) {
  return Object.freeze({
    code,
    intent,
    dimension,
    priority,
    relationStrength: priority >= 90 ? 3 : priority >= 70 ? 2 : 1,
    userValue,
    novelInformation,
    naturalExpressibility,
  });
}

function sceneDefinition(reasonPattern, code, intent, dimension, priority) {
  return Object.freeze({
    ...definition(code, intent, dimension, priority, 2, 2, 3),
    reasonPattern,
  });
}

function uniqueDefinitions(values) {
  const seen = new Set();
  return values.filter((entry) => {
    if (!entry || seen.has(entry.code)) return false;
    seen.add(entry.code);
    return true;
  });
}

function dedupeInsights(values) {
  const result = [];
  const seen = new Set();
  for (const value of values) {
    const key = `${value.code}|${value.subjectItemIds.join('|')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function todayTemplateId(code) {
  return `xiaoda.today.${String(code || '').toLowerCase().replace(/_/g, '-')}`;
}

function detailTemplateId(code) {
  return `xiaoda.detail.${String(code || '').toLowerCase().replace(/_/g, '-')}`;
}

function clampStrength(value) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return 1;
  return Math.max(1, Math.min(3, number));
}

function stripTerminalPunctuation(value) {
  return readText(value).replace(/[，。！？；,.!?;]+$/u, '');
}

function readText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(readText).filter(Boolean))];
}

module.exports = {
  AESTHETIC_INFERENCE_RULES,
  EFFECT_PROMISES,
  XIAODA_STYLE_INSIGHT_VERSION,
  XIAODA_STYLE_MESSAGE_DEFINITIONS,
  buildXiaodaDetailCandidate,
  buildXiaodaStyleInsight,
  buildXiaodaTodayCandidates,
  realizeDetailInsight,
  realizeTodayInsight,
};
