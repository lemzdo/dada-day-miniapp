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
              if (operations.activeWrites > 1) {
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
                outfits[index] = { ...outfits[index], ...data };
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
            if (options.failAtWrite && operations.updates + operations.adds === options.failAtWrite) {
              const error = new Error('database.insertDocument: injected failure');
              error.errCode = -502001;
              throw error;
            }
            const _id = `outfit-${nextId}`;
            nextId += 1;
            outfits.push({ ...data, _id });
            return { _id };
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
  assert.equal(operations.adds, 8);
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
  assert.equal(operations.adds, 8);
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
  assert.equal(operations.adds, 3);
});

test('a single write failure rolls back every reference and preserves the original cause', async () => {
  const bases = buildBases(3);
  const clothes = [...new Set(bases.flatMap((base) => base.clothingIds))]
    .map((_id) => ({ _id, _openid: 'snapshot-batch-user', status: 'active' }));
  const { database, operations, outfits } = createBatchDatabase(clothes, { failAtWrite: 2 });
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
      assert.equal(error.cause.stage, 'outfit_add');
      assert.equal(error.cause.outfitKey, bases[1].clothingIds.slice().sort().join('_'));
      return true;
    },
  );

  assert.equal(outfits.length, 0);
  assert.equal(operations.rollbacks, 1);
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

test('raw CloudBase error fields are preserved without exposing them to the client', () => {
  const entry = loadEntryWithDatabase(createBatchDatabase([]).database);
  const raw = new Error('database.insertDocument: exceed concurrent request limit');
  raw.errCode = -501004;
  raw.stack = 'raw-stack';
  assert.deepEqual(entry.__test.serializeOutfitReferenceCause(raw, { stage: 'outfit_add' }), {
    errCode: -501004,
    errMsg: 'database.insertDocument: exceed concurrent request limit',
    stack: 'raw-stack',
    stage: 'outfit_add',
    documentId: '',
    outfitKey: '',
  });
});
