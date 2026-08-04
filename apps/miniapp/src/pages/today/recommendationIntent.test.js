const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildRecommendationInputSignature,
  createRecommendationIntentRegistry,
} = require('./recommendationIntent');

function signature(overrides = {}) {
  return buildRecommendationInputSignature({
    userRuntimeKey: 'user-a',
    sceneKey: 'home',
    date: '2026-07-30',
    timeOfDay: 'all_day',
    weatherFingerprint: 'resolved|26 - 31|cloudy',
    wardrobeVersion: 'wardrobe-1',
    profileVersion: 'profile-1',
    requestKind: 'initial',
    ...overrides,
  });
}

test('same effective input joins one real recommendation request across triggers', async () => {
  const registry = createRecommendationIntentRegistry();
  let calls = 0;
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });

  const first = registry.run({
    intentId: 'entry-1',
    inputSignature: signature(),
    execute: async () => {
      calls += 1;
      await pending;
      return true;
    },
  });
  const weather = registry.run({
    intentId: 'entry-1',
    inputSignature: signature(),
    execute: async () => {
      calls += 1;
      return false;
    },
  });

  assert.equal(first.joined, false);
  assert.equal(weather.joined, true);
  assert.equal(first.promise, weather.promise);
  assert.equal(calls, 1);
  release();
  assert.equal(await weather.promise, true);
});

test('a real input signature change supersedes the old response', async () => {
  const registry = createRecommendationIntentRegistry();
  const first = registry.run({
    intentId: 'entry-1',
    inputSignature: signature({ weatherFingerprint: 'unresolved|none|other' }),
    execute: async () => true,
  });
  const second = registry.run({
    intentId: 'entry-1',
    inputSignature: signature(),
    execute: async () => true,
  });

  assert.equal(registry.isCurrent(first.intent), false);
  assert.equal(registry.isCurrent(second.intent), true);
  await Promise.all([first.promise, second.promise]);
});

test('scene snapshot activation prevents an older response from committing', async () => {
  const registry = createRecommendationIntentRegistry();
  const request = registry.run({
    intentId: 'scene-work',
    inputSignature: signature({ sceneKey: 'work' }),
    execute: async () => true,
  });
  const snapshotIntent = registry.activate({
    intentId: 'scene-date',
    inputSignature: signature({ sceneKey: 'date' }),
  });

  assert.equal(registry.isCurrent(request.intent), false);
  assert.equal(registry.isCurrent(snapshotIntent), true);
  await request.promise;
});

test('user, mutation versions, refresh batch, and exclusions participate in signatures', () => {
  const base = signature();
  assert.notEqual(base, signature({ userRuntimeKey: 'user-b' }));
  assert.notEqual(base, signature({ wardrobeVersion: 'wardrobe-2' }));
  assert.notEqual(base, signature({ profileVersion: 'profile-2' }));
  assert.notEqual(base, signature({ requestKind: 'refresh', recommendationBatchId: 'batch-1' }));
  assert.equal(
    signature({ excludedOutfitKeys: ['b', 'a', 'a'] }),
    signature({ excludedOutfitKeys: ['a', 'b'] }),
  );
});
