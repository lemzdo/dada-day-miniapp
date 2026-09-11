const assert = require('node:assert/strict');
const test = require('node:test');

const { buildOutfitCardViewModel } = require('./cardViewModel');

function item(id) {
  return { clothingId: id, imageUrl: `${id}.png` };
}

test('card view model shows all items for two and three item outfits', () => {
  assert.equal(buildOutfitCardViewModel({ items: [item('a'), item('b')] }).previewItems.length, 2);
  assert.equal(buildOutfitCardViewModel({ items: [item('a'), item('b'), item('c')] }).previewItems.length, 3);
  assert.equal(buildOutfitCardViewModel({ items: [item('a'), item('b'), item('c')] }).hiddenItemCount, 0);
});

test('card view model caps four and five item homepage cards at three previews', () => {
  const four = buildOutfitCardViewModel({ items: [item('a'), item('b'), item('c'), item('d')] });
  const five = buildOutfitCardViewModel({ items: [item('a'), item('b'), item('c'), item('d'), item('e')] });

  assert.deepEqual(four.previewItems.map((entry) => entry.clothingId), ['a', 'b', 'c']);
  assert.equal(four.hiddenItemCount, 1);
  assert.equal(four.layoutVariant, 'preview-3-plus');
  assert.deepEqual(five.previewItems.map((entry) => entry.clothingId), ['a', 'b', 'c']);
  assert.equal(five.hiddenItemCount, 2);
  assert.equal(five.layoutVariant, 'preview-3-plus');
});

test('Today card view model is the render data boundary', () => {
  const card = buildOutfitCardViewModel({ items: [item('a'), item('b'), item('c'), item('d')] });
  assert.deepEqual(card.previewItems.map((entry) => entry.clothingId), ['a', 'b', 'c']);
  assert.equal(card.totalItemCount, 4);
  assert.equal(card.layoutVariant, 'preview-3-plus');
});
