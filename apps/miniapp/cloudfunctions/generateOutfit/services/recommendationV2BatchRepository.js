'use strict';

const BATCH_COLLECTION = 'recommendation_batches_v2';
const REF_COLLECTION = 'recommendation_outfit_refs_v2';

function assertBatchInput(batch, refs) {
  if (!batch || batch.version !== 'recommendation-v2' || !batch.batchId || !batch.contentHash) throw new Error('V2_BATCH_CORE_INVALID');
  if (!Array.isArray(refs) || refs.length !== 8) throw new Error('V2_BATCH_REFS_REQUIRE_EIGHT');
  if (refs.some((ref, index) => ref.batchId !== batch.batchId || ref.position !== index || !ref.outfitKey || !ref.referenceId)) throw new Error('V2_BATCH_REFS_ORDER_INVALID');
}

async function readExistingBatch(database, openid, batchId) {
  const result = await database.collection(BATCH_COLLECTION).where({ _openid: openid, batchId }).limit(1).get();
  return result.data?.[0] || null;
}

async function readExistingRefs(database, openid, batchId) {
  const result = await database.collection(REF_COLLECTION).where({ _openid: openid, batchId }).get();
  return Array.isArray(result.data) ? result.data.sort((left, right) => left.position - right.position) : [];
}

async function persistRecommendationBatchV2({ database, openid, batch, refs, now = new Date().toISOString() }) {
  assertBatchInput(batch, refs);
  const existing = await readExistingBatch(database, openid, batch.batchId);
  if (existing) {
    if (existing.contentHash !== batch.contentHash) throw new Error('V2_BATCH_ID_HASH_CONFLICT');
    return { idempotent: true, batch: existing, refs: await readExistingRefs(database, openid, batch.batchId), writes: 0 };
  }
  const batchRecord = { ...batch, _openid: openid, createdAt: now, updatedAt: now };
  const refRecords = refs.map((ref) => ({ ...ref, _openid: openid, createdAt: now }));
  await database.runTransaction(async (transaction) => {
    const existingInTransaction = await readExistingBatch(transaction, openid, batch.batchId);
    if (existingInTransaction) {
      if (existingInTransaction.contentHash !== batch.contentHash) throw new Error('V2_BATCH_ID_HASH_CONFLICT');
      return;
    }
    await transaction.collection(BATCH_COLLECTION).add({ data: batchRecord });
    await transaction.collection(REF_COLLECTION).add({ data: refRecords });
  });
  return { idempotent: false, batch: batchRecord, refs: refRecords, writes: 9 };
}

module.exports = { BATCH_COLLECTION, REF_COLLECTION, assertBatchInput, readExistingBatch, readExistingRefs, persistRecommendationBatchV2 };
