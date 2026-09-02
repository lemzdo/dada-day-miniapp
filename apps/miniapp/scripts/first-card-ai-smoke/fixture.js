/* global require, module, structuredClone */
/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const Module = require('node:module');
const crypto = require('node:crypto');

const WRITABLE_COLLECTIONS = new Set([
  'recommendation_canonical_copy_cache_v2',
  'recommendation_copy_jobs_v2',
  'recommendation_candidate_pools',
  'recommendation_batches_v2',
  'outfits',
]);
const READ_ONLY_COLLECTIONS = new Set(['clothes', 'users', 'outfit_history', 'favorite_outfits']);

function clone(value) {
  return value === undefined ? value : structuredClone(value);
}

function createMemoryDatabase(seed = {}, { owner = seed.users?.[0]?._openid || '' } = {}) {
  const stores = new Map(
    Object.entries(seed).map(([name, rows]) => [
      name,
      new Map((rows || []).map((row, index) => [row._id || `${name}-${index + 1}`, clone(row)])),
    ]),
  );
  const writes = [];
  let transactionTail = Promise.resolve();
  const ownerHash = crypto.createHash('sha256').update(String(owner)).digest('hex');
  const command = {
    in(values) {
      return { __op: 'in', values: Array.isArray(values) ? values : [] };
    },
    set(value) {
      return { __op: 'set', value: clone(value) };
    },
  };
  const store = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name);
  };
  const matches = (row, filters) =>
    Object.entries(filters || {}).every(([key, expected]) => {
      const actual = row[key];
      return expected && expected.__op === 'in'
        ? expected.values.includes(actual)
        : actual === expected;
    });
  const assertWrite = (name, data, id, existing = null) => {
    if (READ_ONLY_COLLECTIONS.has(name) || !WRITABLE_COLLECTIONS.has(name))
      throw new Error(`FIXTURE_WRITE_FORBIDDEN:${name}`);
    const value = data && data.__op === 'set' ? data.value : data;
    if (existing && existing._openid && existing._openid !== owner)
      throw new Error(`FIXTURE_OWNER_MISMATCH:${name}`);
    if (existing && existing.ownerHash && existing.ownerHash !== ownerHash)
      throw new Error(`FIXTURE_OWNER_HASH_MISMATCH:${name}`);
    const merged = { ...(existing || {}), ...(value || {}) };
    if (name === 'recommendation_candidate_pools') {
      if (merged.ownerHash !== ownerHash) throw new Error(`FIXTURE_OWNER_HASH_MISMATCH:${name}`);
    } else if (merged._openid !== owner) throw new Error(`FIXTURE_OWNER_MISMATCH:${name}`);
    writes.push({ collection: name, id: id || null, keys: Object.keys(value || {}) });
  };
  const apply = (name, row, data, id) => {
    assertWrite(name, data, id, row);
    Object.entries(data || {}).forEach(([key, value]) => {
      row[key] = value && value.__op === 'set' ? clone(value.value) : clone(value);
    });
  };
  const collection = (name) => {
    const rows = store(name);
    const query = (filters = null, limitValue = Infinity, offset = 0) => ({
      where(next) {
        return query(next, limitValue, offset);
      },
      limit(next) {
        return query(filters, Number(next) || 0, offset);
      },
      skip(next) {
        return query(filters, limitValue, Number(next) || 0);
      },
      orderBy() {
        return this;
      },
      field() {
        return this;
      },
      async get() {
        return {
          data: [...rows.values()]
            .filter((row) => matches(row, filters))
            .slice(offset, offset + limitValue)
            .map(clone),
        };
      },
      async count() {
        return { total: [...rows.values()].filter((row) => matches(row, filters)).length };
      },
    });
    return {
      where(filters) {
        return query(filters);
      },
      limit(value) {
        return query(null, Number(value) || 0);
      },
      async add({ data }) {
        const id = `${name}-${rows.size + 1}`;
        assertWrite(name, data, id);
        rows.set(id, { ...clone(data), _id: id });
        return { _id: id };
      },
      doc(id) {
        return {
          async get() {
            const row = rows.get(id);
            if (!row) throw new Error('document not found');
            return { data: clone(row) };
          },
          async set({ data }) {
            assertWrite(name, data, id, rows.get(id));
            rows.set(id, { ...clone(data), _id: id });
            return {};
          },
          async update({ data }) {
            const row = rows.get(id);
            if (!row) throw new Error('document not found');
            apply(name, row, data, id);
            rows.set(id, row);
            return {};
          },
          async remove() {
            const row = rows.get(id);
            if (!row) return {};
            assertWrite(name, {}, id, row);
            rows.delete(id);
            return {};
          },
        };
      },
    };
  };
  return {
    command,
    collection,
    async runTransaction(callback) {
      const execute = async () => {
        const before = new Map(
          [...stores].map(([name, rows]) => [
            name,
            new Map([...rows].map(([id, row]) => [id, clone(row)])),
          ]),
        );
        const writeCount = writes.length;
        try {
          return await callback({ collection, command });
        } catch (error) {
          for (const [name, originalRows] of before) {
            const currentRows = stores.get(name);
            if (currentRows) {
              currentRows.clear();
              for (const [id, row] of originalRows) currentRows.set(id, row);
            } else stores.set(name, originalRows);
          }
          for (const name of [...stores.keys()]) if (!before.has(name)) stores.delete(name);
          writes.splice(writeCount);
          throw error;
        }
      };
      const result = transactionTail.then(execute, execute);
      transactionTail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
    snapshot() {
      return Object.fromEntries(
        [...stores].map(([name, rows]) => [name, [...rows.values()].map(clone)]),
      );
    },
    writes,
  };
}

function installCloudStub(database, openid) {
  const stub = {
    init() {},
    database: () => database,
    getWXContext: () => ({ OPENID: openid }),
    command: database.command,
  };
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    return request === 'wx-server-sdk' ? stub : originalLoad.call(this, request, parent, isMain);
  };
  return () => {
    Module._load = originalLoad;
  };
}

function buildFixture(openid = 'first-card-smoke-user') {
  const clothes = [
    {
      _id: 'smoke-top',
      _openid: openid,
      status: 'active',
      category: 'top',
      subcategory: 'T恤',
      color: '白色',
      colorPalette: [{ name: 'white', hex: '#fff' }],
      styleTags: ['休闲'],
      sceneTags: ['通勤', '日常'],
      seasonTags: ['春', '夏'],
      material: '棉',
      imageUrl: 'fixture://top',
    },
    {
      _id: 'smoke-bottom',
      _openid: openid,
      status: 'active',
      category: 'bottom',
      subcategory: '长裤',
      color: '灰色',
      colorPalette: [{ name: 'gray', hex: '#888' }],
      styleTags: ['休闲'],
      sceneTags: ['通勤', '日常'],
      seasonTags: ['春', '秋'],
      material: '棉',
      imageUrl: 'fixture://bottom',
    },
    {
      _id: 'smoke-shoes',
      _openid: openid,
      status: 'active',
      category: 'shoes',
      subcategory: '运动鞋',
      color: '白色',
      colorPalette: [{ name: 'white', hex: '#fff' }],
      styleTags: ['休闲'],
      sceneTags: ['通勤', '日常'],
      seasonTags: ['春', '夏', '秋'],
      material: '网面',
      imageUrl: 'fixture://shoes',
    },
  ];
  return {
    openid,
    clothes,
    users: [{ _id: 'smoke-user', _openid: openid, styleProfile: {} }],
    sentinel: { _id: 'sentinel-user', _openid: 'other-owner', styleProfile: {} },
  };
}

module.exports = { createMemoryDatabase, installCloudStub, buildFixture };
