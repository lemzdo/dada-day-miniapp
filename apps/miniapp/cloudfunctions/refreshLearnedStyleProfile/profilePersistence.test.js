const assert = require('node:assert/strict');
const test = require('node:test');

const { NOW, clothing, event, readyScenario } = require('./profileBuilder.fixtures');
const {
  buildProfileDocumentId,
  createSafeRefreshSummary,
  persistProfileDocument,
  readClothesByIds,
  readRecentEvents,
  refreshLearnedStyleProfile,
} = require('./profilePersistence');
const { createMain } = require('./index');

function profile(overrides = {}) {
  return {
    schemaVersion: 1,
    profileVersion: 'learned-style-v1',
    status: 'insufficient_data',
    global: {},
    contexts: {},
    source: {
      windowDays: 180,
      from: '2025-12-28T00:00:00.000Z',
      to: NOW,
      eventCount: 1,
      eligibleEventCount: 1,
      exposureCount: 0,
      distinctOutfitCount: 1,
      lastEventAt: NOW,
      sourceDigest: 'digest-a',
    },
    quality: {
      effectiveActionWeight: 2,
      featureCoverage: 1,
      contextCoverage: 1,
      positiveActionCount: 1,
      negativeActionCount: 0,
      wearCount: 0,
      repeatedWearCount: 0,
    },
    generatedAt: NOW,
    ...overrides,
  };
}

test('document id is stable per user and does not leak openid', () => {
  const first = buildProfileDocumentId('openid-a');
  const second = buildProfileDocumentId('openid-a');
  const other = buildProfileDocumentId('openid-b');

  assert.equal(first, second);
  assert.notEqual(first, other);
  assert.match(first, /^lspv1_[a-f0-9]{64}$/);
  assert.equal(first.includes('openid-a'), false);
});

test('safe summary excludes sensitive source and profile details', () => {
  const summary = createSafeRefreshSummary({
    profile: profile({ status: 'shadow_ready' }),
    unchanged: false,
  });

  assert.deepEqual(Object.keys(summary).sort(), [
    'distinctOutfitCount',
    'effectiveActionWeight',
    'eligibleEventCount',
    'eventCount',
    'featureCoverage',
    'generatedAt',
    'ok',
    'profileVersion',
    'status',
    'unchanged',
  ]);
  assert.equal(JSON.stringify(summary).includes('openid'), false);
  assert.equal(JSON.stringify(summary).includes('outfitKey'), false);
  assert.equal(summary.status, 'shadow_ready');
});

test('persistProfileDocument returns unchanged when digest matches and does not write', async () => {
  const writes = [];
  const db = transactionDb({
    existing: { profileVersion: 'learned-style-v1', source: { sourceDigest: 'digest-a', lastEventAt: NOW } },
    writes,
  });

  const result = await persistProfileDocument({ db, openid: 'openid-a', profile: profile() });

  assert.equal(result.unchanged, true);
  assert.equal(writes.length, 0);
});

test('persistProfileDocument writes new digest with hashed id and server openid', async () => {
  const writes = [];
  const db = transactionDb({
    existing: { profileVersion: 'learned-style-v1', source: { sourceDigest: 'digest-old', lastEventAt: '2026-06-25T00:00:00.000Z' } },
    writes,
  });

  const result = await persistProfileDocument({ db, openid: 'openid-a', profile: profile() });

  assert.equal(result.unchanged, false);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].id, buildProfileDocumentId('openid-a'));
  assert.equal(writes[0].data._openid, 'openid-a');
  assert.equal(writes[0].data._id.includes('openid-a'), false);
});

test('persistProfileDocument refuses stale aggregation over newer profile', async () => {
  const writes = [];
  const db = transactionDb({
    existing: { profileVersion: 'learned-style-v1', source: { sourceDigest: 'digest-new', lastEventAt: '2026-06-27T00:00:00.000Z' } },
    writes,
  });

  const result = await persistProfileDocument({ db, openid: 'openid-a', profile: profile() });

  assert.equal(result.unchanged, true);
  assert.equal(result.reason, 'stale_source');
  assert.equal(writes.length, 0);
});

test('readRecentEvents queries only current user with pagination and stable sort', async () => {
  const calls = [];
  const db = queryDb({
    calls,
    dataByCollection: {
      outfit_behavior_events: [
        event({ eventId: 'evt-b', occurredAt: '2026-06-25T00:00:00.000Z' }),
        event({ eventId: 'evt-a', occurredAt: '2026-06-25T00:00:00.000Z' }),
      ],
    },
  });

  const events = await readRecentEvents({ db, openid: 'openid-a', now: NOW, pageSize: 1, maxEvents: 2 });

  assert.equal(calls.every((call) => call.collection === 'outfit_behavior_events'), true);
  assert.equal(calls.every((call) => call.filter._openid === 'openid-a'), true);
  assert.equal(calls.some((call) => call.filter._openid === 'attacker'), false);
  assert.deepEqual(events.map((item) => item.eventId), ['evt-a', 'evt-b']);
});

test('readClothesByIds batches ids and limits every query to current user', async () => {
  const calls = [];
  const db = queryDb({
    calls,
    dataByCollection: {
      clothes: [clothing({ _id: 'cloth-1', id: 'cloth-1' })],
    },
  });

  const clothes = await readClothesByIds({
    db,
    openid: 'openid-a',
    clothingIds: ['cloth-1', 'cloth-1', 'cloth-2'],
    batchSize: 1,
  });

  assert.equal(clothes.length, 1);
  assert.equal(calls.every((call) => call.collection === 'clothes'), true);
  assert.equal(calls.every((call) => call.filter._openid === 'openid-a'), true);
  assert.equal(calls.length, 2);
});

test('readClothesByIds tolerates a failed batch and keeps successful clothes', async () => {
  const db = queryDb({
    failCollectionsOnce: new Set(['clothes']),
    dataByCollection: {
      clothes: [clothing({ _id: 'cloth-2', id: 'cloth-2' })],
    },
  });

  const clothes = await readClothesByIds({
    db,
    openid: 'openid-a',
    clothingIds: ['cloth-1', 'cloth-2'],
    batchSize: 1,
  });

  assert.deepEqual(clothes.map((item) => item._id), ['cloth-2']);
});

test('refreshLearnedStyleProfile reads current user data builds profile and persists safe summary', async () => {
  const scenario = readyScenario();
  const writes = [];
  const calls = [];
  const db = queryDb({
    calls,
    dataByCollection: {
      outfit_behavior_events: scenario.events,
      clothes: scenario.clothes,
    },
    transactionExisting: null,
    transactionWrites: writes,
  });

  const summary = await refreshLearnedStyleProfile({ db, openid: 'openid-a', now: NOW });

  assert.equal(summary.ok, true);
  assert.equal(summary.status, 'shadow_ready');
  assert.equal(summary.unchanged, false);
  assert.equal(writes.length, 1);
  assert.equal(calls.every((call) => call.filter._openid === 'openid-a'), true);
  assert.equal(JSON.stringify(summary).includes('clothingIds'), false);
});

test('refreshLearnedStyleProfile returns unchanged on identical digest', async () => {
  const scenario = readyScenario();
  const existingProfile = require('./profileBuilder').buildLearnedStyleProfile({ ...scenario, now: NOW });
  const db = queryDb({
    dataByCollection: {
      outfit_behavior_events: scenario.events,
      clothes: scenario.clothes,
    },
    transactionExisting: { profileVersion: 'learned-style-v1', source: { sourceDigest: existingProfile.source.sourceDigest, lastEventAt: existingProfile.source.lastEventAt } },
    transactionWrites: [],
  });

  const summary = await refreshLearnedStyleProfile({ db, openid: 'openid-a', now: NOW });

  assert.equal(summary.unchanged, true);
});

test('createMain ignores spoofed client user ids and uses cloud OPENID only', async () => {
  const calls = [];
  const main = createMain({
    cloud: {
      getWXContext() {
        return { OPENID: 'server-openid' };
      },
      database() {
        return { name: 'mock-db' };
      },
    },
    nowProvider() {
      return NOW;
    },
    refreshProfile(args) {
      calls.push(args);
      return Promise.resolve(createSafeRefreshSummary({ profile: profile(), unchanged: false }));
    },
  });

  const response = await main({ _openid: 'attacker', openid: 'attacker', userId: 'attacker' });

  assert.equal(response.code, 0);
  assert.equal(calls[0].openid, 'server-openid');
  assert.equal(calls[0].now, NOW);
});

function transactionDb({ existing, writes }) {
  return {
    runTransaction(callback) {
      return callback({
        collection() {
          return {
            doc(id) {
              return {
                async get() {
                  return { data: existing ? [{ _id: id, ...existing }] : [] };
                },
                async set(payload) {
                  writes.push({ id, data: payload.data });
                  return {};
                },
              };
            },
          };
        },
      });
    },
  };
}

function queryDb({ calls = [], dataByCollection = {}, failCollectionsOnce = new Set(), transactionExisting = null, transactionWrites = [] }) {
  const db = {
    command: {
      gte(value) {
        return { $gte: value };
      },
      in(value) {
        return { $in: value };
      },
    },
    runTransaction(callback) {
      return transactionDb({ existing: transactionExisting, writes: transactionWrites }).runTransaction(callback);
    },
    collection(name) {
      const state = {
        collection: name,
        filter: {},
        skipValue: 0,
        limitValue: 100,
      };
      const query = {
        where(filter) {
          state.filter = filter;
          return query;
        },
        orderBy() {
          return query;
        },
        skip(value) {
          state.skipValue = value;
          return query;
        },
        limit(value) {
          state.limitValue = value;
          return query;
        },
        async get() {
          calls.push({ collection: name, filter: state.filter, skip: state.skipValue, limit: state.limitValue });
          if (failCollectionsOnce.has(name)) {
            failCollectionsOnce.delete(name);
            throw new Error('query failed once');
          }
          const all = (dataByCollection[name] || []).filter((item) => {
            if (state.filter._openid && item._openid && item._openid !== state.filter._openid) return false;
            const inIds = state.filter._id && state.filter._id.$in;
            if (Array.isArray(inIds) && !inIds.includes(item._id || item.id)) return false;
            return true;
          });
          return { data: all.slice(state.skipValue, state.skipValue + state.limitValue) };
        },
      };
      return query;
    },
  };
  return db;
}
