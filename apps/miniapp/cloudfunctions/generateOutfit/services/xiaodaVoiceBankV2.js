const {
  factEvidenceLevel,
  factSourceMeetsMinimum,
} = require('./recommendationFactAuthorization');

const VOICE_BANK_VERSION = 'xiaoda-fixed-claim-catalog-v2';

const PRODUCT_STATE_COPY = Object.freeze([
  Object.freeze({ id: 'productStateCopy.loading', state: 'loading', text: '小搭正在看天气和衣橱信息，稍等一下。' }),
  Object.freeze({ id: 'productStateCopy.empty', state: 'empty', text: '衣橱里还没有可以搭配的衣物，先添加几件常穿的吧。' }),
  Object.freeze({ id: 'productStateCopy.exhausted', state: 'exhausted', text: '这一轮可用方案已经看完，换个场景再试也可以。' }),
  Object.freeze({ id: 'productStateCopy.stale-waiting', state: 'stale_waiting', text: '衣橱信息有变化，新建议还在准备，请稍等一下。' }),
  Object.freeze({ id: 'productStateCopy.retry', state: 'retry', text: '刚才没有加载成功，可以稍后再试一次。' }),
  Object.freeze({ id: 'productStateCopy.error-neutral', state: 'error_neutral', text: '这次暂时没拿到结果，已为你保留当前页面。' }),
  Object.freeze({ id: 'productStateCopy.refreshing', state: 'refreshing', text: '衣橱信息有更新，小搭正在重新整理建议。' }),
]);

const LIMITED_SCENE_COPY = Object.freeze({
  home: Object.freeze({
    one: '适合在家穿的搭配不多，这次先给你这一套。',
    many: '适合在家穿的搭配不多，这次先给你这几套。',
  }),
  work: Object.freeze({
    one: '适合上班穿的搭配不多，这次先给你这一套。',
    many: '适合上班穿的搭配不多，这次先给你这几套。',
  }),
  date: Object.freeze({
    one: '适合约会的搭配不多，这次先给你这一套。',
    many: '适合约会的搭配不多，这次先给你这几套。',
  }),
  sport: Object.freeze({
    one: '适合运动的衣服不多，这次先给你这一套。',
    many: '适合运动的衣服不多，这次先给你这几套。',
  }),
});

function requirement(slot, options = {}) {
  const minimumEvidenceByFact = { ...(options.minimumEvidenceByFact || {}) };
  return Object.freeze({
    slot,
    allOf: Object.freeze((options.allOf || []).slice()),
    anyOf: Object.freeze((options.anyOf || []).slice()),
    minimumEvidenceLevel: options.minimumEvidenceLevel || 'B',
    ...(Object.keys(minimumEvidenceByFact).length > 0
      ? { minimumEvidenceByFact: Object.freeze(minimumEvidenceByFact) }
      : {}),
  });
}

function defineClaim(row) {
  const requirements = Object.freeze((row.requirements || []).slice());
  return Object.freeze({
    claimId: row.claimId,
    id: row.claimId,
    scene: row.scene,
    group: row.group,
    action: row.action,
    dimension: row.dimension,
    userValue: row.userValue,
    priority: row.priority,
    detailOnly: Boolean(row.detailOnly),
    weatherCondition: row.weatherCondition || '',
    requirements,
    requiredFactIds: Object.freeze(requirements.flatMap((entry) => [
      ...entry.allOf.map((fact) => `${entry.slot}.${fact}`),
      ...entry.anyOf.map((fact) => `${entry.slot}.(${fact})`),
    ])),
    minimumEvidenceSource: requirements.some((entry) => entry.minimumEvidenceLevel === 'A') ? 'A' : 'B',
    subjectSlots: Object.freeze((row.subjectSlots || requirements.map((entry) => entry.slot)).slice()),
    text: row.text,
    forbiddenWhen: Object.freeze((row.forbiddenWhen || []).slice()),
  });
}

const CLAIM_CATALOG = Object.freeze([
  defineClaim({
    claimId: 'H01-01', scene: 'home', group: 'H01', action: 'home_rest', dimension: 'comfort',
    userValue: 'rest_comfort', priority: 510,
    requirements: [
      requirement('top', { allOf: ['soft_material'], minimumEvidenceLevel: 'A' }),
      requirement('bottom', { allOf: ['pants'], anyOf: ['loose_fit', 'flexible_fit', 'waist_not_tight'], minimumEvidenceLevel: 'B' }),
    ],
    text: '上衣摸起来比较软，裤子也不紧，这身在家穿挺舒服，坐久一点也不容易勒。',
  }),
  defineClaim({
    claimId: 'H01-02', scene: 'home', group: 'H01', action: 'home_rest', dimension: 'comfort',
    userValue: 'rest_comfort', priority: 500,
    requirements: [requirement('bottom', { allOf: ['pants', 'flexible_fit'], minimumEvidenceLevel: 'A' })],
    text: '这条裤子弹性不错，宅家坐久了也不容易勒得慌。',
  }),
  defineClaim({
    claimId: 'H01-03', scene: 'home', group: 'H01', action: 'home_rest', dimension: 'comfort',
    userValue: 'rest_comfort', priority: 490,
    requirements: [requirement('bottom', { allOf: ['pants', 'loose_fit'], minimumEvidenceLevel: 'B' })],
    text: '这条裤子版型比较宽松，在家坐着不会觉得太紧。',
  }),
  defineClaim({
    claimId: 'H01-04', scene: 'home', group: 'H01', action: 'home_rest', dimension: 'comfort',
    userValue: 'rest_comfort', priority: 480,
    requirements: [requirement('top', { allOf: ['soft_material'], minimumEvidenceLevel: 'A' })],
    text: '这件上衣摸起来很软，贴身穿也舒服，宅家穿正好。',
  }),
  defineClaim({
    claimId: 'H01-05', scene: 'home', group: 'H01', action: 'home_rest', dimension: 'comfort',
    userValue: 'rest_comfort', priority: 470,
    requirements: [requirement('onepiece', { allOf: ['dress', 'loose_fit'], minimumEvidenceLevel: 'B' })],
    text: '这条裙子版型比较宽松，在家坐着也不会觉得紧。',
  }),
  defineClaim({
    claimId: 'H02-01', scene: 'home', group: 'H02', action: 'home_movement', dimension: 'movement',
    userValue: 'ordinary_movement', priority: 420,
    requirements: [
      requirement('top', { allOf: ['loose_fit'], minimumEvidenceLevel: 'B' }),
      requirement('bottom', { allOf: ['pants', 'loose_fit'], minimumEvidenceLevel: 'B' }),
    ],
    text: '上衣和裤子都比较宽松，在家走动或者做点家务时，不会觉得衣服碍事。',
  }),
  defineClaim({
    claimId: 'H02-02', scene: 'home', group: 'H02', action: 'home_movement', dimension: 'movement',
    userValue: 'rest_and_movement', priority: 430,
    requirements: [
      requirement('top', { allOf: ['movement'], minimumEvidenceLevel: 'A' }),
      requirement('bottom', { allOf: ['pants'], anyOf: ['movement', 'flexible_fit'], minimumEvidenceLevel: 'A' }),
    ],
    text: '无论是窝在沙发上休息，还是起来收拾一下，穿这身都不会觉得碍手碍脚。',
  }),
  defineClaim({
    claimId: 'H02-03', scene: 'home', group: 'H02', action: 'home_movement', dimension: 'movement',
    userValue: 'ordinary_movement', priority: 410,
    requirements: [requirement('bottom', { allOf: ['pants', 'flexible_fit'], minimumEvidenceLevel: 'A' })],
    text: '这条裤子有弹性，在家走动或者做点家务时，不会觉得紧。',
  }),
  defineClaim({
    claimId: 'H02-04', scene: 'home', group: 'H02', action: 'home_movement', dimension: 'movement',
    userValue: 'ordinary_movement', priority: 400,
    requirements: [requirement('onepiece', { allOf: ['dress', 'loose_fit', 'movement'], minimumEvidenceLevel: 'A' })],
    text: '这条裙子不紧身，在家走动或者收拾东西时不会碍事。',
  }),
  defineClaim({
    claimId: 'H03-01', scene: 'home', group: 'H03', action: 'home_temperature', dimension: 'weather',
    userValue: 'temperature_fit', priority: 610, weatherCondition: 'hot',
    requirements: [requirement('top', { allOf: ['lightweight'], minimumEvidenceLevel: 'B' })],
    text: '今天温度比较高，这件上衣比较轻薄，在家穿不会觉得厚重。',
  }),
  defineClaim({
    claimId: 'H03-02', scene: 'home', group: 'H03', action: 'home_temperature', dimension: 'weather',
    userValue: 'temperature_fit', priority: 620, weatherCondition: 'humid_hot',
    requirements: [requirement('top', { allOf: ['breathability'], minimumEvidenceLevel: 'A' })],
    text: '今天有点闷热，这件上衣比较透气，在家待久了也没那么闷。',
  }),
  defineClaim({
    claimId: 'H03-03', scene: 'home', group: 'H03', action: 'home_temperature', dimension: 'weather',
    userValue: 'temperature_fit', priority: 610, weatherCondition: 'cool',
    requirements: [requirement('top', { allOf: ['long_sleeve'], minimumEvidenceLevel: 'B' })],
    text: '今天有点凉，在家穿这件长袖刚刚好。',
  }),
  defineClaim({
    claimId: 'H03-04', scene: 'home', group: 'H03', action: 'home_temperature', dimension: 'weather',
    userValue: 'temperature_fit', priority: 620, weatherCondition: 'cold',
    requirements: [requirement('top', { allOf: ['warmth'], minimumEvidenceLevel: 'A' })],
    text: '今天有点冷，这件上衣比较暖和，在家穿正合适。',
  }),

  defineClaim({
    claimId: 'W01-01', scene: 'work', group: 'W01', action: 'work_fit', dimension: 'scene',
    userValue: 'work_appropriateness', priority: 520,
    requirements: [
      requirement('top', { allOf: ['shirt'], minimumEvidenceLevel: 'B' }),
      requirement('bottom', { allOf: ['pants', 'straight_cut'], minimumEvidenceLevel: 'B' }),
    ],
    text: '衬衫配直筒裤，上班穿比较利落。',
  }),
  defineClaim({
    claimId: 'W01-02', scene: 'work', group: 'W01', action: 'work_fit', dimension: 'scene',
    userValue: 'work_appropriateness', priority: 510,
    requirements: [
      requirement('top', { allOf: ['pattern_visible'], minimumEvidenceLevel: 'B' }),
      requirement('bottom', { allOf: ['pants', 'solid_color'], minimumEvidenceLevel: 'B' }),
      requirement('outfit', { allOf: ['work_eligible'], minimumEvidenceLevel: 'A' }),
    ],
    text: '这件上衣图案比较明显，配纯色裤子就不会显得太花，上班穿也合适。',
  }),
  defineClaim({
    claimId: 'W01-03', scene: 'work', group: 'W01', action: 'work_fit', dimension: 'scene',
    userValue: 'work_appropriateness', priority: 500,
    requirements: [
      requirement('onepiece', { allOf: ['dress', 'simple_style'], minimumEvidenceLevel: 'B' }),
      requirement('outfit', { allOf: ['work_eligible'], minimumEvidenceLevel: 'A' }),
    ],
    text: '这条连衣裙款式简洁，穿去上班很利落。',
  }),
  defineClaim({
    claimId: 'W01-04', scene: 'work', group: 'W01', action: 'work_fit', dimension: 'scene',
    userValue: 'work_outfit_support', priority: 490, detailOnly: true,
    requirements: [
      requirement('shoes', { allOf: ['simple_style'], minimumEvidenceLevel: 'B' }),
      requirement('top', { allOf: ['shirt'], minimumEvidenceLevel: 'B' }),
      requirement('bottom', { allOf: ['pants'], minimumEvidenceLevel: 'B' }),
    ],
    text: '这双鞋款式比较简洁，配衬衫和长裤比较顺眼。',
  }),
  defineClaim({
    claimId: 'W02-01', scene: 'work', group: 'W02', action: 'work_comfort', dimension: 'comfort',
    userValue: 'office_comfort', priority: 420,
    requirements: [requirement('bottom', { allOf: ['pants', 'flexible_fit'], minimumEvidenceLevel: 'A' })],
    text: '这条裤子弹性不错，坐着办公久一点也不容易勒。',
  }),
  defineClaim({
    claimId: 'W02-03', scene: 'work', group: 'W02', action: 'work_comfort', dimension: 'comfort',
    userValue: 'office_comfort', priority: 430,
    requirements: [
      requirement('top', { allOf: ['loose_fit'], minimumEvidenceLevel: 'B' }),
      requirement('bottom', { allOf: ['pants', 'flexible_fit'], minimumEvidenceLevel: 'A' }),
    ],
    text: '上衣不贴身，裤子也有弹性，坐着办公久一点不会觉得紧。',
  }),
  defineClaim({
    claimId: 'W02-04', scene: 'work', group: 'W02', action: 'work_comfort', dimension: 'shoes',
    userValue: 'office_comfort', priority: 400,
    requirements: [requirement('shoes', { anyOf: ['soft_sole', 'cushioning'], minimumEvidenceLevel: 'A' })],
    text: '这双鞋鞋底比较软，上班穿着会舒服些。',
  }),
  defineClaim({
    claimId: 'W03-01', scene: 'work', group: 'W03', action: 'work_temperature', dimension: 'weather',
    userValue: 'temperature_fit', priority: 620, weatherCondition: 'hot',
    requirements: [requirement('top', { allOf: ['lightweight'], minimumEvidenceLevel: 'B' })],
    text: '今天有点热，这件上衣比较轻薄，穿去上班不会觉得厚重。',
  }),
  defineClaim({
    claimId: 'W03-02', scene: 'work', group: 'W03', action: 'work_temperature', dimension: 'weather',
    userValue: 'temperature_fit', priority: 630, weatherCondition: 'humid_hot',
    requirements: [requirement('top', { allOf: ['breathability'], minimumEvidenceLevel: 'A' })],
    text: '今天有点闷热，这件上衣比较透气，上班穿没那么闷。',
  }),
  defineClaim({
    claimId: 'W03-03', scene: 'work', group: 'W03', action: 'work_temperature', dimension: 'weather',
    userValue: 'temperature_fit', priority: 620, weatherCondition: 'cool',
    requirements: [requirement('top', { allOf: ['long_sleeve'], minimumEvidenceLevel: 'B' })],
    text: '今天有点凉，穿这件长袖去上班刚刚好。',
  }),
  defineClaim({
    claimId: 'W03-04', scene: 'work', group: 'W03', action: 'work_temperature', dimension: 'weather',
    userValue: 'temperature_fit', priority: 630, weatherCondition: 'cold',
    requirements: [requirement('outerwear', { allOf: ['warmth'], minimumEvidenceLevel: 'A' })],
    text: '今天温度低，这件外套比较暖和，出门上班穿正合适。',
  }),
  defineClaim({
    claimId: 'W04-01', scene: 'work', group: 'W04', action: 'work_reminder', dimension: 'care',
    userValue: 'care_reminder', priority: 330, detailOnly: true,
    requirements: [requirement('top', { allOf: ['shirt', 'wrinkle_risk'], minimumEvidenceLevel: 'A' })],
    text: '这件衬衫容易皱，出门前顺手把折痕理一下。',
  }),

  defineClaim({
    claimId: 'D01-01', scene: 'date', group: 'D01', action: 'date_coordination', dimension: 'coordination',
    userValue: 'visual_coordination', priority: 520,
    requirements: [
      requirement('top', { allOf: ['pattern_visible'], minimumEvidenceLevel: 'B' }),
      requirement('bottom', { allOf: ['pants', 'simple_style'], minimumEvidenceLevel: 'B' }),
      requirement('shoes', { allOf: ['simple_style'], minimumEvidenceLevel: 'B' }),
    ],
    text: '这件上衣图案比较抢眼，裤子和鞋子简单一点就好，不会显得太花。',
  }),
  defineClaim({
    claimId: 'D01-02', scene: 'date', group: 'D01', action: 'date_coordination', dimension: 'coordination',
    userValue: 'visual_coordination', priority: 510,
    requirements: [
      requirement('onepiece', { allOf: ['dress', 'pattern_visible'], minimumEvidenceLevel: 'B' }),
      requirement('shoes', { allOf: ['simple_style'], minimumEvidenceLevel: 'B' }),
    ],
    text: '这条裙子的图案已经够明显，鞋子和配饰简单一点就好。',
  }),
  defineClaim({
    claimId: 'D01-03', scene: 'date', group: 'D01', action: 'date_coordination', dimension: 'coordination',
    userValue: 'visual_coordination', priority: 500,
    requirements: [
      requirement('top', { allOf: ['bright_color'], minimumEvidenceLevel: 'B' }),
      requirement('bottom', { allOf: ['basic_color'], minimumEvidenceLevel: 'B' }),
      requirement('shoes', { allOf: ['basic_color'], minimumEvidenceLevel: 'B' }),
    ],
    text: '上衣颜色已经够亮了，裤子和鞋子用基础色就好。',
  }),
  defineClaim({
    claimId: 'D01-04', scene: 'date', group: 'D01', action: 'date_coordination', dimension: 'coordination',
    userValue: 'visual_coordination', priority: 490,
    requirements: [
      requirement('shoes', { allOf: ['bright_color'], minimumEvidenceLevel: 'B' }),
      requirement('main', { allOf: ['basic_color'], minimumEvidenceLevel: 'B' }),
    ],
    text: '这双鞋颜色比较亮，衣服就别再堆太多颜色。',
  }),
  defineClaim({
    claimId: 'D01-05', scene: 'date', group: 'D01', action: 'date_coordination', dimension: 'coordination',
    userValue: 'visual_coordination', priority: 480,
    requirements: [requirement('outfit', { allOf: ['color_coordinated'], minimumEvidenceLevel: 'B' })],
    text: '上衣和下装的颜色比较协调，配饰简单一点就够了。',
  }),
  defineClaim({
    claimId: 'D01-06', scene: 'date', group: 'D01', action: 'date_coordination', dimension: 'coordination',
    userValue: 'accessory_simplicity', priority: 470, detailOnly: true,
    requirements: [requirement('top', { allOf: ['neckline_detail'], minimumEvidenceLevel: 'B' })],
    text: '领口已经有细节，项链选简单一点就好。',
  }),
  defineClaim({
    claimId: 'D02-01', scene: 'date', group: 'D02', action: 'date_comfort', dimension: 'comfort',
    userValue: 'wearing_comfort', priority: 420,
    requirements: [requirement('onepiece', { allOf: ['dress', 'loose_fit'], minimumEvidenceLevel: 'B' })],
    text: '这条裙子版型不紧，约会穿会舒服些。',
  }),
  defineClaim({
    claimId: 'D02-02', scene: 'date', group: 'D02', action: 'date_comfort', dimension: 'comfort',
    userValue: 'wearing_comfort', priority: 410,
    requirements: [requirement('top', { allOf: ['soft_material'], minimumEvidenceLevel: 'A' })],
    text: '这件上衣面料比较软，贴身穿也舒服。',
  }),
  defineClaim({
    claimId: 'D02-03', scene: 'date', group: 'D02', action: 'date_comfort', dimension: 'comfort',
    userValue: 'wearing_comfort', priority: 400,
    requirements: [requirement('bottom', { allOf: ['pants', 'flexible_fit'], minimumEvidenceLevel: 'A' })],
    text: '这条裤子弹性不错，穿着不容易勒。',
  }),
  defineClaim({
    claimId: 'D02-04', scene: 'date', group: 'D02', action: 'date_comfort', dimension: 'shoes',
    userValue: 'wearing_comfort', priority: 390,
    requirements: [requirement('shoes', { anyOf: ['soft_sole', 'cushioning'], minimumEvidenceLevel: 'A' })],
    text: '这双鞋鞋底比较软，约会穿会舒服些。',
  }),
  defineClaim({
    claimId: 'D02-05', scene: 'date', group: 'D02', action: 'date_comfort', dimension: 'shoes',
    userValue: 'shoe_stability', priority: 380,
    requirements: [requirement('shoes', { allOf: ['fixed_strap'], minimumEvidenceLevel: 'B' })],
    text: '这双鞋有固定带，走路时不容易松。',
  }),
  defineClaim({
    claimId: 'D03-01', scene: 'date', group: 'D03', action: 'date_temperature', dimension: 'weather',
    userValue: 'temperature_fit', priority: 620, weatherCondition: 'hot',
    requirements: [requirement('top', { allOf: ['lightweight'], minimumEvidenceLevel: 'B' })],
    text: '今天有点热，这件上衣比较轻薄，穿着不会觉得厚重。',
  }),
  defineClaim({
    claimId: 'D03-02', scene: 'date', group: 'D03', action: 'date_temperature', dimension: 'weather',
    userValue: 'temperature_fit', priority: 630, weatherCondition: 'humid_hot',
    requirements: [requirement('top', { allOf: ['breathability'], minimumEvidenceLevel: 'A' })],
    text: '今天有点闷热，这件上衣比较透气，穿着没那么闷。',
  }),
  defineClaim({
    claimId: 'D03-03', scene: 'date', group: 'D03', action: 'date_temperature', dimension: 'weather',
    userValue: 'temperature_fit', priority: 620, weatherCondition: 'cool',
    requirements: [requirement('outerwear', { allOf: ['thin_outerwear'], minimumEvidenceLevel: 'B' })],
    text: '今天有点凉，带上这件薄外套就够了。',
  }),
  defineClaim({
    claimId: 'D03-04', scene: 'date', group: 'D03', action: 'date_temperature', dimension: 'weather',
    userValue: 'temperature_fit', priority: 630, weatherCondition: 'cold',
    requirements: [requirement('outerwear', { allOf: ['warmth'], minimumEvidenceLevel: 'A' })],
    text: '今天温度低，这件外套比较暖和，穿去约会正合适。',
  }),

  defineClaim({
    claimId: 'S01-01', scene: 'sport', group: 'S01', action: 'sport_movement', dimension: 'movement',
    userValue: 'movement_freedom', priority: 650,
    requirements: [
      requirement('top', { allOf: ['shoulder_mobility'], minimumEvidenceLevel: 'A' }),
      requirement('bottom', {
        allOf: ['pants', 'flexible_fit'],
        minimumEvidenceLevel: 'A',
        minimumEvidenceByFact: { pants: 'B' },
      }),
    ],
    text: '上衣肩部不紧，裤子也有弹性，运动时抬手、转身都不会觉得紧。',
  }),
  defineClaim({
    claimId: 'S01-02', scene: 'sport', group: 'S01', action: 'sport_movement', dimension: 'movement',
    userValue: 'movement_freedom', priority: 640,
    requirements: [requirement('top', { allOf: ['shoulder_mobility'], minimumEvidenceLevel: 'A' })],
    text: '这件上衣肩部比较宽松，抬手时不会卡肩。',
  }),
  defineClaim({
    claimId: 'S01-03', scene: 'sport', group: 'S01', action: 'sport_movement', dimension: 'movement',
    userValue: 'movement_freedom', priority: 630,
    requirements: [requirement('bottom', {
      allOf: ['pants', 'flexible_fit'],
      minimumEvidenceLevel: 'A',
      minimumEvidenceByFact: { pants: 'B' },
    })],
    text: '这条裤子弹性不错，运动时抬腿、转身都不会觉得紧。',
  }),
  defineClaim({
    claimId: 'S02-01', scene: 'sport', group: 'S02', action: 'sport_temperature', dimension: 'weather',
    userValue: 'temperature_fit', priority: 540, weatherCondition: 'hot',
    requirements: [requirement('top', { allOf: ['lightweight'], minimumEvidenceLevel: 'B' })],
    text: '今天温度比较高，这件上衣比较轻薄，运动时不会觉得厚重。',
  }),
  defineClaim({
    claimId: 'S02-02', scene: 'sport', group: 'S02', action: 'sport_temperature', dimension: 'weather',
    userValue: 'temperature_fit', priority: 550, weatherCondition: 'humid_hot',
    requirements: [requirement('top', { allOf: ['breathability'], minimumEvidenceLevel: 'A' })],
    text: '今天有点闷热，这件上衣比较透气，运动时没那么闷。',
  }),
  defineClaim({
    claimId: 'S02-03', scene: 'sport', group: 'S02', action: 'sport_function', dimension: 'function',
    userValue: 'sweat_management', priority: 430,
    requirements: [requirement('top', { allOf: ['quick_dry'], minimumEvidenceLevel: 'A' })],
    text: '这件上衣是速干面料，出汗以后干得会快一些。',
  }),
  defineClaim({
    claimId: 'S02-05', scene: 'sport', group: 'S02', action: 'sport_temperature', dimension: 'weather',
    userValue: 'temperature_fit', priority: 540, weatherCondition: 'cool',
    requirements: [requirement('outerwear', { allOf: ['sport_outerwear'], minimumEvidenceLevel: 'B' })],
    text: '今天有点凉，先穿上这件运动外套，热身后再脱。',
  }),
  defineClaim({
    claimId: 'S02-06', scene: 'sport', group: 'S02', action: 'sport_temperature', dimension: 'weather',
    userValue: 'temperature_fit', priority: 550, weatherCondition: 'cold',
    requirements: [requirement('outerwear', { allOf: ['warmth'], minimumEvidenceLevel: 'A' })],
    text: '今天温度比较低，这件外套比较暖和，运动前先穿上。',
  }),
  defineClaim({
    claimId: 'S03-01', scene: 'sport', group: 'S03', action: 'sport_shoes', dimension: 'shoes',
    userValue: 'shoe_stability', priority: 520,
    requirements: [requirement('shoes', { allOf: ['secure_fit'], minimumEvidenceLevel: 'A' })],
    text: '这双鞋固定得比较稳，运动时不容易松。',
  }),
  defineClaim({
    claimId: 'S03-02', scene: 'sport', group: 'S03', action: 'sport_shoes', dimension: 'shoes',
    userValue: 'shoe_stability', priority: 510,
    requirements: [requirement('shoes', { allOf: ['shoe_laces'], minimumEvidenceLevel: 'B' })],
    text: '这双鞋有鞋带，运动前系紧一点，做动作时会更稳。',
  }),
  defineClaim({
    claimId: 'S03-03', scene: 'sport', group: 'S03', action: 'sport_shoes', dimension: 'shoes',
    userValue: 'impact_comfort', priority: 500,
    requirements: [requirement('shoes', { allOf: ['cushioning'], minimumEvidenceLevel: 'A' })],
    text: '这双鞋鞋底有缓冲，运动时脚下会舒服些。',
  }),
  defineClaim({
    claimId: 'S03-04', scene: 'sport', group: 'S03', action: 'sport_shoes', dimension: 'shoes',
    userValue: 'traction', priority: 490,
    requirements: [requirement('shoes', { anyOf: ['sole_grip', 'anti_slip', 'slip_resistance'], minimumEvidenceLevel: 'A' })],
    text: '这双鞋抓地力不错，做动作时不容易打滑。',
  }),
]);

const CLAIM_BY_ID = new Map(CLAIM_CATALOG.map((entry) => [entry.claimId, entry]));

// Compatibility exports now point only at the fixed Claim Catalog. There is no
// fallback inventory and no separate runtime bank for Today versus detail.
const TODAY_SENTENCE_CLUSTERS = Object.freeze(CLAIM_CATALOG.filter((entry) => !entry.detailOnly));
const DETAIL_SENTENCE_CLUSTERS = Object.freeze(CLAIM_CATALOG.slice());
const SAFE_FALLBACK_CLUSTERS = Object.freeze([]);
const ALL_SENTENCE_CLUSTERS = CLAIM_CATALOG;

function getClaimById(claimId) {
  return CLAIM_BY_ID.get(claimId) || null;
}

function getProductStateCopy(state) {
  const record = PRODUCT_STATE_COPY.find((entry) => entry.state === state);
  return record ? record.text : '';
}

function getLimitedRecommendationCopy(scene, acceptedCount) {
  const normalizedScene = normalizeScene(scene);
  const record = LIMITED_SCENE_COPY[normalizedScene];
  if (!record || acceptedCount < 1) return '';
  return acceptedCount === 1 ? record.one : record.many;
}

function classifyLimitedReason(value, fallback = 'SCENE_ELIGIBLE_FEW') {
  const text = String(value || '').toLowerCase();
  if (/wardrobe|sparse|too_few|few_clothes/.test(text)) return 'WARDROBE_SPARSE';
  if (/missing|required_category|no_(?:top|bottom|shoe|outer)/.test(text)) return 'MISSING_REQUIRED_CATEGORY';
  if (/weather|temperature|cold|hot/.test(text)) return 'WEATHER_ELIGIBLE_FEW';
  if (/attribute|incomplete|missing_attributes/.test(text)) return 'ATTRIBUTE_INCOMPLETE';
  if (/diversity|similar|exhaust|limited_by_core/.test(text)) return 'DIVERSITY_EXHAUSTED';
  if (/scene|work_scene|date_scene|sport_scene|home_scene/.test(text)) return 'SCENE_ELIGIBLE_FEW';
  return fallback;
}

function getVoiceBankInventory() {
  return {
    version: VOICE_BANK_VERSION,
    claimCatalog: CLAIM_CATALOG.length,
    recommendationTotal: CLAIM_CATALOG.length,
    fallback: 0,
    productState: PRODUCT_STATE_COPY.length,
    scenes: Object.fromEntries(['home', 'work', 'date', 'sport'].map((scene) => [
      scene,
      CLAIM_CATALOG.filter((entry) => entry.scene === scene).length,
    ])),
  };
}

function renderSentenceCluster(cluster, slots = {}) {
  const definition = getClaimById(cluster?.claimId || cluster?.id);
  if (!definition) return null;
  if (slots && typeof slots !== 'object') return null;
  return definition.text;
}

function sourceLevel(source, confidence, authorized = true, fact = '') {
  return factEvidenceLevel({ source, confidence, authorized, fact });
}

function sourceMeetsMinimum(record, minimumLevel) {
  return factSourceMeetsMinimum(record, minimumLevel);
}

function normalizeScene(value) {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return { home: 'home', 居家: 'home', work: 'work', 上班: 'work', 通勤: 'work', date: 'date', 约会: 'date', sport: 'sport', sports: 'sport', 运动: 'sport' }[text] || text;
}

module.exports = {
  VOICE_BANK_VERSION,
  PRODUCT_STATE_COPY,
  LIMITED_SCENE_COPY,
  CLAIM_CATALOG,
  TODAY_SENTENCE_CLUSTERS,
  DETAIL_SENTENCE_CLUSTERS,
  SAFE_FALLBACK_CLUSTERS,
  ALL_SENTENCE_CLUSTERS,
  getClaimById,
  getProductStateCopy,
  getLimitedRecommendationCopy,
  classifyLimitedReason,
  getVoiceBankInventory,
  renderSentenceCluster,
  sourceLevel,
  sourceMeetsMinimum,
};
