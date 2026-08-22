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

test('resolves the real wx cloud contract shape to the renderer source', async () => {
  const source = 'cloud://cloud1-d8gl3k1vkdf0b7f05/wardrobe/top-1.png';
  const previousWx = globalThis.wx;
  globalThis.wx = {
    cloud: {
      getTempFileURL: async ({ fileList }) => ({
        fileList: fileList.map((fileID) => ({
          fileID,
          tempFileURL: 'https://example.test/temp/top-1.png',
          status: 0,
        })),
      }),
    },
  };
  try {
    const result = await resolveRecommendationMedia(response(source));
    assert.equal(result.light.cards[0].items[0].displayImageUrl, 'https://example.test/temp/top-1.png');
  } finally {
    globalThis.wx = previousWx;
  }
});

test('cache prevents resolution work from repeating across renders', async () => {
  let calls = 0;
  const resolver = async (ids) => { calls += 1; return { [ids[0]]: 'https://cdn.example/xxx.png' }; };
  await resolveRecommendationMedia(response(), resolver);
  await resolveRecommendationMedia(response(), resolver);
  assert.equal(calls, 1);
});

test('overlapping batches share an in-flight cloud lookup per file', async () => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const resolver = async (ids) => {
    calls += 1;
    await gate;
    return Object.fromEntries(ids.map((id) => [id, `https://cdn.example/${id.split('/').pop()}`]));
  };
  const first = resolveRecommendationMedia(response(), resolver);
  const second = resolveRecommendationMedia(response(), resolver);
  assert.equal(calls, 1);
  release();
  await Promise.all([first, second]);
  assert.equal(calls, 1);
});

test('failed resolution is retryable rather than permanently cached', async () => {
  let calls = 0;
  const resolver = async (ids) => {
    calls += 1;
    return calls === 1 ? {} : { [ids[0]]: 'https://cdn.example/retry.png' };
  };
  const first = await resolveRecommendationMedia(response(), resolver);
  const second = await resolveRecommendationMedia(response(), resolver);
  assert.equal(first.light.cards[0].items[0].displayImageUrl, '');
  assert.equal(second.light.cards[0].items[0].displayImageUrl, 'https://cdn.example/retry.png');
  assert.equal(calls, 2);
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
