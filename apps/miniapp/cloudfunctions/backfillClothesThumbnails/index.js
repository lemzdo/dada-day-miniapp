const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const { createThumbnail, resolveThumbnailSource } = require('./shared/thumbnail');

const DEFAULT_SCAN_LIMIT = 200;
const MAX_SCAN_LIMIT = 1000;
const DEFAULT_WRITE_LIMIT = 20;
const MAX_WRITE_LIMIT = 50;

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
      if (!resolveThumbnailSource(item)) {
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
          const thumbnailUrl = await createThumbnail({
            cloud,
            item,
            cloudPath: `wardrobe_uploads/thumbnails/backfill/${item._openid || item.userId || 'unknown'}/${item._id}.jpg`,
          });
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
            source: resolveThumbnailSource(item),
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

function getErrorMessage(error) {
  return error && error.message ? error.message : String(error || 'unknown error');
}

function ok(data) {
  return { code: 0, data, message: 'ok' };
}

function fail(error) {
  return { code: 1, data: null, message: error && error.message ? error.message : 'unknown error' };
}
