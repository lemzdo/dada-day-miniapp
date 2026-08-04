const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const DEPLOYED_SHARED_PATH = './shared/sceneEligibilityFacts';
const DEPLOYED_WEARABILITY_PATH = './services/itemWearabilityFacts';

function createDatabase(wardrobe, candidatePoolRecords) {
  function query(readData) {
    let filters = {};
    let offset = 0;
    let max = Number.POSITIVE_INFINITY;
    return {
      where(nextFilters = {}) {
        filters = { ...filters, ...nextFilters };
        return this;
      },
      orderBy() { return this; },
      skip(nextOffset = 0) { offset = Math.max(0, Number(nextOffset) || 0); return this; },
      limit(nextLimit) { max = Math.max(0, Number(nextLimit) || 0); return this; },
      async get() {
        const data = (typeof readData === 'function' ? readData() : readData)
          .filter((entry) => Object.entries(filters).every(([key, value]) => entry?.[key] === value))
          .slice(offset, offset + max);
        return { data };
      },
    };
  }

  return {
    command: { in: (values) => values },
    collection(name) {
      if (name === 'clothes') return query(wardrobe);
      if (name === 'users') return query([]);
      if (name === 'recommendation_candidate_pools') {
        return {
          ...query(() => candidatePoolRecords),
          doc(id) {
            return {
              async get() {
                return { data: candidatePoolRecords.find((record) => record?._id === id) || null };
              },
              async set({ data }) {
                const next = { ...data, _id: id };
                const index = candidatePoolRecords.findIndex((record) => record?._id === id);
                if (index >= 0) candidatePoolRecords[index] = next;
                else candidatePoolRecords.push(next);
                return { _id: id };
              },
              async remove() {
                const index = candidatePoolRecords.findIndex((record) => record?._id === id);
                if (index >= 0) candidatePoolRecords.splice(index, 1);
              },
            };
          },
        };
      }
      throw new Error(`unexpected collection: ${name}`);
    },
  };
}

function loadDeployedEntry(wardrobe, candidatePoolRecords) {
  const originalLoad = Module._load;
  Module._load = function loadWithCloudStub(request, parent, isMain) {
    if (request === 'wx-server-sdk') {
      return {
        DYNAMIC_CURRENT_ENV: 'test',
        init() {},
        database() { return createDatabase(wardrobe, candidatePoolRecords); },
        getWXContext() { return { OPENID: 'deployment-entry-smoke-user' }; },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    delete require.cache[require.resolve('./index.js')];
    return require('./index.js');
  } finally {
    Module._load = originalLoad;
  }
}

function wardrobeItem() {
  return {
    _id: 'smoke-top',
    _openid: 'deployment-entry-smoke-user',
    status: 'active',
    category: 'top',
    type: 'top',
    subcategory: 'basic cotton top',
    customName: 'basic cotton top',
    styleTags: ['casual'],
    sceneTags: ['home'],
    seasonTags: [],
    colorPalette: [{ name: 'black', hex: '#111111' }],
    confidence: 0.9,
  };
}

test('deployed generateOutfit entry loads the shared runtime contract and serves home and work without normalizeType errors', async () => {
  const shared = require(DEPLOYED_SHARED_PATH);
  const wearability = require(DEPLOYED_WEARABILITY_PATH);

  assert.equal(require.resolve(DEPLOYED_SHARED_PATH).includes('generateOutfit'), true);
  for (const [name, exported] of Object.entries(shared)) {
    assert.equal(typeof exported, 'function', `${name} must be a function`);
  }
  assert.equal(typeof shared.normalizeType, 'function');
  assert.equal(typeof wearability.normalizeType, 'function');

  const candidatePoolRecords = [];
  const entry = loadDeployedEntry([wardrobeItem()], candidatePoolRecords);
  assert.equal(typeof entry.main, 'function');

  for (const scene of ['\u5c45\u5bb6', '\u901a\u52e4']) {
    const response = await entry.main({
      action: 'generate',
      scene,
      weatherMode: 'disabled',
      maxResults: 1,
    });
    assert.equal(response.code, 0, response.message);
    assert.notEqual(response.message.includes('normalizeType is not a function'), true);
  }
  assert.ok(candidatePoolRecords.some((record) => record.recordType === 'manifest'));
  assert.ok(candidatePoolRecords.some((record) => record.recordType === 'chunk'));
});
