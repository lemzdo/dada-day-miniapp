const ITEM_IDS = Object.freeze({
  top: 'top-1',
  bottom: 'bottom-1',
  onepiece: 'onepiece-1',
  outerwear: 'outerwear-1',
  shoes: 'shoes-1',
  accessory: 'accessory-1',
});

function item(role, name, options = {}) {
  return {
    role,
    itemId: options.itemId || ITEM_IDS[role] || `${role}-1`,
    canonicalName: name,
    canonicalSubtype: name,
    normalizedColor: options.color || '',
    visibleFeatureTags: options.tags || [],
    fit: options.fit || '',
    silhouette: options.silhouette || '',
    length: options.length || '',
    patternType: options.patternType || '',
    designElements: options.designElements || [],
    formalityLevel: options.formalityLevel ?? null,
    styleTags: options.styleTags || [],
    authorizedFactIds: [`item:${options.itemId || ITEM_IDS[role] || `${role}-1`}:category`],
  };
}

function relation(relationCode, roles, options = {}) {
  const subjectItemIds = options.subjectItemIds || roles.map((role) => ITEM_IDS[role]);
  return {
    relationCode,
    roles,
    subjectItemIds,
    evidenceFactIds: options.evidenceFactIds || [`relation:${relationCode}:${subjectItemIds.join('|')}`],
    source: options.source || 'presentation_relation',
    polarity: options.polarity || 'positive',
    strength: options.strength || 2,
  };
}

function qualification(reasonCode, roles = ['top', 'bottom']) {
  const subjectItemIds = roles.map((role) => ITEM_IDS[role]);
  return {
    reasonCode,
    subjectItemIds,
    supportingFactIds: subjectItemIds.map((itemId) => `eligibility:${reasonCode}:${itemId}`),
  };
}

function model(scene, items, relations = [], eligibility = null) {
  return {
    scene,
    items,
    relations,
    qualification: eligibility || {},
  };
}

const top = (options = {}) => item('top', options.name || 'T恤', options);
const bottom = (options = {}) => item('bottom', options.name || '直筒裤', options);
const shoes = (options = {}) => item('shoes', options.name || '运动鞋', options);

const XIAODA_STYLE_INSIGHT_FIXTURES = Object.freeze([
  fixture('basic-top-bottom', model('home', [top(), bottom()], [], qualification('HOME_V4_EVIDENCE_SUPPORTED')), 'SIMPLE_EVERYDAY_COMBINATION'),
  fixture('base-top-design-bottom', model('date', [top(), bottom({ designElements: ['pleat'] })], [relation('DETAIL_SINGLE_FOCUS', ['bottom'])]), 'DESIGN_FOCUS_WITH_SIMPLE_SUPPORT'),
  fixture('design-top-base-bottom', model('date', [top({ designElements: ['bow'] }), bottom()], [relation('DETAIL_SINGLE_FOCUS', ['top'])]), 'DESIGN_FOCUS_WITH_SIMPLE_SUPPORT'),
  fixture('print-solid', model('date', [top({ name: '印花T恤', tags: ['印花'], patternType: 'graphic' }), bottom({ tags: ['纯色'] })], [relation('PATTERN_SOLID_BALANCE', ['top', 'bottom'], { strength: 3 })]), 'PATTERN_FOCUS_WITH_SIMPLE_SUPPORT'),
  fixture('accent-neutral', model('date', [top({ color: '红色' }), bottom({ color: '灰色' })], [relation('TOP_ACCENT_WITH_NEUTRAL_BOTTOM', ['top', 'bottom'], { strength: 3 })]), 'COLOR_FOCUS_WITH_NEUTRAL_SUPPORT'),
  fixture('same-color-core', model('work', [top({ color: '藏青色' }), bottom({ color: '藏青色' })], [relation('SAME_COLOR_TOP_BOTTOM', ['top', 'bottom'])]), 'SAME_COLOR_CORE'),
  fixture('bottom-shoe-same', model('home', [top({ color: '白色' }), bottom({ color: '黑色' }), shoes({ color: '黑色' })], [relation('COLOR_ECHO_BOTTOM_SHOES', ['bottom', 'shoes'])]), 'BOTTOM_SHOE_COLOR_CONTINUITY'),
  fixture('top-shoe-echo', model('date', [top({ color: '绿色' }), bottom({ color: '灰色' }), shoes({ color: '绿色' })], [relation('COLOR_ECHO_TOP_SHOES', ['top', 'shoes'])]), 'TOP_SHOE_COLOR_ECHO'),
  fixture('two-color-core', model('home', [top({ color: '蓝色' }), bottom({ color: '灰色' })], [relation('DISTINCT_TOP_BOTTOM_COLOR', ['top', 'bottom'])]), 'TWO_COLOR_CORE'),
  fixture('fitted-wide', model('work', [top({ fit: 'fitted' }), bottom({ silhouette: 'wideLeg' })], [relation('SILHOUETTE_BALANCED_CONTRAST', ['top', 'bottom'], { source: 'aesthetic_evaluation', strength: 3 })]), 'SILHOUETTE_TENSION_BALANCE'),
  fixture('relaxed-tapered', model('home', [top({ fit: 'relaxed' }), bottom({ silhouette: 'tapered' })], [relation('SILHOUETTE_BALANCED_CONTRAST', ['top', 'bottom'], { source: 'aesthetic_evaluation', strength: 3 })]), 'SILHOUETTE_TENSION_BALANCE'),
  fixture('onepiece-only', model('date', [item('onepiece', '连衣裙', { color: '蓝色' })], [relation('STRUCTURE_ONEPIECE_ONLY', ['onepiece'])]), 'ONEPIECE_SETS_THE_LOOK'),
  fixture('onepiece-shoes', model('home', [item('onepiece', '吊带裙', { color: '白色' }), shoes({ color: '白色' })], [relation('STRUCTURE_ONEPIECE_SHOES', ['onepiece', 'shoes'], { strength: 3 })]), 'ONEPIECE_WITH_SHOES'),
  fixture('onepiece-layer', model('work', [item('onepiece', '连衣裙'), item('outerwear', '短外套')], [relation('STRUCTURE_ONEPIECE_OUTERWEAR', ['onepiece', 'outerwear'], { strength: 3 })]), 'ONEPIECE_LAYERING'),
  fixture('home-specific', model('home', [top({ name: '短袖T恤' }), bottom({ name: '短裤' })], [], qualification('HOME_SHORT_SLEEVE_SHORTS')), 'HOME_SHORT_EASY_SET'),
  fixture('work-specific', model('work', [top({ name: '衬衫' }), bottom()], [], qualification('WORK_SHIRT_STRAIGHT_PANTS')), 'WORK_SHIRT_TROUSER_RELATION'),
  fixture('date-specific', model('date', [top({ color: '粉色' }), bottom({ color: '黑色' })], [], qualification('DATE_BRIGHT_TOP_BASIC_SUPPORT')), 'COLOR_FOCUS_WITH_NEUTRAL_SUPPORT'),
  fixture('sport-shoes', model('sport', [top({ name: '运动上衣' }), bottom({ name: '运动短裤' }), shoes()], [], qualification('SPORT_COMPLETE_SET', ['top', 'bottom', 'shoes'])), 'SPORT_COMPLETE_RELATION'),
  fixture('multiple-insights', model('date', [top({ name: '印花T恤', tags: ['印花'], fit: 'fitted' }), bottom({ tags: ['纯色'], silhouette: 'wideLeg' })], [relation('PATTERN_SOLID_BALANCE', ['top', 'bottom'], { strength: 3 }), relation('SILHOUETTE_BALANCED_CONTRAST', ['top', 'bottom'], { source: 'aesthetic_evaluation', strength: 3 })]), 'PATTERN_FOCUS_WITH_SIMPLE_SUPPORT'),
  fixture('strong-scene-weak-relation', model('sport', [top({ name: '运动上衣', color: '白色' }), bottom({ name: '运动裤', color: '灰色' }), shoes()], [relation('NEUTRAL_COLOR_BRIDGE', ['top', 'bottom'], { strength: 1 })], qualification('SPORT_COMPLETE_SET', ['top', 'bottom', 'shoes'])), 'SPORT_COMPLETE_RELATION'),
  fixture('strong-relation-no-scene', model('home', [top({ name: '印花T恤', tags: ['印花'] }), bottom({ tags: ['纯色'] })], [relation('PATTERN_SOLID_BALANCE', ['top', 'bottom'], { strength: 3 })]), 'PATTERN_FOCUS_WITH_SIMPLE_SUPPORT'),
  fixture('missing-attributes', model('work', [top(), bottom()], [], qualification('WORK_V4_EVIDENCE_SUPPORTED')), 'SIMPLE_EVERYDAY_COMBINATION'),
  fixture('optional-accessory', model('date', [top({ color: '红色' }), bottom({ color: '灰色' }), item('accessory', '小包')], [relation('TOP_ACCENT_WITH_NEUTRAL_BOTTOM', ['top', 'bottom'], { strength: 3 })]), 'COLOR_FOCUS_WITH_NEUTRAL_SUPPORT'),
  fixture('future-item-type', model('home', [top(), bottom(), item('smartLayer', '未来单品', { itemId: 'future-1' })], [], qualification('HOME_V4_EVIDENCE_SUPPORTED')), 'SIMPLE_EVERYDAY_COMBINATION'),
]);

const XIAODA_STYLE_INSIGHT_WEAK_FIXTURES = Object.freeze([
  Object.freeze({
    id: 'weak-relation-honest-fallback',
    model: model('home', [top({ tags: ['印花'] }), bottom({ tags: ['印花'] })], [relation('SUBTYPE_FEATURE_PRINT', ['top'])]),
    expectedPrimaryCode: 'SIMPLE_EVERYDAY_COMBINATION',
  }),
  Object.freeze({
    id: 'no-authorized-facts',
    model: model('work', [{ ...top(), authorizedFactIds: [] }], [], null),
    expectedPrimaryCode: null,
  }),
]);

function fixture(id, value, expectedPrimaryCode) {
  return Object.freeze({ id, model: value, expectedPrimaryCode });
}

module.exports = {
  XIAODA_STYLE_INSIGHT_FIXTURES,
  XIAODA_STYLE_INSIGHT_WEAK_FIXTURES,
  item,
  model,
  qualification,
  relation,
};
