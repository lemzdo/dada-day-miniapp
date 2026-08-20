'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { persistRecommendationBatchV2 } = require('./recommendationV2BatchRepository');

function fixture(mode) {
  const batchId = `batch-${mode}`;
  const batch = { version: 'recommendation-v2', batchId, commitToken: `commit-${mode}`, contentHash: `hash-${mode}`, scene: '居家', date: '2026-08-20', timeOfDay: 'all_day', weather: { temp: 28 }, inputIdentityHash: 'input', generatedAt: '2026-08-20T00:00:00.000Z', cardCount: 8, order: Array.from({ length: 8 }, (_, index) => `${mode}-key-${index}`), countContract: { expected: 8, actual: 8 } };
  const refs = batch.order.map((outfitKey, position) => ({ version: 'recommendation-v2', batchId, outfitKey, referenceId: `${mode}-ref-${position}`, position, clothingIds: [`clothing-${position}`] }));
  return { batch, refs };
}

function createDatabase() {
  const records = { recommendation_batches_v2: [], recommendation_outfit_refs_v2: [] };
  const operations = { transactions: 0, adds: 0, rollbacks: 0 };
  const database = {
    collection(name) {
      const rows = records[name];
      return {
        where(filters) { this.filters = filters; return this; },
        limit() { return this; },
        async get() { return { data: rows.filter((row) => Object.entries(this.filters || {}).every(([key, value]) => row[key] === value)) }; },
        async add({ data }) { operations.adds += 1; const entries = Array.isArray(data) ? data : [data]; rows.push(...entries.map((entry, index) => ({ ...entry, _id: entry._id || `${name}-${rows.length + index}` }))); return { _id: rows.at(-1)._id }; },
      };
    },
    async runTransaction(callback) { operations.transactions += 1; const snapshot = JSON.stringify(records); try { return await callback(database); } catch (error) { operations.rollbacks += 1; records.recommendation_batches_v2 = JSON.parse(snapshot).recommendation_batches_v2; records.recommendation_outfit_refs_v2 = JSON.parse(snapshot).recommendation_outfit_refs_v2; throw error; } },
  };
  return { database, records, operations };
}

for (const mode of ['all-existing', 'mixed', 'all-new']) {
  test(`V2 repository uses one atomic path for ${mode}`, async () => {
    const { database, records, operations } = createDatabase();
    const input = fixture(mode);
    const first = await persistRecommendationBatchV2({ database, openid: 'user-1', ...input });
    assert.equal(first.idempotent, false);
    assert.equal(records.recommendation_batches_v2.length, 1);
    assert.equal(records.recommendation_outfit_refs_v2.length, 8);
    assert.equal(operations.transactions, 1);
    const retry = await persistRecommendationBatchV2({ database, openid: 'user-1', ...input });
    assert.equal(retry.idempotent, true);
    assert.equal(operations.transactions, 1);
  });
}

test('V2 repository rejects same batch id with a different hash', async () => {
  const { database } = createDatabase();
  const input = fixture('conflict');
  await persistRecommendationBatchV2({ database, openid: 'user-1', ...input });
  await assert.rejects(() => persistRecommendationBatchV2({ database, openid: 'user-1', batch: { ...input.batch, contentHash: 'different' }, refs: input.refs }), /V2_BATCH_ID_HASH_CONFLICT/);
});
