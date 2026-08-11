const NATURAL_LANGUAGE_PLAN_VERSION = 'recommendation-natural-language-v3';

const DECISION_VALUE_CATEGORIES = Object.freeze({
  FACTUAL_BUT_LOW_VALUE: 'FACTUAL_BUT_LOW_VALUE',
  MEANINGFUL_RELATION: 'MEANINGFUL_RELATION',
  MEANINGFUL_SCENE_EVIDENCE: 'MEANINGFUL_SCENE_EVIDENCE',
  MEANINGFUL_BENEFIT: 'MEANINGFUL_BENEFIT',
});

const MESSAGE_INTENTS = Object.freeze({
  PATTERN_BALANCE: 'pattern_balance',
  COLOR_FOCAL_SUPPORT: 'color_focal_support',
  COLOR_ECHO: 'color_echo',
  COLOR_UNITY: 'color_unity',
  NEUTRAL_SUPPORT: 'neutral_support',
  LAYERING_LOGIC: 'layering_logic',
  ONEPIECE_DECISION: 'onepiece_decision',
  HOME_LIGHT_LAYERS: 'home_light_layers',
  HOME_MOVEMENT_ROOM: 'home_movement_room',
  HOME_QUICK_OUTING: 'home_quick_outing',
  HOME_USE_BOUNDARY: 'home_use_boundary',
  WORK_STRUCTURE: 'work_structure',
  WORK_SIMPLE_SUPPORT: 'work_simple_support',
  WORK_WEATHER_BALANCE: 'work_weather_balance',
  WORK_USE_BOUNDARY: 'work_use_boundary',
  DATE_FOCAL_POINT: 'date_focal_point',
  DATE_SIMPLE_SUPPORT: 'date_simple_support',
  DATE_USE_BOUNDARY: 'date_use_boundary',
  SPORT_ACTIVITY_STRUCTURE: 'sport_activity_structure',
  SPORT_WEATHER_LAYER: 'sport_weather_layer',
  SPORT_USE_BOUNDARY: 'sport_use_boundary',
});

const LOW_VALUE_RELATION_CODES = new Set([
  'SUBTYPE_FEATURE_PRINT',
  'DISTINCT_TOP_BOTTOM_COLOR',
  'SINGLE_COLOR_FALLBACK',
  'STRUCTURE_SINGLE_ITEM',
  'STRUCTURE_TOP_BOTTOM',
]);

const RELATION_MESSAGE_DEFINITIONS = Object.freeze([
  relationMessage({
    id: 'message.pattern-balance',
    intent: MESSAGE_INTENTS.PATTERN_BALANCE,
    relationCodes: ['PATTERN_SOLID_BALANCE'],
    dimension: 'pattern',
    openingFamily: 'pattern_subject',
    endingFamily: 'single_visual_focus',
    priority: 96,
    value: valueAssessment(3, 3, 1, 3),
    sceneReasonCodes: [
      'HOME_PATTERN_TOP_SOLID_BOTTOM',
      'WORK_PATTERN_TOP_SOLID_BOTTOM',
      'DATE_PATTERN_TOP_SIMPLE_SUPPORT',
      'DATE_PATTERN_DRESS_SIMPLE_SHOES',
    ],
    render: renderPatternBalance,
  }),
  relationMessage({
    id: 'message.color-focal-support',
    intent: MESSAGE_INTENTS.COLOR_FOCAL_SUPPORT,
    relationCodes: ['TOP_ACCENT_WITH_NEUTRAL_BOTTOM'],
    dimension: 'color',
    openingFamily: 'bright_subject',
    endingFamily: 'quiet_support',
    priority: 90,
    value: valueAssessment(3, 3, 1, 3),
    sceneReasonCodes: ['DATE_BRIGHT_TOP_BASIC_SUPPORT'],
    render: ({ model }) => `${itemLabel(model, 'top', '上衣')}颜色更亮，搭${itemLabel(model, 'bottom', '中性下装')}这样的中性色，下半身不会再抢注意力`,
  }),
  relationMessage({
    id: 'message.color-echo',
    intent: MESSAGE_INTENTS.COLOR_ECHO,
    relationCodes: [
      'COLOR_ECHO_TOP_SHOES',
      'COLOR_ECHO_ONEPIECE_SHOES',
      'COLOR_ECHO_BOTTOM_SHOES',
    ],
    dimension: 'color',
    openingFamily: 'paired_color_subjects',
    endingFamily: 'color_echo_effect',
    priority: 82,
    value: valueAssessment(3, 2, 0, 3),
    sceneReasonCodes: ['DATE_COLOR_COORDINATED'],
    render: renderColorEcho,
  }),
  relationMessage({
    id: 'message.color-unity',
    intent: MESSAGE_INTENTS.COLOR_UNITY,
    relationCodes: ['SAME_COLOR_ALL_ROLES', 'SAME_COLOR_TOP_BOTTOM'],
    dimension: 'color',
    openingFamily: 'same_color_core',
    endingFamily: 'color_choice_reduced',
    priority: 70,
    value: valueAssessment(2, 2, 0, 3),
    sceneReasonCodes: ['DATE_COLOR_COORDINATED'],
    render: renderColorUnity,
  }),
  relationMessage({
    id: 'message.neutral-support',
    intent: MESSAGE_INTENTS.NEUTRAL_SUPPORT,
    relationCodes: ['NEUTRAL_COLOR_BRIDGE'],
    dimension: 'color',
    openingFamily: 'neutral_pair',
    endingFamily: 'room_for_change',
    priority: 62,
    value: valueAssessment(2, 2, 0, 3),
    render: ({ model, relation }) => `${joinChinese(relation.roles.map((role) => itemLabel(model, role, '单品')))}都偏中性，想加一点颜色，可以只放在一件配饰上`,
  }),
  relationMessage({
    id: 'message.onepiece-layer',
    intent: MESSAGE_INTENTS.LAYERING_LOGIC,
    relationCodes: ['STRUCTURE_ONEPIECE_OUTERWEAR'],
    dimension: 'structure',
    openingFamily: 'layer_sequence',
    endingFamily: 'removable_layer',
    priority: 88,
    value: valueAssessment(3, 3, 0, 3),
    render: ({ model }) => `${itemName(model, 'onepiece', '连衣裙')}单穿已经完整，${itemName(model, 'outerwear', '外套')}只负责加一层，进室内脱掉也不用重新配上下装`,
  }),
  relationMessage({
    id: 'message.onepiece-shoes',
    intent: MESSAGE_INTENTS.ONEPIECE_DECISION,
    relationCodes: ['STRUCTURE_ONEPIECE_SHOES'],
    dimension: 'structure',
    openingFamily: 'onepiece_decision',
    endingFamily: 'fewer_decisions',
    priority: 76,
    value: valueAssessment(3, 2, 0, 3),
    render: ({ model }) => `${itemName(model, 'onepiece', '连衣裙')}省掉了上下装配对，再把${itemName(model, 'shoes', '鞋子')}定下来，出门前只需按天气决定要不要加外层`,
  }),
  relationMessage({
    id: 'message.onepiece-only',
    intent: MESSAGE_INTENTS.ONEPIECE_DECISION,
    relationCodes: ['STRUCTURE_ONEPIECE_ONLY'],
    dimension: 'structure',
    openingFamily: 'onepiece_decision',
    endingFamily: 'fewer_decisions',
    priority: 68,
    value: valueAssessment(2, 2, 0, 3),
    render: ({ model }) => `${itemName(model, 'onepiece', '连衣裙')}本身就省掉了上下装配对，外层和鞋按当天安排再决定`,
  }),
]);

const SCENE_MESSAGE_DEFINITIONS = Object.freeze([
  sceneMessage({
    id: 'message.home-light-layers', scene: 'home', intent: MESSAGE_INTENTS.HOME_LIGHT_LAYERS,
    reasonCodes: ['HOME_HOT_SLEEVELESS_SHORTS', 'HOME_SLEEVELESS_SHORTS', 'HOME_HOT_SHORT_SLEEVE_SHORTS', 'HOME_SHORT_SLEEVE_SHORTS'],
    requiredFactOptions: [['sleeveless', 'shorts'], ['short_sleeve', 'shorts']],
    dimension: 'activity', openingFamily: 'short_lengths', endingFamily: 'indoor_layer_choice', priority: 91,
    value: valueAssessment(3, 3, 3, 3),
    render: ({ model }) => `${itemName(model, 'top', '短上衣')}配${itemName(model, 'bottom', '短裤')}，在家坐着或来回走动时，长衣长裤都不会碍事`,
  }),
  sceneMessage({
    id: 'message.home-pattern-control', scene: 'home', intent: MESSAGE_INTENTS.PATTERN_BALANCE,
    reasonCodes: ['HOME_PATTERN_TOP_SOLID_BOTTOM'], requiredFactOptions: [['pattern_visible', 'solid_color']],
    dimension: 'pattern', openingFamily: 'pattern_subject', endingFamily: 'single_visual_focus', priority: 94,
    value: valueAssessment(3, 3, 3, 3), render: renderPatternBalance,
  }),
  sceneMessage({
    id: 'message.home-movement-room', scene: 'home', intent: MESSAGE_INTENTS.HOME_MOVEMENT_ROOM,
    reasonCodes: ['HOME_LOOSE_TWO_PIECE', 'HOME_TSHIRT_LOOSE_PANTS', 'HOME_LOOSE_DRESS'], requiredFactOptions: [['loose_fit']],
    dimension: 'activity', openingFamily: 'loose_shape', endingFamily: 'movement_room', priority: 88,
    value: valueAssessment(3, 3, 3, 3),
    render: ({ model }) => `${joinChinese(apparelNames(model))}都有宽松余量，坐着、起身和在家走动时不需要再换一身`,
  }),
  sceneMessage({
    id: 'message.home-quick-outing', scene: 'home', intent: MESSAGE_INTENTS.HOME_QUICK_OUTING,
    reasonCodes: ['HOME_SHORT_SLEEVE_LONG_PANTS', 'HOME_TOP_LONG_PANTS'], requiredFactOptions: [['short_sleeve', 'long_pants'], ['category', 'long_pants']],
    dimension: 'scene', openingFamily: 'home_apparel_pair', endingFamily: 'quick_outing_boundary', priority: 82,
    value: valueAssessment(3, 3, 3, 3),
    render: ({ model }) => `${itemName(model, 'top', '上衣')}配${itemName(model, 'bottom', '长裤')}，在家活动不累赘，临时下楼也省得再换下装`,
  }),
  sceneMessage({
    id: 'message.home-dress-outing', scene: 'home', intent: MESSAGE_INTENTS.HOME_QUICK_OUTING,
    reasonCodes: ['HOME_DRESS_NORMAL_SHOES'], requiredFactOptions: [['dress', 'outing_shoe']],
    dimension: 'scene', openingFamily: 'onepiece_decision', endingFamily: 'quick_outing_boundary', priority: 86,
    value: valueAssessment(3, 3, 3, 3),
    render: ({ model }) => `${itemName(model, 'onepiece', '连衣裙')}已经省掉上下装，鞋也选好了，临时下楼不用再找另一套`,
  }),
  sceneMessage({
    id: 'message.home-cool-layer', scene: 'home', intent: MESSAGE_INTENTS.HOME_LIGHT_LAYERS,
    reasonCodes: ['HOME_COOL_LONG_SLEEVE'], requiredFactOptions: [['long_sleeve', 'category']],
    dimension: 'weather', openingFamily: 'weather_first', endingFamily: 'indoor_layer_choice', priority: 84,
    value: valueAssessment(3, 3, 3, 3),
    render: ({ model }) => `天气偏凉时先留${itemName(model, 'top', '长袖上衣')}，在家不用一开始就叠外套`,
  }),
  sceneMessage({
    id: 'message.home-use-boundary', scene: 'home', intent: MESSAGE_INTENTS.HOME_USE_BOUNDARY,
    reasonCodes: ['HOME_CASUAL_TWO_PIECE', 'HOME_V4_EVIDENCE_SUPPORTED'], requiredFactOptions: [['casual_style'], ['category']],
    dimension: 'scene', openingFamily: 'use_boundary', endingFamily: 'formal_outing_boundary', priority: 44,
    value: valueAssessment(2, 2, 3, 3),
    render: ({ model }) => `${joinChinese(apparelNames(model))}按在家活动来选，临时下楼可以沿用；行程更久时，再按天气决定要不要补外层`,
  }),

  sceneMessage({
    id: 'message.work-structured', scene: 'work', intent: MESSAGE_INTENTS.WORK_STRUCTURE,
    reasonCodes: ['WORK_SHIRT_STRAIGHT_PANTS'], requiredFactOptions: [['shirt', 'straight_cut']],
    dimension: 'structure', openingFamily: 'work_structure', endingFamily: 'ordinary_office_ready', priority: 96,
    value: valueAssessment(3, 3, 3, 3),
    render: ({ model }) => `${itemName(model, 'top', '衬衫')}把上半身定得利落，${itemName(model, 'bottom', '直筒裤')}顺着这个线条，普通上班日不必再加复杂外层`,
  }),
  sceneMessage({
    id: 'message.work-pattern-control', scene: 'work', intent: MESSAGE_INTENTS.PATTERN_BALANCE,
    reasonCodes: ['WORK_PATTERN_TOP_SOLID_BOTTOM'], requiredFactOptions: [['pattern_visible', 'solid_color']],
    dimension: 'pattern', openingFamily: 'pattern_subject', endingFamily: 'single_visual_focus', priority: 94,
    value: valueAssessment(3, 3, 3, 3), render: renderPatternBalance,
  }),
  sceneMessage({
    id: 'message.work-simple-support', scene: 'work', intent: MESSAGE_INTENTS.WORK_SIMPLE_SUPPORT,
    reasonCodes: ['WORK_SIMPLE_DRESS_SHOES', 'WORK_SIMPLE_TOP_PANTS_SHOES'], requiredFactOptions: [['simple_style', 'outing_shoe'], ['simple_style', 'long_pants', 'outing_shoe']],
    dimension: 'style', openingFamily: 'simple_core', endingFamily: 'accessory_restraint', priority: 88,
    value: valueAssessment(3, 3, 3, 3),
    render: ({ model }) => `${joinChinese(outfitItemNames(model))}都保持简单，普通上班日把配饰留少一点反而更合适`,
  }),
  sceneMessage({
    id: 'message.work-hot-balance', scene: 'work', intent: MESSAGE_INTENTS.WORK_WEATHER_BALANCE,
    reasonCodes: ['WORK_HOT_SHORT_SLEEVE_PANTS'], requiredFactOptions: [['short_sleeve', 'long_pants']],
    dimension: 'weather', openingFamily: 'weather_first', endingFamily: 'work_weather_balance', priority: 90,
    value: valueAssessment(3, 3, 3, 3),
    render: ({ model }) => `气温高时上身留${itemName(model, 'top', '短袖')}，下身仍用${itemName(model, 'bottom', '长裤')}，通勤不必再叠一层`,
  }),
  sceneMessage({
    id: 'message.work-cool-balance', scene: 'work', intent: MESSAGE_INTENTS.WORK_WEATHER_BALANCE,
    reasonCodes: ['WORK_COOL_LONG_SLEEVE_PANTS'], requiredFactOptions: [['long_sleeve', 'long_pants']],
    dimension: 'weather', openingFamily: 'weather_first', endingFamily: 'work_weather_balance', priority: 90,
    value: valueAssessment(3, 3, 3, 3),
    render: ({ model }) => `天气偏凉时用${itemName(model, 'top', '长袖')}和${itemName(model, 'bottom', '长裤')}先挡一层，进办公室再按温度减外套`,
  }),
  sceneMessage({
    id: 'message.work-use-boundary', scene: 'work', intent: MESSAGE_INTENTS.WORK_USE_BOUNDARY,
    reasonCodes: ['WORK_BASELINE_PRESENTABLE', 'WORK_V4_EVIDENCE_SUPPORTED'], requiredFactOptions: [['work_eligible'], ['category']],
    dimension: 'scene', openingFamily: 'use_boundary', endingFamily: 'formal_work_boundary', priority: 46,
    value: valueAssessment(2, 2, 3, 3),
    render: () => '普通上班日可以直接用这组；遇到正式会议，再换成更明确的商务搭配',
  }),

  sceneMessage({
    id: 'message.date-pattern-focus', scene: 'date', intent: MESSAGE_INTENTS.DATE_FOCAL_POINT,
    reasonCodes: ['DATE_PATTERN_TOP_SIMPLE_SUPPORT', 'DATE_PATTERN_DRESS_SIMPLE_SHOES'], requiredFactOptions: [['pattern_visible', 'solid_color', 'simple_style'], ['dress', 'pattern_visible', 'simple_style']],
    dimension: 'pattern', openingFamily: 'pattern_subject', endingFamily: 'single_visual_focus', priority: 98,
    value: valueAssessment(3, 3, 3, 3), render: renderPatternBalance,
  }),
  sceneMessage({
    id: 'message.date-bright-focus', scene: 'date', intent: MESSAGE_INTENTS.DATE_FOCAL_POINT,
    reasonCodes: ['DATE_BRIGHT_TOP_BASIC_SUPPORT', 'DATE_BRIGHT_SHOES_BASIC_CLOTHES'], requiredFactOptions: [['bright_color', 'basic_color']],
    dimension: 'color', openingFamily: 'bright_subject', endingFamily: 'single_visual_focus', priority: 96,
    value: valueAssessment(3, 3, 3, 3), render: renderDateBrightFocus,
  }),
  sceneMessage({
    id: 'message.date-color-echo', scene: 'date', intent: MESSAGE_INTENTS.COLOR_ECHO,
    reasonCodes: ['DATE_COLOR_COORDINATED'], requiredFactOptions: [['color_coordinated']],
    dimension: 'color', openingFamily: 'paired_color_subjects', endingFamily: 'color_echo_effect', priority: 82,
    value: valueAssessment(2, 2, 3, 3), render: renderDateColorCoordination,
  }),
  sceneMessage({
    id: 'message.date-simple-support', scene: 'date', intent: MESSAGE_INTENTS.DATE_SIMPLE_SUPPORT,
    reasonCodes: ['DATE_SIMPLE_DRESS_SHOES', 'DATE_SIMPLE_COMPLETE'], requiredFactOptions: [['dress', 'simple_style', 'outing_shoe'], ['simple_style', 'outing_shoe']],
    dimension: 'style', openingFamily: 'simple_core', endingFamily: 'one_optional_change', priority: 86,
    value: valueAssessment(3, 3, 3, 3),
    render: ({ model }) => `${joinChinese(outfitItemNames(model))}都保持简单，约会时想加变化，留给一件配饰就够`,
  }),
  sceneMessage({
    id: 'message.date-use-boundary', scene: 'date', intent: MESSAGE_INTENTS.DATE_USE_BOUNDARY,
    reasonCodes: ['DATE_V4_EVIDENCE_SUPPORTED'], requiredFactOptions: [['category']],
    dimension: 'scene', openingFamily: 'use_boundary', endingFamily: 'formal_date_boundary', priority: 45,
    value: valueAssessment(2, 2, 3, 3),
    render: () => '这身更适合吃饭、逛街这类日常约会；如果场合有正式要求，再换更明确的搭配',
  }),

  sceneMessage({
    id: 'message.sport-complete', scene: 'sport', intent: MESSAGE_INTENTS.SPORT_ACTIVITY_STRUCTURE,
    reasonCodes: ['SPORT_COMPLETE_SET'], requiredFactOptions: [['sport_top', 'sport_bottom', 'sport_shoe']],
    dimension: 'activity', openingFamily: 'sport_equipment', endingFamily: 'light_activity_ready', priority: 98,
    value: valueAssessment(3, 3, 3, 3),
    render: ({ model }) => `${itemName(model, 'top', '运动上衣')}、${itemName(model, 'bottom', '运动裤')}和${itemName(model, 'shoes', '运动鞋')}都有运动属性，散步或快走时不用拿日常鞋临时顶替`,
  }),
  sceneMessage({
    id: 'message.sport-light-activity', scene: 'sport', intent: MESSAGE_INTENTS.SPORT_ACTIVITY_STRUCTURE,
    reasonCodes: ['SPORT_LIGHT_ACTIVITY_SET', 'SPORT_DRESS_SHOES'], requiredFactOptions: [['sport_top', 'shorts', 'sport_shoe'], ['category', 'sport_bottom', 'sport_shoe'], ['dress', 'sport_shoe']],
    dimension: 'activity', openingFamily: 'activity_outfit', endingFamily: 'training_boundary', priority: 92,
    value: valueAssessment(3, 3, 3, 3),
    render: ({ model }) => `${joinChinese(apparelNames(model))}配上${itemName(model, 'shoes', '运动鞋')}，适合散步、快走这类轻活动；正式训练还得按运动项目换装备`,
  }),
  sceneMessage({
    id: 'message.sport-hot-layer', scene: 'sport', intent: MESSAGE_INTENTS.SPORT_WEATHER_LAYER,
    reasonCodes: ['SPORT_HOT_SLEEVELESS_SHORTS', 'SPORT_HOT_SHORT_SLEEVE_SHORTS'], requiredFactOptions: [['sleeveless', 'shorts', 'sport_bottom', 'sport_shoe'], ['short_sleeve', 'shorts', 'sport_bottom', 'sport_shoe']],
    dimension: 'weather', openingFamily: 'weather_first', endingFamily: 'activity_layer_choice', priority: 94,
    value: valueAssessment(3, 3, 3, 3),
    render: ({ model }) => `气温高时用${itemName(model, 'top', '短上衣')}和${itemName(model, 'bottom', '运动短裤')}，开始活动前不用先脱一层`,
  }),
  sceneMessage({
    id: 'message.sport-cool-layer', scene: 'sport', intent: MESSAGE_INTENTS.SPORT_WEATHER_LAYER,
    reasonCodes: ['SPORT_COOL_OUTERWEAR', 'SPORT_COOL_LONG_SET'], requiredFactOptions: [['sport_outerwear', 'sport_shoe'], ['long_sleeve', 'sport_top', 'long_pants', 'sport_bottom', 'sport_shoe']],
    dimension: 'weather', openingFamily: 'weather_first', endingFamily: 'warmup_layer_choice', priority: 94,
    value: valueAssessment(3, 3, 3, 3),
    render: ({ model }) => `天气偏凉时先留${itemName(model, 'outerwear', itemName(model, 'top', '长袖运动上衣'))}挡一层，热身后再减掉外层`,
  }),
  sceneMessage({
    id: 'message.sport-use-boundary', scene: 'sport', intent: MESSAGE_INTENTS.SPORT_USE_BOUNDARY,
    reasonCodes: ['SPORT_V4_EVIDENCE_SUPPORTED'], requiredFactOptions: [['category']],
    dimension: 'scene', openingFamily: 'use_boundary', endingFamily: 'training_boundary', priority: 48,
    value: valueAssessment(2, 2, 3, 3),
    render: () => '这组按散步或日常走动来用；正式训练仍要根据具体运动项目换装备',
  }),
]);

const COMPOSED_MESSAGE_DEFINITIONS = Object.freeze(
  ['home', 'work', 'date', 'sport'].flatMap((scene) => RELATION_MESSAGE_DEFINITIONS.map((relationDefinition) => (
    compositionMessage(scene, relationDefinition)
  ))),
);

const DETAIL_MESSAGE_DEFINITIONS = Object.freeze([
  detailMessage('detail.pattern-balance', ['PATTERN_SOLID_BALANCE'], MESSAGE_INTENTS.PATTERN_BALANCE,
    ({ model, relation }) => `${itemLabel(model, relation.roles[0], '印花单品')}和${itemLabel(model, relation.roles[1], '纯色单品')}已经把图案分开，之后加外套或包时避开第二种图案`),
  detailMessage('detail.color-focal-support', ['TOP_ACCENT_WITH_NEUTRAL_BOTTOM'], MESSAGE_INTENTS.COLOR_FOCAL_SUPPORT,
    ({ model }) => `${itemLabel(model, 'top', '亮色上衣')}和${itemLabel(model, 'bottom', '中性下装')}已经分出主次，新增单品时优先沿用下装的中性色`),
  detailMessage('detail.color-echo', ['COLOR_ECHO_TOP_SHOES', 'COLOR_ECHO_ONEPIECE_SHOES', 'COLOR_ECHO_BOTTOM_SHOES'], MESSAGE_INTENTS.COLOR_ECHO,
    ({ model, relation }) => `${joinChinese(relation.roles.map((role) => itemLabel(model, role, '单品')))}已经前后呼应，中间的单品不必再追着同色`),
  detailMessage('detail.color-unity', ['SAME_COLOR_ALL_ROLES', 'SAME_COLOR_TOP_BOTTOM'], MESSAGE_INTENTS.COLOR_UNITY,
    ({ model, relation }) => `${joinChinese(relation.roles.map((role) => itemLabel(model, role, '单品')))}把主体颜色连起来了，后加的鞋或外层可以换一个中性色`),
  detailMessage('detail.neutral-support', ['NEUTRAL_COLOR_BRIDGE'], MESSAGE_INTENTS.NEUTRAL_SUPPORT,
    ({ model, relation }) => `${joinChinese(relation.roles.map((role) => itemLabel(model, role, '单品')))}都偏中性，想加变化时只留一件有颜色的配饰`),
  detailMessage('detail.onepiece-layer', ['STRUCTURE_ONEPIECE_OUTERWEAR'], MESSAGE_INTENTS.LAYERING_LOGIC,
    ({ model }) => `${itemName(model, 'onepiece', '连衣裙')}负责内层，${itemName(model, 'outerwear', '外套')}只负责加一层，脱掉外套后仍是一身`),
  detailMessage('detail.onepiece-decision', ['STRUCTURE_ONEPIECE_SHOES', 'STRUCTURE_ONEPIECE_ONLY'], MESSAGE_INTENTS.ONEPIECE_DECISION,
    ({ model }) => `${itemName(model, 'onepiece', '连衣裙')}已经省掉上下装配对，剩下的鞋和外层按天气与行程决定`),
]);

const SAFE_FALLBACK = Object.freeze({
  strategy: 'highest-value-grounded-message',
  allowGenericSentence: false,
  allowSceneLabelRestatement: false,
});

const RELATION_SLOTS = buildRelationCompatibilityRegistry();
const SCENE_VALUE_SLOTS = SCENE_MESSAGE_DEFINITIONS;
const BENEFIT_SLOTS = Object.freeze([]);
const DETAIL_RELATION_SLOTS = buildDetailCompatibilityRegistry();

function buildNaturalTodayCopyCandidates(model = {}, onlyRelation = null) {
  const qualification = normalizeQualification(model?.qualification);
  const relations = onlyRelation?.relationCode
    ? [onlyRelation]
    : Array.isArray(model?.relations) ? model.relations : [];
  const relationCandidates = relations.flatMap((relation) => RELATION_MESSAGE_DEFINITIONS
    .filter((definition) => definition.relationCodes.includes(relation?.relationCode))
    .map((definition) => buildRelationCandidate(definition, model, relation, qualification))
    .filter(Boolean));
  const sceneCandidates = SCENE_MESSAGE_DEFINITIONS
    .filter((definition) => definition.scene === model?.scene
      && definition.reasonCodes.includes(qualification.reasonCode))
    .map((definition) => buildSceneCandidate(definition, model, qualification, relations[0]))
    .filter(Boolean);
  const onepieceCompositionCandidate = relationCandidates.find((candidate) => (
    [MESSAGE_INTENTS.ONEPIECE_DECISION, MESSAGE_INTENTS.LAYERING_LOGIC].includes(candidate.messageIntent)
  ));
  const compositionCandidates = sceneCandidates.flatMap((sceneCandidate) => relationCandidates
    .filter((relationCandidate) => relationCandidate.source === 'presentation_relation'
      && relationCandidate.messageIntent !== sceneCandidate.messageIntent
      && (!onepieceCompositionCandidate || relationCandidate === onepieceCompositionCandidate))
    .map((relationCandidate) => buildCompositionCandidate(model, relationCandidate, sceneCandidate))
    .filter(Boolean));
  return [...compositionCandidates, ...relationCandidates, ...sceneCandidates]
    .filter((candidate) => isHighValueAssessment(candidate.valueAssessment))
    .sort(compareCandidates);
}

function buildCompositionCandidate(model, relationCandidate, sceneCandidate) {
  const definition = COMPOSED_MESSAGE_DEFINITIONS.find((entry) => entry.scene === model?.scene
    && entry.relationTemplateId === relationCandidate.templateId);
  const relation = asArray(model?.relations).find((entry) => entry?.relationCode === relationCandidate.relationCode
    && asArray(entry?.subjectItemIds).some((itemId) => relationCandidate.subjectItemIds.includes(itemId)));
  const relationLead = renderRelationLead(model, relation || {
    relationCode: relationCandidate.relationCode,
    roles: [],
  });
  const sceneContinuation = renderSceneContinuation(sceneCandidate, relationCandidate);
  if (!definition || !relationLead || !sceneContinuation) return null;
  return {
    candidateId: `${definition.id}:${relationCandidate.relationCode}:${sceneCandidate.candidateId}`,
    templateId: definition.id,
    messageIntent: definition.intent,
    relationCode: relationCandidate.relationCode,
    dimension: `${relationCandidate.dimension}+${sceneCandidate.dimension}`,
    openingFamily: relationCandidate.openingFamily,
    endingFamily: sceneCandidate.endingFamily,
    priority: Math.max(relationCandidate.priority, sceneCandidate.priority)
      + relationCandidate.valueAssessment.total,
    text: stripTerminalPunctuation(`${relationLead}${sceneContinuation}`),
    subjectItemIds: uniqueStrings([
      ...relationCandidate.subjectItemIds,
      ...sceneCandidate.subjectItemIds,
    ]),
    evidenceFactIds: uniqueStrings([
      ...relationCandidate.evidenceFactIds,
      ...sceneCandidate.evidenceFactIds,
    ]),
    authorizationIds: uniqueStrings(sceneCandidate.authorizationIds),
    informationKey: `message:${definition.intent}:${relationCandidate.informationKey}:${sceneCandidate.informationKey}`,
    source: 'evidence_composition',
    valueAssessment: definition.value,
  };
}

function buildNaturalTodayCopyPlan(model = {}, relation = {}, options = {}) {
  const considerAllRelations = Boolean(options?.candidateId);
  const candidates = buildNaturalTodayCopyCandidates(model, considerAllRelations ? null : relation);
  const selected = candidates.find((candidate) => candidate.candidateId === options?.candidateId)
    || candidates[0];
  return selected ? candidateToPlan('today', model, selected, candidates.length) : emptyPlan('today', model, relation);
}

function buildNaturalDetailCopyPlan(model = {}, relation = {}) {
  const definition = DETAIL_MESSAGE_DEFINITIONS.find((entry) => entry.relationCodes.includes(relation?.relationCode));
  if (!definition) return emptyPlan('detail', model, relation);
  const text = stripTerminalPunctuation(definition.render({ model, relation }));
  if (!text) return emptyPlan('detail', model, relation);
  const candidate = {
    candidateId: `${definition.id}:${relation.relationCode}`,
    templateId: definition.id,
    messageIntent: definition.intent,
    relationCode: relation.relationCode,
    dimension: definition.dimension,
    openingFamily: definition.openingFamily,
    endingFamily: definition.endingFamily,
    text,
    subjectItemIds: uniqueStrings(relation.subjectItemIds),
    evidenceFactIds: uniqueStrings(relation.evidenceFactIds),
    authorizationIds: [],
    informationKey: `detail:${definition.intent}:${relation.relationCode}`,
    source: 'presentation_relation',
    valueAssessment: definition.value,
  };
  return candidateToPlan('detail', model, candidate, 1);
}

function buildRelationCandidate(definition, model, relation, qualification) {
  const usesQualification = definition.sceneReasonCodes.includes(qualification.reasonCode);
  const text = stripTerminalPunctuation(definition.render({ model, relation, qualification }));
  if (!text) return null;
  const assessment = usesQualification
    ? withSceneRelevance(definition.value, Math.max(2, definition.value.sceneRelevance))
    : definition.value;
  return {
    candidateId: `${definition.id}:${relation.relationCode}:${usesQualification ? qualification.reasonCode : 'relation'}`,
    templateId: definition.id,
    messageIntent: definition.intent,
    relationCode: relation.relationCode,
    dimension: definition.dimension,
    openingFamily: definition.openingFamily,
    endingFamily: definition.endingFamily,
    priority: definition.priority + (usesQualification ? 4 : 0),
    text,
    subjectItemIds: uniqueStrings([
      ...asArray(relation.subjectItemIds),
      ...(usesQualification ? qualification.subjectItemIds : []),
    ]),
    evidenceFactIds: uniqueStrings([
      ...asArray(relation.evidenceFactIds),
      ...(usesQualification ? qualification.supportingFactIds : []),
    ]),
    authorizationIds: usesQualification ? [`eligibility:${qualification.reasonCode}`] : [],
    informationKey: `message:${definition.intent}:${relation.relationCode}:${usesQualification ? qualification.reasonCode : 'relation'}`,
    source: usesQualification ? 'evidence_composition' : 'presentation_relation',
    valueAssessment: assessment,
  };
}

function buildSceneCandidate(definition, model, qualification, fallbackRelation) {
  const facts = new Set(qualification.evidence.map((record) => record.fact));
  const matchedFacts = definition.requiredFactOptions.find((option) => option.every((fact) => facts.has(fact)));
  if (!matchedFacts) return null;
  const evidence = qualification.evidence.filter((record) => matchedFacts.includes(record.fact));
  const text = stripTerminalPunctuation(definition.render({ model, qualification }));
  if (!text) return null;
  return {
    candidateId: `${definition.id}:${qualification.reasonCode}`,
    templateId: definition.id,
    messageIntent: definition.intent,
    relationCode: fallbackRelation?.relationCode || model?.primaryRelationCode || 'SCENE_EVIDENCE',
    dimension: definition.dimension,
    openingFamily: definition.openingFamily,
    endingFamily: definition.endingFamily,
    priority: definition.priority,
    text,
    subjectItemIds: qualification.subjectItemIds.length > 0
      ? qualification.subjectItemIds
      : uniqueStrings(asArray(fallbackRelation?.subjectItemIds)),
    evidenceFactIds: uniqueStrings(evidence.map((record) => record.factId)),
    authorizationIds: [`eligibility:${qualification.reasonCode}`],
    informationKey: `message:${definition.intent}:${model.scene}:${qualification.reasonCode}`,
    source: 'core_eligibility',
    valueAssessment: definition.value,
  };
}

function candidateToPlan(surface, model, candidate, availableMessageCount) {
  const clause = clauseRecord({
    slot: surface === 'detail' ? 'detail_message' : 'message',
    templateId: candidate.templateId,
    messageIntent: candidate.messageIntent,
    text: candidate.text,
    informationKey: candidate.informationKey,
    subjectItemIds: candidate.subjectItemIds,
    evidenceFactIds: candidate.evidenceFactIds,
    authorizationIds: candidate.authorizationIds,
    relationCode: candidate.relationCode,
    scene: model?.scene,
    source: candidate.source,
    valueAssessment: candidate.valueAssessment,
  });
  const clauses = [clause];
  return {
    version: NATURAL_LANGUAGE_PLAN_VERSION,
    surface,
    scene: model?.scene || '',
    relationCode: candidate.relationCode || 'SCENE_EVIDENCE',
    messageIntent: candidate.messageIntent,
    messageCandidateId: candidate.candidateId,
    messageDimension: candidate.dimension,
    openingFamily: candidate.openingFamily,
    endingFamily: candidate.endingFamily,
    valueAssessment: { ...candidate.valueAssessment },
    availableMessageCount,
    compositionPattern: surface === 'detail' ? 'detail_message' : 'natural_message',
    clauses,
    text: joinClauses(clauses),
    fallbackStrategy: '',
  };
}

function emptyPlan(surface, model, relation) {
  return {
    version: NATURAL_LANGUAGE_PLAN_VERSION,
    surface,
    scene: model?.scene || '',
    relationCode: relation?.relationCode || 'SCENE_EVIDENCE',
    messageIntent: '',
    messageCandidateId: '',
    messageDimension: '',
    openingFamily: '',
    endingFamily: '',
    valueAssessment: valueAssessment(0, 0, 0, 0, false),
    availableMessageCount: 0,
    compositionPattern: '',
    clauses: [],
    text: '',
    fallbackStrategy: SAFE_FALLBACK.strategy,
  };
}

function joinClauses(clauses) {
  const text = asArray(clauses).map((clause) => stripTerminalPunctuation(clause?.text)).filter(Boolean).join('，');
  return text ? `${text}。` : '';
}

function clauseRecord(value) {
  return {
    slot: value.slot,
    templateId: value.templateId,
    messageIntent: value.messageIntent,
    text: stripTerminalPunctuation(value.text),
    informationKey: value.informationKey,
    subjectItemIds: uniqueStrings(value.subjectItemIds),
    evidenceFactIds: uniqueStrings(value.evidenceFactIds),
    authorizationIds: uniqueStrings(value.authorizationIds),
    relationCode: value.relationCode || 'SCENE_EVIDENCE',
    scene: value.scene || '',
    source: value.source,
    valueAssessment: { ...value.valueAssessment },
  };
}

function relationMessage(input) {
  return Object.freeze({
    ...input,
    slot: 'message',
    relationCodes: Object.freeze(input.relationCodes.slice()),
    sceneReasonCodes: Object.freeze(asArray(input.sceneReasonCodes).slice()),
    incrementalInformation: true,
    decisionValue: DECISION_VALUE_CATEGORIES.MEANINGFUL_RELATION,
  });
}

function sceneMessage(input) {
  return Object.freeze({
    ...input,
    slot: 'message',
    reasonCodes: Object.freeze(input.reasonCodes.slice()),
    requiredFactOptions: Object.freeze(input.requiredFactOptions.map((option) => Object.freeze(option.slice()))),
    incrementalInformation: true,
    decisionValue: DECISION_VALUE_CATEGORIES.MEANINGFUL_SCENE_EVIDENCE,
  });
}

function compositionMessage(scene, relationDefinition) {
  return Object.freeze({
    id: `composition.${scene}.${relationDefinition.intent}`,
    slot: 'message',
    scene,
    relationTemplateId: relationDefinition.id,
    intent: `${scene}_${relationDefinition.intent}_with_scene`,
    incrementalInformation: true,
    decisionValue: DECISION_VALUE_CATEGORIES.MEANINGFUL_BENEFIT,
    value: valueAssessment(3, 3, 3, 3),
  });
}

function detailMessage(id, relationCodes, intent, render) {
  return Object.freeze({
    id,
    slot: 'detail_message',
    relationCodes: Object.freeze(relationCodes.slice()),
    intent,
    dimension: relationCodes.some((code) => code.includes('COLOR') || code.includes('ACCENT') || code.includes('NEUTRAL')) ? 'color'
      : relationCodes.some((code) => code.includes('PATTERN')) ? 'pattern' : 'structure',
    openingFamily: intent,
    endingFamily: 'specific_advice',
    value: valueAssessment(3, 2, 0, 3),
    render,
    incrementalInformation: true,
    decisionValue: DECISION_VALUE_CATEGORIES.MEANINGFUL_BENEFIT,
  });
}

function valueAssessment(userValue, novelInformation, sceneRelevance, naturalExpressibility, factAvailable = true) {
  return Object.freeze({
    factAvailable,
    userValue,
    novelInformation,
    sceneRelevance,
    naturalExpressibility,
    total: (factAvailable ? 2 : 0) + userValue + novelInformation + sceneRelevance + naturalExpressibility,
  });
}

function withSceneRelevance(value, sceneRelevance) {
  return valueAssessment(value.userValue, value.novelInformation, sceneRelevance, value.naturalExpressibility, value.factAvailable);
}

function isHighValueAssessment(value) {
  return value?.factAvailable === true
    && value.userValue >= 2
    && value.novelInformation >= 2
    && value.naturalExpressibility >= 2;
}

function compareCandidates(left, right) {
  return right.valueAssessment.total - left.valueAssessment.total
    || right.priority - left.priority
    || left.candidateId.localeCompare(right.candidateId);
}

function normalizeQualification(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    reasonCode: readString(source.reasonCode),
    subjectItemIds: uniqueStrings(source.subjectItemIds),
    supportingFactIds: uniqueStrings(source.supportingFactIds),
    relationFactIds: uniqueStrings(source.relationFactIds),
    evidence: asArray(source.evidence).map((record) => ({
      factId: readString(record?.factId || record?.relationFactId),
      fact: readString(record?.fact),
      itemId: readString(record?.itemId),
    })).filter((record) => record.factId),
  };
}

function renderPatternBalance({ model, relation, qualification }) {
  const roles = relation?.roles || [];
  const patternedRole = roles[0] || findRoleByTag(model, '印花') || 'top';
  const solidRole = roles[1] || findRoleByTag(model, '纯色') || otherCoreRole(patternedRole);
  const patterned = itemLabel(model, patternedRole, '印花单品');
  const solid = itemLabel(model, solidRole, '纯色单品');
  const scene = model?.scene;
  const reasonCode = qualification?.reasonCode || '';
  if (scene === 'home' && reasonCode === 'HOME_PATTERN_TOP_SOLID_BOTTOM') {
    return `${patterned}保留图案，${solid}不再加图案，在家穿也不会上下都花`;
  }
  if (scene === 'work' && reasonCode === 'WORK_PATTERN_TOP_SOLID_BOTTOM') {
    return `${patterned}保留图案，${solid}用纯色，上班时不会让上下装一起抢注意力`;
  }
  if (scene === 'date' && /^DATE_PATTERN_/.test(reasonCode)) {
    return `${patterned}把图案留在一处，${solid}保持简单，约会时有一个重点就够`;
  }
  return `${patterned}保留图案，${solid}用纯色，搭在一起不会有两个重点`;
}

function renderColorEcho({ model, relation }) {
  const [leftRole, rightRole] = relation.roles;
  const left = itemLabel(model, leftRole, '单品');
  const right = itemLabel(model, rightRole, '单品');
  if (relation.relationCode === 'COLOR_ECHO_TOP_SHOES') {
    return `${left}和${right}同色，颜色隔着下装还能前后呼应`;
  }
  if (relation.relationCode === 'COLOR_ECHO_BOTTOM_SHOES') {
    return `${left}和${right}同色，下半身到鞋的颜色不会突然断开`;
  }
  return `${left}和${right}同色，鞋子不会从整身颜色里单独跳出来`;
}

function renderColorUnity({ model, relation = {} }) {
  const roles = relation.roles?.length > 0
    ? relation.roles
    : ['top', 'bottom'].filter((role) => itemForRole(model, role));
  const labels = roles.map((role) => itemLabel(model, role, '单品'));
  if (labels.length >= 3) return `${joinChinese(labels)}都用同色，整身只留一个主色，外层不必继续追着同色`;
  return `${joinChinese(labels)}用同色把主体连起来，鞋和外层可以留给另一个中性色`;
}

function renderDateBrightFocus({ model, qualification }) {
  const subjectIds = new Set(qualification?.subjectItemIds || []);
  const subjects = asArray(model?.items).filter((item) => subjectIds.has(item.itemId));
  const focal = subjects.find((item) => !isNeutralColor(item.normalizedColor))
    || asArray(model?.items).find((item) => !isNeutralColor(item.normalizedColor));
  const support = subjects.find((item) => item.itemId !== focal?.itemId && isNeutralColor(item.normalizedColor))
    || asArray(model?.items).find((item) => item.itemId !== focal?.itemId && isNeutralColor(item.normalizedColor));
  return `${fullItemLabel(focal, '亮色单品')}颜色更亮，${fullItemLabel(support, '基础色单品')}保持安静，约会时不必再加第二个亮色`;
}

function renderDateColorCoordination({ model, qualification }) {
  const subjectIds = new Set(qualification?.subjectItemIds || []);
  const subjects = asArray(model?.items).filter((item) => subjectIds.has(item.itemId));
  const core = subjects.length >= 2
    ? subjects
    : asArray(model?.items).filter((item) => ['onepiece', 'top', 'bottom', 'shoes'].includes(item.role)).slice(0, 2);
  return `${joinChinese(core.map((item) => fullItemLabel(item, '单品')))}已经把主色定下来，想加变化时留给鞋或配饰，不必从头到脚都追着同色`;
}

function renderRelationLead(model, relation = {}) {
  const roles = asArray(relation.roles);
  if (relation.relationCode === 'PATTERN_SOLID_BALANCE') {
    return `${itemLabel(model, roles[0], '印花单品')}把图案留在一处，${itemLabel(model, roles[1], '纯色单品')}保持纯色`;
  }
  if (relation.relationCode === 'TOP_ACCENT_WITH_NEUTRAL_BOTTOM') {
    return `${itemLabel(model, 'top', '亮色上衣')}搭${itemLabel(model, 'bottom', '中性下装')}，亮色只留在上半身`;
  }
  if (['COLOR_ECHO_TOP_SHOES', 'COLOR_ECHO_ONEPIECE_SHOES', 'COLOR_ECHO_BOTTOM_SHOES'].includes(relation.relationCode)) {
    return `${joinChinese(roles.map((role) => itemLabel(model, role, '单品')))}用同色前后呼应`;
  }
  if (['SAME_COLOR_ALL_ROLES', 'SAME_COLOR_TOP_BOTTOM'].includes(relation.relationCode)) {
    return `${joinChinese(roles.map((role) => itemLabel(model, role, '单品')))}先把主色统一`;
  }
  if (relation.relationCode === 'NEUTRAL_COLOR_BRIDGE') {
    return `${joinChinese(roles.map((role) => itemLabel(model, role, '单品')))}先用中性色打底`;
  }
  if (relation.relationCode === 'STRUCTURE_ONEPIECE_OUTERWEAR') {
    return `${itemName(model, 'onepiece', '连衣裙')}先省掉上下装配对，${itemName(model, 'outerwear', '外套')}只负责加一层`;
  }
  if (relation.relationCode === 'STRUCTURE_ONEPIECE_SHOES') {
    return `${itemName(model, 'onepiece', '连衣裙')}先省掉上下装配对，${itemName(model, 'shoes', '鞋子')}也定下来了`;
  }
  if (relation.relationCode === 'STRUCTURE_ONEPIECE_ONLY') {
    return `${itemName(model, 'onepiece', '连衣裙')}先省掉上下装配对`;
  }
  return '';
}

function renderSceneContinuation(candidate, relationCandidate) {
  const id = candidate?.templateId;
  if (id === 'message.home-dress-outing'
    && relationCandidate?.messageIntent === MESSAGE_INTENTS.ONEPIECE_DECISION) {
    return '；临时下楼不用再找另一套';
  }
  if (id === 'message.sport-light-activity'
    && relationCandidate?.messageIntent === MESSAGE_INTENTS.ONEPIECE_DECISION) {
    return '；适合散步、快走，正式训练再按项目换装备';
  }
  const continuations = {
    'message.home-light-layers': '；短袖和短裤在家坐着或走动时都不碍事',
    'message.home-movement-room': '；宽松余量留给在家坐着、起身和走动',
    'message.home-quick-outing': '；长裤让临时下楼不用再换下装',
    'message.home-dress-outing': '；鞋也选好了，临时下楼不用另找一套',
    'message.home-cool-layer': '；天气偏凉时先留这层，在家不用一开始就叠外套',
    'message.home-use-boundary': '；在家或临时下楼可以沿用，行程更久再按天气补外层',
    'message.work-structured': '；普通上班日不必再加复杂外层',
    'message.work-simple-support': '；普通上班日不必再加复杂配饰',
    'message.work-hot-balance': '；气温高时上身不用再叠一层',
    'message.work-cool-balance': '；天气偏凉时先挡一层，进办公室再按温度减外套',
    'message.work-use-boundary': '；这组只按普通上班日来用，正式会议再换更明确的商务搭配',
    'message.date-simple-support': '；约会时想加变化，留给一件配饰就够',
    'message.date-use-boundary': '；它更适合吃饭、逛街这类日常约会，正式场合另换一组',
    'message.sport-complete': '；三类单品都有运动属性，散步或快走时不用拿日常鞋顶替',
    'message.sport-light-activity': '；配上运动鞋适合散步、快走，正式训练再按项目换装备',
    'message.sport-hot-layer': '；气温高时开始活动前不用再脱一层',
    'message.sport-cool-layer': '；天气偏凉时先挡一层，热身后再减掉外层',
    'message.sport-use-boundary': '；适合散步、日常走动，正式训练再按项目换装备',
  };
  return continuations[id] || '';
}

function buildRelationCompatibilityRegistry() {
  const codes = [
    'SAME_COLOR_ALL_ROLES', 'SAME_COLOR_TOP_BOTTOM', 'COLOR_ECHO_TOP_SHOES',
    'COLOR_ECHO_ONEPIECE_SHOES', 'COLOR_ECHO_BOTTOM_SHOES', 'SUBTYPE_FEATURE_PRINT',
    'PATTERN_SOLID_BALANCE', 'TOP_ACCENT_WITH_NEUTRAL_BOTTOM', 'DISTINCT_TOP_BOTTOM_COLOR',
    'NEUTRAL_COLOR_BRIDGE', 'SINGLE_COLOR_FALLBACK', 'STRUCTURE_ONEPIECE_OUTERWEAR',
    'STRUCTURE_ONEPIECE_SHOES', 'STRUCTURE_ONEPIECE_ONLY', 'STRUCTURE_SINGLE_ITEM',
    'STRUCTURE_TOP_BOTTOM',
  ];
  return Object.freeze(Object.fromEntries(codes.map((code) => {
    const definition = RELATION_MESSAGE_DEFINITIONS.find((entry) => entry.relationCodes.includes(code));
    return [code, definition || Object.freeze({
      id: `low-value.${code.toLowerCase()}`,
      slot: 'message',
      relationCodes: Object.freeze([code]),
      decisionValue: DECISION_VALUE_CATEGORIES.FACTUAL_BUT_LOW_VALUE,
      incrementalInformation: false,
    })];
  })));
}

function buildDetailCompatibilityRegistry() {
  return Object.freeze(Object.fromEntries(Object.keys(RELATION_SLOTS).map((code) => {
    const definition = DETAIL_MESSAGE_DEFINITIONS.find((entry) => entry.relationCodes.includes(code));
    return [code, definition || RELATION_SLOTS[code]];
  })));
}

function itemForRole(model, role) {
  return asArray(model?.items).find((item) => item.role === role);
}

function itemName(model, role, fallback) {
  const item = itemForRole(model, role);
  return item?.canonicalSubtype || item?.canonicalName || fallback;
}

function itemLabel(model, role, fallback) {
  return fullItemLabel(itemForRole(model, role), fallback);
}

function fullItemLabel(item, fallback) {
  return `${item?.normalizedColor || ''}${item?.canonicalSubtype || item?.canonicalName || fallback}`;
}

function outfitItemNames(model) {
  return asArray(model?.items).map((item) => item?.canonicalSubtype || item?.canonicalName).filter(Boolean);
}

function apparelNames(model) {
  return asArray(model?.items)
    .filter((item) => ['onepiece', 'top', 'bottom', 'outerwear'].includes(item?.role))
    .map((item) => item?.canonicalSubtype || item?.canonicalName)
    .filter(Boolean);
}

function findRoleByTag(model, tag) {
  return asArray(model?.items).find((item) => asArray(item?.visibleFeatureTags).includes(tag))?.role || '';
}

function otherCoreRole(role) {
  return role === 'top' ? 'bottom' : role === 'onepiece' ? 'shoes' : 'top';
}

function isNeutralColor(color) {
  return /黑|白|灰|藏青|米|棕/.test(readString(color));
}

function joinChinese(values) {
  const list = uniqueStrings(values);
  if (list.length <= 1) return list[0] || '';
  if (list.length === 2) return `${list[0]}和${list[1]}`;
  return `${list.slice(0, -1).join('、')}和${list.at(-1)}`;
}

function stripTerminalPunctuation(value) {
  return readString(value).replace(/[，。！？；,.!?;]+$/u, '');
}

function readString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function uniqueStrings(values) {
  return [...new Set(asArray(values).map(readString).filter(Boolean))];
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

module.exports = {
  BENEFIT_SLOTS,
  COMPOSED_MESSAGE_DEFINITIONS,
  DECISION_VALUE_CATEGORIES,
  DETAIL_MESSAGE_DEFINITIONS,
  DETAIL_RELATION_SLOTS,
  LOW_VALUE_RELATION_CODES,
  MESSAGE_INTENTS,
  NATURAL_LANGUAGE_PLAN_VERSION,
  RELATION_MESSAGE_DEFINITIONS,
  RELATION_SLOTS,
  SAFE_FALLBACK,
  SCENE_MESSAGE_DEFINITIONS,
  SCENE_VALUE_SLOTS,
  buildNaturalDetailCopyPlan,
  buildNaturalTodayCopyCandidates,
  buildNaturalTodayCopyPlan,
  isHighValueAssessment,
  joinClauses,
};
