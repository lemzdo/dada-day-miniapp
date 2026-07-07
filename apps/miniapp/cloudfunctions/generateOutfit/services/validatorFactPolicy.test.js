const assert = require('node:assert/strict');
const test = require('node:test');

const { buildOutfitCopyFacts } = require('./outfitCopyFacts');
const { validateCopyAgainstFacts } = require('./validatorFactPolicy');

function goldenFacts() {
  return buildOutfitCopyFacts({
    outfit: {
      scene: '居家',
      items: [
        { clothingId: 'top-1', category: 'top', subcategory: 'T恤', color: '米白色' },
        { clothingId: 'bottom-1', category: 'bottom', subcategory: '阔腿裤', color: '军绿色' },
        { clothingId: 'shoes-1', category: 'shoes', subcategory: '运动鞋', color: '白色' },
      ],
    },
  });
}

test('validateCopyAgainstFacts allows real colors and aliases with trace code', () => {
  const result = validateCopyAgainstFacts('米色系上衣和绿色系下装接在一起，白色系鞋子呼应上衣。', goldenFacts());

  assert.equal(result.ok, true);
  assert.deepEqual(result.rejectReasons, []);
  assert.ok(result.trace.some((entry) => entry.code === 'COLOR_ALIAS_ALLOWED' && entry.term === '绿色系'));
  assert.ok(result.trace.some((entry) => entry.code === 'COLOR_ALIAS_ALLOWED' && entry.term === '米色系'));
});

test('validateCopyAgainstFacts rejects unsupported colors and missing fields', () => {
  const unsupportedColor = validateCopyAgainstFacts('紫色配饰会让这套更醒目。', goldenFacts());
  assert.equal(unsupportedColor.ok, false);
  assert.ok(unsupportedColor.rejectReasons.includes('UNSUPPORTED_FACT'));

  const missingFields = validateCopyAgainstFacts('印花和宽松版型带来街头感，透气亲肤也舒适自在。', goldenFacts());
  assert.equal(missingFields.ok, false);
  assert.ok(missingFields.rejectReasons.includes('UNSUPPORTED_FACT'));
  assert.ok(missingFields.trace.some((entry) => entry.term === '印花'));
  assert.ok(missingFields.trace.some((entry) => entry.term === '宽松版型'));
  assert.ok(missingFields.trace.some((entry) => entry.term === '街头感'));
  assert.ok(missingFields.trace.some((entry) => entry.term === '透气'));
  assert.ok(missingFields.trace.some((entry) => entry.term === '亲肤'));
});
