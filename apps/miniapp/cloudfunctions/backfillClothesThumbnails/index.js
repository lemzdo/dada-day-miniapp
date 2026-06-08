const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const DEFAULT_SCAN_LIMIT = 200;
const MAX_SCAN_LIMIT = 1000;
const DEFAULT_WRITE_LIMIT = 20;
const MAX_WRITE_LIMIT = 50;
const THUMBNAIL_MAX_SIZE = 360;
const THUMBNAIL_QUALITY = 76;

exports.main = async (event = {}) => {
  const startedAt = Date.now();
  const { OPENID } = cloud.getWXContext();
  const dryRun = event.dryRun !== false;
  const writeLimit = Math.min(Math.max(Number(event.limit || DEFAULT_WRITE_LIMIT), 1), MAX_WRITE_LIMIT);
  const scanLimit = Math.min(Math.max(Number(event.scanLimit || Math.max(DEFAULT_SCAN_LIMIT, writeLimit)), 1), MAX_SCAN_LIMIT);
  const filter = { status: event.status || 'active' };

  if (event.allUsers !== true) {
    filter._openid = OPENID;
  }

  const stats = {
    dryRun,
    scanned: 0,
    pending: 0,
    success: 0,
    failed: 0,
    skipped: 0,
    limit: writeLimit,
    scanLimit,
    failures: [],
    durationMs: 0,
  };

  try {
    const res = await db.collection('clothes')
      .where(filter)
      .orderBy('createdAt', 'desc')
      .limit(scanLimit)
      .get();
    const items = res.data || [];
    stats.scanned = items.length;

    const pendingItems = [];
    for (const item of items) {
      if (hasThumbnail(item)) {
        stats.skipped += 1;
        continue;
      }
      if (!resolveThumbnailSourceImage(item)) {
        stats.skipped += 1;
        continue;
      }
      pendingItems.push(item);
    }
    stats.pending = pendingItems.length;

    if (!dryRun) {
      const targets = pendingItems.slice(0, writeLimit);
      for (const item of targets) {
        try {
          const thumbnailUrl = await createThumbnail(item);
          await db.collection('clothes').doc(item._id).update({
            data: {
              thumbnailUrl,
              updatedAt: new Date().toISOString(),
            },
          });
          stats.success += 1;
        } catch (error) {
          stats.failed += 1;
          stats.failures.push({
            id: item._id,
            source: resolveThumbnailSourceImage(item),
            message: getErrorMessage(error),
          });
        }
      }
    }

    stats.durationMs = Date.now() - startedAt;
    return ok(stats);
  } catch (error) {
    console.error('[backfillClothesThumbnails] failed', error);
    return fail(error);
  }
};

function hasThumbnail(item) {
  return typeof item.thumbnailUrl === 'string' && item.thumbnailUrl.trim().length > 0;
}

function resolveThumbnailSourceImage(item) {
  return item.displayImageUrl
    || item.cleanImageUrl
    || item.aiSegmentImageUrl
    || item.cropImageUrl
    || item.croppedImageUrl
    || item.imageUrl
    || item.manualCropImageUrl
    || '';
}

async function createThumbnail(item) {
  const sourceImageUrl = resolveThumbnailSourceImage(item);
  if (!sourceImageUrl) throw new Error('thumbnail source image is empty');

  const sourceBuffer = await downloadImageSource(sourceImageUrl);
  const Jimp = require('jimp');
  const image = await Jimp.read(sourceBuffer);
  image.scaleToFit(THUMBNAIL_MAX_SIZE, THUMBNAIL_MAX_SIZE).quality(THUMBNAIL_QUALITY);
  const buffer = await image.getBufferAsync(Jimp.MIME_JPEG);
  const cloudPath = `wardrobe_uploads/thumbnails/backfill/${item._openid || item.userId || 'unknown'}/${item._id}.jpg`;
  const uploadRes = await cloud.uploadFile({ cloudPath, fileContent: buffer });
  if (!uploadRes.fileID) throw new Error('thumbnail upload returned empty fileID');
  return uploadRes.fileID;
}

async function downloadImageSource(fileID) {
  if (fileID && typeof fileID === 'string' && /^https?:\/\//.test(fileID)) {
    const fetch = require('node-fetch');
    const response = await fetch(fileID, { timeout: getImageFetchTimeoutMs() });
    if (!response.ok) throw new Error(`download_image_failed_${response.status}`);
    return response.buffer();
  }
  if (!fileID || typeof fileID !== 'string' || !fileID.startsWith('cloud://')) {
    throw new Error('image must be a WeChat cloud fileID or http url');
  }
  const res = await cloud.downloadFile({ fileID });
  const buffer = res && res.fileContent;
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('downloaded image is empty');
  }
  return buffer;
}

function getImageFetchTimeoutMs() {
  return Number(process.env.IMAGE_FETCH_TIMEOUT_MS || process.env.AI_TIMEOUT_MS || 30000);
}

function getErrorMessage(error) {
  return error && error.message ? error.message : String(error || 'unknown error');
}

function ok(data) {
  return { code: 0, data, message: 'ok' };
}

function fail(error) {
  return { code: 1, data: null, message: error && error.message ? error.message : 'unknown error' };
}
