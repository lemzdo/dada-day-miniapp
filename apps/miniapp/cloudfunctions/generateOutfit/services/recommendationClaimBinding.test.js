const assert = require('node:assert/strict');
const test = require('node:test');

const {
  ATTRIBUTE_CATEGORY_COMPATIBILITY,
  buildCopyNames,
  extractItemFactRecords,
  extractItemFacts,
  isFactCategoryCompatible,
  scopeOutfitFactsToItems,
} = require('./recommendationClaimBinding');

test('item-scoped facts keep attribute ownership on the matching garment', () => {
  const items = [
    { id: 'top-1', category: 'top', facts: extractItemFacts({ aestheticFeatures: { neckline: 'crew' } }, 'top') },
    { id: 'bottom-2', category: 'bottom', facts: extractItemFacts({ aestheticFeatures: { fit: 'flexible' } }, 'bottom') },
    { id: 'shoes-3', category: 'shoes', facts: extractItemFacts({ contractFacts: ['anti_slip'] }, 'shoes') },
  ];
  const scoped = scopeOutfitFactsToItems(items, []);

  assert.deepEqual(scoped['top-1'].evidenceFactIds.includes('item:top-1:neckline'), true);
  assert.deepEqual(scoped['bottom-2'].evidenceFactIds.includes('item:bottom-2:flexible_fit'), true);
  assert.deepEqual(scoped['shoes-3'].evidenceFactIds.includes('item:shoes-3:anti_slip'), true);
  assert.equal(scoped['bottom-2'].facts.includes('neckline'), false);
  assert.equal(scoped['shoes-3'].facts.includes('neckline'), false);
});

test('care-label parsing preserves origin and upgrades only explicit label provenance', () => {
  const records = extractItemFactRecords({
    clothingId: 'top-care',
    category: 'top',
    confidence: 0.99,
    careLabelFacts: [{ fact: 'quick_dry', confidence: 0.92, parsedFrom: 'wash_label_ocr' }],
    factEvidence: [
      { fact: 'breathability', source: 'structured_ai', confidence: 0.99, sourceDetail: 'care_label_ocr' },
      { fact: 'warmth', source: 'structured_ai', confidence: 0.99, sourceDetail: 'vision_model' },
    ],
  }, 'top');
  const byFact = Object.fromEntries(records.map((record) => [record.fact, record]));
  assert.equal(byFact.quick_dry.source, 'care_label');
  assert.equal(byFact.quick_dry.sourceDetail, 'wash_label_ocr');
  assert.equal(byFact.breathability.source, 'care_label');
  assert.equal(byFact.breathability.sourceDetail, 'care_label_ocr');
  assert.equal(byFact.warmth.source, 'structured_ai');
  assert.equal(byFact.warmth.sourceDetail, 'vision_model');
});

test('category capability matrix blocks neckline collar and sleeve on bottoms', () => {
  for (const fact of ['neckline', 'collar', 'sleeve']) {
    assert.deepEqual(ATTRIBUTE_CATEGORY_COMPATIBILITY[fact], ['top', 'outerwear', 'onepiece']);
    assert.equal(isFactCategoryCompatible(fact, 'bottom'), false, fact);
  }
});

test('category capability matrix blocks upper-body attributes on shoes', () => {
  for (const fact of ['neckline', 'hemline', 'shoulder_line']) {
    assert.equal(isFactCategoryCompatible(fact, 'shoes'), false, fact);
  }
});

test('copyLabel stays natural while displayName preserves the full user-facing name', () => {
  assert.deepEqual(buildCopyNames({ category: 'top', subcategory: '白色短袖T恤', color: '白色' }), {
    displayName: '白色短袖T恤',
    copyLabel: '这件短袖T恤',
  });
  assert.deepEqual(buildCopyNames({ category: 'bottom', subcategory: '弹力居家长裤' }), {
    displayName: '弹力居家长裤',
    copyLabel: '这条长裤',
  });
  assert.deepEqual(buildCopyNames({ category: 'shoes', subcategory: '亮黄条纹运动鞋' }), {
    displayName: '亮黄条纹运动鞋',
    copyLabel: '这双运动鞋',
  });
});
