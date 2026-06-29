const assert = require('node:assert/strict');
const test = require('node:test');

const { loadActiveWardrobe } = require('./loadActiveWardrobe');

for (const count of [0, 50, 100, 101, 200, 500, 1000]) {
  test(`loads ${count} active wardrobe items through pagination`, async () => {
    const { database, calls } = createMockDatabase(makeClothes(count));
    const result = await loadActiveWardrobe({ database, openid: 'openid-a', pageSize: 100, maxItems: 1000 });

    assert.equal(result.length, count);
    assert.equal(calls.every((call) => call.filter._openid === 'openid-a'), true);
    assert.ok(calls.length >= Math.max(1, Math.ceil(count / 100)));
  });
}

test('deduplicates documents and filters deleted/user-mismatched records from defensive mock data', async () => {
  const docs = [
    { _id: 'a', _openid: 'openid-a', status: 'active', createdAt: '3' },
    { _id: 'a', _openid: 'openid-a', status: 'active', createdAt: '3' },
    { _id: 'b', _openid: 'openid-a', status: 'deleted', createdAt: '2' },
    { _id: 'c', _openid: 'other', status: 'active', createdAt: '1' },
    { _id: 'd', _openid: 'openid-a', status: 'active', createdAt: '0' },
  ];
  const { database } = createMockDatabase(docs);

  const result = await loadActiveWardrobe({ database, openid: 'openid-a', pageSize: 2, maxItems: 1000 });

  assert.deepEqual(result.map((item) => item._id), ['a', 'd']);
});

test('stops at safety max without returning more than the configured ceiling', async () => {
  const { database } = createMockDatabase(makeClothes(1005));
  const result = await loadActiveWardrobe({ database, openid: 'openid-a', pageSize: 100, maxItems: 1000 });

  assert.equal(result.length, 1000);
});

test('query failures are propagated instead of returning partial results', async () => {
  const { database } = createMockDatabase(makeClothes(200), { failAtSkip: 100 });

  await assert.rejects(
    () => loadActiveWardrobe({ database, openid: 'openid-a', pageSize: 100, maxItems: 1000 }),
    /mock query failed/,
  );
});

function makeClothes(count) {
  return Array.from({ length: count }, (_, index) => ({
    _id: `cloth-${String(index).padStart(4, '0')}`,
    _openid: 'openid-a',
    status: 'active',
    createdAt: String(count - index).padStart(4, '0'),
  }));
}

function createMockDatabase(docs, options = {}) {
  const calls = [];
  return {
    calls,
    database: {
      collection(name) {
        assert.equal(name, 'clothes');
        const query = {
          filter: {},
          skipValue: 0,
          limitValue: 100,
          where(filter) {
            this.filter = filter;
            return this;
          },
          orderBy(field, direction) {
            this.order = { field, direction };
            return this;
          },
          skip(value) {
            this.skipValue = value;
            return this;
          },
          limit(value) {
            this.limitValue = value;
            return this;
          },
          async get() {
            calls.push({ filter: this.filter, skip: this.skipValue, limit: this.limitValue, order: this.order });
            if (options.failAtSkip === this.skipValue) throw new Error('mock query failed');
            const rows = docs
              .filter((item) => item._openid === this.filter._openid && item.status === this.filter.status)
              .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
              .slice(this.skipValue, this.skipValue + this.limitValue);
            return { data: rows };
          },
        };
        return query;
      },
    },
  };
}
