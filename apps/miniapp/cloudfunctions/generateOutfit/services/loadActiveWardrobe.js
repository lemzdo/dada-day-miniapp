const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_ITEMS = 1000;

async function loadActiveWardrobe({
  database,
  openid,
  pageSize = DEFAULT_PAGE_SIZE,
  maxItems = DEFAULT_MAX_ITEMS,
}) {
  if (!database) throw new Error('database is required');
  if (!openid) throw new Error('openid is required');

  const safePageSize = clampInteger(pageSize, 1, DEFAULT_PAGE_SIZE);
  const safeMaxItems = clampInteger(maxItems, 1, DEFAULT_MAX_ITEMS);
  const byId = new Map();

  for (let skip = 0; skip < safeMaxItems; skip += safePageSize) {
    const limit = Math.min(safePageSize, safeMaxItems - skip);
    const res = await database
      .collection('clothes')
      .where({ _openid: openid, status: 'active' })
      .orderBy('createdAt', 'desc')
      .skip(skip)
      .limit(limit)
      .get();
    const page = Array.isArray(res.data) ? res.data : [];

    for (const item of page) {
      if (!item || item._openid !== openid || item.status === 'deleted' || item.status !== 'active') continue;
      if (!item._id || byId.has(item._id)) continue;
      byId.set(item._id, item);
    }

    if (page.length < limit) break;
  }

  return Array.from(byId.values());
}

function clampInteger(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return max;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

module.exports = {
  DEFAULT_MAX_ITEMS,
  DEFAULT_PAGE_SIZE,
  loadActiveWardrobe,
};
