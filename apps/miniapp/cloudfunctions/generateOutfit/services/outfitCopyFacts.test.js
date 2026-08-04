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

test('work eligibility relation is derived only from existing scene eligibility provenance', () => {
  const base = {
    scene: 'work',
    items: [
      { clothingId: 'top-work', category: 'top', subcategory: '衬衫', confidence: 0.91 },
      { clothingId: 'bottom-work', category: 'bottom', subcategory: '直筒裤', fit: '直筒', confidence: 0.92 },
    ],
  };
  const absent = buildOutfitCopyFacts({ outfit: base, scene: 'work' });
  assert.equal(absent.relationFacts.some((fact) => fact.factId === 'outfit:work_eligible'), false);

  const present = buildOutfitCopyFacts({
    outfit: {
      ...base,
      eligibility: {
        scene: {
          eligible: true,
          hardRejected: false,
          sceneStrength: 'strong',
          acceptReasons: ['WORK_CORE_COMPLETE'],
        },
      },
    },
    scene: 'work',
  });
  const relation = present.relationFacts.find((fact) => fact.factId === 'outfit:work_eligible');
  assert.equal(relation.source, 'scene_rule');
  assert.equal(relation.sourceRule, 'sceneEligibilityV3');
  assert.deepEqual(relation.sourceRuleReasons, ['WORK_CORE_COMPLETE']);
  assert.deepEqual(relation.subjectItemIds, ['top-work', 'bottom-work']);
  assert.equal(relation.supportingFactIds.every((id) => /^item:(top-work|bottom-work):/.test(id)), true);
});

test('color coordination is an outfit relation backed by both exact item color facts', () => {
  const facts = buildOutfitCopyFacts({
    outfit: {
      scene: 'date',
      items: [
        { clothingId: 'top-date', category: 'top', subcategory: '上衣', color: '米白色', confidence: 0.91 },
        { clothingId: 'bottom-date', category: 'bottom', subcategory: '长裤', color: '米白色', confidence: 0.93 },
      ],
    },
    scene: 'date',
  });
  const relation = facts.relationFacts.find((fact) => fact.factId === 'outfit:color_coordinated');
  assert.deepEqual(relation.subjectItemIds, ['top-date', 'bottom-date']);
  assert.deepEqual(relation.supportingFactIds, ['item:top-date:color', 'item:bottom-date:color']);
  assert.equal(relation.relationRule, 'same_normalized_color_group');
  assert.equal(facts.itemFactsById['top-date'].facts.includes('color_coordinated'), false);
  assert.equal(facts.itemFactsById['bottom-date'].facts.includes('color_coordinated'), false);
});
