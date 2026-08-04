const assert = require('node:assert/strict');
const test = require('node:test');

const { mapPatternLabel } = require('./recommendationPatternLabel');

test('maps only the registered pattern enum values', () => {
  const cases = {
    stripe: '条纹',
    plaid: '格纹',
    check: '格纹',
    floral: '碎花',
    polkaDot: '波点',
    polka_dot: '波点',
    animal: '动物纹',
    abstract: '抽象图案',
    colorBlock: '拼色',
    graphic: '有图案的',
    print: '有图案的',
    printed: '有图案的',
    印花: '有图案的',
  };
  for (const [raw, expected] of Object.entries(cases)) {
    assert.equal(mapPatternLabel(raw), expected, raw);
  }
});

test('rejects solid, generic texture and every unregistered value', () => {
  for (const raw of [
    'other', 'solid', 'plain', '纯色', 'unknown', '', 'texture', 'knit', 'denim',
    'lace', 'embroidery', '字母图案', '卡通图案', null, undefined,
  ]) {
    assert.equal(mapPatternLabel(raw), null, String(raw));
  }
});
