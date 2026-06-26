const crypto = require('crypto');

const EVENT_COLLECTION = 'outfit_behavior_events';
const MAX_EVENTS_PER_REQUEST = 20;
const MAX_EVENT_ID_LENGTH = 128;
const MAX_ID_LENGTH = 160;
const MAX_BUCKET_LENGTH = 64;
const MAX_CLOTHING_IDS = 8;
const MAX_BATCH_OUTFIT_KEYS = 8;
const MAX_EVIDENCE_CODES = 12;

const EVENT_TYPES = new Set([
  'recommendation_exposure',
  'outfit_detail_view',
  'outfit_favorite',
  'outfit_unfavorite',
  'outfit_wear',
  'recommendation_batch_refresh',
]);
const ACTION_EVENT_TYPES = new Set(['outfit_favorite', 'outfit_unfavorite', 'outfit_wear']);
const SCENES = new Set(['home', 'work', 'date', 'sport']);
const SOURCES = new Set(['today', 'detail', 'favorites', 'history', 'other']);

function buildDocumentId(openid, eventId) {
  return `obv1_${sha256(`${String(openid)}|${String(eventId)}`)}`;
}

function normalizeEventBatch({ openid, events, now = new Date().toISOString() }) {
  const normalizedOpenid = sanitizeString(openid, 128);
  if (!normalizedOpenid) throw new Error('openid is required');
  if (!Array.isArray(events)) throw new Error('events must be an array');
  if (events.length > MAX_EVENTS_PER_REQUEST) throw new Error(`events supports at most ${MAX_EVENTS_PER_REQUEST} items`);

  const accepted = [];
  const rejected = [];

  events.forEach((rawEvent, index) => {
    const normalized = normalizeEvent(rawEvent, { openid: normalizedOpenid, now });
    if (normalized.ok) {
      accepted.push({ index, ...normalized.value });
    } else {
      rejected.push({
        index,
        eventId: sanitizeString(rawEvent && rawEvent.eventId, MAX_EVENT_ID_LENGTH),
        eventType: EVENT_TYPES.has(rawEvent && rawEvent.eventType) ? rawEvent.eventType : undefined,
        reason: normalized.reason,
      });
    }
  });

  return { accepted, rejected };
}

async function persistEventBatch({ db, openid, events, now = new Date().toISOString() }) {
  const normalized = normalizeEventBatch({ openid, events, now });
  const results = normalized.rejected.map((item) => ({
    index: item.index,
    eventId: item.eventId,
    eventType: item.eventType,
    status: 'rejected',
    reason: item.reason,
  }));
  let accepted = 0;
  let duplicate = 0;
  let failed = 0;
  const collection = db.collection(EVENT_COLLECTION);

  for (const item of normalized.accepted) {
    try {
      await writeDocument(collection, item.documentId, item.document);
      accepted += 1;
      results.push(toResult(item, 'accepted'));
    } catch (error) {
      if (isDuplicateError(error)) {
        duplicate += 1;
        results.push(toResult(item, 'duplicate'));
      } else {
        failed += 1;
        results.push(toResult(item, 'failed', 'database_write_failed'));
      }
    }
  }

  results.sort((a, b) => a.index - b.index);
  return {
    accepted,
    duplicate,
    rejected: normalized.rejected.length,
    failed,
    results,
  };
}

function normalizeEvent(rawEvent, { openid, now }) {
  if (!rawEvent || typeof rawEvent !== 'object' || Array.isArray(rawEvent)) {
    return reject('event must be an object');
  }

  const eventId = sanitizeString(rawEvent.eventId, MAX_EVENT_ID_LENGTH);
  const eventType = sanitizeString(rawEvent.eventType, 64);
  if (!eventId) return reject('eventId is required');
  if (!EVENT_TYPES.has(eventType)) return reject('eventType is invalid');

  const document = {
    schemaVersion: 1,
    eventType,
    eventId,
    occurredAt: now,
    _openid: openid,
    createdAt: now,
  };
  assignString(document, 'clientOccurredAt', rawEvent.clientOccurredAt, 40);
  assignString(document, 'outfitId', rawEvent.outfitId, MAX_ID_LENGTH);
  assignString(document, 'outfitKey', rawEvent.outfitKey, MAX_ID_LENGTH);
  assignString(document, 'recommendationBatchId', rawEvent.recommendationBatchId, MAX_ID_LENGTH);

  const clothingIds = normalizeStringArray(rawEvent.clothingIds, MAX_CLOTHING_IDS, MAX_ID_LENGTH);
  if (clothingIds.length) document.clothingIds = clothingIds;
  const batchOutfitKeys = normalizeStringArray(rawEvent.batchOutfitKeys, MAX_BATCH_OUTFIT_KEYS, MAX_ID_LENGTH);
  if (batchOutfitKeys.length) document.batchOutfitKeys = batchOutfitKeys;
  const scoresSnapshot = normalizeScoresSnapshot(rawEvent.scoresSnapshot);
  if (Object.keys(scoresSnapshot).length) document.scoresSnapshot = scoresSnapshot;
  const aestheticSnapshot = normalizeAestheticSnapshot(rawEvent.aestheticSnapshot);
  if (Object.keys(aestheticSnapshot).length) document.aestheticSnapshot = aestheticSnapshot;
  const context = normalizeContext(rawEvent.context);
  if (Object.keys(context).length) document.context = context;

  const validityError = getMinimumValidityError(document);
  if (validityError) return reject(validityError);

  const documentId = buildDocumentId(openid, eventId);
  return {
    ok: true,
    value: {
      eventId,
      eventType,
      documentId,
      document,
    },
  };
}

function getMinimumValidityError(document) {
  if (document.eventType === 'recommendation_exposure') {
    if (!hasOutfitIdentity(document)) return 'recommendation_exposure requires outfitKey or outfitId';
    if (document.context?.source !== 'today') return 'recommendation_exposure requires context.source=today';
    if (!hasFiniteNumber(document.context?.position)) return 'recommendation_exposure requires position';
    if (!hasFiniteNumber(document.context?.candidateCount)) return 'recommendation_exposure requires candidateCount';
    return '';
  }
  if (document.eventType === 'outfit_detail_view') {
    if (!hasOutfitIdentity(document)) return 'outfit_detail_view requires outfitKey or outfitId';
    if (!document.context?.source) return 'outfit_detail_view requires context.source';
    return '';
  }
  if (ACTION_EVENT_TYPES.has(document.eventType)) {
    return hasOutfitIdentity(document) ? '' : `${document.eventType} requires outfitKey or outfitId`;
  }
  if (document.eventType === 'recommendation_batch_refresh') {
    if (!document.recommendationBatchId) return 'recommendation_batch_refresh requires recommendationBatchId';
    if (!document.batchOutfitKeys?.length && !hasFiniteNumber(document.context?.candidateCount)) {
      return 'recommendation_batch_refresh requires batchOutfitKeys or candidateCount';
    }
    if (document.context?.trigger !== 'manual') return 'recommendation_batch_refresh requires context.trigger=manual';
  }
  return '';
}

function hasOutfitIdentity(document) {
  return Boolean(document.outfitKey || document.outfitId);
}

function normalizeScoresSnapshot(value) {
  const source = isPlainObject(value) ? value : {};
  const result = {};
  for (const key of ['total', 'weatherAdaptation', 'styleUnity', 'freshness', 'preference']) {
    const numberValue = normalizeFiniteNumber(source[key], 0, 100);
    if (numberValue !== undefined) result[key] = numberValue;
  }
  return result;
}

function normalizeAestheticSnapshot(value) {
  const source = isPlainObject(value) ? value : {};
  const result = {};
  if (source.engineVersion === 'aesthetic-compat-v1') result.engineVersion = 'aesthetic-compat-v1';
  if (source.score === null) {
    result.score = null;
  } else {
    const score = normalizeFiniteNumber(source.score, 0, 100);
    if (score !== undefined) result.score = score;
  }
  const coverage = normalizeFiniteNumber(source.coverage, 0, 1);
  if (coverage !== undefined) result.coverage = coverage;
  const evidenceCodes = normalizeStringArray(source.evidenceCodes, MAX_EVIDENCE_CODES, 64);
  if (evidenceCodes.length) result.evidenceCodes = evidenceCodes;
  return result;
}

function normalizeContext(value) {
  const source = isPlainObject(value) ? value : {};
  const result = {};
  if (SCENES.has(source.scene)) result.scene = source.scene;
  assignString(result, 'temperatureBand', source.temperatureBand, MAX_BUCKET_LENGTH);
  assignString(result, 'conditionBucket', source.conditionBucket, MAX_BUCKET_LENGTH);
  if (SOURCES.has(source.source)) result.source = source.source;
  const position = normalizeFiniteInteger(source.position, 0, Number.MAX_SAFE_INTEGER);
  if (position !== undefined) result.position = position;
  const candidateCount = normalizeFiniteInteger(source.candidateCount, 1, 8);
  if (candidateCount !== undefined) result.candidateCount = candidateCount;
  if (source.trigger === 'manual') result.trigger = 'manual';
  return result;
}

async function writeDocument(collection, documentId, document) {
  const data = { _id: documentId, ...document };
  if (typeof collection.add === 'function') {
    return collection.add({ data });
  }
  return collection.doc(documentId).set({ data });
}

function toResult(item, status, reason) {
  return {
    index: item.index,
    eventId: item.eventId,
    eventType: item.eventType,
    status,
    ...(reason ? { reason } : {}),
  };
}

function isDuplicateError(error) {
  const code = String(error?.errCode ?? error?.code ?? '');
  const message = String(error?.message ?? error?.errMsg ?? '').toLowerCase();
  return code === '-502001'
    || code === '11000'
    || message.includes('duplicate')
    || message.includes('already exists')
    || message.includes('document already exists');
}

function assignString(target, key, value, maxLength) {
  const normalized = sanitizeString(value, maxLength);
  if (normalized) target[key] = normalized;
}

function sanitizeString(value, maxLength) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.slice(0, maxLength);
}

function normalizeStringArray(value, maxItems, maxLength) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => sanitizeString(item, maxLength)).filter(Boolean))]
    .sort()
    .slice(0, maxItems);
}

function normalizeFiniteNumber(value, min, max) {
  if (!hasFiniteNumber(value)) return undefined;
  if (value < min || value > max) return undefined;
  return value;
}

function normalizeFiniteInteger(value, min, max) {
  if (!Number.isInteger(value)) return undefined;
  if (value < min || value > max) return undefined;
  return value;
}

function hasFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function reject(reason) {
  return { ok: false, reason };
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

module.exports = {
  EVENT_COLLECTION,
  MAX_EVENTS_PER_REQUEST,
  buildDocumentId,
  normalizeEventBatch,
  persistEventBatch,
};
