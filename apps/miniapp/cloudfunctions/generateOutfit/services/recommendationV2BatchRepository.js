'use strict';

const crypto = require('node:crypto');

const BATCH_COLLECTION = 'recommendation_batches_v2';
const REF_COLLECTION = 'recommendation_outfit_refs_v2';
const V2_ENVELOPE_FORBIDDEN_KEYS = new Set([
  'snapshotItems', 'itemsSnapshot', 'scores', 'eligibility', 'copyContract',
  'evidence', 'debug', 'fullFacts', 'narrative', 'aiComment', 'historyId',
]);

function stableReferenceId(openid, outfitKey) {
  return `ref-${crypto.createHash('sha256').update(`${openid}|${outfitKey}`).digest('hex').slice(0, 32)}`;
}

function assertBatchInput(batch, refs) {
  if (!batch || batch.runtimeVersion !== 'today-runtime-v2' || batch.schemaVersion !== 'today-v2' || !batch.batchId || !batch.commitToken || !batch.contentHash || !batch.inputIdentityHash || !batch.generatedAt) throw new Error('V2_BATCH_CORE_INVALID');
  if (batch.cardCount !== 8 || batch.countContract?.requestedCardCount !== 8 || batch.countContract?.returnedCardCount !== 8 || typeof batch.countContract.limited !== 'boolean' || typeof batch.countContract.exhausted !== 'boolean') throw new Error('V2_BATCH_CORE_COUNT_INVALID');
  if (!Array.isArray(refs) || refs.length !== 8) throw new Error('V2_BATCH_REFS_REQUIRE_EIGHT');
  const order = Array.isArray(batch.order) ? batch.order : [];
  const keys = refs.map((ref) => ref.outfitKey);
  if (order.length !== 8 || new Set(order).size !== 8 || keys.some((key, index) => refInvalid(refs[index], key) || key !== order[index])) throw new Error('V2_BATCH_REFS_ORDER_INVALID');
}

function refInvalid(ref, key) {
  return !ref || ref.runtimeVersion !== 'today-runtime-v2' || ref.schemaVersion !== 'today-v2' || !key || !ref.referenceId;
}

function assertV2Envelope(envelope, batch, refs) {
  if (!envelope || envelope.runtimeVersion !== 'today-runtime-v2' || envelope.schemaVersion !== 'today-v2') {
    throw new Error('V2_BATCH_ENVELOPE_INVALID');
  }
  if (!envelope.core || envelope.core.batchId !== batch.batchId || envelope.core.contentHash !== batch.contentHash
    || envelope.core.commitToken !== batch.commitToken || !envelope.light
    || !Array.isArray(envelope.light.cards) || envelope.light.cards.length !== 8) {
    throw new Error('V2_BATCH_ENVELOPE_CORE_MISMATCH');
  }
  const walk = (value) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (V2_ENVELOPE_FORBIDDEN_KEYS.has(key)) throw new Error('V2_BATCH_ENVELOPE_FORBIDDEN_FIELD');
      walk(child);
    }
  };
  walk(envelope);
  const owner = refs[0]?._openid;
  envelope.light.cards.forEach((card, index) => {
    if (!owner || card.position !== index || card.outfitKey !== batch.order[index]
      || card.referenceId !== stableReferenceId(owner, card.outfitKey)) {
      throw new Error('V2_BATCH_ENVELOPE_ORDER_INVALID');
    }
  });
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
  const result = await database.collection(REF_COLLECTION).where({ _openid: openid, latestBatchId: batchId }).get();
  return Array.isArray(result.data) ? result.data : [];
}

async function findRefsForOrder(database, openid, order) {
  const refs = [];
  for (const outfitKey of order) {
    const ref = await findRef(database, openid, outfitKey);
    if (!ref || ref._openid !== openid || ref.referenceId !== stableReferenceId(openid, outfitKey)) throw new Error('V2_BATCH_REFS_INCOMPLETE');
    refs.push(ref);
  }
  return refs;
}

function assertStoredBatchComplete(batch, refs, requested) {
  if (!batch || batch.contentHash !== requested.contentHash || batch.commitToken !== requested.commitToken) throw new Error('V2_BATCH_COMMIT_VALIDATION_FAILED');
  if (refs.length !== 8 || refs.some((ref, index) => ref._openid !== requested._openid || ref.outfitKey !== requested.order[index] || ref.referenceId !== stableReferenceId(requested._openid, ref.outfitKey))) throw new Error('V2_BATCH_REFS_INCOMPLETE');
}

async function persistRecommendationBatchV2({ database, openid, batch, refs, envelope, now = new Date().toISOString() }) {
  if (!openid) throw new Error('V2_BATCH_OPENID_REQUIRED');
  if (!envelope) throw new Error('V2_BATCH_ENVELOPE_REQUIRED');
  assertBatchInput(batch, refs);
  assertV2Envelope(envelope, batch, refs.map((ref) => ({ ...ref, _openid: openid })));
  let result;
  await database.runTransaction(async (transaction) => {
    const existingBatch = await findBatch(transaction, openid, batch.batchId);
    const existingBatchRefs = existingBatch ? await findRefsForOrder(transaction, openid, batch.order) : [];
    if (existingBatch) {
      assertStoredBatchComplete(existingBatch, existingBatchRefs, { ...batch, _openid: openid });
      if (envelope) assertV2Envelope(existingBatch.envelope, batch, existingBatchRefs);
      result = { idempotent: true, batch: existingBatch, refs: existingBatchRefs, writes: 0 };
      return;
    }
    const batchRecord = { ...batch, ...(envelope ? { envelope } : {}), _openid: openid, createdAt: now, updatedAt: now };
    await transaction.collection(BATCH_COLLECTION).add({ data: batchRecord });
    const storedRefs = [];
    for (const ref of refs) {
      const existingRef = await findRef(transaction, openid, ref.outfitKey);
      const nextRef = { ...ref, latestBatchId: batch.batchId, latestPosition: ref.position, referenceId: existingRef?.referenceId || stableReferenceId(openid, ref.outfitKey), _openid: openid, updatedAt: now };
      delete nextRef.position;
      delete nextRef.batchId;
      if (existingRef) await transaction.collection(REF_COLLECTION).doc(existingRef._id).update({ data: nextRef });
      else await transaction.collection(REF_COLLECTION).add({ data: { ...nextRef, createdAt: now } });
      storedRefs.push(nextRef);
    }
    result = { idempotent: false, batch: batchRecord, refs: storedRefs, writes: 9 };
  });
  if (!result) throw new Error('V2_BATCH_COMMIT_RESULT_MISSING');
  assertStoredBatchComplete(result.batch, result.refs, { ...batch, _openid: openid });
  return result;
}

module.exports = { BATCH_COLLECTION, REF_COLLECTION, stableReferenceId, assertBatchInput, assertV2Envelope, findBatch, findRef, findBatchRefs, persistRecommendationBatchV2 };
