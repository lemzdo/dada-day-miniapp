const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildCandidatePoolIdentity,
  buildCandidatePoolProjectionProfile,
  buildCandidatePoolStoragePlan,
  createCandidatePoolRecord,
  tryPersistCandidatePool,
} = require('./candidatePool');

function createLogger() {
  const entries = [];
  const write = (level) => (label, payload) => entries.push({ level, label, payload });
  return {
    entries,
    logger: { log: write('log'), info: write('info'), warn: write('warn'), error: write('error') },
  };
}

function identity() {
  return buildCandidatePoolIdentity({
    openid: 'diagnostics-user',
    clothes: [],
    sceneKey: 'sport',
    weather: { mode: 'mock', temp: 20 },
    recommendationProfile: {},
    timeOfDay: 'all_day',
    engineVersion: 'diagnostics-test',
  });
}

function candidate(index, payloadBytes = 0) {
  return {
    itemIds: [`item-${index}`],
    roleItemIds: { top: `item-${index}`, bottom: '', onepiece: '', outerwear: '', shoes: '' },
    itemFactRefs: [{ itemId: `item-${index}`, slot: 'top', role: 'core' }],
    archetype: 'top',
    eligibility: { scene: { eligible: true, hardRejected: false }, weather: { pass: true } },
    eligibilityReasonCandidates: [{ code: 'SPORT_SAFE' }],
    eligibilityReason: { code: 'SPORT_SAFE' },
    totalScore: 1,
    rankingScore: 1,
    outfitKey: `item-${index}`,
    selectionSignatures: { itemSignature: `item-${index}` },
    ...(payloadBytes ? { diagnosticPayload: 'x'.repeat(payloadBytes) } : {}),
  };
}

function candidatesForChunks() {
  return Array.from({ length: 1200 }, (_, index) => candidate(index, 90_000));
}

function databaseThatFailsAt(failAt, error) {
  let setCount = 0;
  const store = new Map();
  return {
    collection: () => ({
      doc: (id) => ({
        set: async ({ data }) => {
          if (Object.hasOwn(data || {}, '_id')) {
            const cloudBaseError = new Error('cannot update _id');
            cloudBaseError.errorCode = -501007;
            throw cloudBaseError;
          }
          const current = setCount;
          setCount += 1;
          if (current === failAt) throw error;
          store.set(id, { ...data, _id: id });
          return { id };
        },
        get: async () => ({ data: store.get(id) || null }),
        remove: async () => {},
      }),
      where: () => ({ get: async () => ({ data: [] }) }),
    }),
  };
}

function writeError(entries) {
  return entries.find((entry) => entry.label === '[CandidatePoolWriteError]')?.payload;
}

test('chunk 0 failure records the failed index and cleans concurrent sibling chunks', async () => {
  const { entries, logger } = createLogger();
  const result = await tryPersistCandidatePool({
    database: databaseThatFailsAt(0, Object.assign(new Error('duplicate key'), { code: 'DUPLICATE_KEY' })),
    candidatePoolId: 'pool-secret-0',
    identity: identity(),
    candidates: candidatesForChunks(),
    auditId: 'rec_diag_chunk_0',
    logger,
  });

  const payload = writeError(entries);
  assert.equal(result.status, 'write_failed');
  assert.equal(payload.stage, 'chunk');
  assert.equal(payload.chunkIndex, 0);
  assert.equal(payload.successfulChunkCount, payload.chunkCount - 1);
  assert.equal(payload.orphanChunkCount, payload.chunkCount - 1);
  assert.equal(payload.errorCode, 'DUPLICATE_KEY');
  assert.ok(payload.documentBytes > 0);
  assert.deepEqual(
    entries.find((entry) => entry.label === '[CandidatePoolChunkIndex]').payload.indexFieldNames,
    ['ownerHash', 'candidatePoolId', 'recordType', 'schemaVersion'],
  );
});

test('middle chunk failure records successful concurrent siblings and orphan count', async () => {
  const { entries, logger } = createLogger();
  const result = await tryPersistCandidatePool({
    database: databaseThatFailsAt(1, Object.assign(new Error('unique constraint'), { errorCode: 'UNIQUE_CONSTRAINT' })),
    candidatePoolId: 'pool-secret-middle',
    identity: identity(),
    candidates: candidatesForChunks(),
    auditId: 'rec_diag_chunk_middle',
    logger,
  });

  const payload = writeError(entries);
  assert.equal(result.status, 'write_failed');
  assert.equal(payload.stage, 'chunk');
  assert.equal(payload.chunkIndex, 1);
  assert.equal(payload.successfulChunkCount, payload.chunkCount - 1);
  assert.equal(payload.orphanChunkCount, payload.chunkCount - 1);
  assert.ok(payload.chunkCount > 2);
});

test('manifest failure records all chunks successful and manifest unwritten', async () => {
  const { entries, logger } = createLogger();
  const candidates = candidatesForChunks();
  const pool = createCandidatePoolRecord({ candidatePoolId: 'pool-secret-manifest', identity: identity(), candidates });
  const plan = buildCandidatePoolStoragePlan(pool);
  const result = await tryPersistCandidatePool({
    database: databaseThatFailsAt(plan.chunks.length, Object.assign(new Error('manifest duplicate'), { errCode: 'DUPLICATE' })),
    candidatePoolId: 'pool-secret-manifest',
    identity: identity(),
    candidates,
    auditId: 'rec_diag_manifest',
    logger,
  });

  const payload = writeError(entries);
  assert.equal(result.status, 'write_failed');
  assert.equal(payload.stage, 'manifest');
  assert.equal(payload.chunkIndex, null);
  assert.equal(payload.successfulChunkCount, plan.chunks.length);
  assert.equal(payload.orphanChunkCount, plan.chunks.length);
  assert.equal(payload.manifestWritten, false);
});

test('SDK error code/message are retained after removing values, ids, urls, and documents', async () => {
  const { entries, logger } = createLogger();
  const error = Object.assign(new Error('duplicate candidatePoolId=pool-secret itemId=item-0 https://private.example/a'), {
    errorCode: 'E_UNIQUE',
    errorMessage: 'duplicate candidatePoolId=pool-secret itemId=item-0 https://private.example/a',
  });
  await tryPersistCandidatePool({
    database: databaseThatFailsAt(0, error),
    candidatePoolId: 'pool-secret',
    identity: identity(),
    candidates: [candidate(0)],
    auditId: 'rec_diag_redaction',
    logger,
  });

  const payload = writeError(entries);
  const serialized = JSON.stringify(payload);
  assert.equal(payload.errorCode, 'E_UNIQUE');
  assert.equal(payload.errorMessage.includes('duplicate'), true);
  assert.equal(serialized.includes('pool-secret'), false);
  assert.equal(serialized.includes('item-0'), false);
  assert.equal(serialized.includes('private.example'), false);
  assert.equal(payload.errorMessage.length <= 500, true);
});

test('write diagnostics do not contain ids, urls, or document content', async () => {
  const { entries, logger } = createLogger();
  await tryPersistCandidatePool({
    database: databaseThatFailsAt(0, new Error(JSON.stringify({ itemId: 'item-0', imageUrl: 'https://private.example/a', material: 'cotton' }))),
    candidatePoolId: 'pool-secret-document',
    identity: identity(),
    candidates: [candidate(0)],
    auditId: 'rec_diag_document',
    logger,
  });
  const serialized = JSON.stringify(entries);
  assert.equal(serialized.includes('item-0'), false);
  assert.equal(serialized.includes('https://private.example'), false);
  assert.equal(serialized.includes('cotton'), false);
  assert.equal(serialized.includes('pool-secret-document'), false);
  assert.equal(serialized.includes('diagnosticPayload'), false);
});

test('successful path emits exactly one WriteDone and preserves saved result', async () => {
  const { entries, logger } = createLogger();
  const candidates = [candidate(0), candidate(1)];
  const result = await tryPersistCandidatePool({
    database: databaseThatFailsAt(-1, new Error('unused')),
    candidatePoolId: 'pool-success',
    identity: identity(),
    candidates,
    auditId: 'rec_diag_success',
    logger,
  });

  const done = entries.filter((entry) => entry.label === '[CandidatePoolWriteDone]');
  assert.equal(result.status, 'saved');
  assert.equal(done.length, 1);
  assert.equal(done[0].payload.manifestWritten, true);
  assert.equal(done[0].payload.successfulChunkCount, done[0].payload.chunkCount);
  assert.equal(done[0].payload.totalChunkBytes + done[0].payload.manifestBytes, result.serializedBytes);
});

test('independent chunks and validations run concurrently while manifest stays the commit point', async () => {
  const store = new Map();
  const state = {
    activeSets: 0,
    maxConcurrentSets: 0,
    activeGets: 0,
    maxConcurrentGets: 0,
    completedChunkGets: 0,
    manifestSnapshot: null,
  };
  const database = {
    collection: () => ({
      doc: (id) => ({
        set: async ({ data }) => {
          if (data.recordType === 'manifest') {
            state.manifestSnapshot = {
              activeSets: state.activeSets,
              activeGets: state.activeGets,
              completedChunkGets: state.completedChunkGets,
            };
          }
          state.activeSets += 1;
          state.maxConcurrentSets = Math.max(state.maxConcurrentSets, state.activeSets);
          await new Promise((resolve) => setTimeout(resolve, 20));
          store.set(id, { ...data, _id: id });
          state.activeSets -= 1;
        },
        get: async () => {
          state.activeGets += 1;
          state.maxConcurrentGets = Math.max(state.maxConcurrentGets, state.activeGets);
          await new Promise((resolve) => setTimeout(resolve, 20));
          const data = store.get(id) || null;
          state.activeGets -= 1;
          state.completedChunkGets += 1;
          return { data };
        },
        remove: async () => {
          store.delete(id);
        },
      }),
    }),
  };
  const sourceCandidates = Array.from({ length: 500 }, (_, index) => candidate(index, 1000));
  const result = await tryPersistCandidatePool({
    database,
    candidatePoolId: 'pool-concurrency-proof',
    identity: identity(),
    candidates: sourceCandidates,
  });

  assert.equal(result.status, 'saved');
  assert.ok(result.chunkCount > 1);
  assert.ok(state.maxConcurrentSets > 1);
  assert.equal(state.maxConcurrentGets, 0);
  assert.deepEqual(state.manifestSnapshot, {
    activeSets: 0,
    activeGets: 0,
    completedChunkGets: 0,
  });
  assert.equal(result.dbReadCount, 0);
  assert.equal(result.dbWriteCount, result.chunkCount + 1);
  assert.equal(result.validationReadCount, 0);
  assert.equal(result.validationMode, 'local_checksum_after_awaited_set');
  assert.ok(result.chunkWriteTimings.every((entry) => entry.documentBytes > 0));
  assert.ok(result.maxActiveChunkWrites > 1);
  const phaseTiming = result.phaseTiming;
  const expectedPhaseNames = [
    'poolInputMaterialization',
    'objectCloneNormalization',
    'dictionaryChunkBuild',
    'jsonSerialization',
    'checksumHash',
    'byteSizeStatistics',
    'chunkTaskCreation',
    'chunkRemoteWriteWall',
    'promiseJoin',
    'localValidation',
    'manifestBuild',
    'manifestWrite',
    'cleanupTelemetryAssembly',
    'otherRealStage',
  ];
  assert.equal(phaseTiming.clock, 'process.hrtime.bigint');
  assert.deepEqual(Object.keys(phaseTiming.phaseWallMs), expectedPhaseNames);
  assert.ok(Math.abs(
    Object.values(phaseTiming.phaseWallMs).reduce((sum, value) => sum + value, 0)
      - phaseTiming.accountedWallMs,
  ) < 0.02);
  assert.equal(phaseTiming.unaccountedWallMs, 0);
  assert.ok(phaseTiming.parallelOperationMs.chunkRemoteWriteCumulative > phaseTiming.phaseWallMs.chunkRemoteWriteWall);
});

test('projection profile uses UTF-8 bytes, conserves pool bytes, and only exposes path/number pairs', () => {
  const candidates = [
    { itemFacts: { material: '棉麻' }, presentation: { todayReason: '轻盈透气' } },
    { itemFacts: { material: '棉麻' }, presentation: { todayReason: '日常通勤' } },
  ];
  const chunks = [{ recordType: 'chunk', candidates: [candidates[0]] }, { recordType: 'chunk', candidates: [candidates[1]] }];
  const manifest = { recordType: 'manifest', chunkCount: 2 };
  const profile = buildCandidatePoolProjectionProfile({ candidates, chunks, manifest });

  assert.equal(profile.candidateCount, 2);
  assert.equal(profile.totalBytes, chunks.reduce((sum, chunk) => sum + Buffer.byteLength(JSON.stringify(chunk), 'utf8'), 0)
    + Buffer.byteLength(JSON.stringify(manifest), 'utf8'));
  assert.equal(profile.averageCandidateBytes, candidates.reduce((sum, value) => sum + Buffer.byteLength(JSON.stringify(value), 'utf8'), 0) / 2);
  assert.ok(profile.topJsonPathBytes.some((entry) => entry.path === 'candidate.itemFacts.material'));
  assert.ok(profile.repeatedJsonPathBytes.some((entry) => entry.path === 'candidate.itemFacts.material'));
  [...profile.topJsonPathBytes, ...profile.repeatedJsonPathBytes].forEach((entry) => {
    assert.deepEqual(Object.keys(entry).sort(), ['bytes', 'path']);
    assert.equal(typeof entry.path, 'string');
    assert.equal(typeof entry.bytes, 'number');
  });
});

test('projection profile records real 120 and 320 candidate byte metrics without truncation', () => {
  for (const candidateCount of [120, 320]) {
    const sourceCandidates = Array.from({ length: candidateCount }, (_, index) => candidate(index, 1024));
    const pool = createCandidatePoolRecord({
      candidatePoolId: `pool-profile-${candidateCount}`,
      identity: identity(),
      candidates: sourceCandidates,
      now: 1000,
    });
    const plan = buildCandidatePoolStoragePlan(pool);
    const profile = buildCandidatePoolProjectionProfile({
      sourceCandidates,
      candidates: pool.candidates,
      chunks: plan.chunks,
      manifest: plan.manifest,
    });
    const runtimeProfile = buildCandidatePoolProjectionProfile({
      candidates: pool.candidates,
      chunks: plan.chunks,
      manifest: plan.manifest,
      prepared: plan.prepared,
      runtime: true,
    });

    assert.equal(profile.candidateCount, candidateCount);
    assert.equal(profile.chunkCount, plan.chunks.length);
    assert.equal(profile.unoptimizedCandidateBytes > profile.optimizedCandidateBytes, true);
    assert.equal(profile.totalBytes, plan.serializedBytes);
    assert.equal(profile.chunkBytes.length, profile.chunkCount);
    assert.equal(profile.maxCandidateBytes >= profile.p95CandidateBytes, true);
    assert.equal(profile.unoptimizedMaxCandidateBytes >= profile.unoptimizedP95CandidateBytes, true);
    assert.equal(runtimeProfile.fieldBytesConserved, true);
    assert.equal(runtimeProfile.categoryBytes.conserved, true);
    assert.equal(runtimeProfile.categoryBytes.unclassified, 0);
    assert.equal(runtimeProfile.totalBytes, plan.serializedBytes);
    assert.ok(runtimeProfile.topLevelFieldBytes.length > 0);
    assert.ok(runtimeProfile.itemReferenceStats.occurrenceCount >= runtimeProfile.itemReferenceStats.uniqueItemCount);
    assert.equal(runtimeProfile.categoryBytes.presentation, 0);
    assert.equal(runtimeProfile.categoryBytes.snapshot, 0);
    console.log(`[projection-${candidateCount}] sourceBytes=${profile.unoptimizedCandidateBytes}, optimizedBytes=${profile.optimizedCandidateBytes}, p50=${profile.p50CandidateBytes}, p95=${profile.p95CandidateBytes}, max=${profile.maxCandidateBytes}, manifestBytes=${profile.manifestBytes}, chunkCount=${profile.chunkCount}, totalChunkBytes=${profile.totalChunkBytes}, reductionBytes=${profile.reductionBytes}`);
  }
});

test('debug=false skips the detailed projection profile', async () => {
  const { entries, logger } = createLogger();
  await tryPersistCandidatePool({
    database: databaseThatFailsAt(-1, new Error('unused')),
    candidatePoolId: 'pool-no-profile',
    identity: identity(),
    candidates: [candidate(0)],
    auditId: 'rec_diag_no_profile',
    debugRecommendationAudit: false,
    logger,
  });
  assert.equal(entries.some((entry) => entry.label === '[CandidatePoolProjectionProfile]'), false);
});
