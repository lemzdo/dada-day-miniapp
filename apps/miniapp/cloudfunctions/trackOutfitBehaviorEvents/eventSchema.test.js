const assert = require('node:assert/strict');
const test = require('node:test');

const {
  MAX_EVENTS_PER_REQUEST,
  buildDocumentId,
  normalizeEventBatch,
  persistEventBatch,
} = require('./eventSchema');

function exposure(overrides = {}) {
  return {
    schemaVersion: 1,
    eventId: 'evt-exposure-1',
    eventType: 'recommendation_exposure',
    outfitKey: 'bottom-1|top-1',
    recommendationBatchId: 'batch-1',
    context: {
      source: 'today',
      position: 0,
      candidateCount: 3,
    },
    ...overrides,
  };
}

function detail(overrides = {}) {
  return {
    schemaVersion: 1,
    eventId: 'evt-detail-1',
    eventType: 'outfit_detail_view',
    outfitId: 'outfit-1',
    context: { source: 'detail' },
    ...overrides,
  };
}

function action(eventType, overrides = {}) {
  return {
    schemaVersion: 1,
    eventId: `evt-${eventType}`,
    eventType,
    outfitKey: 'bottom-1|top-1',
    ...overrides,
  };
}

function refresh(overrides = {}) {
  return {
    schemaVersion: 1,
    eventId: 'evt-refresh-1',
    eventType: 'recommendation_batch_refresh',
    recommendationBatchId: 'batch-old',
    batchOutfitKeys: ['b', 'a', 'a'],
    context: {
      trigger: 'manual',
      scene: 'work',
      candidateCount: 2,
    },
    ...overrides,
  };
}

test('accepts valid event types and canonical output is serializable', () => {
  const result = normalizeEventBatch({
    openid: 'openid-a',
    now: '2026-06-26T00:00:00.000Z',
    events: [
      exposure(),
      detail(),
      action('outfit_favorite'),
      action('outfit_unfavorite'),
      action('outfit_wear'),
      refresh(),
    ],
  });

  assert.equal(result.accepted.length, 6);
  assert.equal(result.rejected.length, 0);
  assert.doesNotThrow(() => JSON.stringify(result.accepted));
});

test('rejects non-array request and more than 20 events', () => {
  assert.throws(() => normalizeEventBatch({ openid: 'openid-a', events: {} }), /events must be an array/);
  const tooMany = Array.from({ length: MAX_EVENTS_PER_REQUEST + 1 }, (_, index) => exposure({ eventId: `evt-${index}` }));
  assert.throws(() => normalizeEventBatch({ openid: 'openid-a', events: tooMany }), /at most 20/);
});

test('invalid eventType and missing minimum fields are rejected per item', () => {
  const result = normalizeEventBatch({
    openid: 'openid-a',
    events: [
      { ...exposure(), eventType: 'bad_type' },
      exposure({ outfitKey: undefined, outfitId: undefined }),
      detail(),
    ],
  });

  assert.equal(result.accepted.length, 1);
  assert.equal(result.rejected.length, 2);
  assert.equal(result.accepted[0].eventType, 'outfit_detail_view');
});

test('unknown and spoofed server fields are stripped', () => {
  const result = normalizeEventBatch({
    openid: 'openid-a',
    now: '2026-06-26T00:00:00.000Z',
    events: [
      exposure({
        unknown: 'drop',
        _openid: 'attacker',
        openid: 'attacker',
        userId: 'attacker',
        occurredAt: '1999-01-01T00:00:00.000Z',
        createdAt: '1999-01-01T00:00:00.000Z',
      }),
    ],
  });

  const doc = result.accepted[0].document;
  assert.equal(doc._openid, 'openid-a');
  assert.equal(doc.occurredAt, '2026-06-26T00:00:00.000Z');
  assert.equal(doc.createdAt, '2026-06-26T00:00:00.000Z');
  assert.equal(Object.prototype.hasOwnProperty.call(doc, 'unknown'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(doc, 'openid'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(doc, 'userId'), false);
});

test('arrays are deduped, sorted, and capped', () => {
  const result = normalizeEventBatch({
    openid: 'openid-a',
    events: [
      exposure({
        clothingIds: ['c9', 'c1', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8'],
        batchOutfitKeys: ['z', 'a', 'z', 'b', 'c', 'd', 'e', 'f', 'g'],
        aestheticSnapshot: {
          engineVersion: 'aesthetic-compat-v1',
          score: 88,
          coverage: 0.7,
          evidenceCodes: Array.from({ length: 14 }, (_, index) => `e${String(index).padStart(2, '0')}`).reverse(),
        },
      }),
    ],
  });

  const doc = result.accepted[0].document;
  assert.deepEqual(doc.clothingIds, ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8']);
  assert.deepEqual(doc.batchOutfitKeys, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'z']);
  assert.equal(doc.aestheticSnapshot.evidenceCodes.length, 12);
  assert.deepEqual(doc.aestheticSnapshot.evidenceCodes.slice(0, 3), ['e00', 'e01', 'e02']);
});

test('invalid numeric values and context enums are dropped', () => {
  const result = normalizeEventBatch({
    openid: 'openid-a',
    events: [
      detail({
        scoresSnapshot: {
          total: Number.NaN,
          weatherAdaptation: Number.POSITIVE_INFINITY,
          styleUnity: 80,
        },
        aestheticSnapshot: {
          engineVersion: 'aesthetic-compat-v1',
          score: 200,
          coverage: -1,
          evidenceCodes: ['ok'],
        },
        context: {
          source: 'detail',
          scene: 'party',
          position: -1,
          candidateCount: 99,
          trigger: 'auto',
        },
      }),
    ],
  });

  const doc = result.accepted[0].document;
  assert.deepEqual(doc.scoresSnapshot, { styleUnity: 80 });
  assert.deepEqual(doc.aestheticSnapshot, {
    engineVersion: 'aesthetic-compat-v1',
    evidenceCodes: ['ok'],
  });
  assert.deepEqual(doc.context, { source: 'detail' });
});

test('normalizeEventBatch does not mutate raw input', () => {
  const raw = exposure({ clothingIds: ['b', 'a', 'a'] });
  const before = JSON.stringify(raw);
  normalizeEventBatch({ openid: 'openid-a', events: [raw] });
  assert.equal(JSON.stringify(raw), before);
});

test('document id is stable per openid and eventId without leaking openid', () => {
  const first = buildDocumentId('openid-a', 'evt-1');
  const second = buildDocumentId('openid-a', 'evt-1');
  const otherUser = buildDocumentId('openid-b', 'evt-1');

  assert.equal(first, second);
  assert.notEqual(first, otherUser);
  assert.equal(first.includes('openid-a'), false);
});

test('persistEventBatch reports duplicates as idempotent success and isolates invalid items', async () => {
  const writtenIds = new Set();
  const writes = [];
  const db = {
    collection(name) {
      assert.equal(name, 'outfit_behavior_events');
      return {
        doc(id) {
          return {
            async set(payload) {
              if (writtenIds.has(id)) {
                const error = new Error('duplicate');
                error.errCode = -502001;
                throw error;
              }
              writtenIds.add(id);
              writes.push({ id, payload });
            },
          };
        },
      };
    },
  };

  const result = await persistEventBatch({
    db,
    openid: 'openid-a',
    events: [
      exposure({ eventId: 'evt-dup' }),
      exposure({ eventId: 'evt-dup' }),
      exposure({ eventId: 'evt-invalid', outfitKey: undefined, outfitId: undefined }),
    ],
  });

  assert.equal(result.accepted, 1);
  assert.equal(result.duplicate, 1);
  assert.equal(result.rejected, 1);
  assert.equal(writes.length, 1);
  assert.deepEqual(result.results.map((item) => item.status), ['accepted', 'duplicate', 'rejected']);
});

test('persistEventBatch reports database failures without failing the whole batch', async () => {
  const db = {
    collection() {
      return {
        doc() {
          return {
            async set() {
              throw new Error('network down');
            },
          };
        },
      };
    },
  };

  const result = await persistEventBatch({
    db,
    openid: 'openid-a',
    events: [exposure(), detail()],
  });

  assert.equal(result.accepted, 0);
  assert.equal(result.duplicate, 0);
  assert.equal(result.rejected, 0);
  assert.equal(result.failed, 2);
});
