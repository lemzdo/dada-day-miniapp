const crypto = require('crypto');
const { buildLearnedStyleProfile, PROFILE_VERSION, WINDOW_DAYS } = require('./profileBuilder');

const EVENT_COLLECTION = 'outfit_behavior_events';
const CLOTHES_COLLECTION = 'clothes';
const PROFILE_COLLECTION = 'learned_style_profiles';
const MAX_EVENTS = 1000;
const EVENT_PAGE_SIZE = 100;
const MAX_CLOTHING_IDS = 500;
const CLOTHING_BATCH_SIZE = 20;

function buildProfileDocumentId(openid) {
  const digest = crypto.createHash('sha256').update(String(openid)).digest('hex');
  return `lspv1_${digest}`;
}

async function refreshLearnedStyleProfile({ db, openid, now = new Date().toISOString(), maxEvents = MAX_EVENTS }) {
  const safeOpenid = normalizeString(openid, 128);
  if (!safeOpenid) throw new Error('openid is required');
  const events = await readRecentEvents({ db, openid: safeOpenid, now, maxEvents });
  const clothingIds = collectClothingIds(events);
  const clothes = await readClothesByIds({ db, openid: safeOpenid, clothingIds });
  const profile = buildLearnedStyleProfile({ events, clothes, now });
  const persistence = await persistProfileDocument({ db, openid: safeOpenid, profile });
  return createSafeRefreshSummary({ profile, unchanged: persistence.unchanged });
}

async function readRecentEvents({ db, openid, now, maxEvents = MAX_EVENTS, pageSize = EVENT_PAGE_SIZE }) {
  const safeOpenid = normalizeString(openid, 128);
  const nowMs = Date.parse(now);
  if (!safeOpenid || !Number.isFinite(nowMs)) return [];
  const from = new Date(nowMs - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const collection = db.collection(EVENT_COLLECTION);
  const events = [];
  const limit = Math.max(1, Math.min(pageSize, maxEvents));

  for (let offset = 0; events.length < maxEvents; offset += limit) {
    const remaining = maxEvents - events.length;
    const queryLimit = Math.min(limit, remaining);
    const filter = {
      _openid: safeOpenid,
      occurredAt: db.command && typeof db.command.gte === 'function' ? db.command.gte(from) : from,
    };
    const result = await collection
      .where(filter)
      .orderBy('occurredAt', 'desc')
      .skip(offset)
      .limit(queryLimit)
      .get();
    const page = Array.isArray(result && result.data) ? result.data : [];
    events.push(...page);
    if (page.length < queryLimit) break;
  }

  return events
    .filter((item) => item && item._openid ? item._openid === safeOpenid : true)
    .sort(compareEvents)
    .slice(-maxEvents);
}

async function readClothesByIds({ db, openid, clothingIds, batchSize = CLOTHING_BATCH_SIZE }) {
  const safeOpenid = normalizeString(openid, 128);
  const ids = normalizeIdArray(clothingIds).slice(0, MAX_CLOTHING_IDS);
  if (!safeOpenid || ids.length === 0) return [];

  const clothes = [];
  const collection = db.collection(CLOTHES_COLLECTION);
  for (let index = 0; index < ids.length; index += batchSize) {
    const batch = ids.slice(index, index + batchSize);
    const filter = {
      _openid: safeOpenid,
      _id: db.command && typeof db.command.in === 'function' ? db.command.in(batch) : batch,
    };
    try {
      const result = await collection.where(filter).limit(batch.length).get();
      const page = Array.isArray(result && result.data) ? result.data : [];
      clothes.push(...page.filter((item) => !item._openid || item._openid === safeOpenid).map(projectClothing));
    } catch (_error) {
      // A single missing/failed clothing batch must not fail the entire shadow refresh.
    }
  }
  const seen = new Set();
  return clothes.filter((item) => {
    const id = normalizeString(item._id || item.id, 160);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  }).sort((left, right) => String(left._id || left.id).localeCompare(String(right._id || right.id)));
}

async function persistProfileDocument({ db, openid, profile }) {
  const safeOpenid = normalizeString(openid, 128);
  if (!safeOpenid) throw new Error('openid is required');
  if (!profile || profile.profileVersion !== PROFILE_VERSION) throw new Error('profile version is invalid');
  if (typeof db.runTransaction !== 'function') throw new Error('profile transaction unavailable');

  const documentId = buildProfileDocumentId(safeOpenid);
  return db.runTransaction(async (transaction) => {
    const ref = transaction.collection(PROFILE_COLLECTION).doc(documentId);
    const existing = normalizeExistingDocument(await ref.get());
    const existingDigest = existing && existing.profileVersion === profile.profileVersion && existing.source && existing.source.sourceDigest;
    const nextDigest = profile.source && profile.source.sourceDigest;
    if (existingDigest && existingDigest === nextDigest) {
      return { unchanged: true, documentId, reason: 'same_digest' };
    }
    const existingLastEventAt = parseTime(existing && existing.source && existing.source.lastEventAt);
    const nextLastEventAt = parseTime(profile.source && profile.source.lastEventAt);
    if (existingLastEventAt !== null && nextLastEventAt !== null && existingLastEventAt > nextLastEventAt) {
      return { unchanged: true, documentId, reason: 'stale_source' };
    }
    const data = {
      _id: documentId,
      _openid: safeOpenid,
      ...profile,
      updatedAt: profile.generatedAt,
    };
    await ref.set({ data });
    return { unchanged: false, documentId };
  });
}

function createSafeRefreshSummary({ profile, unchanged }) {
  return {
    ok: true,
    status: profile.status,
    unchanged: Boolean(unchanged),
    eventCount: profile.source.eventCount,
    eligibleEventCount: profile.source.eligibleEventCount,
    distinctOutfitCount: profile.source.distinctOutfitCount,
    effectiveActionWeight: profile.quality.effectiveActionWeight,
    featureCoverage: profile.quality.featureCoverage,
    generatedAt: profile.generatedAt,
    profileVersion: profile.profileVersion,
  };
}

function collectClothingIds(events) {
  const ids = [];
  for (const event of Array.isArray(events) ? events : []) {
    if (Array.isArray(event && event.clothingIds)) ids.push(...event.clothingIds);
  }
  return normalizeIdArray(ids);
}

function projectClothing(item) {
  return {
    _id: item._id,
    id: item.id || item._id,
    _openid: item._openid,
    category: item.category,
    type: item.type,
    status: item.status,
    colorPalette: Array.isArray(item.colorPalette) ? item.colorPalette : undefined,
    colors: Array.isArray(item.colors) ? item.colors : undefined,
    styleTags: Array.isArray(item.styleTags) ? item.styleTags : undefined,
    style: item.style,
    aestheticFeatures: item.aestheticFeatures,
  };
}

function normalizeExistingDocument(result) {
  if (!result) return null;
  if (Array.isArray(result.data)) return result.data[0] || null;
  return result.data || null;
}

function normalizeIdArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => normalizeString(item, 160)).filter(Boolean))].sort();
}

function normalizeString(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

function parseTime(value) {
  if (typeof value !== 'string') return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function compareEvents(left, right) {
  const leftTime = parseTime(left && left.occurredAt) || 0;
  const rightTime = parseTime(right && right.occurredAt) || 0;
  if (leftTime !== rightTime) return leftTime - rightTime;
  return String(left && left.eventId || '').localeCompare(String(right && right.eventId || ''));
}

module.exports = {
  CLOTHES_COLLECTION,
  EVENT_COLLECTION,
  MAX_CLOTHING_IDS,
  MAX_EVENTS,
  PROFILE_COLLECTION,
  buildProfileDocumentId,
  collectClothingIds,
  createSafeRefreshSummary,
  persistProfileDocument,
  readClothesByIds,
  readRecentEvents,
  refreshLearnedStyleProfile,
};
