'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { prewarmResolvedGarments } = require('./mediaPrewarmCore.js');

test('prewarm dedupes resolved assets and counts successful preloads', async () => {
  const calls = [];
  const result = await prewarmResolvedGarments(
    [{ id: 'a' }, { id: 'b' }, { id: 'a' }],
    (garment) => garment.id === 'b' ? 'https://cdn/b.png' : 'https://cdn/a.png',
    async (source) => { calls.push(source); return true; },
  );
  assert.deepEqual(calls.sort(), ['https://cdn/a.png', 'https://cdn/b.png']);
  assert.deepEqual(result, { requested: 2, warmed: 2 });
});

test('false and thrown preload results fail open with accurate counts', async () => {
  const result = await prewarmResolvedGarments(
    [{ id: 'false' }, { id: 'throw' }, { id: 'ok' }],
    (garment) => `https://cdn/${garment.id}.png`,
    async (source) => {
      if (source.includes('throw')) throw new Error('network');
      return source.includes('ok');
    },
  );
  assert.deepEqual(result, { requested: 3, warmed: 1 });
});

test('already cached preload success is reused without another loader call', async () => {
  const cache = new Map([['https://cdn/cached.png', true]]);
  let loads = 0;
  const result = await prewarmResolvedGarments(
    [{ id: 'cached' }, { id: 'cached' }],
    () => 'https://cdn/cached.png',
    async (source) => {
      if (cache.has(source)) return cache.get(source);
      loads += 1;
      return false;
    },
  );
  assert.equal(loads, 0);
  assert.deepEqual(result, { requested: 1, warmed: 1 });
});
