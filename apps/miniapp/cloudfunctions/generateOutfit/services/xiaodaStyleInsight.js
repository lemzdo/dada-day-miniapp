const {
  XIAODA_PERSONA_CONTRACT,
  XIAODA_PERSONA_VERSION,
  inspectXiaodaPersonaCopy,
} = require('./xiaodaPersonaContract');

const XIAODA_STYLE_INSIGHT_VERSION = 'xiaoda-style-insight-v3';
const DETAIL_INCREMENTAL_VALUE_GATE_VERSION = 'detail-incremental-value-gate-v1';

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
    .sort((left, right) => right.ranking.humanValueTier - left.ranking.humanValueTier
      || right.ranking.total - left.ranking.total
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
  const primaryHumanValueTier = plan.primary?.ranking.humanValueTier || 0;
  const ranked = [plan.primary, ...plan.secondary]
    .filter(Boolean)
    .filter((insight, index) => index === 0 || (
      insight.ranking.humanValueTier === primaryHumanValueTier
        && insight.ranking.total >= (plan.primary?.ranking.total || 0) - 9
    ));
  return ranked.flatMap((insight) => realizeTodayInsightVariants(model, insight)
    .map((text, syntaxIndex) => {
      const persona = inspectXiaodaPersonaCopy(text);
      if (!text || !persona.passed) return null;
      const syntaxSuffix = syntaxIndex === 0 ? '' : `:human-meaning-syntax-${syntaxIndex + 1}`;
      return {
        candidateId: `xiaoda:${insight.insightId}${syntaxSuffix}`,
        templateId: todayTemplateId(insight.code),
        messageIntent: insight.intent,
        relationCode: insight.relationCode,
        dimension: insight.dimension,
        openingFamily: syntaxIndex === 0 ? openingFamily(insight.code) : `human_meaning_syntax_${syntaxIndex + 1}`,
        endingFamily: endingFamily(insight.code),
        priority: insight.priority,
        text,
        subjectItemIds: insight.subjectItemIds.slice(),
        evidenceFactIds: insight.evidenceFactIds.slice(),
        authorizationIds: insight.authorizationIds.slice(),
        informationKey: `xiaoda:${insight.code}:${insight.relationCode}:${insight.subjectItemIds.join('|')}`,
        source: insight.source,
        valueAssessment: copyValueAssessment(insight),
        humanValueTier: insight.ranking.humanValueTier,
        xiaodaStyleInsight: compactInsightPlan(plan, insight),
      };
    })
    .filter(Boolean));
}

function buildXiaodaDetailCandidate(model = {}, options = {}) {
  const plan = buildXiaodaStyleInsight(model);
  const ranked = [plan.primary, ...plan.secondary, ...plan.optional].filter(Boolean);
  const insight = ranked.find((entry) => options.insightCode && entry.code === options.insightCode)
    || ranked.find((entry) => options.relationCode && entry.relationCode === options.relationCode)
    || plan.primary;
  if (!insight) return null;
  const todayText = stripTerminalPunctuation(realizeTodayInsight(model, insight));
  const text = stripTerminalPunctuation(realizeDetailInsight(model, insight));
  const incrementalValueGate = evaluateDetailIncrementalValue({ todayText, detailText: text, insight });
  if (incrementalValueGate.result !== 'PASS' || !incrementalValueGate.emitted) return null;
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
    humanValueTier: insight.ranking.humanValueTier,
    incrementalValueGate,
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
    humanValueTier: humanValueTierFor(definitionValue.code, relation),
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
    humanMeaningAlternatives: narrative.humanMeaningAlternatives,
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
    humanValueTier: humanValueTierFor(definitionValue.code, relation),
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
  const relation = { relationCode: code, subjectItemIds, evidenceFactIds };
  const ranking = rankingAssessment({
    factAvailable: true,
    relationStrength: 1,
    userValue: 2,
    novelInformation: 2,
    outfitSpecificity: 2,
    sceneRelevance: 1,
    naturalExpressibility: 3,
    humanValueTier: humanValueTierFor(code, relation),
  });
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
  void model;
  return readText(insight?.humanMeaning);
}

function realizeTodayInsightVariants(model, insight) {
  const primary = stripTerminalPunctuation(realizeTodayInsight(model, insight));
  if (!primary) return [];
  const variants = uniqueStrings([primary, ...uniqueStrings(insight?.humanMeaningAlternatives)]);
  for (const meaning of variants.slice()) {
    const pair = meaning.match(/^([^，。；]{1,24}?)配(?:上|着)?([^，。；]{1,24})，(.+)$/u);
    if (pair) {
      const left = readText(pair[1]);
      const right = readText(pair[2]);
      const rest = readText(pair[3]).replace(/^穿在身上/u, '整体');
      if (left && right && rest) variants.push(
        `${left}和${right}一起穿，${rest}`,
        `穿上${left}和${right}，${rest}`,
      );
    }
    const together = meaning.match(/^([^，。；]{1,24}?)和([^，。；]{1,24}?)穿在一起，?(.+)$/u);
    if (together) {
      const left = readText(together[1]);
      const right = readText(together[2]);
      const rest = readText(together[3]);
      if (left && right && rest) variants.push(
        `${left}配${right}，穿在身上${rest}`,
        `穿上${left}和${right}，整体${rest}`,
      );
    }
  }
  return uniqueStrings(variants).map(stripTerminalPunctuation).slice(0, 8);
}

function realizeDetailInsight(model, insight) {
  void model;
  return readText(insight?.overallMeaning);
}

function buildInternalUnderstanding(model, code, relation) {
  const top = itemForRole(model, 'top');
  const bottom = itemForRole(model, 'bottom');
  const onepiece = itemForRole(model, 'onepiece');
  const outerwear = itemForRole(model, 'outerwear');
  const shoes = itemForRole(model, 'shoes');
  const subjects = uniqueStrings(relation.subjectItemIds)
    .map((itemId) => itemById(model, itemId))
    .filter(Boolean);
  const focus = subjects.find(isBodyGarmentItem) || top || onepiece || coreItems(model)[0];
  const support = subjects.find((item) => isBodyGarmentItem(item) && item.itemId !== focus?.itemId)
    || [top, bottom, onepiece, shoes, outerwear].find((item) => item && item.itemId !== focus?.itemId);
  const focusName = plainLabel(focus);
  const supportName = plainLabel(support);
  const topName = plainLabel(top);
  const bottomName = plainLabel(bottom);
  const onepieceName = plainLabel(onepiece);
  const outerwearName = plainLabel(outerwear);
  const shoesName = plainLabel(shoes);
  const pairName = top && bottom ? `${topName}配${bottomName}` : joinPlainItems(subjects);
  const subjectNames = joinPlainItems(subjects);

  switch (code) {
    case 'PATTERN_FOCUS_WITH_SIMPLE_SUPPORT':
    case 'PATTERN_SINGLE_FOCUS':
      return interpretation(
        `${focusName}已经把第一眼的重点放在自己身上`,
        support ? `${supportName}没有再添第二种图案` : '同一身里没有第二种图案来抢注意力',
        `${focusName}已经够有内容，${support ? `${supportName}简单一些` : '搭配保持简单'}，穿在身上有重点但不拥挤`,
        `穿上以后会先注意到${focusName}，${support ? `${supportName}没有再加图案` : '同一身里没有第二种图案'}，所以衣服有内容却不会堆得太满`,
      );
    case 'DESIGN_FOCUS_WITH_SIMPLE_SUPPORT':
      return interpretation(
        `${focusName}的设计细节已经足够醒目`,
        support ? `${supportName}没有再抢同一个重点` : '同一身里没有再堆另一处设计细节',
        `${focusName}的细节已经很清楚，${support ? `${supportName}简单一些` : '搭配不再堆设计'}，穿在身上重点明确`,
        `穿上以后，${focusName}的细节会先被看到，${support ? `${supportName}不再加复杂设计` : '同一身里不再堆另一处设计'}，所以重点不会散开`,
      );
    case 'COLOR_FOCUS_WITH_NEUTRAL_SUPPORT':
      return interpretation(
        `${focusName}是穿上后最先被注意到的颜色`,
        support ? `${supportName}没有再抢颜色` : '同一身里没有第二处醒目颜色',
        `${focusName}配${supportName}，穿在身上颜色有重点，也不会显得太花`,
        `穿上以后会先注意到${focusName}，${supportName}的颜色不抢眼，所以这一身只有一个清楚的重点`,
      );
    case 'BOTTOM_SHOE_COLOR_CONTINUITY':
      return interpretation(
        `${plainLabel(bottom || focus)}和${plainLabel(shoes || support)}把腿部到脚下穿得更整齐`,
        top ? `${topName}可以保留自己的明暗变化` : '上身不必跟着穿成一色',
        `${plainLabel(bottom || focus)}配${plainLabel(shoes || support)}，下半身看着干净，${top ? `${topName}也留出了明暗变化` : '整身也不会单调'}`,
        `${plainLabel(bottom || focus)}和${plainLabel(shoes || support)}同色，腿部到脚下少了一次明暗变化，${top ? `${topName}因此更容易被注意到` : '穿上后会更整齐'}`,
        [
          `${plainLabel(bottom || focus)}和${plainLabel(shoes || support)}同色，腿部到脚下看着整齐，${top ? `${topName}保留了明暗变化` : '整身也还有变化'}`,
          `下身穿${plainLabel(bottom || focus)}，脚上穿${plainLabel(shoes || support)}，两件同色，${top ? `${topName}因此更容易被看到` : '穿上后干净利落'}`,
        ],
      );
    case 'TOP_SHOE_COLOR_ECHO':
      return interpretation(
        `${plainLabel(top || focus)}和${plainLabel(shoes || support)}把同一种颜色穿在上身和脚下`,
        bottom ? `${bottomName}让全身不至于只有一种颜色` : '中间的衣物保留了颜色变化',
        `${plainLabel(top || focus)}和${plainLabel(shoes || support)}都是${readText((top || focus)?.normalizedColor) || '相近颜色'}，${bottom ? `${bottomName}让整身不至于满身同色` : '穿在身上整齐又有变化'}`,
        `${plainLabel(shoes || support)}不会单独冒出来，因为${plainLabel(top || focus)}已经有同样的颜色，${bottom ? `${bottomName}又让全身没有铺满这一种颜色` : '穿上后上下会更整齐'}`,
        [
          `${plainLabel(top || focus)}和${plainLabel(shoes || support)}同色，${bottom ? `${bottomName}让全身还留着颜色变化` : '穿上后整齐又有变化'}`,
          `上身的${plainLabel(top || focus)}和脚下的${plainLabel(shoes || support)}颜色一样，${bottom ? `${bottomName}没有跟着铺满这一种颜色` : '全身看着干净整齐'}`,
        ],
      );
    case 'ONEPIECE_SHOE_COLOR_ECHO':
      return interpretation(
        `${plainLabel(onepiece || focus)}和${plainLabel(shoes || support)}穿出了同一种颜色`,
        '裙身和脚下因此不会各说各话',
        `${plainLabel(onepiece || focus)}配${plainLabel(shoes || support)}，同一种颜色穿在身上和脚下，看着干净利落`,
        `${plainLabel(shoes || support)}不会显得突兀，因为${plainLabel(onepiece || focus)}已经有同样的颜色，裙子配鞋看着更顺`,
      );
    case 'SAME_COLOR_WHOLE':
    case 'SAME_COLOR_CORE':
    case 'TONAL_COLOR_RELATION':
      return interpretation(
        `${subjectNames}穿在一起时，上下颜色变化很少`,
        '身体中间不会被两种反差很大的颜色切开',
        `${subjectNames}穿在一起，从上到下看着整齐利落`,
        `${subjectNames}同色，穿在身上时腰间少一道颜色分隔，所以整个人看着更整齐`,
      );
    case 'NEARBY_COLOR_RELATION':
      return interpretation(
        `${subjectNames}的颜色差别不大`,
        '穿在一起时不会出现很硬的明暗分界',
        `${subjectNames}的颜色很接近，穿在身上柔和自然`,
        `${subjectNames}之间的色差小，穿上后上下身不会被强烈反差切开，所以看着更柔和`,
      );
    case 'CONTROLLED_COLOR_CONTRAST':
      return interpretation(
        `${subjectNames}穿出了清楚的颜色反差`,
        '反差落在具体衣物上，不会盖过衣服本身',
        `${subjectNames}有明暗对比，穿在身上清楚又不杂`,
        `${subjectNames}一深一浅，上下身因此分得清楚，颜色虽然有变化，但没有多到互相抢`,
      );
    case 'TWO_COLOR_CORE':
      return interpretation(
        `${pairName}把上下身分得很清楚`,
        '两件衣服各用自己的颜色，不需要额外解释',
        `${pairName}，穿在身上清楚又日常`,
        `${topName}和${bottomName}的明暗区别把上下身分开，穿上以后不会糊成一片，也没有多余颜色来抢注意力`,
      );
    case 'QUIET_NEUTRAL_BASE':
      return interpretation(
        `${subjectNames}都是日常容易穿的颜色`,
        '它们放在身上不会比人更抢眼',
        `${subjectNames}穿在一起简单自然`,
        `${subjectNames}的明暗变化不大，穿上以后衣服不会抢走注意力，整个人看着更放松`,
      );
    case 'SILHOUETTE_TENSION_BALANCE':
      return interpretation(
        `${topName}和${bottomName}一件收、一件放`,
        '上下身不会同时贴紧或同时松垮',
        renderSilhouetteToday(top, bottom),
        `${bodyItem(top)}和${bodyItem(bottom)}一收一放，穿上后上半身和下半身不会挤在同一种宽度里，所以线条更利落`,
      );
    case 'SILHOUETTE_EASY_CONTINUITY':
      return interpretation(
        `${pairName}的松紧接近`,
        '从肩到裤脚没有突然改变宽度',
        `${pairName}，穿在身上线条自然舒展`,
        `${topName}和${bottomName}的宽松程度接近，穿上后从肩到裤脚不会突然收紧或放大，整个人看着更自然`,
      );
    case 'CLEAR_LENGTH_PROPORTION':
      return interpretation(
        `${topName}和${bottomName}一短一长`,
        '衣长差把腰线和腿部位置交代得更清楚',
        `${topName}短一些，${bottomName}长一些，穿在身上比例清楚`,
        `${topName}在腰部附近收住，${bottomName}把线条往下延伸，上短下长让穿着比例更清楚`,
      );
    case 'FORMALITY_COHERENT':
      return interpretation(
        `${subjectNames}穿在一起时整齐程度接近`,
        '不会一件像上班、一件像在家',
        `${subjectNames}放在一起利落得体，穿去上班不会显得太严肃`,
        `${subjectNames}的线条都偏整齐，穿在一起不会有一件过分正式、另一件过分随意的落差`,
      );
    case 'FORMALITY_SOFT_MIX':
      return interpretation(
        `${focusName}稍正式，${supportName}更日常`,
        '两件衣服让正式感放松了一点',
        `${focusName}配${supportName}，穿在身上不端着，也不会显得随便`,
        `${focusName}先把人穿得整齐，${supportName}又把严肃感放松下来，所以日常穿不会太刻意`,
      );
    case 'STYLE_COHERENT':
      return interpretation(
        `${subjectNames}给人的穿着感觉一致`,
        '没有一件衣服突然变成另一种风格',
        `${subjectNames}放在一起，穿在身上自然顺眼`,
        `${subjectNames}都偏同一种日常风格，穿上后不会有某一件突然跳出来，整个人看着更连贯`,
      );
    case 'ONEPIECE_LAYERING':
      return interpretation(
        `${onepieceName}单穿已经能把全身交代清楚`,
        `${outerwearName}只在外面增加一层`,
        `${onepieceName}配${outerwearName}，穿着有层次，脱掉外套后里面也仍然完整`,
        `${onepieceName}先把上身和下身连成一件，${outerwearName}只改变外面的层次，所以进室内脱掉也不会破坏里面的搭配`,
      );
    case 'ONEPIECE_WITH_SHOES':
    case 'ONEPIECE_SETS_THE_LOOK':
      return interpretation(
        `${onepieceName}穿上后已经覆盖了主要穿搭`,
        shoes ? `${shoesName}只需要顺着裙子的感觉` : '不需要再靠第二件衣服补全上下身',
        `${onepieceName}${shoes ? `配${shoesName}` : '单穿'}，一件就把整身穿得很完整`,
        `${onepieceName}把上身和下身连在一件衣服里，${shoes ? `${shoesName}只需顺着裙子的感觉` : '因此不用再处理上下装的关系'}，穿上后重点很清楚`,
      );
    case 'WORK_SHIRT_TROUSER_RELATION':
      return interpretation(
        `${topName}和${bottomName}都把身体线条收得比较整齐`,
        '上身与下身不会出现明显的正式程度落差',
        `${topName}配${bottomName}，穿去上班利落得体，也不会显得太严肃`,
        `${topName}把上半身穿得整齐，${bottomName}的直线条延续到下半身，所以站着或坐着看都很利落`,
      );
    case 'WORK_SIMPLE_POLISH':
    case 'WORK_DAILY_READY':
      return interpretation(
        `${pairName}先把上班需要的整齐感穿出来`,
        shoes ? `${shoesName}让整身保留日常感` : '衣服本身没有刻意往商务套装靠',
        `${[topName, bottomName, shoes && shoesName].filter(Boolean).join('、')}穿去上班整齐自然，不会太正式`,
        `${topName}和${bottomName}让上半身、下半身看着整齐，${shoes ? `${shoesName}又把严肃感放松一点` : '同时保留了日常穿着的轻松程度'}，所以普通工作日刚刚好`,
        [
          `${topName}和${bottomName}把上班需要的整齐感穿出来，${shoes ? `${shoesName}穿在脚上不会显得太严肃` : '日常穿也不会太严肃'}`,
          `穿上${[topName, bottomName, shoes && shoesName].filter(Boolean).join('、')}，上班看着整齐，日常感也还在`,
          `${topName}穿在上身利落，${bottomName}把下半身穿得整齐，${shoes ? `${shoesName}让整身不会太严肃` : '普通工作日这样就够了'}`,
        ],
      );
    case 'DATE_CLEAR_FOCUS':
      return interpretation(
        `${focusName}是穿上后最先被注意到的单品`,
        support ? `${supportName}没有争抢同一个重点` : '同一身里没有第二件衣服抢注意力',
        `${focusName}已经很有存在感，${support ? `${supportName}简单一些` : '搭配不过分堆叠'}，约会时穿得自然又有重点`,
        `穿上以后会先注意到${focusName}，${support ? `${supportName}没有再抢图案或颜色` : '同一身里没有第二个重点'}，所以看起来是认真搭过但不刻意`,
      );
    case 'DATE_SIMPLE_ROOM':
      return interpretation(
        `${subjectNames}穿在身上都不过分抢眼`,
        '衣服把注意力留给穿衣的人',
        `${subjectNames}穿去约会自然大方，不会像刻意盛装`,
        `${subjectNames}都没有过分抢眼的变化，穿上后更像自然见面，而不是让衣服先压过人`,
      );
    case 'SPORT_COMPLETE_RELATION':
    case 'SPORT_LIGHT_ACTIVITY_RELATION':
      return interpretation(
        `${[topName, bottomName, shoes && shoesName].filter(Boolean).join('、')}都在为同一种活动状态服务`,
        shoes ? `${shoesName}和衣服一样偏运动` : '上身与下身都偏运动',
        `${[topName, bottomName, shoes && shoesName].filter(Boolean).join('、')}穿在一起，散步或快走时看着干净有精神`,
        `${topName}和${bottomName}先把身体留在运动状态，${shoes ? `${shoesName}也没有把整身拉回正式穿着` : '上下身的用途一致'}，所以轻活动时不会显得穿错场合`,
      );
    case 'HOME_SHORT_EASY_SET':
      return interpretation(
        `${topName}和${bottomName}把手臂、小腿露出来`,
        '短衣长让人在家穿着看起来更轻快',
        `${topName}配${bottomName}，在家这样简简单单地穿就很好`,
        `${topName}露出手臂，${bottomName}也露出小腿，穿在身上比长衣长裤看着更轻快`,
      );
    case 'HOME_EASY_DAY_SET':
      return interpretation(
        `${pairName}是一身完整的日常穿着`,
        '上衣和长裤把上半身、腿部都穿得整齐',
        `${pairName}，在家穿着简单、整齐`,
        `${topName}照顾上半身，${bottomName}把腿部覆盖完整，穿在身上是一套清楚的日常衣服`,
        [
          `${topName}照顾上半身，${bottomName}把腿部穿得整齐，在家这样简单清楚`,
          `在家穿${topName}和${bottomName}，上身和腿部都穿得整齐`,
        ],
      );
    case 'HOME_RELAXED_MOVEMENT':
      return interpretation(
        `${subjectNames}在身体周围都留了余量`,
        '上身与下身不会同时贴紧',
        `${subjectNames}穿在身上松紧合适，在家活动时看着自然`,
        `${subjectNames}都没有紧贴身体，肩背和腿部周围留有余量，所以人在家走动时衣服线条不会绷住`,
      );
    case 'SIMPLE_EVERYDAY_COMBINATION':
    default: {
      const today = top && bottom
        ? `${pairName}，穿在身上简单自然`
        : `${plainLabel(onepiece || focus)}穿在身上简单自然`;
      return interpretation(
        top && bottom ? `${pairName}就是一身普通日常衣服` : `${plainLabel(onepiece || focus)}本身就能穿成一身`,
        '没有足够具体的关系需要额外解释',
        today,
        '',
      );
    }
  }
}

function interpretation(primaryObservation, supportingRelation, humanMeaning, overallMeaning, humanMeaningAlternatives = []) {
  return {
    primaryObservation: stripTerminalPunctuation(primaryObservation),
    supportingRelation: stripTerminalPunctuation(supportingRelation),
    humanMeaning: stripTerminalPunctuation(humanMeaning),
    humanMeaningAlternatives: uniqueStrings(humanMeaningAlternatives).map(stripTerminalPunctuation),
    overallMeaning: stripTerminalPunctuation(overallMeaning),
  };
}

function evaluateDetailIncrementalValue({ todayText, detailText, insight } = {}) {
  const today = readText(todayText);
  const detail = readText(detailText);
  if (!detail) {
    return {
      version: DETAIL_INCREMENTAL_VALUE_GATE_VERSION,
      result: 'PASS',
      emitted: false,
      reason: 'NO_SUPPORTED_INCREMENT',
    };
  }
  const reasons = [];
  if (!today || detail === today || textSimilarity(detail, today) >= 0.82) reasons.push('REPEATS_TODAY');
  if (!/(所以|因为|因此|让|少了|不会|没有|先把|又把|穿上|穿在)/u.test(detail)) {
    reasons.push('MISSING_STYLING_REASON');
  }
  if (inspectXiaodaPersonaCopy(detail).violations.includes('ALGORITHM_CHINESE')) {
    reasons.push('ALGORITHM_TO_CHINESE_LEAKAGE');
  }
  return {
    version: DETAIL_INCREMENTAL_VALUE_GATE_VERSION,
    result: reasons.length === 0 ? 'PASS' : 'REJECT',
    emitted: reasons.length === 0,
    reason: reasons[0] || 'ADDS_STYLING_REASON',
    reasons,
    primaryInsightCode: readText(insight?.code),
  };
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
    humanValueTier: Math.max(0, Math.min(4, Math.round(Number(input.humanValueTier) || 0))),
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
    humanValueTier: insight.ranking.humanValueTier,
    userValue,
    novelInformation,
    sceneRelevance,
    naturalExpressibility,
    total: 2 + userValue + novelInformation + sceneRelevance + naturalExpressibility,
  };
}

function humanValueTierFor(code, relation = {}) {
  const relationCode = readText(relation.relationCode);
  if (/PATTERN|DETAIL|SILHOUETTE|PROPORTION|STRUCTURE_ONEPIECE_OUTERWEAR|STYLE_COHERENT|FORMALITY_/u.test(relationCode)) return 4;
  if (relationCode === 'TOP_ACCENT_WITH_NEUTRAL_BOTTOM') return 4;
  if (/ONEPIECE|WORK_SHIRT|SPORT_COMPLETE/u.test(code)) return 3;
  if (relation.source === 'scene_evidence' || /^(HOME_|WORK_|DATE_|SPORT_)/u.test(relationCode)) return 2;
  if (/COLOR|SAME_COLOR|TONAL|NEARBY|TWO_COLOR|QUIET_NEUTRAL|ECHO|CONTINUITY/u.test(code)) return 1;
  return 0;
}

function textSimilarity(left, right) {
  const a = new Set(Array.from(readText(left)));
  const b = new Set(Array.from(readText(right)));
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const character of a) if (b.has(character)) shared += 1;
  return shared / Math.max(a.size, b.size);
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

function coreItems(model) {
  return (Array.isArray(model?.items) ? model.items : []).filter((item) => item?.itemId && isBodyGarmentItem(item));
}

function isBodyGarmentItem(item) {
  if (!item || !CORE_ROLES.has(item.role)) return false;
  return !/(?:手提|斜挎|双肩|腰|托特)?包|配饰|饰品|项链|耳环|手链|帽子|围巾/u.test(
    readText(item.canonicalSubtype || item.canonicalName),
  );
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

function plainLabel(item) {
  if (!item) return '单品';
  const name = readText(item.canonicalSubtype || item.canonicalName) || roleFallback(item.role);
  const color = readText(item.normalizedColor);
  return color && !name.includes(color) ? `${color}${name}` : name;
}

function normalizeRelationSubjectItemIds(model, relation, definitionValue) {
  const subjectItemIds = uniqueStrings(relation.subjectItemIds);
  if (definitionValue.code !== 'COLOR_FOCUS_WITH_NEUTRAL_SUPPORT') return subjectItemIds;
  const items = subjectItemIds
    .map((itemId) => itemById(model, itemId))
    .filter(isBodyGarmentItem);
  const accent = items.find((item) => item.normalizedColor && !isNeutralColor(item.normalizedColor));
  const neutral = items.find((item) => item.normalizedColor && isNeutralColor(item.normalizedColor));
  if (!accent || !neutral) return [];
  return [accent.itemId, neutral.itemId];
}

function isNeutralColor(value) {
  return /黑|白|灰|藏青|米|棕|卡其|black|white|gray|grey|navy|beige|brown/i.test(readText(value));
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
  DETAIL_INCREMENTAL_VALUE_GATE_VERSION,
  EFFECT_PROMISES,
  XIAODA_STYLE_INSIGHT_VERSION,
  XIAODA_STYLE_MESSAGE_DEFINITIONS,
  buildXiaodaDetailCandidate,
  buildXiaodaStyleInsight,
  buildXiaodaTodayCandidates,
  evaluateDetailIncrementalValue,
  realizeDetailInsight,
  realizeTodayInsight,
};
