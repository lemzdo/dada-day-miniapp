const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const DELETED_STATUS = 'deleted';
const REPAIR_PAGE_SIZE = 100;
const REPAIR_TIME_BUDGET_MS = 12 * 1000;
const REPAIR_DEADLINE_BUFFER_MS = 800;
const PROCESSING_STALE_MS = 10 * 60 * 1000;
const crypto = require('crypto');
const REPAIR_STAGES = ['outfits', 'favorite_outfits', 'outfit_history'];

exports.main = async (event = {}) => {
  try {
    const { OPENID } = cloud.getWXContext();
    const batchIds = getBatchIds(event);
    if (batchIds.length > 0) return ok(await deleteBatchClothes(OPENID, batchIds));
    if (!event.id) throw new Error('id is required');

    if (event.action === 'inspect' || event.dryRun) {
      return ok(await inspectClothingReferences(OPENID, event.id));
    }

    return ok(await deleteSingleClothing(OPENID, event.id));
  } catch (error) {
    console.error('[deleteClothes] failed', {
      code: getRepairErrorCode(error),
    });
    return fail(error);
  }
};

async function deleteBatchClothes(openid, ids) {
  const successIds = [];
  const failedIds = [];
  const results = [];

  for (const id of ids) {
    try {
      const result = await deleteSingleClothing(openid, id);
      successIds.push(id);
      results.push(result);
    } catch (error) {
      console.warn('[deleteClothes] batch item failed', { id, code: getRepairErrorCode(error) });
      failedIds.push(id);
    }
  }

  return {
    successIds,
    failedIds,
    results,
    total: ids.length,
    successCount: successIds.length,
    failedCount: failedIds.length,
    referenceRepairPending: results.some((item) => item.referenceRepairPending),
  };
}

async function deleteSingleClothing(openid, id) {
  const tombstone = await loadOrInitializeDeletion(openid, id);

  if (tombstone.referenceRepairStatus === 'complete') {
    return buildDeleteResult(tombstone);
  }
  if (tombstone.referenceRepairStatus === 'processing' && !isProcessingStale(tombstone)) {
    return buildDeleteResult(tombstone);
  }

  try {
    const repaired = await repairClothingReferences(tombstone, {
      deadline: Date.now() + REPAIR_TIME_BUDGET_MS,
    });
    return buildDeleteResult(repaired);
  } catch {
    return buildDeleteResult(tombstone);
  }
}

async function loadOrInitializeDeletion(openid, id) {
  if (typeof db.runTransaction !== 'function') throw new Error('delete transaction unavailable');
  return db.runTransaction(async (transaction) => {
    const ref = transaction.collection('clothes').doc(id);
    const currentRes = await ref.get();
    const current = currentRes.data;
    if (!current || current._openid !== openid) throw new Error('clothing not found');

    if (current.status === DELETED_STATUS && isKnownRepairStatus(current.referenceRepairStatus)) {
      return current;
    }

    const now = new Date().toISOString();
    const isLegacyTombstone = current.status === DELETED_STATUS;
    const data = {
      ...(isLegacyTombstone ? {} : {
        status: DELETED_STATUS,
        deletedAt: current.deletedAt || now,
        updatedAt: now,
      }),
      referenceRepairStatus: 'pending',
      referenceRepairStage: isLegacyTombstone ? normalizeRepairStage(current.referenceRepairStage) : 'outfits',
      referenceRepairCursor: isLegacyTombstone ? normalizeCursor(current.referenceRepairCursor) : '',
      referenceRepairFoundReferences: isLegacyTombstone && Boolean(current.referenceRepairFoundReferences),
      referenceRepairUpdatedAt: now,
      referenceRepairHeartbeatAt: null,
      referenceRepairErrorCode: null,
      referenceRepairToken: null,
      preserveSnapshotAssets: true,
    };
    await ref.update({ data });
    return { ...current, ...data };
  }, 3);
}

async function repairClothingReferences(item, { deadline }) {
  let state = {
    ...item,
    referenceRepairStage: normalizeRepairStage(item.referenceRepairStage),
    referenceRepairCursor: normalizeCursor(item.referenceRepairCursor),
    referenceRepairFoundReferences: Boolean(item.referenceRepairFoundReferences),
  };

  state = await acquireRepairLease(state);
  if (!state.referenceRepairLeaseAcquired) return state;
  const repairToken = state.referenceRepairToken;

  try {
    while (state.referenceRepairStage !== 'complete') {
      if (isNearDeadline(deadline)) {
        const saved = await saveRepairProgress(state, {
          referenceRepairStatus: 'pending',
          referenceRepairToken: null,
        });
        return saved;
      }

      const stage = state.referenceRepairStage;
      const page = await readRepairPage(item._openid, stage, state.referenceRepairCursor);
      if (!page.length) {
        state = await advanceRepairStage(state, repairToken);
        if (!isRepairOwned(state, repairToken)) return state;
        continue;
      }

      let pageFoundReference = false;
      for (const record of page) {
        if (!recordHasClothing(record, item._id)) continue;
        pageFoundReference = true;
        await markRecordClothingDeleted(stage, record, item, new Date().toISOString());
      }

      state = await saveRepairProgress(state, {
        referenceRepairStatus: 'processing',
        referenceRepairCursor: page[page.length - 1]._id,
        referenceRepairFoundReferences: state.referenceRepairFoundReferences || pageFoundReference,
        referenceRepairToken: repairToken,
        referenceRepairHeartbeatAt: new Date().toISOString(),
      });
      if (!isRepairOwned(state, repairToken)) return state;

      if (page.length < REPAIR_PAGE_SIZE) {
        state = await advanceRepairStage(state, repairToken);
        if (!isRepairOwned(state, repairToken)) return state;
      }
    }

    return saveRepairProgress(state, {
      referenceRepairStatus: 'complete',
      referenceRepairStage: 'complete',
      referenceRepairCursor: '',
      referenceRepairErrorCode: null,
      preserveSnapshotAssets: Boolean(state.referenceRepairFoundReferences),
      referenceRepairToken: null,
    });
  } catch (error) {
    return saveRepairProgress(state, {
      referenceRepairStatus: 'failed',
      referenceRepairErrorCode: getRepairErrorCode(error),
      preserveSnapshotAssets: true,
      referenceRepairToken: null,
    });
  }
}

async function acquireRepairLease(state) {
  const repairToken = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString();

  return db.runTransaction(async (transaction) => {
    const ref = transaction.collection('clothes').doc(state._id);
    const currentRes = await ref.get();
    const current = currentRes.data;
    if (!current) return { ...state, referenceRepairLeaseAcquired: false };
    if (current.referenceRepairStatus === 'complete') return { ...state, ...current, referenceRepairLeaseAcquired: false };
    if (current.referenceRepairStatus === 'processing' && !isProcessingStale(current)) {
      return { ...state, ...current, referenceRepairLeaseAcquired: false };
    }

    const data = {
      referenceRepairStatus: 'processing',
      referenceRepairErrorCode: null,
      referenceRepairToken: repairToken,
      referenceRepairHeartbeatAt: now,
      referenceRepairUpdatedAt: now,
    };
    await ref.update({ data });
    return { ...state, ...current, ...data, referenceRepairLeaseAcquired: true };
  }, 3);
}

async function readRepairPage(openid, collectionName, cursor) {
  const filter = { _openid: openid };
  if (cursor) filter._id = _.gt(cursor);
  const res = await db.collection(collectionName)
    .where(filter)
    .orderBy('_id', 'asc')
    .limit(REPAIR_PAGE_SIZE)
    .get();
  return res.data || [];
}

async function advanceRepairStage(state, repairToken) {
  const currentIndex = REPAIR_STAGES.indexOf(state.referenceRepairStage);
  const nextStage = currentIndex >= 0 && currentIndex < REPAIR_STAGES.length - 1
    ? REPAIR_STAGES[currentIndex + 1]
    : 'complete';
  return saveRepairProgress(state, {
    referenceRepairStage: nextStage,
    referenceRepairCursor: '',
    referenceRepairToken: repairToken,
  });
}

async function saveRepairProgress(state, patch) {
  const now = new Date().toISOString();
  const data = {
    ...patch,
    referenceRepairUpdatedAt: now,
  };

  return db.runTransaction(async (transaction) => {
    const ref = transaction.collection('clothes').doc(state._id);
    const current = await ref.get();
    const currentData = current.data;
    if (!currentData) return state;
    if (
      currentData.referenceRepairStatus !== 'processing'
      || !state.referenceRepairToken
      || currentData.referenceRepairToken !== state.referenceRepairToken
    ) {
      return { ...state, ...currentData };
    }

    const hasCursor = 'referenceRepairCursor' in patch;
    const hasFoundReferences = 'referenceRepairFoundReferences' in patch;
    if (hasCursor && current.data.referenceRepairCursor && !isCursorAdvanced(patch.referenceRepairCursor, current.data.referenceRepairCursor)) {
      delete data.referenceRepairCursor;
    }
    if (hasFoundReferences && current.data.referenceRepairFoundReferences) {
      data.referenceRepairFoundReferences = true;
    }

    await ref.update({ data });
    return { ...state, ...data };
  }, 3);
}

function isRepairOwned(state, repairToken = state.referenceRepairToken) {
  return Boolean(
    state
      && state.referenceRepairStatus === 'processing'
      && state.referenceRepairToken
      && state.referenceRepairToken === repairToken,
  );
}

function isCursorAdvanced(newCursor, oldCursor) {
  if (!oldCursor) return true;
  if (!newCursor) return false;
  return String(newCursor) > String(oldCursor);
}

async function markRecordClothingDeleted(collectionName, record, deletedItem, now) {
  if (collectionName === 'outfits') {
    const snapshotItems = markSnapshotArray(record.snapshotItems, deletedItem, now, false);
    const deletedItemCount = countDeletedSnapshots(snapshotItems);
    await db.collection(collectionName).doc(record._id).update({
      data: {
        snapshotItems,
        incomplete: deletedItemCount > 0,
        deletedItemCount,
        updatedAt: now,
      },
    });
    return;
  }

  const itemsSnapshot = markSnapshotArray(record.itemsSnapshot, deletedItem, now, true);
  const snapshotItems = markSnapshotArray(record.snapshotItems, deletedItem, now, false);
  const deletedItemCount = Math.max(
    countDeletedSnapshots(itemsSnapshot),
    countDeletedSnapshots(snapshotItems),
  );
  await db.collection(collectionName).doc(record._id).update({
    data: {
      itemsSnapshot,
      snapshotItems,
      incomplete: deletedItemCount > 0,
      deletedItemCount,
      updatedAt: now,
    },
  });
}

function markSnapshotArray(value, deletedItem, now, detailed) {
  const items = Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') : [];
  let matched = false;
  const next = items.map((item) => {
    if (getSnapshotClothingId(item) !== deletedItem._id) return item;
    matched = true;
    return markSnapshotDeleted(item, now);
  });
  if (!matched) next.push(buildDeletedSnapshot(deletedItem, now, detailed));
  return next;
}

function markSnapshotDeleted(item, now) {
  return {
    ...item,
    isDeleted: true,
    deletedAt: item.deletedAt || now,
    ...(Object.prototype.hasOwnProperty.call(item, 'status') ? { status: DELETED_STATUS } : {}),
  };
}

function buildDeletedSnapshot(item, now, detailed) {
  const base = {
    itemId: item._id,
    clothingId: item._id,
    name: readName(item) || '已删除衣物',
    type: item.subcategory || item.subCategory || item.category || 'other',
    category: item.category || 'other',
    color: readColors(item),
    imageUrl: item.imageUrl || item.displayImageUrl || item.thumbnailUrl || '',
    displayImageUrl: item.displayImageUrl || item.imageUrl || item.thumbnailUrl || '',
    thumbnailUrl: item.thumbnailUrl || item.displayImageUrl || item.imageUrl || '',
    isDeleted: true,
    deletedAt: now,
  };
  if (!detailed) return base;
  return {
    ...base,
    style: Array.isArray(item.styleTags) ? item.styleTags.join(' / ') : '',
    thickness: item.thickness || '',
    material: item.material || item.materialGuess || '',
  };
}

function recordHasClothing(record, clothingId) {
  if (Array.isArray(record.clothingIds) && record.clothingIds.includes(clothingId)) return true;
  return [record.itemsSnapshot, record.snapshotItems].some((items) =>
    Array.isArray(items) && items.some((item) => getSnapshotClothingId(item) === clothingId),
  );
}

function getSnapshotClothingId(item) {
  return item && (item.clothingId || item.itemId);
}

function countDeletedSnapshots(items) {
  return (items || []).filter((item) => item && (
    item.isDeleted || item.deletedAt || item.status === DELETED_STATUS
  )).length;
}

async function inspectClothingReferences(openid, id) {
  const current = await db.collection('clothes').doc(id).get();
  if (!current.data || current.data._openid !== openid) throw new Error('clothing not found');

  const counts = {
    outfits: 0,
    favorite_outfits: 0,
    outfit_history: 0,
  };
  for (const stage of REPAIR_STAGES) {
    let cursor = '';
    let hasMore = true;
    while (hasMore) {
      const page = await readRepairPage(openid, stage, cursor);
      counts[stage] += page.filter((record) => recordHasClothing(record, id)).length;
      hasMore = page.length === REPAIR_PAGE_SIZE;
      if (!hasMore) break;
      cursor = page[page.length - 1]._id;
    }
  }

  return {
    id,
    affectedFavoriteCount: counts.favorite_outfits,
    affectedHistoryCount: counts.outfit_history,
    affectedOutfitCount: counts.outfits + counts.favorite_outfits + counts.outfit_history,
  };
}

function buildDeleteResult(item) {
  const status = item.referenceRepairStatus || 'pending';
  return {
    id: item._id,
    deletedAt: item.deletedAt,
    referenceRepairStatus: status,
    referenceRepairPending: status !== 'complete',
    referenceRepairFoundReferences: Boolean(item.referenceRepairFoundReferences),
  };
}

function normalizeRepairStage(value) {
  return REPAIR_STAGES.includes(value) || value === 'complete' ? value : 'outfits';
}

function normalizeCursor(value) {
  return typeof value === 'string' ? value : '';
}

function isKnownRepairStatus(value) {
  return ['pending', 'processing', 'complete', 'failed'].includes(value);
}

function isNearDeadline(deadline) {
  return Date.now() >= deadline - REPAIR_DEADLINE_BUFFER_MS;
}

function isProcessingStale(item) {
  const heartbeatAt = Date.parse(item.referenceRepairHeartbeatAt || item.referenceRepairUpdatedAt || '');
  return !Number.isFinite(heartbeatAt) || Date.now() - heartbeatAt >= PROCESSING_STALE_MS;
}

function getBatchIds(event) {
  const rawIds = Array.isArray(event.ids) ? event.ids : Array.isArray(event.clothesIds) ? event.clothesIds : [];
  return Array.from(new Set(rawIds.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim())));
}

function getRepairErrorCode(error) {
  if (error && typeof error.repairErrorCode === 'string') return error.repairErrorCode;
  const message = String(error && (error.errMsg || error.message || error) || '');
  if (/timeout|time limit/i.test(message)) return 'REFERENCE_REPAIR_TIMEOUT';
  if (/not found/i.test(message)) return 'REFERENCE_REPAIR_NOT_FOUND';
  return 'REFERENCE_REPAIR_FAILED';
}

function readName(item) {
  if (!item) return '';
  return item.customName || item.subcategory || item.subCategory || item.category || '';
}

function readColors(item) {
  if (!item) return '';
  if (Array.isArray(item.colorPalette)) {
    return item.colorPalette.map((color) => color && color.name).filter(Boolean).join(' / ');
  }
  if (Array.isArray(item.colors)) return item.colors.filter(Boolean).join(' / ');
  return item.color || '';
}

function ok(data) {
  return { code: 0, data, message: 'ok' };
}

function fail(error) {
  const message = error && error.message === 'clothing not found'
    ? 'clothing not found'
    : '删除衣物暂时未完成，请稍后再试';
  return { code: 1, data: null, message };
}
