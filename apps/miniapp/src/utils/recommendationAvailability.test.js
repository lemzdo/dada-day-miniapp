const assert = require('node:assert/strict');
const test = require('node:test');

const {
  NEUTRAL_EMPTY_NOTICE,
  NO_MORE_NEW_OUTFITS_NOTICE,
  getRecommendationEmptyStateCopy,
} = require('./recommendationAvailability');

test('neutral empty state never tells a complete wardrobe to add clothes', () => {
  assert.equal(getRecommendationEmptyStateCopy([]), '这个场景暂时没找到合适的搭配，换个场景试试吧。');
  assert.equal(getRecommendationEmptyStateCopy([]), NEUTRAL_EMPTY_NOTICE);
  assert.equal(getRecommendationEmptyStateCopy([]).includes('衣橱'), false);
});

test('missing-category copy names only the roles reported by the server', () => {
  assert.equal(getRecommendationEmptyStateCopy(['bottom']), '当前场景还缺少下装，补齐后再试试。');
  assert.match(getRecommendationEmptyStateCopy(['top', 'bottom', 'onepiece', 'shoes']), /上衣和下装，或一件连衣裙/);
  assert.match(getRecommendationEmptyStateCopy(['top', 'bottom', 'onepiece', 'shoes']), /鞋子/);
});

test('sport fact gaps explain why ordinary footwear or bottoms are insufficient', () => {
  assert.match(getRecommendationEmptyStateCopy([], ['sport_stable_shoe']), /稳定包脚的运动鞋/);
  assert.match(getRecommendationEmptyStateCopy([], ['sport_activity_bottom']), /活动方便的下装/);
});

test('refresh exhaustion copy is stable and does not imply an empty wardrobe', () => {
  assert.equal(NO_MORE_NEW_OUTFITS_NOTICE, '这一轮暂时没有更多新搭配了。');
  assert.equal(NO_MORE_NEW_OUTFITS_NOTICE.includes('衣服'), false);
});
