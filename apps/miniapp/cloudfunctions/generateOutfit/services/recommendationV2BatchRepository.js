'use strict';

const crypto = require('node:crypto');

const BATCH_COLLECTION = 'recommendation_batches_v2';
const V2_ENVELOPE_FORBIDDEN_KEYS = new Set([
  'snapshotItems', 'itemsSnapshot', 'scores', 'eligibility', 'copyContract',
  'evidence', 'debug', 'fullFacts', 'narrative', 'aiComment', 'historyId',
]);

function stableReferenceId(openid, outfitKey) {
  return `ref-${crypto.createHash('sha256').update(`${openid}|${outfitKey}`).digest('hex').slice(0, 32)}`;
}

function assertBatchInput(batch) {
  if (!batch || batch.runtimeVersion !== 'today-runtime-v2' || batch.schemaVersion !== 'today-v2' || !batch.batchId || !batch.commitToken || !batch.contentHash || !batch.inputIdentityHash || !batch.generatedAt) throw new Error('V2_BATCH_CORE_INVALID');
  if (batch.cardCount !== 8 || batch.countContract?.requestedCardCount !== 8 || batch.countContract?.returnedCardCount !== 8 || typeof batch.countContract.limited !== 'boolean' || typeof batch.countContract.exhausted !== 'boolean') throw new Error('V2_BATCH_CORE_COUNT_INVALID');
  const order = Array.isArray(batch.order) ? batch.order : [];
  if (order.length !== 8 || new Set(order).size !== 8 || order.some((key) => typeof key !== 'string' || !key)) throw new Error('V2_BATCH_ORDER_INVALID');
}

function assertV2Envelope(envelope, batch, openid) {
  if (!envelope || envelope.runtimeVersion !== 'today-runtime-v2' || envelope.schemaVersion !== 'today-v2') throw new Error('V2_BATCH_ENVELOPE_INVALID');
  if (!envelope.core || envelope.core.batchId !== batch.batchId || envelope.core.contentHash !== batch.contentHash
    || envelope.core.commitToken !== batch.commitToken || !envelope.light
    || !Array.isArray(envelope.light.cards) || envelope.light.cards.length !== 8) throw new Error('V2_BATCH_ENVELOPE_CORE_MISMATCH');
  const walk = (value) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (V2_ENVELOPE_FORBIDDEN_KEYS.has(key)) throw new Error('V2_BATCH_ENVELOPE_FORBIDDEN_FIELD');
      walk(child);
    }
  };
  walk(envelope);
  envelope.light.cards.forEach((card, index) => {
    const outfitKey = batch.order[index];
    if (!card || card.position !== index || card.outfitKey !== outfitKey
      || card.referenceId !== stableReferenceId(openid, outfitKey)
      || !Array.isArray(card.clothingIds) || card.clothingIds.length === 0
      || card.clothingIds.some((id) => typeof id !== 'string' || !id)) throw new Error('V2_BATCH_ENVELOPE_ORDER_INVALID');
  });
}

async function findBatch(database, openid, batchId) {
  const result = await database.collection(BATCH_COLLECTION).where({ _openid: openid, batchId }).limit(1).get();
  return result.data?.[0] || null;
}

function resolveV2BatchEnvelopeCard(storedBatch, openid, batchId, outfitKey, referenceId) {
  const envelope = storedBatch?.envelope;
  const position = Array.isArray(storedBatch?.order) ? storedBatch.order.indexOf(outfitKey) : -1;
  const card = envelope?.light?.cards?.[position];
  if (!storedBatch || storedBatch._openid !== openid || storedBatch.batchId !== batchId
    || !envelope || storedBatch.contentHash !== envelope.core?.contentHash
    || storedBatch.commitToken !== envelope.core?.commitToken || position < 0
    || card?.outfitKey !== outfitKey || card?.position !== position
    || card?.referenceId !== referenceId || card.referenceId !== stableReferenceId(openid, outfitKey)
    || !Array.isArray(card.clothingIds) || card.clothingIds.length === 0) return null;
  return card;
}

function assertStoredBatchComplete(storedBatch, requested, openid) {
  if (!storedBatch || storedBatch._openid !== openid || storedBatch.contentHash !== requested.contentHash || storedBatch.commitToken !== requested.commitToken) throw new Error('V2_BATCH_COMMIT_VALIDATION_FAILED');
  assertV2Envelope(storedBatch.envelope, requested, openid);
}

function createBatchPersistenceTiming(timing = {}) {
  const target = timing && typeof timing === 'object' ? timing : {};
  for (const key of ['transactionBeginMs', 'preconditionReadMs', 'refsReadMs', 'batchWriteMs', 'refsWriteMs', 'commitMs', 'otherMs']) {
    if (!Number.isFinite(target[key]) || target[key] < 0) target[key] = 0;
  }
  if (!Number.isInteger(target.transactionAttempts) || target.transactionAttempts < 0) target.transactionAttempts = 0;
  target.sequential = false;
  target.readCount = 0;
  target.writeCount = 0;
  target.refsReadMs = 0;
  target.refsWriteMs = 0;
  return target;
}

async function persistRecommendationBatchV2({ database, openid, batch, envelope, now = new Date().toISOString(), timing } = {}) {
  if (!openid) throw new Error('V2_BATCH_OPENID_REQUIRED');
  if (!envelope) throw new Error('V2_BATCH_ENVELOPE_REQUIRED');
  assertBatchInput(batch);
  assertV2Envelope(envelope, batch, openid);
  const persistenceTiming = createBatchPersistenceTiming(timing);
  const persistenceStartedAt = Date.now();
  let result;
  let callbackCompletedAt = persistenceStartedAt;
  let attemptBoundaryAt = persistenceStartedAt;
  await database.runTransaction(async (transaction) => {
    const attemptStartedAt = Date.now();
    persistenceTiming.transactionAttempts += 1;
    persistenceTiming.transactionBeginMs += Math.max(0, attemptStartedAt - attemptBoundaryAt);
    try {
      const readsStartedAt = Date.now();
      const existingBatch = await findBatch(transaction, openid, batch.batchId);
      persistenceTiming.readCount += 1;
      persistenceTiming.preconditionReadMs += Math.max(0, Date.now() - readsStartedAt);
      if (existingBatch) {
        assertStoredBatchComplete(existingBatch, batch, openid);
        result = { idempotent: true, batch: existingBatch, writes: 0 };
        return;
      }
      const batchRecord = { ...batch, envelope, _openid: openid, createdAt: now, updatedAt: now };
      const batchWriteStartedAt = Date.now();
      await transaction.collection(BATCH_COLLECTION).add({ data: batchRecord });
      persistenceTiming.batchWriteMs += Math.max(0, Date.now() - batchWriteStartedAt);
      persistenceTiming.writeCount += 1;
      result = { idempotent: false, batch: batchRecord, writes: 1 };
    } finally {
      const attemptFinishedAt = Date.now();
      attemptBoundaryAt = attemptFinishedAt;
      if (result) callbackCompletedAt = attemptFinishedAt;
    }
  });
  persistenceTiming.commitMs = Math.max(0, Date.now() - callbackCompletedAt);
  persistenceTiming.totalMs = Math.max(0, Date.now() - persistenceStartedAt);
  persistenceTiming.otherMs = Math.max(0, persistenceTiming.totalMs
    - persistenceTiming.transactionBeginMs - persistenceTiming.preconditionReadMs
    - persistenceTiming.batchWriteMs - persistenceTiming.commitMs);
  if (!result) throw new Error('V2_BATCH_COMMIT_RESULT_MISSING');
  assertStoredBatchComplete(result.batch, batch, openid);
  return { ...result, timing: persistenceTiming };
}

module.exports = { BATCH_COLLECTION, stableReferenceId, assertBatchInput, assertV2Envelope, findBatch, resolveV2BatchEnvelopeCard, persistRecommendationBatchV2, createBatchPersistenceTiming };
