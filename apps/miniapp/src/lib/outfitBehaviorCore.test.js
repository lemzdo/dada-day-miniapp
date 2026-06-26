const assert = require('node:assert/strict');
const test = require('node:test');

const {
  MAX_OUTFIT_BEHAVIOR_QUEUE_SIZE,
  OUTFIT_BEHAVIOR_BATCH_SIZE,
  buildOutfitBehaviorSnapshot,
  createOutfitBehaviorEventId,
  createOutfitExposureTracker,
  createOutfitBehaviorQueue,
  recordExplicitOutfitBehavior,
} = require('./outfitBehaviorCore');

function outfit(overrides = {}) {
  return {
    id: 'outfit-1',
    outfitKey: 'top-1|bottom-1',
    recommendationBatchId: 'batch-1',
    title: 'do not send',
    displayTitle: 'do not send either',
    imageUrl: 'cloud://secret',
    city: 'Shanghai',
    clothingIds: ['bottom-1', 'top-1', 'top-1'],
    items: [
      { clothingId: 'shoe-1', imageUrl: 'cloud://shoe' },
      { clothingId: 'top-1', imageUrl: 'cloud://top' },
    ],
    scores: {
      total: 88,
      weatherAdaptation: 90,
      styleUnity: 80,
      freshness: 70,
      preference: 60,
      fashion: 100,
    },
    aestheticEvaluation: {
      engineVersion: 'aesthetic-compat-v1',
      score: 77,
      coverage: 0.8,
      dimensions: { forbidden: true },
      evidence: [
        { code: 'z-code', itemIds: ['secret'] },
        { code: 'a-code', data: { raw: true } },
      ],
    },
    ...overrides,
  };
}

test('snapshot only includes allowlisted outfit fields', () => {
  const snapshot = buildOutfitBehaviorSnapshot(outfit());
  const json = JSON.stringify(snapshot);

  assert.deepEqual(snapshot.clothingIds, ['bottom-1', 'shoe-1', 'top-1']);
  assert.deepEqual(snapshot.scoresSnapshot, {
    total: 88,
    weatherAdaptation: 90,
    styleUnity: 80,
    freshness: 70,
    preference: 60,
  });
  assert.deepEqual(snapshot.aestheticSnapshot, {
    engineVersion: 'aesthetic-compat-v1',
    score: 77,
    coverage: 0.8,
    evidenceCodes: ['a-code', 'z-code'],
  });
  for (const forbidden of ['title', 'displayTitle', 'imageUrl', 'city', 'dimensions', 'itemIds', 'raw']) {
    assert.equal(json.includes(forbidden), false);
  }
});

test('exposure tracker dedupes same page session and batch but allows a new batch', () => {
  const tracker = createOutfitExposureTracker({ pageSessionId: 'page-1' });
  const first = tracker.buildExposureEvent({
    outfit: outfit(),
    recommendationBatchId: 'batch-1',
    position: 0,
    candidateCount: 2,
    context: { scene: 'work' },
  });
  const duplicate = tracker.buildExposureEvent({
    outfit: outfit(),
    recommendationBatchId: 'batch-1',
    position: 0,
    candidateCount: 2,
  });
  const newBatch = tracker.buildExposureEvent({
    outfit: outfit(),
    recommendationBatchId: 'batch-2',
    position: 0,
    candidateCount: 2,
  });

  assert.equal(first && first.eventType, 'recommendation_exposure');
  assert.equal(duplicate, null);
  assert.equal(newBatch && newBatch.recommendationBatchId, 'batch-2');
});

test('event ids are stable when idempotency key is provided and do not rely on Math.random alone', () => {
  const first = createOutfitBehaviorEventId({
    pageSessionId: 'page-1',
    eventType: 'outfit_favorite',
    idempotencyKey: 'mutation-1',
    nowMs: 123,
    sequence: 1,
  });
  const second = createOutfitBehaviorEventId({
    pageSessionId: 'page-1',
    eventType: 'outfit_favorite',
    idempotencyKey: 'mutation-1',
    nowMs: 999,
    sequence: 99,
  });
  const third = createOutfitBehaviorEventId({
    pageSessionId: 'page-1',
    eventType: 'outfit_wear',
    nowMs: 123,
    sequence: 1,
  });

  assert.equal(first, second);
  assert.notEqual(first, third);
  assert.match(first, /^obv1:/);
});

test('queue caps at 50 and sends batches of at most 20 without local persistence', async () => {
  const batches = [];
  const queue = createOutfitBehaviorQueue({
    sender: async (events) => {
      batches.push(events);
      return { accepted: events.length };
    },
  });

  for (let index = 0; index < MAX_OUTFIT_BEHAVIOR_QUEUE_SIZE + 7; index += 1) {
    queue.enqueue({ schemaVersion: 1, eventId: `evt-${index}`, eventType: 'outfit_wear', outfitKey: `outfit-${index}` });
  }
  await queue.flush();

  assert.equal(queue.size(), 0);
  assert.ok(batches.length >= 2);
  assert.ok(batches.every((batch) => batch.length <= OUTFIT_BEHAVIOR_BATCH_SIZE));
  assert.equal(batches.flat().length, MAX_OUTFIT_BEHAVIOR_QUEUE_SIZE);
});

test('tracking rejection is swallowed and leaves the business result intact', async () => {
  const queue = createOutfitBehaviorQueue({
    sender: async () => {
      throw new Error('tracking unavailable');
    },
  });

  const businessResult = await recordExplicitOutfitBehavior({
    queue,
    eventType: 'outfit_favorite',
    outfit: outfit(),
    source: 'today',
    idempotencyKey: 'favorite-success',
    afterBusinessSuccess: async () => 'business-ok',
  });

  assert.equal(businessResult, 'business-ok');
});

test('explicit action failure is not tracked and wear is not permanently deduped', async () => {
  const sent = [];
  const queue = createOutfitBehaviorQueue({
    sender: async (events) => {
      sent.push(...events);
      return { accepted: events.length };
    },
  });

  await assert.rejects(
    () => recordExplicitOutfitBehavior({
      queue,
      eventType: 'outfit_favorite',
      outfit: outfit(),
      source: 'today',
      afterBusinessSuccess: async () => {
        throw new Error('favorite failed');
      },
    }),
    /favorite failed/,
  );
  await recordExplicitOutfitBehavior({
    queue,
    eventType: 'outfit_wear',
    outfit: outfit(),
    source: 'today',
    afterBusinessSuccess: async () => 'first',
  });
  await recordExplicitOutfitBehavior({
    queue,
    eventType: 'outfit_wear',
    outfit: outfit(),
    source: 'today',
    afterBusinessSuccess: async () => 'second',
  });
  await queue.flush();

  assert.deepEqual(sent.map((event) => event.eventType), ['outfit_wear', 'outfit_wear']);
});

test('manual batch refresh is explicit and automatic weather refresh is not represented', () => {
  const tracker = createOutfitExposureTracker({ pageSessionId: 'page-1' });
  const manual = tracker.buildBatchRefreshEvent({
    previousRecommendationBatchId: 'batch-old',
    previousOutfits: [outfit({ outfitKey: 'b' }), outfit({ outfitKey: 'a' })],
    scene: 'work',
    trigger: 'manual',
  });
  const weather = tracker.buildBatchRefreshEvent({
    previousRecommendationBatchId: 'batch-old',
    previousOutfits: [outfit({ outfitKey: 'b' })],
    scene: 'work',
    trigger: 'weather',
  });

  assert.equal(manual && manual.eventType, 'recommendation_batch_refresh');
  assert.deepEqual(manual && manual.batchOutfitKeys, ['a', 'b']);
  assert.equal(weather, null);
});
