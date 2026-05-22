const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const RETENTION_DAYS = 7;
const BATCH_SIZE = 50;

exports.main = async (event = {}) => {
  try {
    const { OPENID } = cloud.getWXContext();
    const dryRun = Boolean(event.dryRun);
    const retentionDays = Math.max(Number(event.retentionDays || RETENTION_DAYS), 1);
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    const filter = {
      status: 'deleted',
      deletedAt: _.lt(cutoff),
    };

    if (event.allUsers === false && OPENID) {
      filter._openid = OPENID;
    }

    let scanned = 0;
    let removed = 0;
    let deletedFiles = [];

    while (true) {
      const res = await db.collection('clothes').where(filter).limit(BATCH_SIZE).get();
      const items = res.data || [];
      if (!items.length) break;

      scanned += items.length;
      for (const item of items) {
        const fileIDs = collectCloudFileIDs(item);
        if (!dryRun) {
          const fileResult = await deleteCloudFiles(fileIDs);
          deletedFiles = deletedFiles.concat(fileResult);
          await db.collection('clothes').doc(item._id).remove();
          removed += 1;
        }
      }

      if (dryRun || items.length < BATCH_SIZE) break;
    }

    return ok({
      dryRun,
      cutoff,
      retentionDays,
      scanned,
      removed,
      deletedFiles,
    });
  } catch (error) {
    console.error('[cleanupDeletedClothes] failed', error);
    return fail(error);
  }
};

function collectCloudFileIDs(item) {
  return [
    item.fileID,
    item.originalFileID,
    item.originalImageUrl,
    item.displayImageUrl,
    item.thumbnailUrl,
    item.cutoutImageUrl,
    item.whiteBgImageUrl,
    item.maskImageUrl,
    item.manualCropImageUrl,
    item.aiProcessedImageUrl,
    item.segmentedImageUrl,
  ]
    .filter((fileID) => typeof fileID === 'string' && fileID.startsWith('cloud://'))
    .filter((fileID, index, list) => list.indexOf(fileID) === index);
}

async function deleteCloudFiles(fileIDs) {
  if (!fileIDs.length) return [];

  try {
    const res = await cloud.deleteFile({ fileList: fileIDs });
    return res.fileList || [];
  } catch (error) {
    console.warn('[cleanupDeletedClothes] delete cloud files failed', {
      fileIDs,
      message: error && error.message ? error.message : String(error || 'unknown error'),
    });
    return [];
  }
}

function ok(data) {
  return { code: 0, data, message: 'ok' };
}

function fail(error) {
  return { code: 1, data: null, message: error && error.message ? error.message : 'unknown error' };
}
