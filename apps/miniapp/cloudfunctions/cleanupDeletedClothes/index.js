const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const DELETED_STATUS = 'deleted';
const RETENTION_DAYS = 7;
const REPAIR_PAGE_SIZE = 100;
const TOMBSTONE_PAGE_SIZE = 50;
const MAX_HANDLED_TOMBSTONES = 50;
const CLEANUP_TIME_BUDGET_MS = 15 * 1000;
const DEADLINE_BUFFER_MS = 1000;
const PROCESSING_STALE_MS = 10 * 60 * 1000;
const SNAPSHOT_FILE_SCAN_PAGE_SIZE = 100;
const crypto = require('crypto');
const REPAIR_STAGES = ['outfits', 'favorite_outfits', 'outfit_history'];
const CLOTHING_IMAGE_FIELDS = [
  'fileID',
  'originalFileID',
  'imageUrl',
  'originalImageUrl',
  'normalizedImageUrl',
  'displayImageUrl',
  'thumbnailUrl',
  'thumbImageUrl',
  'cropImageUrl',
  'croppedImageUrl',
  'cleanImageUrl',
  'cutoutImageUrl',
  'whiteBgImageUrl',
  'maskImageUrl',
  'manualCropImageUrl',
  'aiProcessedImageUrl',
  'aiSegmentImageUrl',
  'segmentedImageUrl',
];

exports.main = async (event = {}) => {
  try {
    const { OPENID } = cloud.getWXContext();
    const dryRun = Boolean(event.dryRun);
    const retentionDays = Math.max(Number(event.retentionDays || RETENTION_DAYS), 1);
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    const deadline = Date.now() + CLEANUP_TIME_BUDGET_MS;
    const filter = { status: DELETED_STATUS };
    if (event.allUsers === false && OPENID) filter._openid = OPENID;

    let cursor = '';
    let scanned = 0;
    let handled = 0;
    let repaired = 0;
    let removed = 0;
    let preservedFiles = 0;
    let deletedFiles = 0;
    let pending = 0;

    while (!isNearDeadline(deadline) && handled < MAX_HANDLED_TOMBSTONES) {
      const page = await readTombstonePage(filter, cursor);
      if (!page.length) break;

      for (const rawItem of page) {
        scanned += 1;
        cursor = rawItem._id;
        if (isNearDeadline(deadline) || handled >= MAX_HANDLED_TOMBSTONES) break;

        let item = rawItem;
        if (!isKnownRepairStatus(item.referenceRepairStatus)) {
          if (dryRun) {
            pending += 1;
            continue;
          }
          item = await initializeLegacyRepairState(item);
        }

        if (shouldResumeRepair(item)) {
          handled += 1;
          if (dryRun) {
            pending += 1;
            continue;
          }
          item = await repairClothingReferences(item, { deadline });
          if (item.referenceRepairStatus === 'complete') repaired += 1;
        }

        if (item.referenceRepairStatus !== 'complete') {
          pending += 1;
          continue;
        }
        if (!isOlderThanCutoff(item.deletedAt, cutoff)) continue;

        handled += 1;
        if (dryRun) continue;
        const result = await cleanupCompletedTombstone(item, { deadline });
        if (result.removed) removed += 1;
        preservedFiles += result.preservedFiles;
        deletedFiles += result.deletedFiles;
      }

      if (page.length < TOMBSTONE_PAGE_SIZE) break;
    }

    return ok({
      dryRun,
      cutoff,
      retentionDays,
      scanned,
      handled,
      repaired,
      pending,
      removed,
      preservedFiles,
      deletedFiles,
      budgetExhausted: isNearDeadline(deadline) || handled >= MAX_HANDLED_TOMBSTONES,
    });
  } catch (error) {
    console.error('[cleanupDeletedClothes] failed', { code: getRepairErrorCode(error) });
    return fail();
  }
};

async function readTombstonePage(baseFilter, cursor) {
  const filter = { ...baseFilter };
  if (cursor) filter._id = _.gt(cursor);
  const res = await db.collection('clothes')
    .where(filter)
    .orderBy('_id', 'asc')
    .limit(TOMBSTONE_PAGE_SIZE)
    .get();
  return res.data || [];
}

async function initializeLegacyRepairState(item) {
  const now = new Date().toISOString();
  const data = {
    referenceRepairStatus: 'pending',
    referenceRepairStage: 'outfits',
    referenceRepairCursor: '',
    referenceRepairFoundReferences: false,
    referenceRepairUpdatedAt: now,
    referenceRepairHeartbeatAt: null,
    referenceRepairErrorCode: null,
    referenceRepairToken: null,
    preserveSnapshotAssets: true,
  };
  await db.collection('clothes').doc(item._id).update({ data });
  return { ...item, ...data };
}

function shouldResumeRepair(item) {
  if (item.referenceRepairStatus === 'pending' || item.referenceRepairStatus === 'failed') return true;
  return item.referenceRepairStatus === 'processing' && isProcessingStale(item.referenceRepairUpdatedAt, item.referenceRepairHeartbeatAt);
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
    if (current.referenceRepairStatus === 'processing' && !isProcessingStale(current.referenceRepairUpdatedAt, current.referenceRepairHeartbeatAt)) {
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
  const data = { ...patch, referenceRepairUpdatedAt: now };

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
      data: { snapshotItems, incomplete: deletedItemCount > 0, deletedItemCount, updatedAt: now },
    });
    return;
  }

  const itemsSnapshot = markSnapshotArray(record.itemsSnapshot, deletedItem, now, true);
  const snapshotItems = markSnapshotArray(record.snapshotItems, deletedItem, now, false);
  const deletedItemCount = Math.max(countDeletedSnapshots(itemsSnapshot), countDeletedSnapshots(snapshotItems));
  await db.collection(collectionName).doc(record._id).update({
    data: { itemsSnapshot, snapshotItems, incomplete: deletedItemCount > 0, deletedItemCount, updatedAt: now },
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

async function cleanupCompletedTombstone(item, { deadline }) {
  const fileIDs = collectCloudFileIDs(item);
  const deletable = [];
  let preservedFiles = 0;

  if (item.preserveSnapshotAssets) {
    preservedFiles += fileIDs.length;
  } else {
    for (const fileID of fileIDs) {
      const ownership = await inspectFileOwnership(item, fileID, { deadline });
      if (ownership === 'exclusive') deletable.push(fileID);
      else preservedFiles += 1;
    }

    const deletion = await deleteCloudFiles(deletable);
    if (!deletion.success) {
      await saveCleanupFailure(item._id, deletion.errorCode);
      return { removed: false, preservedFiles, deletedFiles: deletion.deletedCount };
    }
  }

  await db.collection('clothes').doc(item._id).remove();
  return { removed: true, preservedFiles, deletedFiles: deletable.length };
}

async function inspectFileOwnership(item, fileID, { deadline }) {
  try {
    for (const field of CLOTHING_IMAGE_FIELDS) {
      const res = await db.collection('clothes').where({ [field]: fileID }).limit(2).get();
      if ((res.data || []).some((clothing) => clothing._id !== item._id)) return 'shared';
    }

    const snapshotOwnership = await inspectSnapshotFileOwnership(item._openid, fileID, { deadline });
    if (snapshotOwnership !== 'exclusive') return snapshotOwnership;

    return 'exclusive';
  } catch {
    logCleanupWarning('CLEANUP_FILE_OWNERSHIP_UNKNOWN');
    return 'unknown';
  }
}

async function inspectSnapshotFileOwnership(openid, fileID, { deadline }) {
  if (!openid) return 'unknown';
  try {
    for (const collectionName of REPAIR_STAGES) {
      let cursor = '';
      let hasMore = true;
      while (hasMore) {
        if (isNearDeadline(deadline)) return 'unknown';
        const filter = { _openid: openid };
        if (cursor) filter._id = _.gt(cursor);
        const res = await db.collection(collectionName)
          .where(filter)
          .orderBy('_id', 'asc')
          .limit(SNAPSHOT_FILE_SCAN_PAGE_SIZE)
          .get();
        const page = res.data || [];
        if (page.some((record) => recordSnapshotHasFileID(record, fileID))) return 'shared';
        hasMore = page.length === SNAPSHOT_FILE_SCAN_PAGE_SIZE;
        if (hasMore) cursor = page[page.length - 1]._id;
      }
    }
    return 'exclusive';
  } catch {
    logCleanupWarning('CLEANUP_SNAPSHOT_FILE_SCAN_FAILED');
    return 'unknown';
  }
}

function recordSnapshotHasFileID(record, fileID) {
  return [record.snapshotItems, record.itemsSnapshot].some((items) =>
    Array.isArray(items) && items.some((item) => snapshotItemHasFileID(item, fileID)),
  );
}

function snapshotItemHasFileID(item, fileID) {
  return Boolean(
    item
      && typeof item === 'object'
      && CLOTHING_IMAGE_FIELDS.some((field) => item[field] === fileID),
  );
}

function collectCloudFileIDs(item) {
  return CLOTHING_IMAGE_FIELDS
    .map((field) => item[field])
    .filter((fileID) => typeof fileID === 'string' && fileID.startsWith('cloud://'))
    .filter((fileID, index, list) => list.indexOf(fileID) === index);
}

async function deleteCloudFiles(fileIDs) {
  if (!fileIDs.length) return { success: true, deletedCount: 0 };
  try {
    const res = await cloud.deleteFile({ fileList: fileIDs });
    const resultMap = new Map((res.fileList || []).map((item) => [item.fileID, item]));
    let deletedCount = 0;
    for (const fileID of fileIDs) {
      const result = resultMap.get(fileID);
      if (!result || !isSuccessfulFileDeletion(result)) {
        return { success: false, deletedCount, errorCode: 'CLEANUP_FILE_DELETE_FAILED' };
      }
      deletedCount += 1;
    }
    return { success: true, deletedCount };
  } catch {
    logCleanupWarning('CLEANUP_FILE_DELETE_FAILED');
    return { success: false, deletedCount: 0, errorCode: 'CLEANUP_FILE_DELETE_FAILED' };
  }
}

function isSuccessfulFileDeletion(result) {
  if (result.status === 0 || result.status === '0' || result.errCode === 0) return true;
  const message = String(result.errMsg || result.message || '');
  return /not[ _-]?found|not exist|does not exist|不存在/i.test(message);
}

async function saveCleanupFailure(id, errorCode) {
  await db.collection('clothes').doc(id).update({
    data: {
      cleanupStatus: 'failed',
      cleanupErrorCode: errorCode,
      cleanupUpdatedAt: new Date().toISOString(),
    },
  });
}

function logCleanupWarning(code) {
  console.warn('[cleanupDeletedClothes] skipped unsafe file deletion', { code });
}

function isOlderThanCutoff(deletedAt, cutoff) {
  return typeof deletedAt === 'string' && deletedAt < cutoff;
}

function isProcessingStale(updatedAt, heartbeatAt) {
  const timestamp = Date.parse(heartbeatAt || updatedAt || '');
  return !Number.isFinite(timestamp) || Date.now() - timestamp >= PROCESSING_STALE_MS;
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
  return Date.now() >= deadline - DEADLINE_BUFFER_MS;
}

function getRepairErrorCode(error) {
  const message = String(error && (error.errMsg || error.message || error) || '');
  if (/timeout|time limit/i.test(message)) return 'REFERENCE_REPAIR_TIMEOUT';
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

function fail() {
  return { code: 1, data: null, message: '清理任务暂时未完成，将在下次继续' };
}
