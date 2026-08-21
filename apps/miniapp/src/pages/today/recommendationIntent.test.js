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

test('out-of-order responses can only apply while their generation owns the input', async () => {
  const registry = createRecommendationIntentRegistry();
  const applied = [];
  let releaseOld;
  const oldPending = new Promise((resolve) => { releaseOld = resolve; });
  const old = registry.run({
    intentId: 'entry',
    inputSignature: signature({ weatherFingerprint: 'cached|20|cloudy' }),
    execute: async (intent) => { await oldPending; if (registry.isCurrent(intent)) applied.push('old'); },
  });
  const latest = registry.run({
    intentId: 'entry',
    inputSignature: signature({ weatherFingerprint: 'resolved|22|sunny' }),
    execute: async (intent) => { if (registry.isCurrent(intent)) applied.push('latest'); },
  });
  await latest.promise;
  releaseOld();
  await old.promise;
  assert.deepEqual(applied, ['latest']);
});

test('same identity joins while scene or wardrobe identity changes create generations', async () => {
  const registry = createRecommendationIntentRegistry();
  let calls = 0;
  const run = (inputSignature) => registry.run({
    intentId: 'entry', inputSignature, execute: async () => { calls += 1; },
  });
  const first = run(signature());
  const joined = run(signature());
  const scene = run(signature({ sceneKey: 'date' }));
  const wardrobe = run(signature({ wardrobeVersion: 'wardrobe-2' }));
  await Promise.all([first.promise, joined.promise, scene.promise, wardrobe.promise]);
  assert.equal(joined.joined, true);
  assert.equal(calls, 3);
  assert.notEqual(first.intent.generation, scene.intent.generation);
  assert.notEqual(scene.intent.generation, wardrobe.intent.generation);
});
