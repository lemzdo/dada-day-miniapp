const assert = require('node:assert/strict');
const test = require('node:test');

const { buildOutfitCopyFacts } = require('./outfitCopyFacts');

function goldenInput() {
  return {
    outfit: {
      id: 'golden',
      scene: '居家',
      weatherSnapshot: { temp: 22, weather: '多云' },
      items: [
        { clothingId: 'top-1', category: 'top', subcategory: 'T恤', color: '米白色' },
        { clothingId: 'bottom-1', category: 'bottom', subcategory: '阔腿裤', color: '军绿色' },
        { clothingId: 'shoes-1', category: 'shoes', subcategory: '运动鞋', color: '白色' },
      ],
    },
  };
}

test('buildOutfitCopyFacts exposes raw colors aliases families and fields', () => {
  const facts = buildOutfitCopyFacts(goldenInput());

  assert.equal(facts.scene.raw, '居家');
  assert.equal(facts.weather.text, '22℃ 多云');
  assert.deepEqual(facts.items.map((item) => `${item.name}/${item.rawColor}`), [
    'T恤/米白色',
    '阔腿裤/军绿色',
    '运动鞋/白色',
  ]);
  assert.deepEqual(facts.colorAliases['米白色'], ['米白', '米色', '白色', '米色系', '白色系']);
  assert.deepEqual(facts.colorAliases['军绿色'], ['军绿', '绿色', '绿色系', '低饱和色']);
  assert.deepEqual(facts.colorAliases['白色'], ['白色', '白色系']);
  assert.ok(facts.allowedFacts.includes('color:米白色'));
  assert.ok(facts.allowedFacts.includes('colorAlias:军绿色:绿色系'));
  assert.equal(facts.fieldsPresent.color, true);
  assert.equal(facts.fieldsPresent.pattern, false);
});

test('buildOutfitCopyFacts does not authorize unsupported claims when fields are missing', () => {
  const facts = buildOutfitCopyFacts({
    outfit: {
      scene: '居家',
      items: [{ clothingId: 'top-1', category: 'top', subcategory: 'T恤' }],
    },
  });

  assert.equal(facts.fieldsPresent.color, false);
  for (const claim of ['印花', '宽松版型', '街头感', '透气', '亲肤', '舒适自在']) {
    assert.ok(facts.forbiddenClaims.includes(claim), claim);
    assert.equal(facts.allowedFacts.some((fact) => fact.includes(claim)), false);
  }
});
