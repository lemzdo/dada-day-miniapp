'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { bootstrapRecommendationV2Collections, COLLECTIONS } = require('./recommendationV2CollectionBootstrap');

function databaseFixture() {
  const docs = new Map(COLLECTIONS.map((name) => [name, []]));
  let sequence = 0;
  const collection = (name) => ({
    where(query) {
      return {
        limit() { return this; },
        async get() { return { data: docs.get(name).filter((doc) => doc.__d1dBootstrapMarker === query.__d1dBootstrapMarker) }; },
      };
    },
    async add({ data }) { const doc = { ...data, _id: `probe-${++sequence}` }; docs.get(name).push(doc); return { _id: doc._id }; },
    doc(id) { return { async remove() { docs.set(name, docs.get(name).filter((doc) => doc._id !== id)); } }; },
  });
  return { database: { collection }, docs };
}

test('bootstrap creates only the two V2 collections and removes probes', async () => {
  const fixture = databaseFixture();
  const first = await bootstrapRecommendationV2Collections({ database: fixture.database, acceptanceRunId: 'ttui-v2-bootstrap-test' });
  assert.deepEqual(first.collections.map((item) => item.collection), [...COLLECTIONS]);
  assert.ok(first.collections.every((item) => item.created && item.probeRemoved && item.accessible));
  assert.deepEqual(fixture.docs.get(COLLECTIONS[0]), []);
  assert.deepEqual(fixture.docs.get(COLLECTIONS[1]), []);
});

test('bootstrap is repeatable without overwriting existing data', async () => {
  const fixture = databaseFixture();
  await bootstrapRecommendationV2Collections({ database: fixture.database, acceptanceRunId: 'ttui-v2-bootstrap-repeat' });
  fixture.docs.get(COLLECTIONS[0]).push({ _id: 'business-doc', batchId: 'keep-me' });
  const second = await bootstrapRecommendationV2Collections({ database: fixture.database, acceptanceRunId: 'ttui-v2-bootstrap-repeat' });
  assert.ok(second.collections.every((item) => item.created));
  assert.deepEqual(fixture.docs.get(COLLECTIONS[0]), [{ _id: 'business-doc', batchId: 'keep-me' }]);
});
