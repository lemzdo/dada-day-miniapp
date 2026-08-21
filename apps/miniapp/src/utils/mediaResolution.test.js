const assert = require('node:assert/strict');
const test = require('node:test');
const { clearMediaResolutionCache, resolveRecommendationMedia } = require('./mediaResolution');

function response(url = 'cloud://cloud1-d8gl3k1vkdf0b7f05/xxx.png') {
  return { light: { cards: [{ items: [{ clothingId: 'top-1', displayImageUrl: url }] }] } };
}

test.afterEach(clearMediaResolutionCache);

test('resolves canonical displayImageUrl cloud fixture in one batch', async () => {
  let calls = 0;
  const result = await resolveRecommendationMedia(response(), async (ids) => {
    calls += 1;
    assert.deepEqual(ids, ['cloud://cloud1-d8gl3k1vkdf0b7f05/xxx.png']);
    return new Map([[ids[0], 'https://cdn.example/xxx.png']]);
  });
  assert.equal(result.light.cards[0].items[0].displayImageUrl, 'https://cdn.example/xxx.png');
  assert.equal(calls, 1);
});

test('cache prevents resolution work from repeating across renders', async () => {
  let calls = 0;
  const resolver = async (ids) => { calls += 1; return { [ids[0]]: 'https://cdn.example/xxx.png' }; };
  await resolveRecommendationMedia(response(), resolver);
  await resolveRecommendationMedia(response(), resolver);
  assert.equal(calls, 1);
});

test('failed or missing cloud resolution is fail-closed', async () => {
  const result = await resolveRecommendationMedia(response(), async () => ({}));
  assert.equal(result.light.cards[0].items[0].displayImageUrl, '');
});

test('does not introduce image aliases', async () => {
  const result = await resolveRecommendationMedia(response(), async (ids) => ({ [ids[0]]: 'https://cdn.example/xxx.png' }));
  assert.equal('imageUrl' in result.light.cards[0].items[0], false);
  assert.equal('thumbnailUrl' in result.light.cards[0].items[0], false);
});
