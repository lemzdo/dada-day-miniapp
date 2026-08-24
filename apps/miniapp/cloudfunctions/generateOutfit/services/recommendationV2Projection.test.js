'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { projectBatchCoreV2, projectHomeLightItemV2, projectHomeLightV2 } = require('./recommendationV2Projection');

const baseCards = (mode) => Array.from({ length: 8 }, (_, index) => ({
  _id: `legacy-${mode}-${index}`,
  outfitKey: `${mode}-key-${index}`,
  title: `标题-${index}`,
  reason: `理由-${index}`,
  styleTags: ['a', 'b', 'c', 'forbidden-fourth'],
  clothingIds: [`clothing-${index}`],
  items: [{ clothingId: `clothing-${index}`, displayImageUrl: `cloud://image-${index}`, hidden: 'must-not-leak' }],
  scores: { total: 99 },
}));

for (const mode of ['all-existing', 'mixed', 'all-new']) {
  test(`V2 home light fixture keeps the same eight-card contract for ${mode}`, () => {
    const result = projectHomeLightV2(baseCards(mode), `batch-${mode}`);
    assert.equal(result.cards.length, 8);
    assert.deepEqual(Object.keys(result.cards[0]).sort(), ['aiState', 'clothingIds', 'copySource', 'displayTitle', 'isFavorite', 'isWornToday', 'items', 'outfitKey', 'position', 'referenceId', 'styleTags', 'todayReason'].sort());
    assert.equal(result.cards[0].styleTags.length, 3);
    assert.equal('scores' in result.cards[0], false);
    assert.equal('hidden' in result.cards[0].items[0], false);
  });
}

test('V2 batch core only contains the batch contract fields', () => {
  const result = projectBatchCoreV2({ batchId: 'batch-1', commitToken: 'commit-1', contentHash: 'hash-1', sceneKey: 'home', scene: '居家', targetDate: '2026-08-20', timeOfDay: 'all_day', weatherMode: 'live', weatherSnapshot: { temp: 28, humidity: 60, weather: '多云', wind: 2, uv: 3 }, weatherFingerprint: 'weather-1', inputIdentityHash: 'input-1', generatedAt: '2026-08-20T00:00:00.000Z', countContract: { requestedCardCount: 8, returnedCardCount: 8, limited: false, exhausted: false }, order: Array.from({ length: 8 }, (_, index) => `key-${index}`), scores: { forbidden: true } });
  assert.equal(result.cardCount, 8);
  assert.equal('scores' in result, false);
  assert.deepEqual(result.countContract, { requestedCardCount: 8, returnedCardCount: 8, limited: false, exhausted: false });
  assert.equal(result.runtimeVersion, 'today-runtime-v2');
  assert.equal(result.schemaVersion, 'today-v2');
  assert.deepEqual(Object.keys(result.weatherSnapshot).sort(), ['humidity', 'temp', 'uv', 'weather', 'wind']);
});

test('V2 projection emits only the display image field and fails closed', () => {
  assert.deepEqual(projectHomeLightItemV2({ clothingId: 'c-1', displayImageUrl: 'cloud://image' }), {
    clothingId: 'c-1', displayImageUrl: 'cloud://image', isDeleted: false,
  });
  assert.throws(() => projectHomeLightItemV2({ clothingId: 'c-1', displayImageUrl: '' }), /V2_HOME_LIGHT_IMAGE_REQUIRED/);
  assert.throws(() => projectHomeLightItemV2({ clothingId: 'c-1', displayImageUrl: 'cloud://image', isDeleted: true }), /V2_HOME_LIGHT_DELETED_ITEM/);
});

test('V2 TARGET_8 accepts partial and empty batches with self-consistent contracts', () => {
  for (const count of [7, 3, 1, 0]) {
    const cards = baseCards(`partial-${count}`).slice(0, count);
    const light = projectHomeLightV2(cards, `batch-partial-${count}`);
    const core = projectBatchCoreV2({
      batchId: `batch-partial-${count}`, commitToken: 'commit', contentHash: 'hash',
      sceneKey: 'home', scene: '居家', targetDate: '2026-08-20', timeOfDay: 'all_day',
      weatherMode: 'live', weatherSnapshot: {}, weatherFingerprint: 'weather', inputIdentityHash: 'input',
      generatedAt: '2026-08-20T00:00:00.000Z',
      countContract: { requestedCardCount: 8, returnedCardCount: count, limited: count < 8, exhausted: count < 8 },
      order: cards.map((card) => card.outfitKey),
    });
    assert.equal(light.cards.length, count);
    assert.equal(core.cardCount, count);
    assert.equal(core.countContract.returnedCardCount, count);
  }
});
