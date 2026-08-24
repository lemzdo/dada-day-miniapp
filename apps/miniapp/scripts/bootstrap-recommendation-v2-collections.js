'use strict';

const COLLECTIONS = Object.freeze([
  'recommendation_batches_v2',
]);

function normalizeCollectionNames(result) {
  const rows = Array.isArray(result) ? result : result?.Collections || result?.collections || result?.data || [];
  return rows.map((row) => typeof row === 'string' ? row : row?.collectionName || row?.name).filter(Boolean);
}

async function ensureCollections({ manager, collections = COLLECTIONS }) {
  if (!manager || typeof manager.listCollections !== 'function' || typeof manager.createCollection !== 'function') {
    throw new Error('CLOUDBASE_MANAGER_ADAPTER_REQUIRED:listCollections/createCollection');
  }
  const before = normalizeCollectionNames(await manager.listCollections());
  const created = [];
  const existing = [];
  for (const name of collections) {
    if (before.includes(name)) {
      existing.push(name);
      continue;
    }
    try {
      await manager.createCollection(name);
      created.push(name);
    } catch (error) {
      // A concurrent creator is safe only after a fresh list confirms it.
      const after = normalizeCollectionNames(await manager.listCollections());
      if (!after.includes(name)) throw error;
      existing.push(name);
    }
  }
  const finalNames = normalizeCollectionNames(await manager.listCollections());
  const missing = collections.filter((name) => !finalNames.includes(name));
  if (missing.length > 0) throw new Error(`V2_COLLECTION_BOOTSTRAP_INCOMPLETE:${missing.join(',')}`);
  return {
    collections: [...collections],
    created,
    existing,
    indexes: 'none-added; query fields rely on CloudBase defaults and transaction/idempotency guards',
  };
}

async function loadManager() {
  const moduleName = process.env.D1D_CLOUDBASE_MANAGER_MODULE || '@cloudbase/manager-node';
  let loaded;
  try { loaded = require(moduleName); } catch (error) {
    throw new Error(`CLOUDBASE_MANAGER_MODULE_UNAVAILABLE:${moduleName}:${error.message}`);
  }
  const CloudBase = loaded.default || loaded;
  if (typeof CloudBase.init !== 'function') throw new Error(`CLOUDBASE_MANAGER_FACTORY_UNSUPPORTED:${moduleName}`);
  // manager-node resolves credentials only from explicit config or its
  // documented Tencent env vars; never print or persist those values.
  return CloudBase.init({ envId: process.env.D1D_CLOUDBASE_ENV_ID }).database;
}

async function main() {
  const envId = process.env.D1D_CLOUDBASE_ENV_ID;
  if (!envId) throw new Error('D1D_CLOUDBASE_ENV_ID is required');
  const result = await ensureCollections({ manager: await loadManager() });
  console.log(JSON.stringify({ envId, ...result }, null, 2));
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });

module.exports = { COLLECTIONS, normalizeCollectionNames, ensureCollections };
