'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { COLLECTIONS, ensureCollections } = require('./bootstrap-recommendation-v2-collections');

function fixture(initial = []) {
  const names = new Set(initial);
  const calls = [];
  return {
    calls,
    manager: {
      async listCollections() { return [...names].map((name) => ({ collectionName: name })); },
      async createCollection(name) { calls.push(name); names.add(name); },
    },
  };
}

test('missing collections are created through manager API, without document probes', async () => {
  const f = fixture();
  const result = await ensureCollections({ manager: f.manager });
  assert.deepEqual(f.calls, [...COLLECTIONS]);
  assert.deepEqual(result.created, [...COLLECTIONS]);
  assert.match(result.indexes, /none-added/);
});

test('existing collections are no-op and no overwrite occurs', async () => {
  const f = fixture([...COLLECTIONS]);
  const result = await ensureCollections({ manager: f.manager });
  assert.deepEqual(f.calls, []);
  assert.deepEqual(result.existing, [...COLLECTIONS]);
});

test('NOT_FOUND-style create race fails closed unless fresh list confirms existence', async () => {
  const names = new Set();
  const manager = {
    async listCollections() { return [...names]; },
    async createCollection(name) { if (name === COLLECTIONS[0]) throw new Error('NOT_FOUND'); },
  };
  await assert.rejects(() => ensureCollections({ manager }), /NOT_FOUND/);
});
