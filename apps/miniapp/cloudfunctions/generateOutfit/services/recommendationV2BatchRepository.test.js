'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { persistRecommendationBatchV2, resolveV2BatchEnvelopeCard, stableReferenceId } = require('./recommendationV2BatchRepository');

function fixture(suffix = 'one') {
  const order = Array.from({ length: 8 }, (_, index) => `${suffix}-key-${index}`);
  const batch = { runtimeVersion: 'today-runtime-v2', schemaVersion: 'today-v2', batchId: `batch-${suffix}`, commitToken: `commit-${suffix}`, contentHash: `hash-${suffix}`, sceneKey: 'home', scene: '居家', targetDate: '2026-08-20', timeOfDay: 'all_day', weatherMode: 'live', weatherSnapshot: {}, weatherFingerprint: 'weather', inputIdentityHash: 'input', generatedAt: '2026-08-20T00:00:00.000Z', cardCount: 8, order, countContract: { requestedCardCount: 8, returnedCardCount: 8, limited: false, exhausted: false } };
  const envelope = { runtimeVersion: 'today-runtime-v2', schemaVersion: 'today-v2', core: batch, light: { runtimeVersion: 'today-runtime-v2', schemaVersion: 'today-v2', batchId: batch.batchId, cards: order.map((outfitKey, position) => ({ referenceId: stableReferenceId('user-1', outfitKey), outfitKey, position, displayTitle: '今日搭配', todayReason: '适合今天', styleTags: [], clothingIds: [`clothing-${position}`], items: [], isFavorite: false, isWornToday: false })) } };
  return { batch, envelope };
}

function createDatabase(options = {}) {
  const records = { recommendation_batches_v2: [] };
  const operations = { transactions: 0, reads: 0, writes: 0, rollbacks: 0 };
  let transactionTail = Promise.resolve();
  const database = { collection(name) { const rows = records[name]; return { where(filters) { this.filters = filters; return this; }, limit() { return this; }, async get() { operations.reads += 1; return { data: rows.filter((row) => Object.entries(this.filters).every(([key, value]) => row[key] === value)) }; }, async add({ data }) { if (options.failWrite) throw new Error('injected write failure'); operations.writes += 1; rows.push({ ...data, _id: `${name}-${rows.length}` }); return { _id: rows.at(-1)._id }; } }; }, async runTransaction(callback) { const execute = async () => { operations.transactions += 1; const snapshot = JSON.parse(JSON.stringify(records)); try { return await callback(database); } catch (error) { records.recommendation_batches_v2.splice(0, records.recommendation_batches_v2.length, ...snapshot.recommendation_batches_v2); operations.rollbacks += 1; throw error; } }; const result = transactionTail.then(execute, execute); transactionTail = result.then(() => undefined, () => undefined); return result; } };
  return { database, records, operations };
}

test('batch is the sole atomic source: new write is one read and one write', async () => {
  const input = fixture(); const { database, records, operations } = createDatabase();
  const result = await persistRecommendationBatchV2({ database, openid: 'user-1', ...input });
  assert.equal(result.idempotent, false); assert.equal(result.writes, 1); assert.equal(records.recommendation_batches_v2.length, 1);
  assert.equal(operations.reads, 1); assert.equal(operations.writes, 1); assert.equal(result.timing.readCount, 1); assert.equal(result.timing.writeCount, 1); assert.equal(result.timing.sequential, false); assert.equal(result.timing.refsReadMs, 0); assert.equal(result.timing.refsWriteMs, 0);
});

test('same content repeats idempotently with one read and no write', async () => {
  const input = fixture(); const { database, operations } = createDatabase();
  await persistRecommendationBatchV2({ database, openid: 'user-1', ...input }); const before = { ...operations };
  const result = await persistRecommendationBatchV2({ database, openid: 'user-1', ...input });
  assert.equal(result.idempotent, true); assert.equal(result.writes, 0); assert.equal(operations.reads - before.reads, 1); assert.equal(operations.writes - before.writes, 0);
});

test('same batch id with a different hash fails closed and rolls back', async () => {
  const input = fixture(); const { database, records, operations } = createDatabase();
  await persistRecommendationBatchV2({ database, openid: 'user-1', ...input });
  await assert.rejects(() => persistRecommendationBatchV2({ database, openid: 'user-1', batch: { ...input.batch, contentHash: 'different' }, envelope: { ...input.envelope, core: { ...input.batch, contentHash: 'different' } } }), /V2_BATCH_COMMIT_VALIDATION_FAILED/);
  assert.equal(records.recommendation_batches_v2.length, 1); assert.equal(operations.rollbacks, 1);
});

test('transaction failure leaves no batch document', async () => {
  const input = fixture(); const { database, records, operations } = createDatabase({ failWrite: true });
  await assert.rejects(() => persistRecommendationBatchV2({ database, openid: 'user-1', ...input }), /injected write failure/);
  assert.equal(records.recommendation_batches_v2.length, 0); assert.equal(operations.reads, 1); assert.equal(operations.writes, 0); assert.equal(operations.rollbacks, 1);
});

test('envelope enforces all eight ordered stable identities and lazy clothing ids', async () => {
  const input = fixture(); const invalid = structuredClone(input); invalid.envelope.light.cards[3].referenceId = 'wrong'; const { database } = createDatabase();
  await assert.rejects(() => persistRecommendationBatchV2({ database, openid: 'user-1', ...invalid }), /V2_BATCH_ENVELOPE_ORDER_INVALID/);
  const missingIds = structuredClone(input); missingIds.envelope.light.cards[0].clothingIds = []; await assert.rejects(() => persistRecommendationBatchV2({ database, openid: 'user-1', ...missingIds }), /V2_BATCH_ENVELOPE_ORDER_INVALID/);
});

test('concurrent same-content calls serialize to one write and one idempotent result', async () => {
  const input = fixture('concurrent'); const { database, records, operations } = createDatabase();
  const results = await Promise.all([
    persistRecommendationBatchV2({ database, openid: 'user-1', ...input }),
    persistRecommendationBatchV2({ database, openid: 'user-1', ...input }),
  ]);
  assert.equal(records.recommendation_batches_v2.length, 1); assert.equal(operations.writes, 1);
  assert.deepEqual(results.map((result) => result.idempotent).sort(), [false, true]);
  assert.deepEqual(results.map((result) => result.timing.writeCount).sort(), [0, 1]);
});

test('forbidden deep snapshot fields are rejected before persistence', async () => {
  const input = fixture('forbidden'); input.envelope.light.cards[0].items[0] = { snapshotItems: [{ clothingId: 'hidden' }] };
  const { database, records } = createDatabase();
  await assert.rejects(() => persistRecommendationBatchV2({ database, openid: 'user-1', ...input }), /V2_BATCH_ENVELOPE_FORBIDDEN_FIELD/);
  assert.equal(records.recommendation_batches_v2.length, 0);
});

test('batch envelope resolver is the detail/action descriptor dependency', async () => {
  const input = fixture('resolve'); const { database } = createDatabase();
  await persistRecommendationBatchV2({ database, openid: 'user-1', ...input });
  const stored = (await database.collection('recommendation_batches_v2').where({ _openid: 'user-1', batchId: input.batch.batchId }).get()).data[0];
  const card = input.envelope.light.cards[4];
  assert.deepEqual(resolveV2BatchEnvelopeCard(stored, 'user-1', input.batch.batchId, card.outfitKey, card.referenceId).clothingIds, card.clothingIds);
  assert.equal(resolveV2BatchEnvelopeCard(stored, 'user-1', input.batch.batchId, card.outfitKey, 'wrong'), null);
  assert.equal(resolveV2BatchEnvelopeCard(stored, 'user-1', input.batch.batchId, 'wrong-key', card.referenceId), null);
});
