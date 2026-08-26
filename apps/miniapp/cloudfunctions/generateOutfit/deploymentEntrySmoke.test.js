const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const DEPLOYED_SHARED_PATH = './shared/sceneEligibilityFacts';
const DEPLOYED_WEARABILITY_PATH = './services/itemWearabilityFacts';

const CLOUD_FUNCTION_ROOT = __dirname;

function listDirectoryNames(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).map((entry) => entry.name);
}

function resolveCaseAwarePath(candidatePath) {
  const absolutePath = path.resolve(candidatePath);
  const parsed = path.parse(absolutePath);
  let current = parsed.root;
  const segments = absolutePath.slice(parsed.root.length).split(path.sep).filter(Boolean);
  const mismatches = [];

  for (const segment of segments) {
    let names;
    try {
      names = listDirectoryNames(current);
    } catch {
      return { exists: false, actualPath: current, mismatches };
    }
    const exact = names.find((name) => name === segment);
    if (exact) {
      current = path.join(current, exact);
      continue;
    }
    const actualName = names.find((name) => name.toLowerCase() === segment.toLowerCase());
    if (actualName) {
      mismatches.push({ directory: current, expected: segment, actual: actualName });
      current = path.join(current, actualName);
      continue;
    }
    return { exists: false, actualPath: path.join(current, segment), mismatches };
  }
  return { exists: fs.existsSync(current), actualPath: current, mismatches };
}

function resolveStaticRelativeModule(sourceFile, request) {
  const requestedPath = path.resolve(path.dirname(sourceFile), request);
  const candidates = path.extname(requestedPath)
    ? [requestedPath]
    : [requestedPath, `${requestedPath}.js`, `${requestedPath}.json`, path.join(requestedPath, 'index.js')];
  const attempted = [];
  for (const candidate of candidates) {
    const resolved = resolveCaseAwarePath(candidate);
    attempted.push({ candidate, ...resolved });
    if (resolved.exists && fs.statSync(resolved.actualPath).isFile()) return { ...resolved, resolvedPath: resolved.actualPath, attempted };
  }
  return { exists: false, resolvedPath: null, attempted };
}

function collectStaticRelativeRequires(sourceFile) {
  const source = fs.readFileSync(sourceFile, 'utf8');
  const staticRequests = [];
  const dynamicRequests = [];
  const requirePattern = /require\(\s*([^)]*)\)/g;
  let match;
  while ((match = requirePattern.exec(source))) {
    const argument = match[1].trim();
    const staticMatch = argument.match(/^(['"])(\.\/[^'"]*|\.\.\/[^'"]*)\1$/);
    if (staticMatch) staticRequests.push(staticMatch[2]);
    else if (argument.startsWith('.') || argument.includes('+') || argument.includes('`')) dynamicRequests.push(argument);
  }
  return { staticRequests, dynamicRequests };
}

function inspectCloudFunctionEntryModules(entryFile) {
  const queue = [entryFile];
  const visited = new Set();
  const errors = [];
  const dynamicRequires = [];
  while (queue.length > 0) {
    const sourceFile = queue.shift();
    if (visited.has(sourceFile)) continue;
    visited.add(sourceFile);
    const { staticRequests, dynamicRequests } = collectStaticRelativeRequires(sourceFile);
    dynamicRequires.push(...dynamicRequests.map((request) => ({ sourceFile, request })));
    for (const request of staticRequests) {
      const resolution = resolveStaticRelativeModule(sourceFile, request);
      const expectedPath = path.resolve(path.dirname(sourceFile), request);
      const mismatch = resolution.attempted.find((attempt) => attempt.mismatches.length > 0);
      if (!resolution.resolvedPath || mismatch) {
        errors.push({
          sourceFile,
          require: request,
          expectedPath,
          actualDiskName: mismatch?.mismatches?.[0]?.actual || null,
          code: mismatch ? 'REQUIRE_CASE_MISMATCH' : 'LOCAL_FILE_MISSING',
        });
        continue;
      }
      if (resolution.resolvedPath.startsWith(`${CLOUD_FUNCTION_ROOT}${path.sep}`)
        && !resolution.resolvedPath.includes(`${path.sep}node_modules${path.sep}`)) {
        queue.push(resolution.resolvedPath);
      }
    }
  }
  return { visited: [...visited], errors, dynamicRequires };
}

function createDatabase(wardrobe, candidatePoolRecords) {
  const stores = new Map();
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

  const database = {
    command: { in: (values) => values, set: (value) => value },
    async runTransaction(callback) { return callback(database); },
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
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      const collectionQuery = query(() => [...store.values()]);
      return {
        ...collectionQuery,
        doc(id) {
          return {
            async get() { return { data: store.get(id) || null }; },
            async set({ data }) { store.set(id, { ...data, _id: id }); return { _id: id }; },
            async update({ data }) {
              const current = store.get(id) || { _id: id };
              store.set(id, { ...current, ...data, _id: id });
              return { updated: 1 };
            },
            async remove() { store.delete(id); },
          };
        },
        async add({ data }) {
          const id = data?._id || `${name}-${store.size + 1}`;
          store.set(id, { ...data, _id: id });
          return { _id: id };
        },
      };
    },
  };
  return database;
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

test('deployment entry resolves every static relative dependency with exact disk casing', () => {
  const entryFile = path.join(CLOUD_FUNCTION_ROOT, 'index.js');
  const inspection = inspectCloudFunctionEntryModules(entryFile);
  if (inspection.errors.length > 0) {
    assert.fail(JSON.stringify(inspection.errors, null, 2));
  }
  const aestheticResolution = resolveStaticRelativeModule(entryFile, './services/aestheticCompatibility');
  assert.equal(aestheticResolution.resolvedPath, path.join(CLOUD_FUNCTION_ROOT, 'services', 'aestheticCompatibility.js'));
  assert.deepEqual(aestheticResolution.attempted.flatMap((attempt) => attempt.mismatches), []);
  console.log(`[deployment-entry-smoke] inspected=${inspection.visited.length} dynamicRequires=${JSON.stringify(inspection.dynamicRequires)}`);
});

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

test('deployed generateOutfit entry loads the shared runtime contract and serves home and work', async () => {
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
    assert.equal(response.data.runtimeVersion, 'today-runtime-v2');
    assert.equal(response.data.schemaVersion, 'today-v2');
    assert.equal(response.data.batch.batchId, response.data.light.batchId);
    assert.equal(response.data.batch.cardCount, response.data.light.cards.length);
    assert.ok(response.data.batch.cardCount >= 0 && response.data.batch.cardCount <= 1);
    assert.equal(response.data.batch.countContract.returnedCardCount, response.data.batch.cardCount);
  }
  assert.ok(candidatePoolRecords.some((record) => record.recordType === 'manifest'));
  assert.ok(candidatePoolRecords.some((record) => record.recordType === 'chunk'));
});
