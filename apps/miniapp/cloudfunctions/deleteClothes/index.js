const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const DELETED_STATUS = 'deleted';

exports.main = async (event = {}) => {
  try {
    const { OPENID } = cloud.getWXContext();
    if (!event.id) throw new Error('id is required');

    const collection = db.collection('clothes');
    const current = await collection.doc(event.id).get();
    if (!current.data || current.data._openid !== OPENID) throw new Error('clothing not found');

    const impact = await getDeleteImpact(OPENID, event.id);
    if (event.action === 'inspect' || event.dryRun) {
      return ok({
        id: event.id,
        affectedFavoriteCount: impact.affectedFavoriteCount,
        affectedHistoryCount: impact.affectedHistoryCount,
        affectedOutfitCount: impact.affectedOutfitCount,
      });
    }

    const now = new Date().toISOString();
    await ensureOutfitSnapshots({
      openid: OPENID,
      clothingId: event.id,
      deletedItem: current.data,
      outfits: impact.outfits,
      favoriteOutfits: impact.favoriteOutfits,
      historyOutfits: impact.historyOutfits,
      now,
    });

    await collection.doc(event.id).update({
      data: {
        status: DELETED_STATUS,
        deletedAt: now,
        updatedAt: now,
      },
    });

    return ok({
      id: event.id,
      deletedAt: now,
      affectedFavoriteCount: impact.affectedFavoriteCount,
      affectedHistoryCount: impact.affectedHistoryCount,
      affectedOutfitCount: impact.affectedOutfitCount,
    });
  } catch (error) {
    console.error('[deleteClothes] failed', error);
    return fail(error);
  }
};

async function getDeleteImpact(openid, clothingId) {
  const outfitsRes = await db.collection('outfits').where({ _openid: openid }).limit(500).get();
  const outfits = (outfitsRes.data || []).filter((outfit) =>
    Array.isArray(outfit.clothingIds) && outfit.clothingIds.includes(clothingId),
  );
  const favoriteRes = await db.collection('favorite_outfits').where({ _openid: openid }).limit(500).get();
  const favoriteOutfits = (favoriteRes.data || []).filter((outfit) => recordHasClothing(outfit, clothingId));
  const historyRes = await db.collection('outfit_history').where({ _openid: openid }).limit(500).get();
  const historyOutfits = (historyRes.data || []).filter((outfit) => recordHasClothing(outfit, clothingId));

  return {
    affectedFavoriteCount: favoriteOutfits.length,
    affectedHistoryCount: historyOutfits.length,
    affectedOutfitCount: outfits.length + favoriteOutfits.length + historyOutfits.length,
    outfits,
    favoriteOutfits,
    historyOutfits,
  };
}

function recordHasClothing(record, clothingId) {
  if (Array.isArray(record.clothingIds) && record.clothingIds.includes(clothingId)) return true;
  return Array.isArray(record.itemsSnapshot) && record.itemsSnapshot.some((item) => item.clothingId === clothingId || item.itemId === clothingId);
}

async function ensureOutfitSnapshots({ openid, clothingId, deletedItem, outfits, favoriteOutfits, historyOutfits, now }) {
  await ensureLegacyOutfitSnapshots({ openid, clothingId, deletedItem, outfits, now });
  await markSnapshotDeleted('favorite_outfits', clothingId, favoriteOutfits || [], now);
  await markSnapshotDeleted('outfit_history', clothingId, historyOutfits || [], now);
}

async function ensureLegacyOutfitSnapshots({ openid, clothingId, deletedItem, outfits, now }) {
  if (!outfits.length) return;

  for (const outfit of outfits) {
    const clothingIds = Array.isArray(outfit.clothingIds) ? outfit.clothingIds : [];
    const clothesMap = await loadClothesMap(openid, clothingIds, deletedItem);
    const existingSnapshots = normalizeSnapshotItems(outfit.snapshotItems);
    const snapshotMap = new Map(existingSnapshots.map((item) => [item.itemId, item]));
    const snapshotItems = clothingIds.map((id) => {
      const source = clothesMap.get(id);
      const existing = snapshotMap.get(id);
      return {
        ...snapshotFromClothing(source, existing, id),
        isDeleted: id === clothingId ? true : Boolean(existing && existing.isDeleted),
      };
    });

    await db.collection('outfits').doc(outfit._id).update({
      data: {
        snapshotItems,
        incomplete: snapshotItems.some((item) => item.isDeleted),
        deletedItemCount: snapshotItems.filter((item) => item.isDeleted).length,
        updatedAt: now,
      },
    });
  }
}

async function markSnapshotDeleted(collectionName, clothingId, records, now) {
  for (const record of records) {
    const itemsSnapshot = normalizeDetailedSnapshotItems(record.itemsSnapshot).map((item) =>
      item.clothingId === clothingId || item.itemId === clothingId
        ? { ...item, deletedAt: item.deletedAt || now }
        : item,
    );
    const snapshotItems = normalizeSnapshotItems(record.snapshotItems).map((item) =>
      item.itemId === clothingId ? { ...item, isDeleted: true } : item,
    );

    await db.collection(collectionName).doc(record._id).update({
      data: {
        itemsSnapshot,
        snapshotItems,
        updatedAt: now,
      },
    });
  }
}

function normalizeDetailedSnapshotItems(value) {
  return Array.isArray(value)
    ? value
        .map((item) => {
          const clothingId = item && (item.clothingId || item.itemId);
          if (!clothingId || typeof clothingId !== 'string') return null;
          return {
            ...item,
            clothingId,
            itemId: clothingId,
          };
        })
        .filter(Boolean)
    : [];
}

async function loadClothesMap(openid, ids, deletedItem) {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  const result = new Map();
  if (!uniqueIds.length) return result;

  const res = await db.collection('clothes').where({
    _openid: openid,
    _id: db.command.in(uniqueIds),
  }).limit(100).get();

  for (const item of res.data || []) {
    result.set(item._id, item);
  }
  if (deletedItem && deletedItem._id) {
    result.set(deletedItem._id, deletedItem);
  }
  return result;
}

function normalizeSnapshotItems(value) {
  return Array.isArray(value)
    ? value.filter((item) => item && typeof item.itemId === 'string')
    : [];
}

function snapshotFromClothing(item, fallback, itemId) {
  const colors = readColors(item) || readColors(fallback);
  return {
    itemId,
    name: readName(item) || fallback?.name || fallback?.category || '已删除衣服',
    category: item?.category || fallback?.category || 'other',
    color: colors,
    thumbnailUrl: getSnapshotThumbnail(item) || fallback?.thumbnailUrl || '',
    isDeleted: Boolean(item?.status === DELETED_STATUS || fallback?.isDeleted),
  };
}

function readName(item) {
  if (!item) return '';
  return item.customName || item.subcategory || item.subCategory || item.category || '';
}

function readColors(item) {
  if (!item) return '';
  if (Array.isArray(item.colorPalette) && item.colorPalette.length > 0) {
    return item.colorPalette.map((color) => color.name).filter(Boolean).join(' / ');
  }
  if (Array.isArray(item.colors) && item.colors.length > 0) {
    return item.colors.filter(Boolean).join(' / ');
  }
  return item.color || '';
}

function getSnapshotThumbnail(item) {
  if (!item) return '';
  return item.thumbnailUrl || item.displayImageUrl || item.originalImageUrl || '';
}

function ok(data) {
  return { code: 0, data, message: 'ok' };
}

function fail(error) {
  return { code: 1, data: null, message: error && error.message ? error.message : 'unknown error' };
}
