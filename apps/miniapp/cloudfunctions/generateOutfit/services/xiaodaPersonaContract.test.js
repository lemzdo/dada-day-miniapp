const assert = require('node:assert/strict');
const test = require('node:test');

const {
  ALGORITHM_CHINESE_REJECTION_CORPUS,
  XIAODA_PERSONA_CONTRACT,
  XIAODA_PERSONA_VERSION,
  inspectXiaodaPersonaCopy,
} = require('./xiaodaPersonaContract');

test('Xiaoda persona is a formal body-centered product contract', () => {
  assert.equal(XIAODA_PERSONA_CONTRACT.version, XIAODA_PERSONA_VERSION);
  assert.equal(XIAODA_PERSONA_CONTRACT.perspective, 'body_centered_human');
  assert.equal(XIAODA_PERSONA_CONTRACT.sentenceOrder, 'judgment_then_reason');
  assert.ok(XIAODA_PERSONA_CONTRACT.allowedAestheticInferences.includes('有重点'));
  assert.ok(XIAODA_PERSONA_CONTRACT.forbiddenClaims.includes('显瘦'));
});

test('persona inspection rejects algorithm Chinese marketing and unsupported effects', () => {
  for (const text of [
    ...ALGORITHM_CHINESE_REJECTION_CORPUS,
    '亮色只留在上半身，主体颜色已经连起来。',
    '颜色隔着下装还能前后呼应。',
    '下半身到鞋的颜色不会突然断开。',
    '上衣和鞋子同色把视线拉回两端，下装在中间隔开。',
    '上衣和鞋子都是白色，把视线留在脸附近。',
    '白色短裤配白色运动鞋让腿部到脚下颜色不断开。',
    '上衣和鞋子把浅色放在上下两端，让中间的绿色更集中。',
    '米白色印花T恤配灰色短裤，短裤在中间留出颜色变化。',
    '这套显瘦显高，闭眼冲就行。',
  ]) {
    assert.equal(inspectXiaodaPersonaCopy(text).passed, false, text);
  }
});

test('persona inspection rejects editorial analysis voice and semicolon-heavy copy', () => {
  for (const text of [
    '这套的价值在于两件衣服各司其职、互不干扰。',
    '白色短裤和白色运动鞋过渡自然；上衣保持基础形态。',
    '这套搭配适合轻运动，穿起来清爽利落。',
    '蓝色手提袋没有打破军绿和米白的主支撑关系。',
  ]) {
    assert.equal(inspectXiaodaPersonaCopy(text).passed, false, text);
  }
});

test('persona inspection accepts natural grounded wardrobe language', () => {
  for (const text of [
    '印花上衣已经够有内容了，纯色长裤简单一点刚刚好，整身有重点，也不会显得太杂。',
    '白色上衣和鞋子颜色一样，灰色短裤让整身还留着明暗变化，鞋子也不会显得突兀。',
    '鞋子和上衣同色所以不突兀，下装让整身保留颜色变化。',
  ]) {
    assert.deepEqual(inspectXiaodaPersonaCopy(text).violations, [], text);
  }
});
