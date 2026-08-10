const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

function loadEntryWithDatabase(database) {
  const originalLoad = Module._load;
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  Module._load = function loadWithCloudStub(request, parent, isMain) {
    if (request === 'wx-server-sdk') {
      return {
        DYNAMIC_CURRENT_ENV: 'test',
        init() {},
        database() {
          return database;
        },
        getWXContext() {
          return { OPENID: 'snapshot-batch-user' };
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[require.resolve('./index.js')];
    return require('./index.js');
  } finally {
    Module._load = originalLoad;
    process.env.NODE_ENV = previousNodeEnv;
  }
}

function createBatchDatabase(clothes, options = {}) {
  const outfits = [];
  const operations = {
    reads: 0,
    adds: 0,
    updates: 0,
    transactions: 0,
    rollbacks: 0,
    activeWrites: 0,
    maxConcurrentWrites: 0,
  };
  let nextId = 1;
  let transactionTail = Promise.resolve();

  function query(records, collectionName) {
    let filters = {};
    return {
      where(nextFilters = {}) {
        filters = nextFilters;
        return this;
      },
      limit() {
        return this;
      },
      async get() {
        operations.reads += 1;
        if (options.failRead === collectionName) {
          const error = new Error(`database.getDocument: injected ${collectionName} read failure`);
          error.errCode = -502001;
          throw error;
        }
        return {
          data: records.filter((record) => Object.entries(filters).every(([key, value]) => (
            Array.isArray(value) ? value.includes(record[key]) : record[key] === value
          ))),
        };
      },
    };
  }

  const database = {
    command: {
      in(values) {
        return values;
      },
      set(value) {
        return { __cloudbaseSet: true, value };
      },
    },
    collection(name) {
      if (name === 'clothes') return query(clothes, 'clothes');
      if (name !== 'outfits') throw new Error(`unexpected collection: ${name}`);
      return {
        ...query(outfits, 'outfits'),
        doc(id) {
          return {
          async update({ data }) {
              operations.activeWrites += 1;
              operations.maxConcurrentWrites = Math.max(operations.maxConcurrentWrites, operations.activeWrites);
              if (options.writeDelayMs) await new Promise((resolve) => setTimeout(resolve, options.writeDelayMs));
              if (operations.activeWrites > 1 && !options.allowConcurrentWrites) {
                operations.activeWrites -= 1;
                const error = new Error('database.updateDocInTransaction: exceed concurrent request limit');
                error.errCode = -501004;
                throw error;
              }
              operations.updates += 1;
              try {
                if (options.failAtWrite && operations.updates + operations.adds === options.failAtWrite) {
                  const error = new Error('database.updateDocInTransaction: injected failure');
                  error.errCode = -502001;
                  throw error;
                }
                const index = outfits.findIndex((record) => record._id === id);
                const nextData = Object.fromEntries(Object.entries(data).map(([key, value]) => [
                  key,
                  value && value.__cloudbaseSet ? value.value : value,
                ]));
                if (outfits[index].selectedDifferentiator === null
                  && nextData.selectedDifferentiator
                  && !data.selectedDifferentiator?.__cloudbaseSet) {
                  const error = new Error("Cannot create field 'authorizedValue' in element {selectedDifferentiator: null}");
                  error.errCode = -502001;
                  throw error;
                }
                outfits[index] = { ...outfits[index], ...nextData };
              } finally {
                operations.activeWrites -= 1;
              }
            },
          };
        },
        async add({ data }) {
          operations.activeWrites += 1;
          operations.maxConcurrentWrites = Math.max(operations.maxConcurrentWrites, operations.activeWrites);
          if (operations.activeWrites > 1) {
            operations.activeWrites -= 1;
            const error = new Error('database.insertDocument: exceed concurrent request limit');
            error.errCode = -501004;
            throw error;
          }
          operations.adds += 1;
          try {
            if (options.failBatchAdd || (options.failAtWrite && operations.updates + operations.adds === options.failAtWrite)) {
              const error = new Error('database.insertDocument: injected failure');
              error.errCode = -502001;
              throw error;
            }
            const rows = Array.isArray(data) ? data : [data];
            const ids = rows.map((row) => row._id || `outfit-${nextId++}`);
            rows.forEach((row, index) => outfits.push({ ...row, _id: ids[index] }));
            return Array.isArray(data) ? { _ids: ids } : { _id: ids[0] };
          } finally {
            operations.activeWrites -= 1;
          }
        },
      };
    },
    async runTransaction(callback) {
      const execute = async () => {
        operations.transactions += 1;
        const snapshot = outfits.map((record) => ({ ...record }));
        const nextIdSnapshot = nextId;
        try {
          return await callback(database);
        } catch (error) {
          outfits.splice(0, outfits.length, ...snapshot);
          nextId = nextIdSnapshot;
          operations.rollbacks += 1;
          throw error;
        }
      };
      const result = transactionTail.then(execute, execute);
      transactionTail = result.then(() => undefined, () => undefined);
      return result;
    },
  };
  return { database, operations, outfits };
}

function buildBases(count = 8, offset = 0) {
  return Array.from({ length: count }, (_, localIndex) => {
    const index = localIndex + offset;
    const clothingIds = [`top-${index}`, 'bottom', 'shoes'];
    return {
      clothingIds,
      scene: '居家',
      targetDate: '2026-07-30',
      items: clothingIds.map((clothingId) => ({
        clothingId,
        category: clothingId.startsWith('top') ? 'top' : clothingId,
        imageUrl: `cloud://stable/${clothingId}.png`,
      })),
      reason: `reason-${index}`,
      reasoning: `reason-${index}`,
    };
  });
}

test('recommendation snapshots use one transaction and two reads while preserving retry idempotency', async () => {
  const bases = buildBases();
  const clothingIds = [...new Set(bases.flatMap((base) => base.clothingIds))];
  const clothes = clothingIds.map((_id) => ({
    _id,
    _openid: 'snapshot-batch-user',
    status: 'active',
  }));
  const { database, operations, outfits } = createBatchDatabase(clothes);
  const entry = loadEntryWithDatabase(database);
  const firstCounts = { reads: 0, writes: 0 };
  const first = await entry.__test.upsertRecommendationOutfitsBatch({
    openid: 'snapshot-batch-user',
    bases,
    now: '2026-07-30T00:00:00.000Z',
    operationCounts: firstCounts,
  });

  assert.equal(first.length, 8);
  assert.equal(new Set(first.map((record) => record._id)).size, 8);
  assert.deepEqual(firstCounts, { reads: 2, writes: 8 });
  assert.equal(operations.transactions, 1);
  assert.equal(operations.reads, 2);
  assert.equal(operations.adds, 1);
  assert.equal(operations.maxConcurrentWrites, 1);
  assert.equal(outfits.length, 8);

  const retryCounts = { reads: 0, writes: 0 };
  const retry = await entry.__test.upsertRecommendationOutfitsBatch({
    openid: 'snapshot-batch-user',
    bases,
    now: '2026-07-30T00:01:00.000Z',
    operationCounts: retryCounts,
  });
  assert.deepEqual(retry.map((record) => record._id), first.map((record) => record._id));
  assert.deepEqual(retryCounts, { reads: 2, writes: 8 });
  assert.equal(operations.transactions, 2);
  assert.equal(operations.adds, 1);
  assert.equal(operations.updates, 8);
  assert.equal(outfits.length, 8);
});

test('legal tail batches persist exactly the available count', async () => {
  const bases = buildBases(3);
  const clothes = [...new Set(bases.flatMap((base) => base.clothingIds))]
    .map((_id) => ({ _id, _openid: 'snapshot-batch-user', status: 'active' }));
  const { database, operations, outfits } = createBatchDatabase(clothes);
  const entry = loadEntryWithDatabase(database);

  const saved = await entry.__test.upsertRecommendationOutfitsBatch({
    openid: 'snapshot-batch-user',
    bases,
    now: '2026-07-30T00:00:00.000Z',
  });

  assert.equal(saved.length, 3);
  assert.equal(outfits.length, 3);
  assert.equal(operations.transactions, 1);
  assert.equal(operations.rollbacks, 0);
});

test('mixed existing and new references update and add without changing keys', async () => {
  const bases = buildBases(3);
  const clothingIds = [...new Set(bases.flatMap((base) => base.clothingIds))];
  const clothes = clothingIds.map((_id) => ({
    _id,
    _openid: 'snapshot-batch-user',
    status: 'active',
  }));
  const { database, operations, outfits } = createBatchDatabase(clothes);
  const entry = loadEntryWithDatabase(database);
  const first = await entry.__test.upsertRecommendationOutfitsBatch({
    openid: 'snapshot-batch-user',
    bases: bases.slice(0, 1),
    now: '2026-07-30T00:00:00.000Z',
  });
  const beforeId = first[0]._id;

  const saved = await entry.__test.upsertRecommendationOutfitsBatch({
    openid: 'snapshot-batch-user',
    bases,
    now: '2026-07-30T00:01:00.000Z',
  });

  assert.equal(saved.length, 3);
  assert.equal(saved[0]._id, beforeId);
  assert.equal(new Set(saved.map((record) => record.outfitKey)).size, 3);
  assert.equal(outfits.length, 3);
  assert.equal(operations.updates, 1);
  assert.equal(operations.adds, 2);
});

test('snapshot persistence round-trips are explicit for all-new, all-existing, and mixed batches', async () => {
  const bases = buildBases(8);
  const clothingIds = [...new Set(bases.flatMap((base) => base.clothingIds))];
  const clothes = clothingIds.map((_id) => ({
    _id,
    _openid: 'snapshot-batch-user',
    status: 'active',
  }));
  const { database, operations, outfits } = createBatchDatabase(clothes);
  const entry = loadEntryWithDatabase(database);

  const allNewCounts = { reads: 0, writes: 0 };
  await entry.__test.upsertRecommendationOutfitsBatch({
    openid: 'snapshot-batch-user',
    bases,
    now: '2026-07-30T00:00:00.000Z',
    availableClothingIds: clothingIds,
    operationCounts: allNewCounts,
  });
  assert.equal(allNewCounts.snapshot.dbRoundTrips, 2);
  assert.equal(allNewCounts.snapshot.writeRoundTrips, 1);

  const allExistingCounts = { reads: 0, writes: 0 };
  await entry.__test.upsertRecommendationOutfitsBatch({
    openid: 'snapshot-batch-user',
    bases,
    now: '2026-07-30T00:01:00.000Z',
    availableClothingIds: clothingIds,
    operationCounts: allExistingCounts,
  });
  assert.equal(allExistingCounts.snapshot.dbRoundTrips, 9);
  assert.equal(allExistingCounts.snapshot.writeRoundTrips, 8);

  const mixedCounts = { reads: 0, writes: 0 };
  await entry.__test.upsertRecommendationOutfitsBatch({
    openid: 'snapshot-batch-user',
    bases: [...bases.slice(0, 4), ...buildBases(4, 8)],
    now: '2026-07-30T00:02:00.000Z',
    availableClothingIds: [...clothingIds, ...buildBases(4, 8).flatMap((base) => base.clothingIds)],
    operationCounts: mixedCounts,
  });
  assert.equal(mixedCounts.snapshot.dbRoundTrips, 6);
  assert.equal(mixedCounts.snapshot.writeRoundTrips, 5);
  assert.equal(operations.adds, 2);
  assert.equal(operations.updates, 12);
  assert.equal(outfits.length, 12);
});

test('all-existing recommendation snapshots use one read and controlled parallel owned-field updates', async () => {
  const bases = buildBases(8);
  bases.forEach((base, index) => {
    base.presentationPlan = {
      planId: `plan-${index}`,
      factModel: { facts: Array.from({ length: 24 }, (_, factIndex) => `fact-${factIndex}-${'x'.repeat(80)}`) },
    };
  });
  const clothingIds = [...new Set(bases.flatMap((base) => base.clothingIds))];
  const clothes = clothingIds.map((_id) => ({ _id, _openid: 'snapshot-batch-user', status: 'active' }));
  const { database, operations, outfits } = createBatchDatabase(clothes, { allowConcurrentWrites: true, writeDelayMs: 2 });
  const entry = loadEntryWithDatabase(database);
  const first = await entry.__test.upsertRecommendationOutfitsBatch({
    openid: 'snapshot-batch-user',
    bases,
    now: '2026-07-30T00:00:00.000Z',
    availableClothingIds: clothingIds,
  });
  const userState = {
    userTitle: '我的通勤套装',
    isFavorite: true,
    favoritedAt: '2026-07-29T00:00:00.000Z',
    wornAt: '2026-07-29T00:00:00.000Z',
    wornDate: '2026-07-29',
    isWornToday: false,
  };
  Object.assign(outfits[0], userState);

  const counts = { reads: 0, writes: 0 };
  const retry = await entry.__test.upsertRecommendationOutfitsBatch({
    openid: 'snapshot-batch-user',
    bases,
    now: '2026-07-30T00:01:00.000Z',
    availableClothingIds: clothingIds,
    operationCounts: counts,
  });

  assert.deepEqual(retry.map((record) => record._id), first.map((record) => record._id));
  assert.equal(counts.reads, 1);
  assert.equal(counts.writes, 8);
  assert.equal(counts.snapshot.dbRoundTrips, 9);
  assert.equal(counts.snapshot.writeRoundTrips, 8);
  assert.equal(counts.snapshot.maxConcurrency, 8);
  assert.equal(operations.maxConcurrentWrites, 8);
  assert.ok(counts.snapshot.inputPayloadBytes > counts.snapshot.payloadBytes * 10);
  assert.ok(counts.snapshot.payloadBytes < 10 * 1024);
  assert.deepEqual(
    Object.fromEntries(Object.keys(userState).map((key) => [key, outfits[0][key]])),
    userState,
  );
});

test('parallel existing recommendation update failure is surfaced with its reference cause', async () => {
  const bases = buildBases(2);
  const clothingIds = [...new Set(bases.flatMap((base) => base.clothingIds))];
  const clothes = clothingIds.map((_id) => ({ _id, _openid: 'snapshot-batch-user', status: 'active' }));
  const options = { allowConcurrentWrites: true, writeDelayMs: 2 };
  const { database, operations } = createBatchDatabase(clothes, options);
  const entry = loadEntryWithDatabase(database);
  await entry.__test.upsertRecommendationOutfitsBatch({
    openid: 'snapshot-batch-user',
    bases,
    now: '2026-07-30T00:00:00.000Z',
    availableClothingIds: clothingIds,
  });
  options.failAtWrite = operations.updates + operations.adds + 1;
  await assert.rejects(
    entry.__test.upsertRecommendationOutfitsBatch({
      openid: 'snapshot-batch-user',
      bases,
      now: '2026-07-30T00:01:00.000Z',
      availableClothingIds: clothingIds,
    }),
    (error) => {
      assert.equal(error.businessCode, 'OUTFIT_REFERENCE_WRITE_FAILED');
      assert.equal(error.cause.stage, 'outfit_recommendation_update');
      return true;
    },
  );
  assert.equal(operations.transactions, 1);
});

test('nullable selectedDifferentiator is atomically replaced for existing outfit references', async () => {
  const [base] = buildBases(1);
  const selectedDifferentiator = {
    type: 'relation',
    relationCode: 'TOP_ACCENT_WITH_NEUTRAL_BOTTOM',
    roles: ['top', 'bottom'],
    authorizedValues: ['粉色', '灰色'],
    authorizedValue: '粉色',
    subjectItemIds: ['top-0'],
    evidenceFactIds: ['fact-1'],
  };
  const { database, operations, outfits } = createBatchDatabase([
    ...base.clothingIds.map((_id) => ({ _id, _openid: 'snapshot-batch-user', status: 'active' })),
  ]);
  outfits.push({
    _id: 'existing-outfit',
    _openid: 'snapshot-batch-user',
    outfitKey: base.clothingIds.slice().sort().join('_'),
    selectedDifferentiator: null,
    presentationPlan: { selectedDifferentiator: null, title: '保留标题' },
    copyContract: null,
    userTitle: '保留用户标题',
    snapshotItems: [{ itemId: 'top-0', imageUrl: 'cloud://stable/top-0.png' }],
  });
  const entry = loadEntryWithDatabase(database);
  const nextBase = {
    ...base,
    selectedDifferentiator,
    presentationPlan: { selectedDifferentiator, title: '新标题' },
    copyContract: { todayReason: '保留授权文案' },
  };

  const payload = entry.__test.buildOutfitSaveData(nextBase, {
    outfitKey: base.clothingIds.slice().sort().join('_'),
    now: '2026-07-30T00:01:00.000Z',
    patch: {},
    current: outfits[0],
  });
  const updatePayload = entry.__test.buildOutfitReferenceUpdatePayload(payload);
  assert.deepEqual(Object.keys(updatePayload).filter((key) => key.startsWith('selectedDifferentiator.')), []);
  assert.equal(updatePayload.selectedDifferentiator.__cloudbaseSet, true);
  assert.equal(updatePayload.presentationPlan.__cloudbaseSet, true);
  assert.equal(updatePayload.copyContract.__cloudbaseSet, true);
  assert.equal(Object.keys(updatePayload).filter((key) => key === 'selectedDifferentiator').length, 1);

  const saved = await entry.__test.upsertRecommendationOutfitsBatch({
    openid: 'snapshot-batch-user',
    bases: [nextBase],
    now: '2026-07-30T00:01:00.000Z',
    operationCounts: { reads: 0, writes: 0 },
  });
  assert.deepEqual(saved[0].selectedDifferentiator, selectedDifferentiator);
  assert.deepEqual(outfits[0].selectedDifferentiator, selectedDifferentiator);
  assert.equal(outfits[0].userTitle, '保留用户标题');
  assert.equal(outfits[0].snapshotItems.length, 3);
  assert.equal(outfits[0].snapshotItems.some((item) => item.itemId === 'top-0'), true);
  assert.equal(operations.updates, 1);

  const replacement = { ...selectedDifferentiator, relationCode: 'COLOR_ECHO_TOP_SHOES', authorizedValue: '白色' };
  const replacementResult = await entry.__test.upsertRecommendationOutfitsBatch({
    openid: 'snapshot-batch-user',
    bases: [{ ...nextBase, selectedDifferentiator: replacement }],
    now: '2026-07-30T00:02:00.000Z',
  });
  assert.deepEqual(replacementResult[0].selectedDifferentiator, replacement);

  const clearedResult = await entry.__test.upsertRecommendationOutfitsBatch({
    openid: 'snapshot-batch-user',
    bases: [{ ...nextBase, selectedDifferentiator: null }],
    now: '2026-07-30T00:03:00.000Z',
  });
  assert.equal(clearedResult[0].selectedDifferentiator, null);
  assert.equal(outfits[0].selectedDifferentiator, null);
  assert.equal(operations.updates, 3);
});

test('selectedDifferentiator update payload always contains only its parent key', () => {
  const entry = loadEntryWithDatabase(createBatchDatabase([]).database);
  const value = { relationCode: 'RELATION', authorizedValue: '白色', evidence: ['fact-1'] };
  for (const selectedDifferentiator of [value, null]) {
    const payload = entry.__test.buildOutfitReferenceUpdatePayload({
      selectedDifferentiator,
      title: '保留其他字段',
    });
    const keys = Object.keys(payload);
    assert.equal(keys.includes('selectedDifferentiator'), true);
    assert.equal(keys.some((key) => key.startsWith('selectedDifferentiator.')), false);
    assert.equal(keys.filter((key) => key === 'selectedDifferentiator').length, 1);
  }
});

test('a single write failure rolls back every reference and preserves the original cause', async () => {
  const bases = buildBases(3);
  const clothes = [...new Set(bases.flatMap((base) => base.clothingIds))]
    .map((_id) => ({ _id, _openid: 'snapshot-batch-user', status: 'active' }));
  const { database, operations, outfits } = createBatchDatabase(clothes, { failBatchAdd: true });
  const entry = loadEntryWithDatabase(database);

  await assert.rejects(
    entry.__test.upsertRecommendationOutfitsBatch({
      openid: 'snapshot-batch-user',
      bases,
      now: '2026-07-30T00:00:00.000Z',
    }),
    (error) => {
      assert.equal(error.businessCode, 'OUTFIT_REFERENCE_WRITE_FAILED');
      assert.equal(error.cause.errCode, -502001);
      assert.equal(error.cause.stage, 'outfit_batch_add');
      assert.equal(error.cause.outfitKey, bases[0].clothingIds.slice().sort().join('_'));
      return true;
    },
  );

  assert.equal(outfits.length, 0);
  assert.equal(operations.rollbacks, 1);
});

test('transaction failures with direct diagnostic fields are wrapped without changing the transaction call', async () => {
  const { database } = createBatchDatabase([]);
  database.runTransaction = async () => {
    const error = new Error('transaction failed');
    error.stage = 'outfit_add';
    error.errCode = -502001;
    error.errMsg = 'write rejected';
    error.documentId = 'outfit-doc-2';
    error.outfitKey = 'top-2_bottom_shoes';
    throw error;
  };
  const entry = loadEntryWithDatabase(database);

  await assert.rejects(entry.__test.runOutfitReferenceTransaction(async () => undefined), (error) => {
    assert.equal(error.businessCode, 'OUTFIT_REFERENCE_WRITE_FAILED');
    assert.deepEqual(error.cause, {
      errorName: 'Error',
      errCode: -502001,
      errMsg: 'write rejected',
      stage: 'outfit_add',
      operation: null,
      collection: null,
      documentId: 'outfit-doc-2',
      outfitKey: 'top-2_bottom_shoes',
      requestId: null,
      stack: error.cause.stack,
    });
    return true;
  });
});

test('same-user concurrent batches are serialized and remain idempotent', async () => {
  const bases = buildBases(2);
  const allClothingIds = [...new Set(bases.flatMap((base) => base.clothingIds))];
  const clothes = allClothingIds.map((_id) => ({
    _id,
    _openid: 'snapshot-batch-user',
    status: 'active',
  }));
  const { database, operations, outfits } = createBatchDatabase(clothes);
  const entry = loadEntryWithDatabase(database);

  const [first, retry] = await Promise.all([
    entry.__test.upsertRecommendationOutfitsBatch({
      openid: 'snapshot-batch-user',
      bases,
      now: '2026-07-30T00:00:00.000Z',
    }),
    entry.__test.upsertRecommendationOutfitsBatch({
      openid: 'snapshot-batch-user',
      bases,
      now: '2026-07-30T00:01:00.000Z',
    }),
  ]);

  assert.equal(first.length, 2);
  assert.equal(retry.length, 2);
  assert.deepEqual(retry.map((record) => record._id), first.map((record) => record._id));
  assert.equal(outfits.length, 2);
  assert.equal(operations.rollbacks, 0);
  assert.equal(operations.maxConcurrentWrites, 1);
});

test('read failures retain their stage and database cause', async () => {
  const bases = buildBases(1);
  const clothes = [...new Set(bases[0].clothingIds)]
    .map((_id) => ({ _id, _openid: 'snapshot-batch-user', status: 'active' }));
  const { database } = createBatchDatabase(clothes, { failRead: 'outfits' });
  const entry = loadEntryWithDatabase(database);

  await assert.rejects(
    entry.__test.upsertRecommendationOutfitsBatch({
      openid: 'snapshot-batch-user',
      bases,
      now: '2026-07-30T00:00:00.000Z',
    }),
    (error) => {
      assert.equal(error.businessCode, 'OUTFIT_REFERENCE_WRITE_FAILED');
      assert.equal(error.cause.errCode, -502001);
      assert.equal(error.cause.stage, 'outfit_existing_read');
      return true;
    },
  );
});

test('raw CloudBase error fields are preserved in the safe diagnostic shape', () => {
  const entry = loadEntryWithDatabase(createBatchDatabase([]).database);
  const raw = new Error('database.insertDocument: exceed concurrent request limit');
  raw.errCode = -501004;
  raw.stack = 'raw-stack';
  assert.deepEqual(entry.__test.serializeOutfitReferenceCause(raw, { stage: 'outfit_add' }), {
    errorName: 'Error',
    errCode: -501004,
    errMsg: 'database.insertDocument: exceed concurrent request limit',
    stage: 'outfit_add',
    operation: null,
    collection: null,
    documentId: null,
    outfitKey: null,
    requestId: null,
    stack: 'raw-stack',
  });
});

test('failure response exposes only a safe outfit reference diagnostic, including cyclic causes', () => {
  const entry = loadEntryWithDatabase(createBatchDatabase([]).database);
  const cause = {
    errorName: 'CloudBaseError',
    stage: 'outfit_add',
    errCode: -502001,
    errMsg: 'injected failure',
    documentId: 'outfit-doc-1',
    outfitKey: 'top-1_bottom-1',
    operation: 'add',
    collection: 'outfits',
    requestId: 'request-1',
    stack: `${Array.from({ length: 12 }, (_, index) => `line-${index}`).join('\n')}\n${'x'.repeat(1800)}`,
    clothes: [{ _id: 'private-clothing' }],
    items: [{ imageUrl: 'https://private.example/image.jpg' }],
    openid: 'private-openid',
    payload: { private: true },
  };
  cause.self = cause;
  const wrapped = new Error('操作暂时失败，请稍后再试');
  wrapped.businessCode = 'OUTFIT_REFERENCE_WRITE_FAILED';
  wrapped.cause = cause;

  assert.doesNotThrow(() => entry.__test.getSafeOutfitReferenceCause(cause));
  const response = entry.__test.fail(wrapped);
  assert.equal(response.code, 1);
  assert.equal(response.data.errorCode, 'OUTFIT_REFERENCE_WRITE_FAILED');
  assert.equal(response.message, '操作暂时失败，请稍后再试');
  assert.deepEqual(response.data.debug.outfitReferenceWriteFailure, {
    errorName: 'CloudBaseError',
    errCode: -502001,
    errMsg: 'injected failure',
    stage: 'outfit_add',
    operation: 'add',
    collection: 'outfits',
    documentId: 'outfit-doc-1',
    outfitKey: 'top-1_bottom-1',
    requestId: 'request-1',
    stack: Array.from({ length: 8 }, (_, index) => `line-${index}`).join('\n'),
  });
  const serialized = JSON.stringify(response.data.debug);
  assert.equal(serialized.includes('clothes'), false);
  assert.equal(serialized.includes('items'), false);
  assert.equal(serialized.includes('openid'), false);
  assert.equal(serialized.includes('imageUrl'), false);
  assert.equal(serialized.includes('payload'), false);
  assert.doesNotThrow(() => JSON.stringify(response));
});
