const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Module = require('node:module');
const test = require('node:test');

const {
  CANDIDATE_POOL_MAX_BYTES,
  buildCandidatePoolProjectionProfile,
  buildCandidatePoolStoragePlan,
  buildCandidatePoolIdentity,
  createCandidatePoolRecord,
  hydrateCandidateCore,
  loadCandidatePool,
  serializeCandidateCore,
  tryPersistCandidatePool,
} = require('./candidatePool');
const { ELIGIBILITY_REASON_CATALOG } = require('./recommendationEligibilityReason');

function legacyStableSerialize(value) {
  if (Array.isArray(value)) return `[${value.map(legacyStableSerialize).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${legacyStableSerialize(value[key])}`).join(',')}}`;
}

function legacyCandidateChecksum(candidates) {
  return crypto.createHash('sha256').update(legacyStableSerialize(candidates)).digest('hex');
}

function loadGenerateOutfitInternals() {
  const originalLoad = Module._load;
  Module._load = function loadWithCloudStub(request, parent, isMain) {
    if (request === 'wx-server-sdk') {
      return {
        DYNAMIC_CURRENT_ENV: 'test',
        init() {},
        database() { return { command: { in: (values) => values } }; },
        getWXContext() { return { OPENID: 'storage-test-user' }; },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  try {
    delete require.cache[require.resolve('../index.js')];
    return require('../index.js').__test;
  } finally {
    Module._load = originalLoad;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
}

function profile() {
  return {
    styleTags: [],
    colorPreference: [],
    avoidTags: [],
    fitPreference: 'unknown',
    genderPreference: 'unknown',
    temperatureSensitivity: 'normal',
  };
}

function item(id, category, subcategory, extra = {}) {
  return {
    _id: id,
    category,
    type: category,
    subcategory,
    subCategory: subcategory,
    customName: subcategory,
    styleTags: ['simple'],
    sceneTags: ['work'],
    seasonTags: [],
    colorPalette: [{ name: 'black', hex: '#111111' }],
    confidence: 0.9,
    ...extra,
  };
}

function largeWardrobe() {
  return [
    ...Array.from({ length: 5 }, (_, index) => item(`top-${index}`, 'top', `office simple shirt ${index}`)),
    ...Array.from({ length: 8 }, (_, index) => item(`bottom-${index}`, 'bottom', `straight long pants ${index}`, { pantsLength: 'long', fit: 'straight' })),
    ...Array.from({ length: 4 }, (_, index) => item(`shoe-${index}`, 'shoes', `simple loafer shoes ${index}`, { shoeType: 'loafer' })),
    ...Array.from({ length: 6 }, (_, index) => item(`coat-${index}`, 'outerwear', `office blazer ${index}`)),
    ...Array.from({ length: 4 }, (_, index) => item(`accessory-${index}`, 'accessory', `accent bag ${index}`, {
      colorPalette: [{ name: 'red', hex: '#ff0000' }],
    })),
    ...Array.from({ length: 4 }, (_, index) => item(`dress-${index}`, 'onepiece', `simple office dress ${index}`)),
  ];
}

function createDocumentDatabase({ records = [], writes, failAt = -1, failure } = {}) {
  const store = new Map((Array.isArray(records) ? records : []).map((record, index) => [
    record?._id || `seed-${index}`,
    record,
  ]));
  let writeCount = 0;
  const collection = () => ({
    doc: (id) => ({
      set: async ({ data }) => {
        if (Object.hasOwn(data || {}, '_id')) {
          const error = new Error('不能更新_id的值');
          error.errorCode = -501007;
          throw error;
        }
        const current = writeCount;
        writeCount += 1;
        if (current === failAt) throw failure || new Error('database error');
        store.set(id, { ...data, _id: id });
        writes?.push({ id, data: { ...data } });
      },
      get: async () => ({ data: store.get(id) || null }),
      remove: async () => { store.delete(id); },
    }),
    where: (filter) => {
      const get = async () => ({ data: [...store.values()].filter((record) => Object.entries(filter)
        .every(([key, value]) => record?.[key] === value)) });
      return { limit: () => ({ get }), get };
    },
  });
  return { collection };
}

function generateCandidates(internals, scene, weather) {
  const clothes = largeWardrobe();
  const identity = buildCandidatePoolIdentity({
    openid: 'storage-test-user',
    clothes,
    sceneKey: scene === '居家' ? 'home' : scene === '上班' ? 'work' : scene === '约会' ? 'date' : 'sport',
    weather,
    weatherMode: weather.mode,
    recommendationProfile: profile(),
    timeOfDay: 'all_day',
    engineVersion: 'test-version',
  });
  const recommendations = internals.generateRuleRecommendations({
    clothes,
    scene,
    weather,
    weatherMode: weather.mode,
    recommendationProfile: profile(),
    excludeClothingIdSets: [],
    excludedOutfitKeys: [],
    maxResults: 8,
    debugRecommendationAudit: false,
    timings: {},
  });
  return { clothes, identity, recommendations, candidates: recommendations.candidatePoolCandidates || [] };
}

test('candidate pool storage projection real measurements for all scenes', async () => {
  const internals = loadGenerateOutfitInternals();
  const scenes = [
    { scene: '居家', sceneKey: 'home', weather: { temp: 22, weather: 'clear', mode: 'live' } },
    { scene: '上班', sceneKey: 'work', weather: { temp: 20, weather: 'clear', mode: 'live' } },
    { scene: '约会', sceneKey: 'date', weather: { temp: 25, weather: 'clear', mode: 'live' } },
    { scene: '运动', sceneKey: 'sport', weather: { temp: 28, weather: 'sunny', mode: 'live' } },
  ];

  for (const { scene, sceneKey, weather } of scenes) {
    const { identity, candidates } = generateCandidates(internals, scene, weather);
    if (candidates.length === 0) {
      console.log(`[${sceneKey}] candidateCount=0 (no valid candidates)`);
      continue;
    }

    const pool = createCandidatePoolRecord({
      candidatePoolId: `batch:${sceneKey}-test`,
      identity,
      candidates,
      now: Date.now(),
    });

    const plan = buildCandidatePoolStoragePlan(pool);
    const sourceProfile = buildCandidatePoolProjectionProfile({
      candidates,
      runtime: true,
    });
    const storedProfile = buildCandidatePoolProjectionProfile({
      candidates: pool.candidates,
      chunks: plan.chunks,
      manifest: plan.manifest,
      prepared: plan.prepared,
      runtime: true,
    });
    const totalBytes = plan.serializedBytes;
    console.log(`[${sceneKey}] candidateCount=${candidates.length}, manifestBytes=${plan.manifestBytes}, chunksBytes=${plan.chunksBytes}, chunkCount=${plan.chunks.length}, totalBytes=${totalBytes}`);
    if (sceneKey === 'home') {
      console.log(`[home-source-field-profile] ${JSON.stringify(sourceProfile)}`);
      console.log(`[home-stored-field-profile] ${JSON.stringify(storedProfile)}`);
      const persisted = await tryPersistCandidatePool({
        database: createDocumentDatabase(),
        candidatePoolId: `batch:${sceneKey}-phase-test`,
        identity,
        candidates,
        now: Date.now(),
        debugRecommendationAudit: true,
        logger: { info() {}, warn() {}, error() {} },
      });
      console.log(`[home-phase-timing] ${JSON.stringify(persisted.phaseTiming)}`);
      assert.equal(persisted.status, 'saved');
    }
    assert.ok(plan.manifestBytes <= CANDIDATE_POOL_MAX_BYTES, `${sceneKey} manifest exceeds storage budget`);
    assert.ok(plan.chunks.every((chunk) => Buffer.byteLength(JSON.stringify(chunk), 'utf8') <= CANDIDATE_POOL_MAX_BYTES), `${sceneKey} chunk exceeds storage budget`);
    assert.equal(plan.manifest.candidateCount, candidates.length);
    assert.equal(plan.manifest.chunkCount, plan.chunks.length);
    assert.equal(storedProfile.fieldBytesConserved, true);
    assert.equal(storedProfile.categoryBytes.conserved, true);
    assert.ok(sourceProfile.optimizedCandidateBytes > storedProfile.optimizedCandidateBytes);
  }
});

test('removed fields audit: rejectionStatus.validatorRejectReasons', () => {
  const internals = loadGenerateOutfitInternals();
  const { candidates } = generateCandidates(internals, '上班', { temp: 20, weather: 'clear', mode: 'live' });
  if (candidates.length === 0) return;

  const serialized = serializeCandidateCore(candidates[0]);
  assert.equal(Object.hasOwn(serialized, 'rejectionStatus'), false);

  const pool = createCandidatePoolRecord({
    candidatePoolId: 'batch:audit-test',
    identity: buildCandidatePoolIdentity({
      openid: 'audit-user',
      clothes: largeWardrobe(),
      sceneKey: 'work',
      weather: { temp: 20, mode: 'live' },
      weatherMode: 'live',
      recommendationProfile: profile(),
      timeOfDay: 'all_day',
      engineVersion: 'test-version',
    }),
    candidates,
    now: Date.now(),
  });

  const hydrated = hydrateCandidateCore(pool.candidates[0], {
    reasonDescriptorForCode: (code) => {
      const entry = ELIGIBILITY_REASON_CATALOG.find((e) => e.reasonCode === code);
      return entry ? { code: entry.reasonCode, family: entry.family, qualityTier: entry.qualityTier, isGenericFallback: false, catalogOrder: 0, text: `catalog:${entry.reasonCode}` } : null;
    },
  });

  assert.deepEqual(hydrated.validatorRejectReasons, []);
  assert.deepEqual(hydrated.riskFlags, []);
});

test('scoreBreakdown/scores are preserved for materialization', () => {
  const internals = loadGenerateOutfitInternals();
  const { candidates } = generateCandidates(internals, '上班', { temp: 20, weather: 'clear', mode: 'live' });
  if (candidates.length === 0) return;

  const original = candidates[0];
  const serialized = serializeCandidateCore(original);

  assert.equal(Object.hasOwn(serialized, 'scores'), true, 'scores must be stored');
  assert.ok(typeof serialized.scores.total === 'number' || serialized.scores.total === null, 'scores.total must be number or null');
  assert.ok(typeof serialized.scores.weatherAdaptation === 'number' || serialized.scores.weatherAdaptation === null, 'scores.weatherAdaptation must be number or null');
  assert.ok(typeof serialized.scores.colorHarmony === 'number' || serialized.scores.colorHarmony === null, 'scores.colorHarmony must be number or null');
  assert.ok(typeof serialized.scores.styleUnity === 'number' || serialized.scores.styleUnity === null, 'scores.styleUnity must be number or null');
  assert.ok(typeof serialized.scores.sceneMatch === 'number' || serialized.scores.sceneMatch === null, 'scores.sceneMatch must be number or null');
  assert.ok(typeof serialized.scores.freshness === 'number' || serialized.scores.freshness === null, 'scores.freshness must be number or null');
  assert.ok(typeof serialized.scores.preference === 'number' || serialized.scores.preference === null, 'scores.preference must be number or null');

  const pool = createCandidatePoolRecord({
    candidatePoolId: 'batch:audit-score',
    identity: buildCandidatePoolIdentity({
      openid: 'audit-user',
      clothes: largeWardrobe(),
      sceneKey: 'work',
      weather: { temp: 20, mode: 'live' },
      weatherMode: 'live',
      recommendationProfile: profile(),
      timeOfDay: 'all_day',
      engineVersion: 'test-version',
    }),
    candidates,
    now: Date.now(),
  });

  const hydrated = hydrateCandidateCore(pool.candidates[0], {
    reasonDescriptorForCode: (code) => {
      const entry = ELIGIBILITY_REASON_CATALOG.find((e) => e.reasonCode === code);
      return entry ? { code: entry.reasonCode, family: entry.family, qualityTier: entry.qualityTier, isGenericFallback: false, catalogOrder: 0, text: `catalog:${entry.reasonCode}` } : null;
    },
  });

  assert.equal(hydrated.scores.total, serialized.scores.total, 'scores.total must match');
  assert.equal(hydrated.scores.weatherAdaptation, serialized.scores.weatherAdaptation, 'scores.weatherAdaptation must match');
  assert.equal(hydrated.scores.colorHarmony, serialized.scores.colorHarmony, 'scores.colorHarmony must match');
  assert.equal(hydrated.scores.styleUnity, serialized.scores.styleUnity, 'scores.styleUnity must match');
  assert.equal(hydrated.scores.sceneMatch, serialized.scores.sceneMatch, 'scores.sceneMatch must match');
  assert.equal(hydrated.scores.freshness, serialized.scores.freshness, 'scores.freshness must match');
  assert.equal(hydrated.scores.preference, serialized.scores.preference, 'scores.preference must match');
  assert.deepEqual(hydrated.scoreBreakdown, hydrated.scores, 'scoreBreakdown must equal scores');
});

test('result equivalence: original vs hydrated candidate pool path', () => {
  const internals = loadGenerateOutfitInternals();
  const scenes = ['居家', '上班', '约会'];

  for (const scene of scenes) {
    const weather = { temp: 22, weather: 'clear', mode: 'live' };
    const { clothes, identity, recommendations } = generateCandidates(internals, scene, weather);
    const originalCandidates = recommendations.candidatePoolCandidates || [];
    if (originalCandidates.length === 0) continue;

    const pool = createCandidatePoolRecord({
      candidatePoolId: `batch:equiv-${scene}`,
      identity,
      candidates: originalCandidates,
      now: Date.now(),
    });

    const hydratedCandidates = pool.candidates.map((c) => hydrateCandidateCore(c, {
      reasonDescriptorForCode: (code) => {
        const entry = ELIGIBILITY_REASON_CATALOG.find((e) => e.reasonCode === code);
        return entry ? { code: entry.reasonCode, family: entry.family, qualityTier: entry.qualityTier, isGenericFallback: false, catalogOrder: 0, text: `catalog:${entry.reasonCode}` } : null;
      },
    }));

    for (let i = 0; i < Math.min(originalCandidates.length, hydratedCandidates.length); i++) {
      const original = originalCandidates[i];
      const hydrated = hydratedCandidates[i];

      assert.equal(hydrated.outfitKey, original.outfitKey || original.selectionSignatures?.itemSignature, `outfitKey mismatch at index ${i}`);
      assert.deepEqual(hydrated.itemIds.sort(), original.itemIds.sort(), `itemIds mismatch at index ${i}`);
      assert.deepEqual(hydrated.roleItemIds, original.roleItemIds, `roleItemIds mismatch at index ${i}`);
      assert.equal(hydrated.archetype, original.archetype, `archetype mismatch at index ${i}`);
      assert.equal(hydrated.totalScore, original.totalScore, `totalScore mismatch at index ${i}`);
      assert.equal(hydrated.rankingScore, original.rankingScore, `rankingScore mismatch at index ${i}`);
      const hydratedReasonCodes = hydrated.eligibilityReasonCandidates.map(r => r.code);
      const originalReasonCodes = (original.eligibilityReasonCandidates || []).map(r => r.code);
      assert.deepEqual(hydratedReasonCodes.sort(), originalReasonCodes.sort(), `reasonCodes mismatch at index ${i}`);
    }
  }
});

test('tryPersistCandidatePool handles all persistence scenarios', async () => {
  const identity = buildCandidatePoolIdentity({
    openid: 'persist-test',
    clothes: largeWardrobe(),
    sceneKey: 'work',
    weather: { temp: 20, mode: 'live' },
    weatherMode: 'live',
    recommendationProfile: profile(),
    timeOfDay: 'all_day',
    engineVersion: 'test-version',
  });

  const mockCandidates = [{
    itemIds: ['top-0', 'bottom-0', 'shoe-0'],
    roleItemIds: { top: 'top-0', bottom: 'bottom-0', onepiece: '', outerwear: '', shoes: 'shoe-0' },
    itemFactRefs: [
      { itemId: 'top-0', slot: 'top', role: 'core' },
      { itemId: 'bottom-0', slot: 'bottom', role: 'core' },
      { itemId: 'shoe-0', slot: 'shoes', role: 'core' },
    ],
    archetype: 'top+bottom+shoes',
    eligibility: {
      weather: { pass: true, penalty: 0 },
      scene: { eligible: true, hardRejected: false, penalty: 0, sceneStrength: 'strong' },
      penalty: 0,
    },
    eligibilityReasonCandidates: [{ code: 'WORK_SIMPLE_TOP_PANTS_SHOES' }],
    eligibilityReason: { code: 'WORK_SIMPLE_TOP_PANTS_SHOES' },
    validatorRejectReasons: [],
    riskFlags: [],
    scoreBreakdown: { total: 8.5 },
    totalScore: 8.5,
    rankingScore: 8.5,
    outfitKey: 'bottom-0_shoe-0_top-0',
    selectionSignatures: {
      itemSignature: 'bottom-0_shoe-0_top-0',
      archetype: 'top+bottom+shoes',
      reasonCodeSignature: 'WORK_SIMPLE_TOP_PANTS_SHOES',
      titleSignature: 'work',
      tagSignature: '',
    },
  }];

  const writes = [];
  const oversizedDb = createDocumentDatabase({ writes });

  const result = await tryPersistCandidatePool({
    database: oversizedDb,
    candidatePoolId: 'batch:oversized',
    identity,
    candidates: Array.from({ length: 1000 }, () => ({ ...mockCandidates[0] })),
    now: Date.now(),
  });

  assert.equal(result.status, 'saved');
  assert.equal(result.candidatePoolId, 'batch:oversized');
  assert.ok(result.serializedBytes > CANDIDATE_POOL_MAX_BYTES);
  assert.ok(result.chunkCount > 1);
  assert.equal(writes.at(-1).data.recordType, 'manifest', 'manifest must be written last');
  assert.ok(writes.slice(0, -1).every((entry) => entry.data.recordType === 'chunk'));
  assert.ok(writes.every((entry) => !Object.hasOwn(entry.data, '_id')));
  assert.ok(writes.every((entry) => Buffer.byteLength(JSON.stringify(entry.data), 'utf8') <= CANDIDATE_POOL_MAX_BYTES));
  assert.ok(writes.every((entry) => entry.id.startsWith('pool-v2:')));
});

test('strict CloudBase mock accepts one, two, and four chunks without persisting _id', async () => {
  const identity = buildCandidatePoolIdentity({
    openid: 'strict-write-test',
    clothes: largeWardrobe(),
    sceneKey: 'work',
    weather: { temp: 20, mode: 'live' },
    weatherMode: 'live',
    recommendationProfile: profile(),
    timeOfDay: 'all_day',
    engineVersion: 'v6.1-test',
  });
  const candidate = {
    itemIds: ['top-0', 'bottom-0', 'shoe-0'],
    roleItemIds: { top: 'top-0', bottom: 'bottom-0', onepiece: '', outerwear: '', shoes: 'shoe-0' },
    itemFactRefs: [
      { itemId: 'top-0', slot: 'top', role: 'core' },
      { itemId: 'bottom-0', slot: 'bottom', role: 'core' },
      { itemId: 'shoe-0', slot: 'shoes', role: 'core' },
    ],
    archetype: 'top+bottom+shoes',
    eligibility: { weather: { pass: true }, scene: { eligible: true, hardRejected: false }, penalty: 0 },
    eligibilityReasonCandidates: [{ code: 'WORK_SIMPLE_TOP_PANTS_SHOES' }],
    totalScore: 8.5,
    rankingScore: 8.5,
    outfitKey: 'bottom-0_shoe-0_top-0',
    selectionSignatures: { itemSignature: 'bottom-0_shoe-0_top-0', archetype: 'top+bottom+shoes' },
  };

  await assert.rejects(
    createDocumentDatabase().collection('recommendation_candidate_pools').doc('strict-id').set({
      data: { _id: 'must-be-rejected', recordType: 'chunk' },
    }),
    (error) => error.errorCode === -501007,
  );

  for (const [chunkCount, candidateCount] of [[1, 100], [2, 320], [4, 800]]) {
    const sourceCandidates = Array.from({ length: candidateCount }, () => candidate);
    const pool = createCandidatePoolRecord({
      candidatePoolId: 'batch:strict-' + chunkCount,
      identity,
      candidates: sourceCandidates,
      now: 1000,
    });
    const plan = buildCandidatePoolStoragePlan(pool);
    assert.equal(plan.chunks.length, chunkCount);
    const writes = [];
    const database = createDocumentDatabase({ writes });
    const result = await tryPersistCandidatePool({
      database,
      candidatePoolId: pool.candidatePoolId,
      identity,
      candidates: sourceCandidates,
      now: 1000,
    });

    assert.equal(result.status, 'saved');
    assert.equal(writes.length, chunkCount + 1);
    assert.deepEqual(writes.map((entry) => entry.id), [
      ...plan.chunks.map((chunk) => chunk._id),
      plan.manifest._id,
    ]);
    assert.ok(writes.every((entry) => !Object.hasOwn(entry.data, '_id')));
    assert.ok(writes.slice(0, chunkCount).every((entry) => entry.data.recordType === 'chunk'));
    assert.equal(writes.at(-1).data.recordType, 'manifest');

    const retry = await tryPersistCandidatePool({
      database,
      candidatePoolId: pool.candidatePoolId,
      identity,
      candidates: sourceCandidates,
      now: 1000,
    });
    assert.equal(retry.status, 'saved');
    const loaded = await loadCandidatePool({
      database,
      candidatePoolId: pool.candidatePoolId,
      identity,
      now: 1001,
    });
    assert.equal(loaded.hit, true);
    assert.equal(loaded.pool.candidates.length, sourceCandidates.length);
  }
});

test('strict CloudBase mock cleans already-written chunks after a mid-write failure', async () => {
  const identity = buildCandidatePoolIdentity({
    openid: 'strict-cleanup-test',
    clothes: largeWardrobe(),
    sceneKey: 'work',
    weather: { temp: 20, mode: 'live' },
    weatherMode: 'live',
    recommendationProfile: profile(),
    timeOfDay: 'all_day',
    engineVersion: 'v6.1-test',
  });
  const candidate = {
    itemIds: ['top-0', 'bottom-0', 'shoe-0'],
    roleItemIds: { top: 'top-0', bottom: 'bottom-0', onepiece: '', outerwear: '', shoes: 'shoe-0' },
    itemFactRefs: [
      { itemId: 'top-0', slot: 'top', role: 'core' },
      { itemId: 'bottom-0', slot: 'bottom', role: 'core' },
      { itemId: 'shoe-0', slot: 'shoes', role: 'core' },
    ],
    archetype: 'top+bottom+shoes',
    eligibility: { weather: { pass: true }, scene: { eligible: true, hardRejected: false }, penalty: 0 },
    eligibilityReasonCandidates: [{ code: 'WORK_SIMPLE_TOP_PANTS_SHOES' }],
    totalScore: 8.5,
    rankingScore: 8.5,
    outfitKey: 'bottom-0_shoe-0_top-0',
    selectionSignatures: { itemSignature: 'bottom-0_shoe-0_top-0', archetype: 'top+bottom+shoes' },
  };
  const database = createDocumentDatabase({ failAt: 1, failure: new Error('middle write failed') });
  const result = await tryPersistCandidatePool({
    database,
    candidatePoolId: 'batch:strict-cleanup',
    identity,
    candidates: Array.from({ length: 500 }, () => candidate),
    now: 1000,
  });

  assert.equal(result.status, 'write_failed');
  assert.equal(result.cleanupAttempted, true);
  assert.equal(result.cleanupDeletedCount, result.chunkCount - 1);
  const loaded = await loadCandidatePool({
    database,
    candidatePoolId: 'batch:strict-cleanup',
    identity,
    now: 1001,
  });
  assert.equal(loaded.hit, false);
  assert.equal(loaded.reason, 'not_found');
});

test('deterministic V2 writes are retry and concurrent safe', async () => {
  const identity = buildCandidatePoolIdentity({
    openid: 'persist-retry-test',
    clothes: largeWardrobe(),
    sceneKey: 'work',
    weather: { temp: 20, mode: 'live' },
    weatherMode: 'live',
    recommendationProfile: profile(),
    timeOfDay: 'all_day',
    engineVersion: 'v6.1-test',
  });
  const candidates = [{
    itemIds: ['top-0', 'bottom-0', 'shoe-0'],
    roleItemIds: { top: 'top-0', bottom: 'bottom-0', onepiece: '', outerwear: '', shoes: 'shoe-0' },
    itemFactRefs: [
      { itemId: 'top-0', slot: 'top', role: 'core' },
      { itemId: 'bottom-0', slot: 'bottom', role: 'core' },
      { itemId: 'shoe-0', slot: 'shoes', role: 'core' },
    ],
    archetype: 'top+bottom+shoes',
    eligibility: { weather: { pass: true, penalty: 0 }, scene: { eligible: true, hardRejected: false, penalty: 0, sceneStrength: 'strong' }, penalty: 0 },
    eligibilityReasonCandidates: [{ code: 'WORK_SIMPLE_TOP_PANTS_SHOES' }],
    totalScore: 8.5,
    rankingScore: 8.5,
    outfitKey: 'bottom-0_shoe-0_top-0',
    selectionSignatures: { itemSignature: 'bottom-0_shoe-0_top-0', archetype: 'top+bottom+shoes', reasonCodeSignature: 'WORK_SIMPLE_TOP_PANTS_SHOES', titleSignature: 'work', tagSignature: '' },
  }];
  const writes = [];
  const database = createDocumentDatabase({ writes });
  const request = () => tryPersistCandidatePool({ database, candidatePoolId: 'batch:retry-safe', identity, candidates, now: 1000 });
  const [first, second] = await Promise.all([request(), request()]);
  assert.equal(first.status, 'saved');
  assert.equal(second.status, 'saved');
  const retry = await request();
  assert.equal(retry.status, 'saved');
  assert.ok(writes.every((record) => record.id.startsWith('pool-v2:')));
  assert.ok(writes.every((record) => !Object.hasOwn(record.data, '_id')));
  assert.equal(writes.filter((record) => record.data.recordType === 'manifest').length, 3);
  const loaded = await loadCandidatePool({ database, candidatePoolId: 'batch:retry-safe', identity, now: 1001 });
  assert.equal(loaded.hit, true);
  assert.equal(loaded.pool.candidates.length, candidates.length);
});

test('tryPersistCandidatePool handles database write failure', async () => {
  const identity = buildCandidatePoolIdentity({
    openid: 'persist-test',
    clothes: largeWardrobe(),
    sceneKey: 'work',
    weather: { temp: 20, mode: 'live' },
    weatherMode: 'live',
    recommendationProfile: profile(),
    timeOfDay: 'all_day',
    engineVersion: 'test-version',
  });

  const mockCandidates = [{
    itemIds: ['top-0', 'bottom-0', 'shoe-0'],
    roleItemIds: { top: 'top-0', bottom: 'bottom-0', onepiece: '', outerwear: '', shoes: 'shoe-0' },
    itemFactRefs: [
      { itemId: 'top-0', slot: 'top', role: 'core' },
      { itemId: 'bottom-0', slot: 'bottom', role: 'core' },
      { itemId: 'shoe-0', slot: 'shoes', role: 'core' },
    ],
    archetype: 'top+bottom+shoes',
    eligibility: {
      weather: { pass: true, penalty: 0 },
      scene: { eligible: true, hardRejected: false, penalty: 0, sceneStrength: 'strong' },
      penalty: 0,
    },
    eligibilityReasonCandidates: [{ code: 'WORK_SIMPLE_TOP_PANTS_SHOES' }],
    eligibilityReason: { code: 'WORK_SIMPLE_TOP_PANTS_SHOES' },
    validatorRejectReasons: [],
    riskFlags: [],
    scoreBreakdown: { total: 8.5 },
    totalScore: 8.5,
    rankingScore: 8.5,
    outfitKey: 'bottom-0_shoe-0_top-0',
    selectionSignatures: {
      itemSignature: 'bottom-0_shoe-0_top-0',
      archetype: 'top+bottom+shoes',
      reasonCodeSignature: 'WORK_SIMPLE_TOP_PANTS_SHOES',
      titleSignature: 'work',
      tagSignature: '',
    },
  }];

  const failingDb = createDocumentDatabase({ failAt: 0, failure: new Error('database error') });

  const result = await tryPersistCandidatePool({
    database: failingDb,
    candidatePoolId: 'batch:fail',
    identity,
    candidates: mockCandidates,
    now: Date.now(),
  });

  assert.equal(result.status, 'write_failed');
  assert.equal(result.candidatePoolId, null);
});

test('tryPersistCandidatePool handles database timeout', async () => {
  const identity = buildCandidatePoolIdentity({
    openid: 'persist-test',
    clothes: largeWardrobe(),
    sceneKey: 'work',
    weather: { temp: 20, mode: 'live' },
    weatherMode: 'live',
    recommendationProfile: profile(),
    timeOfDay: 'all_day',
    engineVersion: 'test-version',
  });

  const mockCandidates = [{
    itemIds: ['top-0', 'bottom-0', 'shoe-0'],
    roleItemIds: { top: 'top-0', bottom: 'bottom-0', onepiece: '', outerwear: '', shoes: 'shoe-0' },
    itemFactRefs: [
      { itemId: 'top-0', slot: 'top', role: 'core' },
      { itemId: 'bottom-0', slot: 'bottom', role: 'core' },
      { itemId: 'shoe-0', slot: 'shoes', role: 'core' },
    ],
    archetype: 'top+bottom+shoes',
    eligibility: {
      weather: { pass: true, penalty: 0 },
      scene: { eligible: true, hardRejected: false, penalty: 0, sceneStrength: 'strong' },
      penalty: 0,
    },
    eligibilityReasonCandidates: [{ code: 'WORK_SIMPLE_TOP_PANTS_SHOES' }],
    eligibilityReason: { code: 'WORK_SIMPLE_TOP_PANTS_SHOES' },
    validatorRejectReasons: [],
    riskFlags: [],
    scoreBreakdown: { total: 8.5 },
    totalScore: 8.5,
    rankingScore: 8.5,
    outfitKey: 'bottom-0_shoe-0_top-0',
    selectionSignatures: {
      itemSignature: 'bottom-0_shoe-0_top-0',
      archetype: 'top+bottom+shoes',
      reasonCodeSignature: 'WORK_SIMPLE_TOP_PANTS_SHOES',
      titleSignature: 'work',
      tagSignature: '',
    },
  }];

  const timeoutDb = createDocumentDatabase({ failAt: 0, failure: new Error('ETIMEDOUT') });

  const result = await tryPersistCandidatePool({
    database: timeoutDb,
    candidatePoolId: 'batch:timeout',
    identity,
    candidates: mockCandidates,
    now: Date.now(),
  });

  assert.equal(result.status, 'write_timeout');
  assert.equal(result.candidatePoolId, null);
});

test('tryPersistCandidatePool handles database timeout by code', async () => {
  const identity = buildCandidatePoolIdentity({
    openid: 'persist-test',
    clothes: largeWardrobe(),
    sceneKey: 'work',
    weather: { temp: 20, mode: 'live' },
    weatherMode: 'live',
    recommendationProfile: profile(),
    timeOfDay: 'all_day',
    engineVersion: 'test-version',
  });

  const mockCandidates = [{
    itemIds: ['top-0', 'bottom-0', 'shoe-0'],
    roleItemIds: { top: 'top-0', bottom: 'bottom-0', onepiece: '', outerwear: '', shoes: 'shoe-0' },
    archetype: 'top+bottom+shoes',
    eligibility: {
      weather: { pass: true, penalty: 0 },
      scene: { eligible: true, hardRejected: false, penalty: 0, sceneStrength: 'strong' },
      penalty: 0,
    },
    eligibilityReasonCandidates: [{ code: 'WORK_SIMPLE_TOP_PANTS_SHOES' }],
    totalScore: 8.5,
    rankingScore: 8.5,
    outfitKey: 'bottom-0_shoe-0_top-0',
    selectionSignatures: {
      itemSignature: 'bottom-0_shoe-0_top-0',
      archetype: 'top+bottom+shoes',
      reasonCodeSignature: 'WORK_SIMPLE_TOP_PANTS_SHOES',
      titleSignature: 'work',
      tagSignature: '',
    },
  }];

  const timeoutError = new Error('connection timeout');
  timeoutError.code = 'ETIMEDOUT';
  const timeoutDb = createDocumentDatabase({ failAt: 0, failure: timeoutError });

  const result = await tryPersistCandidatePool({
    database: timeoutDb,
    candidatePoolId: 'batch:timeout-code',
    identity,
    candidates: mockCandidates,
    now: Date.now(),
  });

  assert.equal(result.status, 'write_timeout');
  assert.equal(result.candidatePoolId, null);
});

test('V2 manifest and chunks round-trip a real 320-candidate UTF-8 pool', async () => {
  const identity = buildCandidatePoolIdentity({
    openid: 'roundtrip-user',
    clothes: largeWardrobe(),
    sceneKey: 'home',
    weather: { temp: 22, mode: 'live' },
    weatherMode: 'live',
    recommendationProfile: profile(),
    timeOfDay: 'all_day',
    engineVersion: 'v6.1-test',
  });
  const base = {
    itemIds: ['top-0', 'bottom-0', 'shoe-0'],
    roleItemIds: { top: 'top-0', bottom: 'bottom-0', onepiece: '', outerwear: '', shoes: 'shoe-0' },
    itemFactRefs: [
      { itemId: 'top-0', slot: 'top', role: 'core' },
      { itemId: 'bottom-0', slot: 'bottom', role: 'core' },
      { itemId: 'shoe-0', slot: 'shoes', role: 'core' },
    ],
    archetype: 'top+bottom+shoes',
    eligibility: { weather: { pass: true, penalty: 0 }, scene: { eligible: true, hardRejected: false, penalty: 0, sceneStrength: 'strong' }, penalty: 0 },
    eligibilityReasonCandidates: [{ code: 'WORK_SIMPLE_TOP_PANTS_SHOES' }],
    totalScore: 8.5,
    rankingScore: 8.5,
    selectionSignatures: { itemSignature: '', archetype: 'top+bottom+shoes', reasonCodeSignature: 'WORK_SIMPLE_TOP_PANTS_SHOES', titleSignature: 'home', tagSignature: 'simple' },
  };
  const candidates = Array.from({ length: 320 }, (_, index) => ({
    ...base,
    itemIds: [`top-${index}`, `bottom-${index}`, `shoe-${index}`],
    roleItemIds: { top: `top-${index}`, bottom: `bottom-${index}`, onepiece: '', outerwear: '', shoes: `shoe-${index}` },
    itemFactRefs: [
      { itemId: `top-${index}`, slot: 'top', role: 'core' },
      { itemId: `bottom-${index}`, slot: 'bottom', role: 'core' },
      { itemId: `shoe-${index}`, slot: 'shoes', role: 'core' },
    ],
    outfitKey: `candidate-${index}`,
    title: `居家组合 ${index}`,
    styleTags: ['simple', 'home'],
    todayReason: `今天适合居家活动 ${index} ${'舒适搭配。'.repeat(20)}`,
    copyContract: { todayReason: `今天适合居家活动 ${index}`, title: `居家组合 ${index}`, reuseExplanation: 'quality_tradeoff_too_large' },
    selectionSignatures: { ...base.selectionSignatures, itemSignature: `candidate-${index}` },
  }));
  const pool = createCandidatePoolRecord({ candidatePoolId: 'batch:roundtrip-320', identity, candidates, now: 1000 });
  const plan = buildCandidatePoolStoragePlan(pool);
  assert.ok(plan.serializedBytes > CANDIDATE_POOL_MAX_BYTES, `fixture should require chunking: ${plan.serializedBytes}`);
  assert.ok(plan.chunks.length > 1);
  assert.ok(plan.chunks.every((chunk) => Buffer.byteLength(JSON.stringify(chunk), 'utf8') <= CANDIDATE_POOL_MAX_BYTES));

  const records = [...plan.chunks, plan.manifest];
  const database = createDocumentDatabase({ records });
  const loaded = await loadCandidatePool({ database, candidatePoolId: pool.candidatePoolId, identity, now: 2000 });
  assert.equal(loaded.hit, true);
  assert.equal(loaded.pool.candidates.length, 320);
  assert.equal(loaded.pool.checksum, pool.checksum);
  for (const index of [0, 159, 319]) {
    const hydrated = hydrateCandidateCore(loaded.pool.candidates[index], { reasonDescriptorForCode: () => ({ code: 'WORK_SIMPLE_TOP_PANTS_SHOES' }) });
    assert.equal(hydrated.outfitKey, candidates[index].outfitKey);
    assert.equal(hydrated.rankingScore, candidates[index].rankingScore);
    assert.equal(Object.hasOwn(hydrated, 'title'), false, 'title must be rebuilt from facts');
    assert.equal(Object.hasOwn(hydrated, 'todayReason'), false, 'todayReason must be rebuilt from reason code');
    assert.equal(Object.hasOwn(hydrated, 'copyContract'), false, 'copy contract must not be persisted');
  }

  const legacyV2Candidates = plan.chunks.flatMap((chunk) => chunk.candidates);
  const legacyV2Checksum = legacyCandidateChecksum(legacyV2Candidates);
  const legacyV2Records = records.map((record) => {
    const { checksumAlgorithm: ignoredChecksumAlgorithm, ...legacyRecord } = record;
    void ignoredChecksumAlgorithm;
    return record.recordType === 'chunk'
      ? {
        ...legacyRecord,
        checksum: legacyV2Checksum,
        chunkChecksum: legacyCandidateChecksum(record.candidates),
      }
      : { ...legacyRecord, checksum: legacyV2Checksum };
  });
  const legacyV2Database = createDocumentDatabase({ records: legacyV2Records });
  const legacyV2Result = await loadCandidatePool({
    database: legacyV2Database,
    candidatePoolId: pool.candidatePoolId,
    identity,
    now: 2000,
  });
  assert.equal(legacyV2Result.hit, true, 'V2 records without checksumAlgorithm must keep using the legacy stable checksum');

  const legacy = records.map((record) => ({ ...record, schemaVersion: 1, version: 'candidate-pool-v1' }));
  const legacyDatabase = createDocumentDatabase({ records: legacy });
  const legacyResult = await loadCandidatePool({ database: legacyDatabase, candidatePoolId: pool.candidatePoolId, identity, now: 2000 });
  assert.equal(legacyResult.hit, false);

  const missingChunkRecords = records.slice(1);
  const missingDatabase = createDocumentDatabase({ records: missingChunkRecords });
  const missingResult = await loadCandidatePool({ database: missingDatabase, candidatePoolId: pool.candidatePoolId, identity, now: 2000 });
  assert.equal(missingResult.hit, false);
  assert.equal(missingResult.reason, 'chunks_missing');

  const loadRecords = async (nextRecords, nextIdentity = identity, nextNow = 2000) => {
    const database = createDocumentDatabase({ records: nextRecords });
    return loadCandidatePool({ database, candidatePoolId: pool.candidatePoolId, identity: nextIdentity, now: nextNow });
  };

  const checksumBroken = records.map((record) => ({ ...record }));
  checksumBroken[0].candidates = [{ ...checksumBroken[0].candidates[0], outfitKey: 'tampered' }, ...checksumBroken[0].candidates.slice(1)];
  const checksumResult = await loadRecords(checksumBroken);
  assert.equal(checksumResult.hit, false);
  assert.equal(checksumResult.reason, 'chunk_invalid');

  const manifestChecksumBroken = records.map((record) => ({ ...record }));
  const manifestRecord = manifestChecksumBroken.find((record) => record.recordType === 'manifest');
  manifestRecord.checksum = 'broken-checksum';
  const manifestChecksumResult = await loadRecords(manifestChecksumBroken);
  assert.equal(manifestChecksumResult.hit, false);
  assert.equal(manifestChecksumResult.reason, 'chunk_invalid');

  const outOfOrder = records.map((record) => ({ ...record }));
  const chunks = outOfOrder.filter((record) => record.recordType === 'chunk');
  [chunks[0].chunkIndex, chunks[1].chunkIndex] = [chunks[1].chunkIndex, chunks[0].chunkIndex];
  const orderResult = await loadRecords(outOfOrder);
  assert.equal(orderResult.hit, false);
  assert.equal(orderResult.reason, 'checksum_mismatch');

  const expired = records.map((record) => ({ ...record, expiresAtMs: 1900, expiresAt: new Date(1900).toISOString() }));
  const expiredResult = await loadRecords(expired, identity, 2000);
  assert.equal(expiredResult.hit, false);
  assert.equal(expiredResult.reason, 'expired');

  const identityBroken = records.map((record) => record.recordType === 'manifest'
    ? { ...record, identity: { ...record.identity, identityHash: 'different-identity' } }
    : { ...record });
  const identityResult = await loadRecords(identityBroken);
  assert.equal(identityResult.hit, false);
  assert.equal(identityResult.reason, 'identity_changed');

  const duplicateChunkResult = await loadRecords([
    ...records,
    { ...records.find((record) => record.recordType === 'chunk'), _id: 'legacy-duplicate-chunk' },
  ]);
  assert.equal(duplicateChunkResult.hit, false);
  assert.equal(duplicateChunkResult.reason, 'chunks_missing');
});
