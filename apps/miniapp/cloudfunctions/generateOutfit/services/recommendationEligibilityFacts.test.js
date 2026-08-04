const assert = require('node:assert/strict');
const test = require('node:test');

const { adaptLegacyVisibleFacts } = require('./recommendationEligibilityFacts');
const { factCanInformEligibility, factEvidenceLevel } = require('./recommendationFactAuthorization');

test('legacy visible fields derive only observable eligibility facts with explicit legacy provenance', () => {
  const result = adaptLegacyVisibleFacts([{
    _id: 'legacy-top',
    category: 'top',
    subCategory: '无袖休闲上衣',
    sleeveLength: 'sleeveless',
    fit: '宽松',
    patternType: '纯色',
    color: '白色',
    styleTags: ['休闲', '简约'],
    material: '柔软透气速干弹力面料',
    contractFacts: ['soft_material', 'flexible_fit', 'breathability', 'quick_dry', 'cushioning', 'grip'],
    factSource: 'legacy_snapshot',
  }]);

  const records = result.itemFactsById['legacy-top'].factRecords;
  const facts = new Set(records.map((record) => record.fact));
  for (const fact of ['sleeveless', 'loose_fit', 'solid_color', 'basic_color', 'simple_style', 'casual_style']) {
    assert.equal(facts.has(fact), true, fact);
  }
  for (const fact of ['soft_material', 'flexible_fit', 'breathability', 'quick_dry', 'cushioning', 'grip']) {
    assert.equal(facts.has(fact), false, fact);
  }
  for (const record of records) {
    assert.equal(record.source, 'legacy_snapshot');
    assert.equal(record.sourceDetail, 'legacy-visible-fact-adapter');
    assert.equal(factCanInformEligibility(record), true);
    assert.equal(factEvidenceLevel(record), 'B');
  }
});

test('legacy_snapshot never authorizes reliable-only functional facts even at high confidence', () => {
  for (const fact of ['soft_material', 'flexible_fit', 'breathability', 'quick_dry', 'warmth', 'cushioning', 'anti_slip', 'grip', 'secure_fit']) {
    const record = { factId: `item:x:${fact}`, itemId: 'x', fact, source: 'legacy_snapshot', confidence: 1, authorized: true };
    assert.equal(factCanInformEligibility(record), false, fact);
    assert.equal(factEvidenceLevel(record), 'C', fact);
  }
});

test('audited legacy enum adapters accept tshirt, pattern, sport dress and shoe closures only from exact fields', () => {
  const result = adaptLegacyVisibleFacts([
    { _id: 'tee-ok', category: 'top', subCategory: 'tshirt', patternType: 'stripe' },
    { _id: 'tee-no', category: 'top', subCategory: '上衣', customName: '很像 T 恤的名字' },
    { _id: 'sport-dress-ok', category: 'onepiece', subCategory: 'tennis_dress' },
    { _id: 'sport-dress-no', category: 'onepiece', subCategory: 'dress', styleTags: ['网球风'] },
    { _id: 'lace-ok', category: 'shoes', subCategory: '运动鞋', closureType: 'lace_up' },
    { _id: 'strap-ok', category: 'shoes', subCategory: '凉鞋', shoeClosure: 'fixed_strap' },
    { _id: 'closure-no', category: 'shoes', subCategory: '鞋子', customName: '看起来有鞋带' },
  ]);

  assert.equal(result.itemFactsById['tee-ok'].facts.includes('short_sleeve'), true);
  assert.equal(result.items.find((item) => item.id === 'tee-ok').legacyVisibleTraits.tshirt, true);
  assert.equal(result.items.find((item) => item.id === 'tee-ok').patternLabel, '条纹');
  assert.equal(result.itemFactsById['tee-no'].facts.includes('short_sleeve'), false);
  assert.equal(result.items.find((item) => item.id === 'sport-dress-ok').legacyVisibleTraits.sportDress, true);
  assert.equal(result.items.find((item) => item.id === 'sport-dress-no').legacyVisibleTraits.sportDress, false);
  assert.equal(result.itemFactsById['lace-ok'].facts.includes('shoe_laces'), true);
  assert.equal(result.itemFactsById['strap-ok'].facts.includes('fixed_strap'), true);
  assert.equal(result.itemFactsById['closure-no'].facts.includes('shoe_laces'), false);
  assert.equal(result.itemFactsById['closure-no'].facts.includes('fixed_strap'), false);
});

test('ordinary red orange and yellow legacy colors never synthesize bright_color', () => {
  const result = adaptLegacyVisibleFacts([
    { _id: 'red', category: 'top', color: '红色' },
    { _id: 'orange', category: 'top', color: '橙色' },
    { _id: 'yellow', category: 'top', color: '黄色' },
  ]);
  for (const id of ['red', 'orange', 'yellow']) {
    assert.equal(result.itemFactsById[id].facts.includes('bright_color'), false, id);
  }
});

test('pattern legacy adapter rejects texture material and decoration values', () => {
  for (const patternType of ['other', 'texture', 'knit', 'denim', 'lace', 'embroidery']) {
    const result = adaptLegacyVisibleFacts([{ _id: patternType, category: 'top', patternType }]);
    assert.equal(result.itemFactsById[patternType].facts.includes('pattern_visible'), false, patternType);
    assert.equal(result.items[0].patternLabel, null, patternType);
  }
});
