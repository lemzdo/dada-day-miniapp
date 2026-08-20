'use strict';

const crypto = require('node:crypto');

const BATCH_COLLECTION = 'recommendation_batches_v2';
const REF_COLLECTION = 'recommendation_outfit_refs_v2';

function stableReferenceId(openid, outfitKey) {
  return `ref-${crypto.createHash('sha256').update(`${openid}|${outfitKey}`).digest('hex').slice(0, 32)}`;
}

function assertBatchInput(batch, refs) {
  if (!batch || batch.runtimeVersion !== 'today-runtime-v2' || batch.schemaVersion !== 'today-v2' || !batch.batchId || !batch.commitToken || !batch.contentHash || !batch.inputIdentityHash || !batch.generatedAt) throw new Error('V2_BATCH_CORE_INVALID');
  if (batch.cardCount !== 8 || batch.countContract?.expected !== 8 || batch.countContract?.actual !== 8) throw new Error('V2_BATCH_CORE_COUNT_INVALID');
  if (!Array.isArray(refs) || refs.length !== 8) throw new Error('V2_BATCH_REFS_REQUIRE_EIGHT');
  const order = Array.isArray(batch.order) ? batch.order : [];
  const keys = refs.map((ref) => ref.outfitKey);
  if (order.length !== 8 || new Set(order).size !== 8 || keys.some((key, index) => refInvalid(refs[index], batch, key, index) || key !== order[index])) throw new Error('V2_BATCH_REFS_ORDER_INVALID');
}

function refInvalid(ref, batch, key, index) {
  return !ref || ref.runtimeVersion !== 'today-runtime-v2' || ref.schemaVersion !== 'today-v2' || ref.batchId !== batch.batchId || ref.position !== index || !key || !ref.referenceId;
}

async function findBatch(database, openid, batchId) {
  const result = await database.collection(BATCH_COLLECTION).where({ _openid: openid, batchId }).limit(1).get();
  return result.data?.[0] || null;
}

async function findRef(database, openid, outfitKey) {
  const result = await database.collection(REF_COLLECTION).where({ _openid: openid, outfitKey }).limit(1).get();
  return result.data?.[0] || null;
}

async function findBatchRefs(database, openid, batchId) {
  const result = await database.collection(REF_COLLECTION).where({ _openid: openid, batchId }).get();
  return Array.isArray(result.data) ? result.data.sort((left, right) => left.position - right.position) : [];
}

function assertStoredBatchComplete(batch, refs, requested) {
  if (!batch || batch.contentHash !== requested.contentHash || batch.commitToken !== requested.commitToken) throw new Error('V2_BATCH_COMMIT_VALIDATION_FAILED');
  if (refs.length !== 8 || refs.some((ref, index) => ref.batchId !== requested.batchId || ref.position !== index || ref.outfitKey !== requested.order[index])) throw new Error('V2_BATCH_REFS_INCOMPLETE');
}

async function persistRecommendationBatchV2({ database, openid, batch, refs, now = new Date().toISOString() }) {
  if (!openid) throw new Error('V2_BATCH_OPENID_REQUIRED');
  assertBatchInput(batch, refs);
  let result;
  await database.runTransaction(async (transaction) => {
    const existingBatch = await findBatch(transaction, openid, batch.batchId);
    const existingBatchRefs = await findBatchRefs(transaction, openid, batch.batchId);
    if (existingBatch) {
      assertStoredBatchComplete(existingBatch, existingBatchRefs, batch);
      result = { idempotent: true, batch: existingBatch, refs: existingBatchRefs, writes: 0 };
      return;
    }
    if (existingBatchRefs.length > 0) throw new Error('V2_BATCH_PARTIAL_EXISTING');
    const batchRecord = { ...batch, _openid: openid, createdAt: now, updatedAt: now };
    await transaction.collection(BATCH_COLLECTION).add({ data: batchRecord });
    const storedRefs = [];
    for (const ref of refs) {
      const existingRef = await findRef(transaction, openid, ref.outfitKey);
      const nextRef = { ...ref, referenceId: existingRef?.referenceId || stableReferenceId(openid, ref.outfitKey), _openid: openid, updatedAt: now };
      if (existingRef) await transaction.collection(REF_COLLECTION).doc(existingRef._id).update({ data: nextRef });
      else await transaction.collection(REF_COLLECTION).add({ data: { ...nextRef, createdAt: now } });
      storedRefs.push(nextRef);
    }
    result = { idempotent: false, batch: batchRecord, refs: storedRefs, writes: 9 };
  });
  if (!result) throw new Error('V2_BATCH_COMMIT_RESULT_MISSING');
  assertStoredBatchComplete(result.batch, result.refs, batch);
  return result;
}

module.exports = { BATCH_COLLECTION, REF_COLLECTION, stableReferenceId, assertBatchInput, findBatch, findRef, findBatchRefs, persistRecommendationBatchV2 };
