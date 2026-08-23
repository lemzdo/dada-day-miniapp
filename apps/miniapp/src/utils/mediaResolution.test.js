const assert = require('node:assert/strict');
const test = require('node:test');
const {
  clearMediaResolutionCache,
  hydrateHomeLightForRender,
} = require('./mediaResolution');

function response(url = 'cloud://cloud1-d8gl3k1vkdf0b7f05/xxx.png') {
  return { light: { cards: [{ items: [{ clothingId: 'top-1', displayImageUrl: url }] }] } };
}

test.afterEach(clearMediaResolutionCache);

test('resolves canonical displayImageUrl cloud fixture in one batch', async () => {
  let calls = 0;
  const result = await hydrateHomeLightForRender(response().light, async (ids) => {
    calls += 1;
    assert.deepEqual(ids, ['cloud://cloud1-d8gl3k1vkdf0b7f05/xxx.png']);
    return new Map([[ids[0], 'https://cdn.example/xxx.png']]);
  });
  assert.equal(result.cards[0].items[0].displayImageUrl, 'https://cdn.example/xxx.png');
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
          tempFileURL: 'https://cloud1.tcb.qcloud.la/temp/top-1.png?sign=abc',
          status: 0,
          errMsg: 'ok',
        })),
      }),
    },
  };
  try {
    const canonical = response(source).light;
    const result = await hydrateHomeLightForRender(canonical);
    assert.equal(canonical.cards[0].items[0].displayImageUrl, source);
    assert.equal(result.cards[0].items[0].displayImageUrl, 'https://cloud1.tcb.qcloud.la/temp/top-1.png?sign=abc');
  } finally {
    globalThis.wx = previousWx;
  }
});

test('hydrates render light while preserving canonical cloud file ID', async () => {
  const canonical = response().light;
  const render = await hydrateHomeLightForRender(canonical, async (ids) => new Map([
    [ids[0], 'https://cloud1.tcb.qcloud.la/xxx.png?sign=abc'],
  ]));
  assert.equal(canonical.cards[0].items[0].displayImageUrl, 'cloud://cloud1-d8gl3k1vkdf0b7f05/xxx.png');
  assert.equal(render.cards[0].items[0].displayImageUrl, 'https://cloud1.tcb.qcloud.la/xxx.png?sign=abc');
});

test('hydration rejects resolver output that is not an https URL', async () => {
  const render = await hydrateHomeLightForRender(response().light, async (ids) => new Map([
    [ids[0], 'cloud://still-canonical'],
  ]));
  assert.equal(render, null);
});

test('wx contract requires status zero and a renderable temp URL', async () => {
  const previousWx = globalThis.wx;
  globalThis.wx = { cloud: { getTempFileURL: async ({ fileList }) => ({
    fileList: fileList.map((fileID) => ({ fileID, tempFileURL: 'cloud://bad', status: 1 })),
  }) } };
  try {
    const canonical = response().light;
    canonical.cards[0].items.push({ clothingId: 'bottom-1', displayImageUrl: 'cloud://cloud1-d8gl3k1vkdf0b7f05/bottom.png' });
    assert.equal(await hydrateHomeLightForRender(canonical), null);
  } finally {
    globalThis.wx = previousWx;
  }
});

test('wx status zero still rejects cloud and http temp URLs', async () => {
  const previousWx = globalThis.wx;
  globalThis.wx = { cloud: { getTempFileURL: async ({ fileList }) => ({
    fileList: fileList.map((fileID, index) => ({
      fileID,
      tempFileURL: index === 0 ? 'cloud://bad' : 'http://insecure.test/file.png',
      status: 0,
    })),
  }) } };
  try {
    const canonical = response().light;
    canonical.cards[0].items.push({ clothingId: 'bottom-1', displayImageUrl: 'cloud://cloud1-d8gl3k1vkdf0b7f05/bottom.png' });
    assert.equal(await hydrateHomeLightForRender(canonical), null);
  } finally {
    globalThis.wx = previousWx;
  }
});

test('cache prevents resolution work from repeating across renders', async () => {
  let calls = 0;
  const resolver = async (ids) => { calls += 1; return { [ids[0]]: 'https://cdn.example/xxx.png' }; };
  await hydrateHomeLightForRender(response().light, resolver);
  await hydrateHomeLightForRender(response().light, resolver);
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
  const first = hydrateHomeLightForRender(response().light, resolver);
  const second = hydrateHomeLightForRender(response().light, resolver);
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
  const first = await hydrateHomeLightForRender(response().light, resolver);
  const second = await hydrateHomeLightForRender(response().light, resolver);
  assert.equal(first, null);
  assert.equal(second.cards[0].items[0].displayImageUrl, 'https://cdn.example/retry.png');
  assert.equal(calls, 2);
});

test('failed or missing cloud resolution is fail-closed', async () => {
  const result = await hydrateHomeLightForRender(response().light, async () => ({}));
  assert.equal(result, null);
});

test('does not introduce image aliases', async () => {
  const result = await hydrateHomeLightForRender(response().light, async (ids) => ({ [ids[0]]: 'https://cdn.example/xxx.png' }));
  assert.equal('imageUrl' in result.cards[0].items[0], false);
  assert.equal('thumbnailUrl' in result.cards[0].items[0], false);
});
