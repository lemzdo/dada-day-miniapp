const MAX_OUTFIT_BEHAVIOR_QUEUE_SIZE = 50;
const OUTFIT_BEHAVIOR_BATCH_SIZE = 20;
const MAX_ARRAY_ITEMS = 8;
const MAX_EVIDENCE_CODES = 12;
const EVENT_SOURCE_VALUES = new Set(['today', 'detail', 'favorites', 'history', 'other']);
const EVENT_SCENE_VALUES = new Set(['home', 'work', 'date', 'sport']);

let globalSequence = 0;

function buildOutfitBehaviorSnapshot(outfit) {
  const source = isObject(outfit) ? outfit : {};
  const clothingIds = normalizeStringArray([
    ...(Array.isArray(source.clothingIds) ? source.clothingIds : []),
    ...readItemClothingIds(source.items),
    ...readItemClothingIds(source.itemsSnapshot),
    ...readItemClothingIds(source.snapshotItems),
  ], MAX_ARRAY_ITEMS);
  const scoresSnapshot = buildScoresSnapshot(source.scores);
  const aestheticSnapshot = buildAestheticSnapshot(source.aestheticEvaluation);
  return {
    ...(source.id ? { outfitId: String(source.id) } : {}),
    ...(source.outfitKey ? { outfitKey: String(source.outfitKey) } : {}),
    ...(clothingIds.length ? { clothingIds } : {}),
    ...(Object.keys(scoresSnapshot).length ? { scoresSnapshot } : {}),
    ...(Object.keys(aestheticSnapshot).length ? { aestheticSnapshot } : {}),
  };
}

function createOutfitBehaviorEventId({
  pageSessionId = 'session',
  eventType,
  idempotencyKey,
  nowMs = Date.now(),
  sequence,
}) {
  const stableKey = idempotencyKey
    ? `${pageSessionId}|${eventType}|${idempotencyKey}`
    : `${pageSessionId}|${eventType}|${nowMs}|${sequence ?? nextSequence()}`;
  return `obv1:${hashString(stableKey)}`;
}

function createOutfitExposureTracker({ pageSessionId = createPageSessionId() } = {}) {
  const seenExposures = new Set();
  return {
    pageSessionId,
    buildExposureEvent({
      outfit,
      recommendationBatchId,
      position,
      candidateCount,
      context = {},
    }) {
      const snapshot = buildOutfitBehaviorSnapshot(outfit);
      const outfitKey = snapshot.outfitKey || snapshot.outfitId;
      const batchId = recommendationBatchId || outfit?.recommendationBatchId || '';
      if (!outfitKey || !batchId) return null;
      const exposureKey = `${pageSessionId}|${batchId}|${outfitKey}`;
      if (seenExposures.has(exposureKey)) return null;
      seenExposures.add(exposureKey);
      return buildEvent({
        eventType: 'recommendation_exposure',
        snapshot,
        recommendationBatchId: batchId,
        context: {
          ...context,
          source: 'today',
          position,
          candidateCount,
        },
        idempotencyKey: `exposure|${exposureKey}`,
        pageSessionId,
      });
    },
    buildBatchRefreshEvent({
      previousRecommendationBatchId,
      previousOutfits,
      scene,
      trigger,
    }) {
      if (trigger !== 'manual' || !previousRecommendationBatchId) return null;
      const batchOutfitKeys = normalizeStringArray((previousOutfits || [])
        .map((outfit) => outfit?.outfitKey || outfit?.id), MAX_ARRAY_ITEMS);
      const candidateCount = Math.min(MAX_ARRAY_ITEMS, Math.max(1, Array.isArray(previousOutfits) ? previousOutfits.length : 0));
      return buildEvent({
        eventType: 'recommendation_batch_refresh',
        recommendationBatchId: previousRecommendationBatchId,
        batchOutfitKeys,
        context: {
          scene,
          trigger: 'manual',
          candidateCount,
        },
        idempotencyKey: `refresh|${pageSessionId}|${previousRecommendationBatchId}|${batchOutfitKeys.join(',')}`,
        pageSessionId,
      });
    },
  };
}

function createOutfitBehaviorQueue({ sender }) {
  const queue = [];
  return {
    enqueue(event) {
      if (!event) return;
      if (queue.length >= MAX_OUTFIT_BEHAVIOR_QUEUE_SIZE) return;
      queue.push(event);
    },
    size() {
      return queue.length;
    },
    async flush() {
      while (queue.length > 0) {
        const batch = queue.splice(0, OUTFIT_BEHAVIOR_BATCH_SIZE);
        try {
          await sender(batch);
        } catch (error) {
          queue.unshift(...batch);
          queue.splice(MAX_OUTFIT_BEHAVIOR_QUEUE_SIZE);
          throw error;
        }
      }
    },
  };
}

async function recordExplicitOutfitBehavior({
  queue,
  eventType,
  outfit,
  source,
  idempotencyKey,
  afterBusinessSuccess,
}) {
  const result = await afterBusinessSuccess();
  try {
    const snapshot = buildOutfitBehaviorSnapshot(outfit);
    const event = buildEvent({
      eventType,
      snapshot,
      context: { source },
      idempotencyKey: idempotencyKey || `${eventType}|${snapshot.outfitKey || snapshot.outfitId}|${Date.now()}|${nextSequence()}`,
    });
    queue.enqueue(event);
    await queue.flush();
  } catch (error) {
    // Behavior tracking is best-effort and must never affect the business action.
  }
  return result;
}

function buildEvent({
  eventType,
  snapshot = {},
  recommendationBatchId,
  batchOutfitKeys,
  context,
  idempotencyKey,
  pageSessionId,
}) {
  const event = {
    schemaVersion: 1,
    eventId: createOutfitBehaviorEventId({ pageSessionId, eventType, idempotencyKey }),
    eventType,
    clientOccurredAt: new Date().toISOString(),
    ...snapshot,
  };
  if (recommendationBatchId) event.recommendationBatchId = String(recommendationBatchId);
  const normalizedBatchKeys = normalizeStringArray(batchOutfitKeys || [], MAX_ARRAY_ITEMS);
  if (normalizedBatchKeys.length) event.batchOutfitKeys = normalizedBatchKeys;
  const normalizedContext = normalizeContext(context);
  if (Object.keys(normalizedContext).length) event.context = normalizedContext;
  return event;
}

function buildScoresSnapshot(scores) {
  const source = isObject(scores) ? scores : {};
  const result = {};
  for (const key of ['total', 'weatherAdaptation', 'styleUnity', 'freshness', 'preference']) {
    if (Number.isFinite(source[key])) result[key] = source[key];
  }
  return result;
}

function buildAestheticSnapshot(aestheticEvaluation) {
  const source = isObject(aestheticEvaluation) ? aestheticEvaluation : {};
  const result = {};
  if (source.engineVersion === 'aesthetic-compat-v1') result.engineVersion = 'aesthetic-compat-v1';
  if (source.score === null || Number.isFinite(source.score)) result.score = source.score;
  if (Number.isFinite(source.coverage)) result.coverage = source.coverage;
  const evidenceCodes = normalizeStringArray([
    ...(Array.isArray(source.evidenceCodes) ? source.evidenceCodes : []),
    ...(Array.isArray(source.evidence) ? source.evidence.map((item) => item?.code) : []),
  ], MAX_EVIDENCE_CODES);
  if (evidenceCodes.length) result.evidenceCodes = evidenceCodes;
  return result;
}

function normalizeContext(context) {
  const source = isObject(context) ? context : {};
  const result = {};
  const scene = normalizeScene(source.scene);
  if (scene) result.scene = scene;
  if (typeof source.temperatureBand === 'string' && source.temperatureBand.trim()) {
    result.temperatureBand = source.temperatureBand.trim().slice(0, 64);
  }
  if (typeof source.conditionBucket === 'string' && source.conditionBucket.trim()) {
    result.conditionBucket = source.conditionBucket.trim().slice(0, 64);
  }
  if (EVENT_SOURCE_VALUES.has(source.source)) result.source = source.source;
  if (Number.isInteger(source.position) && source.position >= 0) result.position = source.position;
  if (Number.isInteger(source.candidateCount) && source.candidateCount >= 1) {
    result.candidateCount = Math.min(MAX_ARRAY_ITEMS, source.candidateCount);
  }
  if (source.trigger === 'manual') result.trigger = 'manual';
  return result;
}

function normalizeScene(scene) {
  if (EVENT_SCENE_VALUES.has(scene)) return scene;
  const value = String(scene || '').trim();
  const mapped = {
    home: 'home',
    work: 'work',
    date: 'date',
    sport: 'sport',
    sports: 'sport',
    '居家': 'home',
    '上班': 'work',
    '通勤': 'work',
    '约会': 'date',
    '运动': 'sport',
  }[value];
  return mapped || undefined;
}

function readItemClothingIds(items) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => item?.clothingId || item?.itemId).filter(Boolean);
}

function normalizeStringArray(values, maxItems) {
  return [...new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean))]
    .sort()
    .slice(0, maxItems);
}

function createPageSessionId(nowMs = Date.now()) {
  return `page:${nowMs}:${nextSequence()}`;
}

function nextSequence() {
  globalSequence += 1;
  return globalSequence;
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function isObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

module.exports = {
  MAX_OUTFIT_BEHAVIOR_QUEUE_SIZE,
  OUTFIT_BEHAVIOR_BATCH_SIZE,
  buildOutfitBehaviorSnapshot,
  createOutfitBehaviorEventId,
  createOutfitExposureTracker,
  createOutfitBehaviorQueue,
  recordExplicitOutfitBehavior,
};
