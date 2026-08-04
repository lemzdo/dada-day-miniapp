const assert = require('node:assert/strict');
const test = require('node:test');

const {
  CANDIDATE_POOL_LOOKUP_INDEX,
  CANDIDATE_POOL_MAX_BYTES,
  CANDIDATE_POOL_SCHEMA_VERSION,
  CANDIDATE_POOL_VERSION,
  CANDIDATE_POOL_TTL_MS,
  buildCandidatePoolIdentity,
  createCandidatePoolRecord,
  getReasonSelectionDescriptor,
  hydrateCandidateCore,
  validateCandidatePool,
} = require('./candidatePool');
const { ELIGIBILITY_REASON_CATALOG } = require('./recommendationEligibilityReason');

function identity(overrides = {}) {
  return buildCandidatePoolIdentity({
    openid: 'user-a',
    clothes: [
      { _id: 'top-a', updatedAt: '2026-07-20T08:00:00.000Z' },
      { _id: 'bottom-a', updatedAt: '2026-07-20T08:00:00.000Z' },
      { _id: 'shoe-a', updatedAt: '2026-07-20T08:00:00.000Z' },
    ],
    sceneKey: 'work',
    weather: { mode: 'live', temp: 27, condition: 'clear' },
    weatherMode: 'live',
    recommendationProfile: { styleTags: ['简约'], colorPreference: ['黑色'] },
    timeOfDay: 'all_day',
    engineVersion: 'generateOutfit-recommendation-v6-1-title-invariant-fix-20260724',
    ...overrides,
  });
}

function candidate() {
  return {
    itemIds: ['top-a', 'bottom-a', 'shoe-a', 'accessory-a'],
    roleItemIds: { top: 'top-a', bottom: 'bottom-a', onepiece: '', outerwear: '', shoes: 'shoe-a' },
    itemFactRefs: [
      { itemId: 'top-a', slot: 'top', role: 'core' },
      { itemId: 'bottom-a', slot: 'bottom', role: 'core' },
      { itemId: 'shoe-a', slot: 'shoes', role: 'core' },
      { itemId: 'accessory-a', slot: 'accessory', role: 'optional' },
    ],
    archetype: 'top+bottom+shoes',
    eligibility: {
      weather: { pass: true, penalty: 0, rejectReasons: [], warningReasons: [], evidence: [{ forbidden: true }] },
      scene: {
        eligible: true,
        hardRejected: false,
        penalty: 0,
        acceptReasons: ['WORK_QUALIFIED_SHOE'],
        rejectReasons: [],
        warnings: [],
        sceneStrength: 'strong',
        evidence: [{ forbidden: true }],
      },
      penalty: 0,
    },
    eligibilityReasonCandidates: [{ code: 'WORK_SIMPLE_TOP_PANTS_SHOES' }],
    eligibilityReason: { code: 'WORK_SIMPLE_TOP_PANTS_SHOES' },
    validatorRejectReasons: [],
    riskFlags: [],
    scoreBreakdown: { total: 8.5, styleUnity: 8 },
    totalScore: 8.5,
    rankingScore: 8.5,
    outfitKey: 'bottom-a_shoe-a_top-a',
    selectionSignatures: {
      itemSignature: 'bottom-a_shoe-a_top-a',
      archetype: 'top+bottom+shoes',
      reasonCodeSignature: 'WORK_SIMPLE_TOP_PANTS_SHOES',
      titleSignature: 'work',
      tagSignature: '简约',
    },
    derivedFacts: { shouldNotPersist: true },
    items: [{ imageUrl: 'cloud://private' }],
  };
}

test('candidate pool identity changes for every input that invalidates candidate reuse', () => {
  const base = identity();
  assert.notEqual(identity({ openid: 'user-b' }).identityHash, base.identityHash);
  assert.notEqual(identity({ sceneKey: 'date' }).identityHash, base.identityHash);
  assert.notEqual(identity({ weatherMode: 'disabled', weather: { mode: 'disabled' } }).identityHash, base.identityHash);
  assert.notEqual(identity({ recommendationProfile: { styleTags: ['复古'] } }).identityHash, base.identityHash);
  assert.notEqual(identity({ timeOfDay: 'night' }).identityHash, base.identityHash);
  assert.notEqual(identity({ engineVersion: 'next-build' }).identityHash, base.identityHash);
  assert.notEqual(identity({ clothes: [{ _id: 'top-a', updatedAt: '2026-07-21T08:00:00.000Z' }] }).identityHash, base.identityHash);
});

test('candidate pool compacts reconstructible fields while preserving the hydrated contract', () => {
  const pool = createCandidatePoolRecord({
    candidatePoolId: 'batch:pool-test',
    identity: identity(),
    candidates: [candidate()],
    now: 1000,
  });
  const entry = pool.candidates[0];
  for (const key of ['archetype', 'eligibility', 'itemFactRefs', 'rankingScore', 'reasonCodes', 'scores', 'selectionSignatures', 'totalScore']) {
    assert.ok(Object.hasOwn(entry, key), `${key} must be retained`);
  }
  for (const key of ['itemIds', 'itemRoles', 'roleItemIds', 'stableSortId']) {
    assert.equal(Object.hasOwn(entry, key), false, `${key} must not be duplicated in storage`);
  }
  const hydrated = hydrateCandidateCore(entry, {
    reasonDescriptorForCode: (code) => getReasonSelectionDescriptor(code, ELIGIBILITY_REASON_CATALOG),
  });
  for (const key of ['itemIds', 'roleItemIds']) {
    assert.ok(Object.hasOwn(hydrated, key), `${key} must remain available after hydration`);
  }
  assert.equal(hydrated.outfitKey, candidate().outfitKey, 'outfitKey remains the stable candidate identity');
  assert.equal(JSON.stringify(pool).includes('cloud://private'), false);
  assert.equal(JSON.stringify(pool).includes('derivedFacts'), false, 'derived facts are rebuilt from wardrobe');
  assert.equal(JSON.stringify(pool).includes('visibleFacts'), false, 'visible facts are rebuilt from wardrobe');
  assert.equal(JSON.stringify(pool).toLowerCase().includes('openid'), false);
  assert.equal(pool.schemaVersion, CANDIDATE_POOL_SCHEMA_VERSION);
  assert.equal(pool.version, CANDIDATE_POOL_VERSION);
  assert.deepEqual(CANDIDATE_POOL_LOOKUP_INDEX, ['ownerHash', 'candidatePoolId', 'recordType', 'schemaVersion']);
});

test('candidate pool logical record accepts oversize pools for chunk planning', () => {
  const pool = createCandidatePoolRecord({
    candidatePoolId: 'batch:oversized',
    identity: identity(),
    candidates: Array.from({ length: 1000 }, candidate),
    now: 1000,
  });
  assert.ok(Buffer.byteLength(JSON.stringify(pool), 'utf8') > CANDIDATE_POOL_MAX_BYTES);
  assert.ok(pool.chunkCount > 1);
});

test('candidate pool refuses rejected or unscored candidates', () => {
  const rejected = candidate();
  rejected.eligibility.scene.eligible = false;
  rejected.eligibility.scene.hardRejected = true;
  assert.throws(() => createCandidatePoolRecord({
    candidatePoolId: 'batch:rejected', identity: identity(), candidates: [rejected], now: 1000,
  }), /accepted scored cores/);
});

test('candidate pool validates user isolation, identity changes, expiry, and corrupt entries', () => {
  const baseIdentity = identity();
  const pool = createCandidatePoolRecord({ candidatePoolId: 'batch:pool-test', identity: baseIdentity, candidates: [candidate()], now: 1000 });
  assert.deepEqual(validateCandidatePool(pool, baseIdentity, 1001), { ok: true, ageMs: 1 });
  assert.equal(validateCandidatePool(pool, identity({ openid: 'user-b' }), 1001).reason, 'user_mismatch');
  assert.equal(validateCandidatePool(pool, identity({ sceneKey: 'date' }), 1001).reason, 'identity_changed');
  assert.equal(validateCandidatePool(pool, baseIdentity, 1000 + CANDIDATE_POOL_TTL_MS + 1).reason, 'expired');
  assert.equal(validateCandidatePool({ ...pool, candidates: [{ stableSortId: 'broken' }] }, baseIdentity, 1001).reason, 'pool_corrupt');
});

test('pool candidates rehydrate with catalog metadata but without stored facts or copy', () => {
  const pool = createCandidatePoolRecord({ candidatePoolId: 'batch:pool-test', identity: identity(), candidates: [candidate()], now: 1000 });
  const core = hydrateCandidateCore(pool.candidates[0], {
    reasonDescriptorForCode: (code) => getReasonSelectionDescriptor(code, ELIGIBILITY_REASON_CATALOG),
  });
  assert.deepEqual(core.itemFactRefs, [
    { itemId: 'top-a', slot: 'top', role: 'core' },
    { itemId: 'bottom-a', slot: 'bottom', role: 'core' },
    { itemId: 'shoe-a', slot: 'shoes', role: 'core' },
    { itemId: 'accessory-a', slot: 'accessory', role: 'optional' },
  ]);
  assert.equal(core.eligibilityReasonCandidates[0].code, 'WORK_SIMPLE_TOP_PANTS_SHOES');
  assert.equal(Object.hasOwn(core, 'items'), false);
  assert.equal(Object.hasOwn(core, 'derivedFacts'), false);
});

test('V2 pool hydration ignores legacy missing, empty, or invalid title fields', () => {
  const pool = createCandidatePoolRecord({
    candidatePoolId: 'batch:legacy-v2-title',
    identity: identity(),
    candidates: [candidate()],
    now: 1000,
  });
  const variants = [
    { ...pool.candidates[0] },
    { ...pool.candidates[0], title: '' },
    { ...pool.candidates[0], title: { invalid: true } },
    { ...pool.candidates[0], displayTitle: '', userTitle: '旧自定义标题' },
  ];
  const hydrated = variants.map((entry) => hydrateCandidateCore(entry, {
    reasonDescriptorForCode: (code) => getReasonSelectionDescriptor(code, ELIGIBILITY_REASON_CATALOG),
  }));

  assert.equal(pool.schemaVersion, 2);
  assert.equal(hydrated.every((entry) => entry.outfitKey === candidate().outfitKey), true);
  assert.equal(hydrated.every((entry) => !Object.hasOwn(entry, 'title')), true);
  assert.equal(hydrated.every((entry) => !Object.hasOwn(entry, 'displayTitle')), true);
  assert.equal(hydrated.every((entry) => !Object.hasOwn(entry, 'userTitle')), true);
});
