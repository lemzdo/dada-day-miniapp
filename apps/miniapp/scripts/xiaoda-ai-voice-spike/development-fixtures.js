'use strict';

function item(id, role, subcategory, color, extras = {}) {
  return {
    itemId: id,
    role,
    category: role,
    canonicalSubtype: subcategory,
    normalizedColor: color,
    authorizedFactIds: [`item:${id}:category`, `item:${id}:color`, ...(extras.factIds || [])],
    ...extras,
  };
}

function relation(code, ids, extras = {}) {
  return {
    relationCode: code,
    subjectItemIds: ids,
    evidenceFactIds: ids.flatMap((id) => [`item:${id}:category`, `item:${id}:color`]),
    strength: 3,
    ...extras,
  };
}

function fixture(id, coverage, scene, items, relations, extras = {}) {
  return {
    id,
    coverage,
    outfit: {
      outfitKey: `synthetic:${id}`,
      scene,
      presentationPlan: {
        primaryRelationCode: relations[0]?.relationCode || null,
        factModel: { scene, items, relations, primaryRelationCode: relations[0]?.relationCode || null },
      },
      xiaodaStyleInsight: {
        allowedAestheticInferences: (extras.allowedAestheticJudgments || []).map((label) => ({ label })),
      },
      ...(extras.weatherDependency ? { weatherDependency: extras.weatherDependency } : {}),
    },
  };
}

const DEVELOPMENT_FIXTURES = Object.freeze([
  fixture('upper-complex-lower-simple', ['上繁下简', '图案 + 纯色'], 'date', [
    item('uc-top', 'top', '印花T恤', '蓝色', { patternType: 'graphic', factIds: ['item:uc-top:pattern_visible'] }),
    item('uc-bottom', 'bottom', '直筒裤', '白色'),
  ], [relation('PATTERN_SOLID_BALANCE', ['uc-top', 'uc-bottom'])], { allowedAestheticJudgments: ['重点清楚'] }),
  fixture('upper-simple-lower-complex', ['上简下繁', '基础 + 设计'], 'date', [
    item('lc-top', 'top', '纯色针织衫', '米色'), item('lc-bottom', 'bottom', '褶裥半身裙', '棕色', { designElements: ['pleat'] }),
  ], [relation('DETAIL_SINGLE_FOCUS', ['lc-bottom', 'lc-top'])]),
  fixture('strong-color-focus', ['强颜色重点 + 简单支持'], 'date', [
    item('red-top', 'top', 'Polo衫', '红色'), item('neutral-bottom', 'bottom', '短裤', '白色'),
  ], [relation('TOP_ACCENT_WITH_NEUTRAL_BOTTOM', ['red-top', 'neutral-bottom'])]),
  fixture('top-shoe-echo', ['同色呼应'], 'home', [
    item('echo-top', 'top', '短袖T恤', '白色'), item('echo-bottom', 'bottom', '阔腿裤', '绿色'), item('echo-shoes', 'shoes', '运动鞋', '白色'),
  ], [relation('COLOR_ECHO_TOP_SHOES', ['echo-top', 'echo-shoes'])]),
  fixture('bottom-shoe-echo', ['同色呼应'], 'work', [
    item('bs-top', 'top', '衬衫', '蓝色'), item('bs-bottom', 'bottom', '长裤', '黑色'), item('bs-shoes', 'shoes', '乐福鞋', '黑色'),
  ], [relation('COLOR_ECHO_BOTTOM_SHOES', ['bs-bottom', 'bs-shoes'])]),
  fixture('analogous-colors', ['邻近/协调颜色'], 'work', [
    item('an-top', 'top', '针织衫', '蓝色'), item('an-bottom', 'bottom', '长裤', '绿色'),
  ], [relation('COLOR_ANALOGOUS', ['an-top', 'an-bottom'])]),
  fixture('same-color-core', ['同色呼应'], 'work', [
    item('mono-top', 'top', '衬衫', '藏青色'), item('mono-bottom', 'bottom', '直筒裤', '藏青色'),
  ], [relation('SAME_COLOR_TOP_BOTTOM', ['mono-top', 'mono-bottom'])]),
  fixture('fitted-wide', ['松紧关系'], 'date', [
    item('fit-top', 'top', '修身上衣', '白色', { fit: 'fitted' }), item('wide-bottom', 'bottom', '阔腿裤', '黑色', { silhouette: 'wideLeg' }),
  ], [relation('SILHOUETTE_BALANCED_CONTRAST', ['fit-top', 'wide-bottom'])]),
  fixture('relaxed-tapered', ['松紧关系'], 'home', [
    item('relaxed-top', 'top', '宽松卫衣', '灰色', { fit: 'relaxed' }), item('tapered-bottom', 'bottom', '束脚裤', '黑色', { silhouette: 'tapered' }),
  ], [relation('SILHOUETTE_BALANCED_CONTRAST', ['relaxed-top', 'tapered-bottom'])]),
  fixture('proportion-layer', ['比例关系', 'layer'], 'work', [
    item('layer-top', 'top', '短上衣', '白色'), item('layer-bottom', 'bottom', '高腰长裤', '黑色'), item('layer-outer', 'outerwear', '长外套', '灰色'),
  ], [relation('PROPORTION_CLEAR_LAYERING', ['layer-top', 'layer-bottom', 'layer-outer'])]),
  fixture('onepiece-shoes', ['onepiece + shoe'], 'date', [
    item('dress', 'onepiece', '连衣裙', '蓝色'), item('dress-shoes', 'shoes', '单鞋', '白色'),
  ], [relation('STRUCTURE_ONEPIECE_SHOES', ['dress', 'dress-shoes'])]),
  fixture('onepiece-layer', ['onepiece + shoe', 'layer'], 'work', [
    item('layer-dress', 'onepiece', '连衣裙', '黑色'), item('jacket', 'outerwear', '短外套', '米色'), item('layer-shoes', 'shoes', '乐福鞋', '黑色'),
  ], [relation('STRUCTURE_ONEPIECE_OUTERWEAR', ['layer-dress', 'jacket']), relation('COLOR_ECHO_ONEPIECE_SHOES', ['layer-dress', 'layer-shoes'])]),
  fixture('ordinary-home-basic', ['ordinary basic outfit', 'Home'], 'home', [
    item('basic-home-top', 'top', '白T恤', '白色'), item('basic-home-bottom', 'bottom', '短裤', '灰色'),
  ], []),
  fixture('ordinary-work-basic', ['ordinary basic outfit', 'Work'], 'work', [
    item('basic-work-top', 'top', '衬衫', '白色'), item('basic-work-bottom', 'bottom', '长裤', '黑色'),
  ], [relation('FORMALITY_ALIGNED', ['basic-work-top', 'basic-work-bottom'])]),
  fixture('ordinary-date-basic', ['ordinary basic outfit', 'Date'], 'date', [
    item('basic-date-top', 'top', '针织衫', '米色'), item('basic-date-bottom', 'bottom', '半身裙', '棕色'),
  ], [relation('COLOR_ANALOGOUS', ['basic-date-top', 'basic-date-bottom'])]),
  fixture('sport-complete', ['Sport'], 'sport', [
    item('sport-top', 'top', '运动上衣', '白色'), item('sport-bottom', 'bottom', '运动短裤', '灰色'), item('sport-shoes', 'shoes', '运动鞋', '白色'),
  ], [relation('COLOR_ECHO_TOP_SHOES', ['sport-top', 'sport-shoes'])]),
  fixture('sparse-facts', ['sparse facts'], 'home', [
    item('sparse-top', 'top', 'T恤', ''), item('sparse-bottom', 'bottom', '裤子', ''),
  ], []),
  fixture('competing-insights', ['competing insights', '图案 + 纯色', '松紧关系'], 'date', [
    item('multi-top', 'top', '印花上衣', '红色', { patternType: 'graphic', fit: 'fitted' }),
    item('multi-bottom', 'bottom', '阔腿裤', '黑色', { silhouette: 'wideLeg' }),
  ], [relation('PATTERN_SOLID_BALANCE', ['multi-top', 'multi-bottom']), relation('SILHOUETTE_BALANCED_CONTRAST', ['multi-top', 'multi-bottom'])]),
  fixture('weather-relevant', ['weather relevant'], 'sport', [
    item('weather-top', 'top', '运动上衣', '蓝色'), item('weather-bottom', 'bottom', '运动长裤', '黑色'),
  ], [relation('FORMALITY_ALIGNED', ['weather-top', 'weather-bottom'])], { weatherDependency: { weatherRelevant: true, thermalBand: 'cold', windRelevant: true, rainRelevant: false } }),
  fixture('optional-layer', ['layer', 'optional item'], 'home', [
    item('optional-top', 'top', 'T恤', '白色'), item('optional-bottom', 'bottom', '长裤', '灰色'),
    item('optional-layer', 'outerwear', '针织开衫', '米色', { optional: true }),
  ], [relation('PROPORTION_CLEAR_LAYERING', ['optional-top', 'optional-bottom', 'optional-layer'])]),
]);

module.exports = { DEVELOPMENT_FIXTURES };
