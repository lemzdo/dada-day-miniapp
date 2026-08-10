const NATURAL_LANGUAGE_PLAN_VERSION = 'recommendation-natural-language-v1';

const RELATION_SLOTS = Object.freeze({
  SAME_COLOR_ALL_ROLES: relationSlot('relation.same-color-all', ({ model, relation }) => {
    const names = relation.roles.map((role) => itemName(model, role, '单品'));
    const color = itemForRole(model, relation.roles[0])?.normalizedColor || '';
    return `${joinChinese(names)}都用了${color || '同一个颜色'}`;
  }),
  SAME_COLOR_TOP_BOTTOM: relationSlot('relation.same-color-top-bottom', ({ model }) => {
    const top = itemForRole(model, 'top');
    const bottom = itemForRole(model, 'bottom');
    return `${itemName(model, 'top', '上衣')}和${itemName(model, 'bottom', '下装')}都用了${top?.normalizedColor || bottom?.normalizedColor || '同一个颜色'}`;
  }),
  COLOR_ECHO_TOP_SHOES: relationSlot('relation.color-echo-top-shoes', ({ model }) => (
    `${itemLabel(model, 'top', '上衣')}和${itemLabel(model, 'shoes', '鞋子')}用同色呼应`
  )),
  COLOR_ECHO_ONEPIECE_SHOES: relationSlot('relation.color-echo-onepiece-shoes', ({ model }) => (
    `${itemLabel(model, 'onepiece', '连衣裙')}和${itemLabel(model, 'shoes', '鞋子')}用同色呼应`
  )),
  COLOR_ECHO_BOTTOM_SHOES: relationSlot('relation.color-echo-bottom-shoes', ({ model }) => (
    `${itemLabel(model, 'bottom', '下装')}和${itemLabel(model, 'shoes', '鞋子')}用同色呼应`
  )),
  SUBTYPE_FEATURE_PRINT: relationSlot('relation.print-focus', ({ model, relation }) => (
    `${itemLabel(model, relation.roles[0], '印花单品')}的印花已经是这身的重点`
  )),
  PATTERN_SOLID_BALANCE: relationSlot('relation.pattern-solid', ({ model, relation }) => (
    `${itemLabel(model, relation.roles[0], '印花单品')}有图案，${itemLabel(model, relation.roles[1], '纯色单品')}保持纯色`
  )),
  TOP_ACCENT_WITH_NEUTRAL_BOTTOM: relationSlot('relation.accent-neutral', ({ model }) => (
    `${itemLabel(model, 'top', '上衣')}配${itemLabel(model, 'bottom', '下装')}，亮色留在上半身`
  )),
  DISTINCT_TOP_BOTTOM_COLOR: relationSlot('relation.distinct-top-bottom', ({ model }) => (
    `${itemLabel(model, 'top', '上衣')}配${itemLabel(model, 'bottom', '下装')}，其他单品沿用这两个颜色就好`
  )),
  NEUTRAL_COLOR_BRIDGE: relationSlot('relation.neutral-pair', ({ model, relation }) => (
    `${itemLabel(model, relation.roles[0], '单品')}和${itemLabel(model, relation.roles[1], '单品')}都是中性色`
  )),
  SINGLE_COLOR_FALLBACK: relationSlot('relation.single-color', ({ model, relation }) => (
    `${itemLabel(model, relation.roles[0], '这件单品')}定下了这身的主色`
  )),
  STRUCTURE_ONEPIECE_OUTERWEAR: relationSlot('relation.onepiece-outerwear', ({ model }) => (
    `${itemName(model, 'onepiece', '连衣裙')}放在里面，${itemName(model, 'outerwear', '外套')}叠在外面`
  )),
  STRUCTURE_ONEPIECE_SHOES: relationSlot('relation.onepiece-shoes', ({ model }) => (
    `${itemName(model, 'onepiece', '连衣裙')}配${itemName(model, 'shoes', '鞋子')}`
  )),
  STRUCTURE_ONEPIECE_ONLY: relationSlot('relation.onepiece-only', ({ model }) => (
    `${itemName(model, 'onepiece', '连衣裙')}单穿就能成一身`
  )),
  STRUCTURE_SINGLE_ITEM: relationSlot('relation.single-item', ({ model, relation }) => (
    `这次先穿${itemName(model, relation.roles[0], '这件单品')}`
  )),
  STRUCTURE_TOP_BOTTOM: relationSlot('relation.top-bottom', ({ model }) => (
    `${itemName(model, 'top', '上衣')}配${itemName(model, 'bottom', '下装')}`
  )),
});

const SCENE_VALUE_SLOTS = Object.freeze({
  home: sceneSlot('scene.home-direct', '宅家时可以直接这样穿', false),
  work: sceneSlot('scene.work-direct', '日常通勤可以直接这样穿', false),
  date: sceneSlot('scene.date-direct', '约会时可以直接这样穿', false),
  sport: sceneSlot('scene.sport-direct', '日常轻运动可以直接这样穿', false),
});

const BENEFIT_SLOTS = Object.freeze([
  benefitSlot('benefit.less-bundled-home', ['HOME_HOT_SLEEVELESS_SHORTS', 'HOME_SLEEVELESS_SHORTS'], ['sleeveless', 'shorts'], '无袖上衣和短裤不会裹得太多'),
  benefitSlot('benefit.less-bundled-home-short-sleeve', ['HOME_HOT_SHORT_SLEEVE_SHORTS', 'HOME_SHORT_SLEEVE_SHORTS'], ['short_sleeve', 'shorts'], '短袖和短裤不会裹得太多'),
  benefitSlot('benefit.pattern-kept-single-home', ['HOME_PATTERN_TOP_SOLID_BOTTOM'], ['pattern_visible', 'solid_color'], '纯色下装不会再加一层图案'),
  benefitSlot('benefit.loose-room-home', ['HOME_LOOSE_TWO_PIECE', 'HOME_TSHIRT_LOOSE_PANTS'], ['loose_fit'], '宽松的版型给坐着和走动留了余量'),
  benefitSlot('benefit.quick-outing-home', ['HOME_SHORT_SLEEVE_LONG_PANTS', 'HOME_TOP_LONG_PANTS', 'HOME_DRESS_NORMAL_SHOES'], [], '临时下楼也不用换一身'),
  benefitSlot('benefit.loose-dress-home', ['HOME_LOOSE_DRESS'], ['loose_fit'], '宽松裙身给坐着和走动留了余量'),
  benefitSlot('benefit.cool-long-sleeve-home', ['HOME_COOL_LONG_SLEEVE'], ['long_sleeve'], '天气偏凉时，长袖能多挡一层'),
  benefitSlot('benefit.work-shirt-straight', ['WORK_SHIRT_STRAIGHT_PANTS'], ['shirt', 'straight_cut'], '衬衫和直筒裤看起来利落'),
  benefitSlot('benefit.work-pattern-single', ['WORK_PATTERN_TOP_SOLID_BOTTOM'], ['pattern_visible', 'solid_color'], '纯色下装不会再加一层图案'),
  benefitSlot('benefit.work-simple', ['WORK_SIMPLE_DRESS_SHOES', 'WORK_SIMPLE_TOP_PANTS_SHOES'], ['simple_style'], '衣服和鞋子都保持简单，不用再补复杂配饰'),
  benefitSlot('benefit.work-hot', ['WORK_HOT_SHORT_SLEEVE_PANTS'], ['short_sleeve', 'long_pants'], '温度高时，短袖和长裤不会裹得太多'),
  benefitSlot('benefit.work-cool', ['WORK_COOL_LONG_SLEEVE_PANTS'], ['long_sleeve', 'long_pants'], '天气偏凉时，长袖和长裤能多挡一层'),
  benefitSlot('benefit.date-pattern-single', ['DATE_PATTERN_TOP_SIMPLE_SUPPORT', 'DATE_PATTERN_DRESS_SIMPLE_SHOES'], ['pattern_visible', 'simple_style'], '其他单品保持简单，图案不会显得太多'),
  benefitSlot('benefit.date-color-count', ['DATE_BRIGHT_TOP_BASIC_SUPPORT', 'DATE_BRIGHT_SHOES_BASIC_CLOTHES'], ['bright_color', 'basic_color'], '基础色单品不会再添一层抢眼颜色'),
  benefitSlot('benefit.date-accessory-simple', ['DATE_COLOR_COORDINATED'], ['color'], '配饰保持简单就够了'),
  benefitSlot('benefit.date-simple', ['DATE_SIMPLE_DRESS_SHOES', 'DATE_SIMPLE_COMPLETE'], ['simple_style', 'outing_shoe'], '衣服和鞋子都简洁，不用再加复杂细节'),
  benefitSlot('benefit.sport-complete', ['SPORT_COMPLETE_SET'], ['sport_top', 'sport_bottom', 'sport_shoe'], '运动上衣、运动裤配运动鞋，活动起来更方便'),
  benefitSlot('benefit.sport-light-set', ['SPORT_LIGHT_ACTIVITY_SET'], ['sport_shoe'], '配上运动鞋，走动更方便'),
  benefitSlot('benefit.sport-hot-sleeveless', ['SPORT_HOT_SLEEVELESS_SHORTS'], ['sleeveless', 'shorts', 'sport_shoe'], '无袖上衣和短裤不会裹得太多'),
  benefitSlot('benefit.sport-hot-short-sleeve', ['SPORT_HOT_SHORT_SLEEVE_SHORTS'], ['short_sleeve', 'shorts', 'sport_shoe'], '短袖和短裤不会裹得太多'),
  benefitSlot('benefit.sport-cool-layer', ['SPORT_COOL_OUTERWEAR', 'SPORT_COOL_LONG_SET'], ['sport_outerwear', 'sport_shoe'], '运动前有外套可以先挡一层'),
  benefitSlot('benefit.sport-dress-shoes', ['SPORT_DRESS_SHOES'], ['dress', 'sport_shoe'], '连衣裙配运动鞋，走动更方便'),
]);

const DETAIL_RELATION_SLOTS = Object.freeze({
  SAME_COLOR_ALL_ROLES: detailSlot('detail.same-color-all', ({ model, relation }) => `${joinChinese(relation.roles.map((role) => itemName(model, role, '单品')))}都用了同一个颜色，后续加单品时沿用这个颜色就行`),
  SAME_COLOR_TOP_BOTTOM: detailSlot('detail.same-color-top-bottom', ({ model }) => `${itemLabel(model, 'top', '上衣')}和${itemLabel(model, 'bottom', '下装')}同色，后续加单品时可以继续沿用这个颜色`),
  COLOR_ECHO_TOP_SHOES: detailSlot('detail.color-echo-top-shoes', ({ model }) => `${itemLabel(model, 'top', '上衣')}和${itemLabel(model, 'shoes', '鞋子')}已经互相呼应，中间的下装保留现在的颜色就好`),
  COLOR_ECHO_ONEPIECE_SHOES: detailSlot('detail.color-echo-onepiece-shoes', ({ model }) => `${itemLabel(model, 'onepiece', '连衣裙')}和${itemLabel(model, 'shoes', '鞋子')}已经互相呼应，不必再加同样抢眼的颜色`),
  COLOR_ECHO_BOTTOM_SHOES: detailSlot('detail.color-echo-bottom-shoes', ({ model }) => `${itemLabel(model, 'bottom', '下装')}和${itemLabel(model, 'shoes', '鞋子')}已经互相呼应，上衣保留现在的方向就好`),
  TOP_ACCENT_WITH_NEUTRAL_BOTTOM: detailSlot('detail.accent-neutral', ({ model }) => `${itemLabel(model, 'top', '上衣')}已经负责亮色重点，${itemLabel(model, 'bottom', '下装')}保持中性色就够了`),
  DISTINCT_TOP_BOTTOM_COLOR: detailSlot('detail.distinct-top-bottom', ({ model }) => `${itemLabel(model, 'top', '上衣')}和${itemLabel(model, 'bottom', '下装')}颜色不同，后续加单品时沿用其中一个颜色会更省事`),
  SUBTYPE_FEATURE_PRINT: detailSlot('detail.print-focus', ({ model, relation }) => `${itemLabel(model, relation.roles[0], '印花单品')}已经有图案，其他单品不用再加新的图案`),
  PATTERN_SOLID_BALANCE: detailSlot('detail.pattern-solid', ({ model, relation }) => `${itemLabel(model, relation.roles[0], '印花单品')}负责图案，${itemLabel(model, relation.roles[1], '纯色单品')}留在纯色就好`),
  NEUTRAL_COLOR_BRIDGE: detailSlot('detail.neutral-pair', ({ model, relation }) => `${itemLabel(model, relation.roles[0], '单品')}和${itemLabel(model, relation.roles[1], '单品')}都是中性色，后续加单品时沿用其中一个颜色就行`),
  STRUCTURE_ONEPIECE_OUTERWEAR: detailSlot('detail.onepiece-outerwear', ({ model }) => `${itemName(model, 'onepiece', '连衣裙')}负责内层，${itemName(model, 'outerwear', '外套')}负责外层，脱掉外套后也不用重新配上下装`),
  STRUCTURE_ONEPIECE_SHOES: detailSlot('detail.onepiece-shoes', ({ model }) => `${itemName(model, 'onepiece', '连衣裙')}是一件式结构，配好${itemName(model, 'shoes', '鞋子')}就不用再补下装`),
  STRUCTURE_ONEPIECE_ONLY: detailSlot('detail.onepiece-only', ({ model }) => `${itemName(model, 'onepiece', '连衣裙')}单穿就能成一身，其他单品按当天需要再加就行`),
  STRUCTURE_SINGLE_ITEM: detailSlot('detail.single-item', ({ model, relation }) => `先以${itemName(model, relation.roles[0], '这件单品')}为主，其他单品有明确选择时再加`),
  STRUCTURE_TOP_BOTTOM: detailSlot('detail.top-bottom', ({ model }) => `${itemName(model, 'top', '上衣')}和${itemName(model, 'bottom', '下装')}先组成主体，鞋和外套可以按当天需要再加`),
  SINGLE_COLOR_FALLBACK: detailSlot('detail.single-color', ({ model, relation }) => `${itemLabel(model, relation.roles[0], '这件单品')}已经定下主色，其他颜色先从它附近选就好`),
});

const SAFE_FALLBACK = Object.freeze({
  strategy: 'grounded-relation-only',
  allowGenericSentence: false,
  allowSceneLabelRestatement: false,
});

function buildNaturalTodayCopyPlan(model = {}, relation = {}) {
  const relationDefinition = RELATION_SLOTS[relation?.relationCode];
  if (!relationDefinition) return emptyPlan('today', model, relation);
  const relationClause = buildRelationClause(relationDefinition, model, relation);
  const clauses = hasIncrementalInformation(relationDefinition) ? [relationClause] : [];
  const qualification = normalizeQualification(model?.qualification);
  const sceneDefinition = qualification.reasonCode ? SCENE_VALUE_SLOTS[model?.scene] : null;
  if (sceneDefinition && hasIncrementalInformation(sceneDefinition)) {
    clauses.push(buildSceneClause(sceneDefinition, model, relation, qualification));
  }
  const benefitDefinition = BENEFIT_SLOTS.find((entry) => entry.reasonCodes.includes(qualification.reasonCode));
  const benefitClause = benefitDefinition && hasIncrementalInformation(benefitDefinition)
    ? buildBenefitClause(benefitDefinition, model, relation, qualification, clauses)
    : null;
  if (benefitClause) clauses.push(benefitClause);
  return finalizePlan('today', model, relation, clauses);
}

function buildNaturalDetailCopyPlan(model = {}, relation = {}) {
  const definition = DETAIL_RELATION_SLOTS[relation?.relationCode];
  if (!definition) return emptyPlan('detail', model, relation);
  const text = definition.render({ model, relation });
  const clause = clauseRecord({
    slot: 'relation',
    templateId: definition.id,
    text,
    informationKey: `relation:${relation.relationCode}`,
    subjectItemIds: relation.subjectItemIds,
    evidenceFactIds: relation.evidenceFactIds,
    authorizationIds: [],
    relationCode: relation.relationCode,
    scene: model.scene,
    source: 'presentation_relation',
  });
  return finalizePlan('detail', model, relation, [clause]);
}

function buildRelationClause(definition, model, relation) {
  return clauseRecord({
    slot: 'relation',
    templateId: definition.id,
    text: definition.render({ model, relation }),
    informationKey: `relation:${relation.relationCode}`,
    subjectItemIds: relation.subjectItemIds,
    evidenceFactIds: relation.evidenceFactIds,
    authorizationIds: [],
    relationCode: relation.relationCode,
    scene: model.scene,
    source: 'presentation_relation',
  });
}

function buildSceneClause(definition, model, relation, qualification) {
  return clauseRecord({
    slot: 'scene_value',
    templateId: definition.id,
    text: definition.text,
    informationKey: `scene:${model.scene}:${qualification.reasonCode}`,
    subjectItemIds: qualification.subjectItemIds.length > 0
      ? qualification.subjectItemIds
      : relation.subjectItemIds,
    evidenceFactIds: qualification.relationFactIds,
    authorizationIds: [`eligibility:${qualification.reasonCode}`],
    relationCode: relation.relationCode,
    scene: model.scene,
    source: 'core_eligibility',
  });
}

function buildBenefitClause(definition, model, relation, qualification, previousClauses) {
  const evidence = qualification.evidence.filter((record) => definition.requiredFacts.includes(record.fact));
  if (definition.requiredFacts.length > 0
    && !definition.requiredFacts.every((fact) => evidence.some((record) => record.fact === fact))) return null;
  const evidenceFactIds = uniqueStrings(definition.requiredFacts.length > 0
    ? evidence.map((record) => record.factId)
    : qualification.supportingFactIds);
  const usedEvidence = new Set(previousClauses.flatMap((clause) => clause.evidenceFactIds));
  if (evidenceFactIds.length === 0 || !evidenceFactIds.some((factId) => !usedEvidence.has(factId))) return null;
  return clauseRecord({
    slot: 'benefit',
    templateId: definition.id,
    text: definition.text,
    informationKey: `benefit:${definition.id}`,
    subjectItemIds: qualification.subjectItemIds,
    evidenceFactIds,
    authorizationIds: [`eligibility:${qualification.reasonCode}`],
    relationCode: relation.relationCode,
    scene: model.scene,
    source: 'core_eligibility_benefit',
  });
}

function finalizePlan(surface, model, relation, clauses) {
  return {
    version: NATURAL_LANGUAGE_PLAN_VERSION,
    surface,
    scene: model?.scene || '',
    relationCode: relation?.relationCode || null,
    compositionPattern: clauses.map((clause) => clause.slot).join('>'),
    clauses,
    text: joinClauses(clauses),
    fallbackStrategy: clauses.length === 1 ? SAFE_FALLBACK.strategy : '',
  };
}

function emptyPlan(surface, model, relation) {
  return finalizePlan(surface, model, relation, []);
}

function joinClauses(clauses) {
  const text = clauses.map((clause) => stripTerminalPunctuation(clause.text)).filter(Boolean).join('，');
  return text ? `${text}。` : '';
}

function clauseRecord(value) {
  return {
    slot: value.slot,
    templateId: value.templateId,
    text: stripTerminalPunctuation(value.text),
    informationKey: value.informationKey,
    subjectItemIds: uniqueStrings(value.subjectItemIds),
    evidenceFactIds: uniqueStrings(value.evidenceFactIds),
    authorizationIds: uniqueStrings(value.authorizationIds),
    relationCode: value.relationCode || null,
    scene: value.scene || '',
    source: value.source,
  };
}

function normalizeQualification(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    reasonCode: readString(source.reasonCode),
    subjectItemIds: uniqueStrings(source.subjectItemIds),
    supportingFactIds: uniqueStrings(source.supportingFactIds),
    relationFactIds: uniqueStrings(source.relationFactIds),
    evidence: (Array.isArray(source.evidence) ? source.evidence : []).map((record) => ({
      factId: readString(record?.factId || record?.relationFactId),
      fact: readString(record?.fact),
      itemId: readString(record?.itemId),
    })).filter((record) => record.factId),
  };
}

function hasIncrementalInformation(definition) {
  return definition?.incrementalInformation === true;
}

function relationSlot(id, render) { return Object.freeze({ id, slot: 'relation', render, incrementalInformation: true }); }
function detailSlot(id, render) { return Object.freeze({ id, slot: 'relation', render, incrementalInformation: true }); }
function sceneSlot(id, text, incrementalInformation = true) {
  return Object.freeze({ id, slot: 'scene_value', text, incrementalInformation });
}
function benefitSlot(id, reasonCodes, requiredFacts, text) {
  return Object.freeze({
    id,
    slot: 'benefit',
    reasonCodes: Object.freeze(reasonCodes),
    requiredFacts: Object.freeze(requiredFacts),
    text,
    incrementalInformation: true,
  });
}

function itemForRole(model, role) {
  return (Array.isArray(model?.items) ? model.items : []).find((item) => item.role === role);
}

function itemName(model, role, fallback) {
  const item = itemForRole(model, role);
  return item?.canonicalSubtype || item?.canonicalName || fallback;
}

function itemLabel(model, role, fallback) {
  const item = itemForRole(model, role);
  return `${item?.normalizedColor || ''}${item?.canonicalSubtype || item?.canonicalName || fallback}`;
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
  return [...new Set((Array.isArray(values) ? values : []).map(readString).filter(Boolean))];
}

module.exports = {
  BENEFIT_SLOTS,
  DETAIL_RELATION_SLOTS,
  NATURAL_LANGUAGE_PLAN_VERSION,
  RELATION_SLOTS,
  SAFE_FALLBACK,
  SCENE_VALUE_SLOTS,
  buildNaturalDetailCopyPlan,
  buildNaturalTodayCopyPlan,
  hasIncrementalInformation,
  joinClauses,
};
