const STORAGE_MIGRATION_VERSION = 4;
const LEGACY_PAGE_CACHE_PREFIX = 'd1d:pageCache:';
const LEGACY_USER_STORAGE_PREFIX = 'd1d:userStorage:v1:';
const LEGACY_DIAGNOSTIC_KEYS = new Set([
  'generateOutfit:acceptance-transport:v1',
  'generateOutfit:performance-ledger:v1',
  'today:performance-ledger:v1',
  'today:ttui-hard-invalid-acceptance:v1',
]);
const LEGACY_DIRECT_KEYS = new Set([
  'userId',
  'openid',
  'userProfileCache:v1',
  'd1d:lastWeather',
  'outfitStateSync',
  'today:outfitReturnSnapshot',
  'wardrobeNeedsRefresh',
  'detailNeedsRefresh',
]);

function buildPreAuthMigrationPlan(keys) {
  const removeKeys = uniqueStrings(keys).filter((key) => (
    key.startsWith(LEGACY_PAGE_CACHE_PREFIX)
      || LEGACY_DIAGNOSTIC_KEYS.has(key)
      || key.startsWith('d1d:migration:user-cache-isolation:v1:')
      || isCrossScopeRebuildableSnapshotKey(key)
  ));
  return { migrationVersion: STORAGE_MIGRATION_VERSION, removeKeys };
}

function isCrossScopeRebuildableSnapshotKey(key) {
  if (!key.startsWith(LEGACY_USER_STORAGE_PREFIX)) return false;
  return key.includes('today%3AsceneSnapshot%3A')
    || key.includes('today:sceneSnapshot:')
    || key.includes('today%3AoutfitReturnSnapshot')
    || key.includes('today:outfitReturnSnapshot');
}

function buildPostAuthMigrationPlan(entries, userScope) {
  const scopePrefix = `${LEGACY_USER_STORAGE_PREFIX}${userScope}:`;
  const uploadRefs = [];
  const removableKeys = [];
  const outfitRefs = [];
  let todaySnapshot = null;
  const todayControl = {};

  for (const entry of normalizeEntries(entries)) {
    const businessKey = entry.key.startsWith(scopePrefix)
      ? entry.key.slice(scopePrefix.length)
      : isUnscopedLegacyBusinessKey(entry.key)
        ? entry.key
        : '';
    if (!businessKey) continue;

    if (isUploadBatchImagesBusinessKey(businessKey)) {
      const batchId = decodeLastKeyPart(businessKey);
      if (batchId) {
        uploadRefs.push({
          batchId,
          cloudImageIds: uniqueStrings(entry.value),
          phase: 'processing',
          createdAt: 1,
          updatedAt: 1,
          needsServerVerification: true,
        });
      }
      removableKeys.push(entry.key);
      continue;
    }

    if (businessKey === 'outfitStateSync') {
      removableKeys.push(entry.key);
      continue;
    }

    if (businessKey === 'd1d:today:v2:home-light') {
      if (entry.value && typeof entry.value === 'object') todaySnapshot = entry.value;
      removableKeys.push(entry.key);
      continue;
    }

    const controlField = getTodayControlField(businessKey);
    if (controlField) {
      if (entry.value !== null && entry.value !== undefined && entry.value !== '') {
        todayControl[controlField] = entry.value;
      }
      removableKeys.push(entry.key);
      continue;
    }

    if (businessKey.startsWith('today:recommendationInput:')
      || businessKey.startsWith('today%3ArecommendationInput%3A')) {
      removableKeys.push(entry.key);
      continue;
    }

    if (isOutfitDetailDraftBusinessKey(businessKey)) {
      const ref = extractOutfitRef(entry.value);
      if (ref) outfitRefs.push(ref);
      removableKeys.push(entry.key);
      continue;
    }

    if (businessKey.startsWith('today%3AoutfitReturnSnapshot')
      || businessKey.startsWith('today:outfitReturnSnapshot')) {
      removableKeys.push(entry.key);
    }
  }

  return {
    migrationVersion: STORAGE_MIGRATION_VERSION,
    uploadRefs: dedupeBy(uploadRefs, (ref) => ref.batchId).slice(0, 10),
    outfitRefs: dedupeBy(outfitRefs, buildOutfitRefIdentity),
    todaySnapshot,
    todayControl,
    removeAfterValidation: uniqueStrings(removableKeys),
  };
}

function extractOutfitRef(value) {
  if (!value || typeof value !== 'object') return null;
  const outfitKey = normalizeString(value.outfitKey) || buildOutfitKey(value.clothingIds);
  const historyId = normalizeString(value.historyId || value.todayHistoryId);
  const favoriteId = normalizeString(value.favoriteOutfitId || value.sourceFavoriteOutfitId);
  const outfitId = normalizeString(value.outfitId || (
    value.outfitKind !== 'recommendation' && !historyId && !favoriteId ? value.id : ''
  ));
  const batchId = normalizeString(value.batchId || value.recommendationBatchId);
  const referenceId = normalizeString(value.referenceId);

  if (historyId) return { schemaVersion: 1, source: 'history', outfitKey, historyId };
  if (favoriteId) return { schemaVersion: 1, source: 'favorite', outfitKey, favoriteId };
  if (outfitId) return { schemaVersion: 1, source: 'outfit', outfitKey, outfitId };
  if (outfitKey && batchId && referenceId) {
    return { schemaVersion: 1, source: 'recommendation', outfitKey, batchId, referenceId };
  }
  return null;
}

function applyWriteValidateDelete({ writes, validate, remove, removeKeys }) {
  const writeResults = [];
  for (const write of Array.isArray(writes) ? writes : []) {
    const result = write();
    writeResults.push(result);
    if (!result || result.ok !== true) return { status: 'write-failed', writeResults, removed: [] };
  }
  if (typeof validate === 'function' && !validate()) {
    return { status: 'validation-failed', writeResults, removed: [] };
  }
  const removed = [];
  for (const key of uniqueStrings(removeKeys)) {
    remove(key);
    removed.push(key);
  }
  return { status: 'migrated', writeResults, removed };
}

function isUploadBatchImagesBusinessKey(key) {
  return key.startsWith('uploadBatchImages%3A') || key.startsWith('uploadBatchImages:');
}

function isOutfitDetailDraftBusinessKey(key) {
  return key.startsWith('outfitDetailDraft%3A') || key.startsWith('outfitDetailDraft:');
}

function isUnscopedLegacyBusinessKey(key) {
  return isUploadBatchImagesBusinessKey(key)
    || isOutfitDetailDraftBusinessKey(key)
    || key === 'outfitStateSync'
    || key.startsWith('today:outfitReturnSnapshot');
}

function getTodayControlField(key) {
  const fields = {
    'today:recommendationInput:context': 'recommendationContext',
    'today:recommendationInput:latestIdentity': 'latestIdentity',
    'today:recommendationInput:wardrobeVersion': 'wardrobeVersion',
    'today:recommendationInput:profileVersion': 'profileVersion',
    'today:recommendationInput:hardInvalid': 'hardInvalid',
  };
  return fields[key] || '';
}

function decodeLastKeyPart(key) {
  const encodedSeparator = key.lastIndexOf('%3A');
  const raw = encodedSeparator >= 0
    ? key.slice(encodedSeparator + 3)
    : key.slice(key.lastIndexOf(':') + 1);
  try { return decodeURIComponent(raw); } catch { return raw; }
}

function normalizeEntries(entries) {
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry && typeof entry.key === 'string');
}

function buildOutfitKey(values) {
  return uniqueStrings(values).sort().join('_');
}

function buildOutfitRefIdentity(ref) {
  return [ref.source, ref.historyId, ref.favoriteId, ref.outfitId, ref.batchId, ref.outfitKey, ref.referenceId]
    .filter(Boolean).join('|');
}

function dedupeBy(values, getKey) {
  const map = new Map();
  values.forEach((value) => {
    const key = getKey(value);
    if (key) map.set(key, value);
  });
  return [...map.values()];
}

function normalizeString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean))];
}

module.exports = {
  LEGACY_DIAGNOSTIC_KEYS,
  LEGACY_DIRECT_KEYS,
  LEGACY_PAGE_CACHE_PREFIX,
  LEGACY_USER_STORAGE_PREFIX,
  STORAGE_MIGRATION_VERSION,
  applyWriteValidateDelete,
  buildPostAuthMigrationPlan,
  buildPreAuthMigrationPlan,
  extractOutfitRef,
};
