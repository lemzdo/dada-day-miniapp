const crypto = require('crypto');

const PROFILE_VERSION = 'learned-style-v1';
const WINDOW_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_SIGNALS_PER_SIDE = 5;
const MAX_STYLE_TAGS_PER_OUTFIT = 8;

const DIMENSIONS = [
  'fit',
  'silhouette',
  'patternType',
  'designElement',
  'formalityLevel',
  'colorFamily',
  'styleTag',
];

const SCENES = ['home', 'work', 'date', 'sport'];
const CONFIDENT_LEVELS = new Set(['high', 'medium']);
const FIT_VALUES = new Set(['fitted', 'regular', 'relaxed', 'oversized']);
const SILHOUETTE_VALUES = new Set(['straight', 'boxy', 'aLine', 'xLine', 'cocoon', 'tapered', 'wideLeg', 'flare', 'bodycon']);
const PATTERN_VALUES = new Set(['solid', 'stripe', 'plaid', 'floral', 'graphic', 'polkaDot', 'animal', 'abstract', 'colorBlock', 'other']);
const DESIGN_VALUES = new Set([
  'ruffle',
  'pleat',
  'lace',
  'cutout',
  'asymmetry',
  'hardware',
  'embroidery',
  'distressed',
  'layered',
  'bow',
  'puffSleeve',
  'sheer',
  'fringe',
  'belted',
]);

const HALF_LIFE_DAYS = {
  outfit_detail_view: 45,
  outfit_favorite: 120,
  outfit_unfavorite: 120,
  outfit_wear: 180,
  recommendation_batch_refresh: 30,
};

const BASE_WEIGHTS = {
  outfit_detail_view: 0.5,
  outfit_favorite: 2,
  outfit_unfavorite: -2.5,
  recommendation_batch_refresh: -0.2,
};

function buildLearnedStyleProfile({ events, clothes, now }) {
  const nowMs = parseTime(now);
  if (nowMs === null) throw new Error('now must be a valid ISO timestamp');

  const normalizedEvents = Array.isArray(events) ? events.slice() : [];
  const clothesById = buildClothesMap(clothes);
  const outfitClothingIds = buildOutfitClothingIdMap(normalizedEvents);
  const sortedEvents = normalizedEvents
    .map((raw, inputIndex) => ({ raw, inputIndex, timeMs: parseTime(raw && raw.occurredAt) }))
    .filter((item) => item.timeMs !== null && isInsideWindow(item.timeMs, nowMs))
    .sort(compareEventItems);

  const globalAccumulator = createAccumulator();
  const contextAccumulators = Object.fromEntries(SCENES.map((scene) => [scene, createAccumulator()]));
  const source = {
    windowDays: WINDOW_DAYS,
    from: new Date(nowMs - WINDOW_DAYS * DAY_MS).toISOString(),
    to: new Date(nowMs).toISOString(),
    eventCount: sortedEvents.length,
    eligibleEventCount: 0,
    exposureCount: 0,
    distinctOutfitCount: 0,
    sourceDigest: '',
  };
  const quality = {
    effectiveActionWeight: 0,
    featureCoverage: 0,
    contextCoverage: 0,
    positiveActionCount: 0,
    negativeActionCount: 0,
    wearCount: 0,
    repeatedWearCount: 0,
  };

  const wearCounts = new Map();
  const exposedBatchOutfits = new Set();
  const refreshCap = new Map();
  const contributionDigestParts = [];
  const distinctOutfits = new Set();
  let featureWeight = 0;
  let contextWeight = 0;
  let lastEventAt;

  for (const item of sortedEvents) {
    const event = item.raw || {};
    const eventType = event.eventType;
    const eventId = normalizeString(event.eventId, 160) || `index-${item.inputIndex}`;
    lastEventAt = event.occurredAt;

    if (eventType === 'recommendation_exposure') {
      source.exposureCount += 1;
      const exposureOutfitKey = getOutfitIdentity(event);
      if (event.recommendationBatchId && exposureOutfitKey) {
        exposedBatchOutfits.add(`${event.recommendationBatchId}|${exposureOutfitKey}`);
      }
      continue;
    }

    const contributions = resolveEventContributions({
      event,
      nowMs,
      wearCounts,
      exposedBatchOutfits,
      refreshCap,
      outfitClothingIds,
    });

    for (const contribution of contributions) {
      if (contribution.weight === null || contribution.weight === 0) continue;
      source.eligibleEventCount += 1;
      const absWeight = Math.abs(contribution.weight);
      quality.effectiveActionWeight += absWeight;
      if (contribution.weight > 0) quality.positiveActionCount += 1;
      if (contribution.weight < 0) quality.negativeActionCount += 1;
      if (eventType === 'outfit_wear') {
        quality.wearCount += 1;
        if (contribution.wearIndex > 1) quality.repeatedWearCount += 1;
      }
      if (SCENES.includes(event.context && event.context.scene)) contextWeight += absWeight;

      const outfitIdentity = contribution.outfitIdentity || getOutfitIdentity(event);
      if (outfitIdentity) distinctOutfits.add(outfitIdentity);
      const outfitFeatures = extractOutfitFeatures(contribution.clothingIds, clothesById);
      const hasFeatures = hasAnyFeature(outfitFeatures);
      if (hasFeatures) featureWeight += absWeight;
      addContribution(globalAccumulator, {
        weight: contribution.weight,
        outfitIdentity,
        features: outfitFeatures,
        hasFeatures,
        hasContext: SCENES.includes(event.context && event.context.scene),
      });
      const scene = event.context && event.context.scene;
      if (SCENES.includes(scene)) {
        addContribution(contextAccumulators[scene], {
          weight: contribution.weight,
          outfitIdentity,
          features: outfitFeatures,
          hasFeatures,
          hasContext: true,
        });
      }
      contributionDigestParts.push([
        PROFILE_VERSION,
        eventType,
        eventId,
        event.occurredAt,
        outfitIdentity || '',
        round(contribution.weight),
        contribution.clothingIds.join(','),
      ].join(':'));
    }
  }

  source.distinctOutfitCount = distinctOutfits.size;
  if (lastEventAt) source.lastEventAt = lastEventAt;
  source.sourceDigest = shortHash(contributionDigestParts.sort().join('|'));

  quality.effectiveActionWeight = round(quality.effectiveActionWeight);
  quality.featureCoverage = quality.effectiveActionWeight > 0 ? round(featureWeight / quality.effectiveActionWeight) : 0;
  quality.contextCoverage = quality.effectiveActionWeight > 0 ? round(contextWeight / quality.effectiveActionWeight) : 0;

  const global = buildSlice(globalAccumulator, quality.featureCoverage);
  const contexts = {};
  for (const scene of SCENES) {
    const sceneAccumulator = contextAccumulators[scene];
    if (
      sceneAccumulator.eligibleEventCount >= 4
      && sceneAccumulator.distinctOutfits.size >= 3
      && sceneAccumulator.effectiveActionWeight >= 4
    ) {
      contexts[scene] = buildSlice(sceneAccumulator, sceneAccumulator.featureCoverage());
    }
  }

  const status = source.eligibleEventCount >= 8
    && source.distinctOutfitCount >= 4
    && quality.effectiveActionWeight >= 8
    && quality.featureCoverage >= 0.35
    ? 'shadow_ready'
    : 'insufficient_data';

  return sanitizeProfile({
    schemaVersion: 1,
    profileVersion: PROFILE_VERSION,
    status,
    global,
    contexts,
    source,
    quality,
    generatedAt: new Date(nowMs).toISOString(),
  });
}

function extractLearnableFeatures(clothing) {
  const result = emptyFeatureSet();
  if (!clothing || typeof clothing !== 'object') return result;

  const aesthetic = clothing.aestheticFeatures;
  if (aesthetic && aesthetic.version === 1) {
    const confidence = aesthetic.confidence || {};
    if (CONFIDENT_LEVELS.has(confidence.fit) && FIT_VALUES.has(aesthetic.fit)) result.fit.push(aesthetic.fit);
    if (CONFIDENT_LEVELS.has(confidence.silhouette) && SILHOUETTE_VALUES.has(aesthetic.silhouette)) result.silhouette.push(aesthetic.silhouette);
    if (CONFIDENT_LEVELS.has(confidence.patternType) && PATTERN_VALUES.has(aesthetic.patternType)) result.patternType.push(aesthetic.patternType);
    if (CONFIDENT_LEVELS.has(confidence.designElements) && Array.isArray(aesthetic.designElements)) {
      result.designElement.push(...aesthetic.designElements.filter((item) => DESIGN_VALUES.has(item)));
    }
    if (CONFIDENT_LEVELS.has(confidence.formalityLevel) && Number.isInteger(aesthetic.formalityLevel) && aesthetic.formalityLevel >= 1 && aesthetic.formalityLevel <= 5) {
      result.formalityLevel.push(String(aesthetic.formalityLevel));
    }
  }

  result.colorFamily.push(...extractColorFamilies(clothing));
  result.styleTag.push(...extractStyleTags(clothing));
  return dedupeFeatureSet(result);
}

function calculateEventWeight(event, { now, wearIndex = 1 } = {}) {
  const nowMs = parseTime(now);
  const eventMs = parseTime(event && event.occurredAt);
  if (nowMs === null || eventMs === null || !isInsideWindow(eventMs, nowMs)) return null;
  const eventType = event.eventType;
  if (eventType === 'recommendation_exposure') return 0;
  const halfLife = HALF_LIFE_DAYS[eventType];
  if (!halfLife) return null;
  const ageDays = Math.max(0, (nowMs - eventMs) / DAY_MS);
  const decay = Math.pow(0.5, ageDays / halfLife);
  const baseWeight = eventType === 'outfit_wear' ? wearWeight(wearIndex) : BASE_WEIGHTS[eventType];
  return round(baseWeight * decay);
}

function resolveEventContributions({ event, nowMs, wearCounts, exposedBatchOutfits, refreshCap, outfitClothingIds }) {
  if (event.eventType === 'recommendation_batch_refresh') {
    if (!event.recommendationBatchId || !Array.isArray(event.batchOutfitKeys)) return [];
    const day = new Date(Math.min(parseTime(event.occurredAt), nowMs)).toISOString().slice(0, 10);
    return [...new Set(event.batchOutfitKeys.map((item) => normalizeString(item, 160)).filter(Boolean))]
      .sort()
      .filter((outfitKey) => exposedBatchOutfits.has(`${event.recommendationBatchId}|${outfitKey}`))
      .map((outfitKey) => {
        const capKey = `${day}|${outfitKey}`;
        const used = refreshCap.get(capKey) || 0;
        if (used >= 3) return null;
        refreshCap.set(capKey, used + 1);
        return {
          outfitIdentity: outfitKey,
          clothingIds: (outfitClothingIds.get(outfitKey) || []).slice(),
          weight: calculateEventWeight(event, { now: new Date(nowMs).toISOString() }),
        };
      })
      .filter(Boolean);
  }

  const outfitIdentity = getOutfitIdentity(event);
  if (!outfitIdentity) return [];
  let wearIndex = 1;
  if (event.eventType === 'outfit_wear') {
    wearIndex = (wearCounts.get(outfitIdentity) || 0) + 1;
    wearCounts.set(outfitIdentity, wearIndex);
  }
  const clothingIds = normalizeClothingIds(event.clothingIds && event.clothingIds.length ? event.clothingIds : outfitClothingIds.get(outfitIdentity));
  return [{
    outfitIdentity,
    clothingIds,
    wearIndex,
    weight: calculateEventWeight(event, { now: new Date(nowMs).toISOString(), wearIndex }),
  }];
}

function buildClothesMap(clothes) {
  const items = Array.isArray(clothes)
    ? clothes
    : clothes && typeof clothes === 'object'
      ? Object.values(clothes)
      : [];
  const map = new Map();
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const id = normalizeString(item._id || item.id, 160);
    if (id) map.set(id, item);
  }
  return map;
}

function buildOutfitClothingIdMap(events) {
  const map = new Map();
  for (const event of events) {
    const outfitIdentity = getOutfitIdentity(event || {});
    const clothingIds = normalizeClothingIds(event && event.clothingIds);
    if (outfitIdentity && clothingIds.length) map.set(outfitIdentity, clothingIds);
  }
  return map;
}

function extractOutfitFeatures(clothingIds, clothesById) {
  const combined = emptyFeatureSet();
  for (const clothingId of normalizeClothingIds(clothingIds)) {
    const clothing = clothesById.get(clothingId);
    if (!clothing) continue;
    const features = extractLearnableFeatures(clothing);
    for (const dimension of DIMENSIONS) combined[dimension].push(...features[dimension]);
  }
  combined.styleTag = combined.styleTag.slice(0, MAX_STYLE_TAGS_PER_OUTFIT);
  return dedupeFeatureSet(combined);
}

function addContribution(accumulator, contribution) {
  const absWeight = Math.abs(contribution.weight);
  accumulator.eligibleEventCount += 1;
  accumulator.effectiveActionWeight += absWeight;
  if (contribution.hasFeatures) accumulator.featureWeight += absWeight;
  if (contribution.hasContext) accumulator.contextWeight += absWeight;
  if (contribution.outfitIdentity) accumulator.distinctOutfits.add(contribution.outfitIdentity);

  if (!contribution.hasFeatures) return;
  for (const dimension of DIMENSIONS) {
    const values = contribution.features[dimension];
    if (!values.length) continue;
    const splitWeight = absWeight / values.length;
    for (const value of values) {
      const bucket = getBucket(accumulator.values[dimension], value);
      if (contribution.weight > 0) bucket.positiveWeight += splitWeight;
      if (contribution.weight < 0) bucket.negativeWeight += splitWeight;
      if (contribution.outfitIdentity) bucket.outfits.add(contribution.outfitIdentity);
    }
  }
}

function buildSlice(accumulator, globalFeatureCoverage) {
  const slice = {};
  for (const dimension of DIMENSIONS) {
    const buckets = [...accumulator.values[dimension].entries()].map(([value, bucket]) => {
      const positiveWeight = round(bucket.positiveWeight);
      const negativeWeight = round(bucket.negativeWeight);
      const supportWeight = round(positiveWeight + negativeWeight);
      const score = supportWeight > 0 ? round(clamp((positiveWeight - negativeWeight) / supportWeight, -1, 1)) : 0;
      const supportConfidence = clamp(supportWeight / 12, 0, 1);
      const diversityConfidence = clamp(bucket.outfits.size / 4, 0, 1);
      const coverageConfidence = clamp(globalFeatureCoverage, 0, 1);
      const confidence = round(supportConfidence * diversityConfidence * (coverageConfidence || 1));
      return {
        value,
        score,
        confidence,
        supportWeight,
        positiveWeight,
        negativeWeight,
        distinctOutfitCount: bucket.outfits.size,
      };
    });
    const eligible = buckets.filter((item) => item.supportWeight >= 1);
    slice[dimension] = {
      positive: eligible.filter((item) => item.score >= 0.15).sort(compareSignals).slice(0, MAX_SIGNALS_PER_SIDE),
      negative: eligible.filter((item) => item.score <= -0.15).sort(compareSignals).slice(0, MAX_SIGNALS_PER_SIDE),
      observedValueCount: buckets.length,
    };
  }
  return slice;
}

function createAccumulator() {
  return {
    eligibleEventCount: 0,
    effectiveActionWeight: 0,
    featureWeight: 0,
    contextWeight: 0,
    distinctOutfits: new Set(),
    values: Object.fromEntries(DIMENSIONS.map((dimension) => [dimension, new Map()])),
    featureCoverage() {
      return this.effectiveActionWeight > 0 ? round(this.featureWeight / this.effectiveActionWeight) : 0;
    },
  };
}

function getBucket(map, value) {
  if (!map.has(value)) {
    map.set(value, {
      positiveWeight: 0,
      negativeWeight: 0,
      outfits: new Set(),
    });
  }
  return map.get(value);
}

function emptyFeatureSet() {
  return Object.fromEntries(DIMENSIONS.map((dimension) => [dimension, []]));
}

function dedupeFeatureSet(features) {
  const result = emptyFeatureSet();
  for (const dimension of DIMENSIONS) {
    result[dimension] = [...new Set((features[dimension] || []).map((item) => normalizeString(item, 64)).filter(Boolean))].sort();
  }
  return result;
}

function hasAnyFeature(features) {
  return DIMENSIONS.some((dimension) => features[dimension].length > 0);
}

function extractColorFamilies(clothing) {
  const palette = Array.isArray(clothing.colorPalette)
    ? clothing.colorPalette
    : Array.isArray(clothing.colors)
      ? clothing.colors.map((name) => ({ name }))
      : [];
  if (!palette.length) return [];
  const primary = palette.find((item) => item && item.role === 'primary') || palette[0];
  const family = colorFamily(primary);
  return family ? [family] : [];
}

function colorFamily(color) {
  if (!color || typeof color !== 'object') return '';
  const byName = colorNameFamily(color.name);
  if (byName) return byName;
  const byHex = hexFamily(color.hex);
  return byHex || 'other';
}

function colorNameFamily(name) {
  const value = normalizeString(name, 64).toLowerCase();
  if (!value) return '';
  const direct = [
    ['black', ['black', '黑', '黑色']],
    ['white', ['white', '白', '白色']],
    ['gray', ['gray', 'grey', '灰', '灰色']],
    ['beige', ['beige', '米', '米色', '卡其']],
    ['brown', ['brown', '棕', '咖', '褐']],
    ['navy', ['navy', '藏青', '深蓝']],
    ['red', ['red', '红', '红色']],
    ['orange', ['orange', '橙', '橘']],
    ['yellow', ['yellow', '黄', '黄色']],
    ['green', ['green', '绿', '绿色']],
    ['blue', ['blue', '蓝', '蓝色']],
    ['purple', ['purple', 'violet', '紫', '紫色']],
    ['pink', ['pink', '粉', '粉色']],
    ['neutral', ['neutral', '中性']],
  ];
  for (const [family, tokens] of direct) {
    if (tokens.some((token) => value.includes(token))) return family;
  }
  return '';
}

function hexFamily(hex) {
  const value = normalizeString(hex, 16);
  const match = /^#?([0-9a-fA-F]{6})$/.exec(value);
  if (!match) return '';
  const raw = match[1];
  const r = parseInt(raw.slice(0, 2), 16) / 255;
  const g = parseInt(raw.slice(2, 4), 16) / 255;
  const b = parseInt(raw.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;
  if (lightness < 0.12) return 'black';
  if (lightness > 0.92) return 'white';
  if (delta < 0.08) return 'gray';
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  if (saturation < 0.12) return 'neutral';
  let hue;
  if (max === r) hue = ((g - b) / delta + (g < b ? 6 : 0)) * 60;
  else if (max === g) hue = ((b - r) / delta + 2) * 60;
  else hue = ((r - g) / delta + 4) * 60;
  if (hue < 15 || hue >= 345) return 'red';
  if (hue < 45) return 'orange';
  if (hue < 70) return 'yellow';
  if (hue < 165) return 'green';
  if (hue < 250) return lightness < 0.28 ? 'navy' : 'blue';
  if (hue < 290) return 'purple';
  if (hue < 345) return lightness > 0.55 ? 'pink' : 'purple';
  return 'other';
}

function extractStyleTags(clothing) {
  const values = [];
  if (Array.isArray(clothing.styleTags)) values.push(...clothing.styleTags);
  if (typeof clothing.style === 'string') values.push(clothing.style);
  return values
    .map((item) => normalizeString(item, 64))
    .filter((item) => item && item.length <= 24)
    .slice(0, MAX_STYLE_TAGS_PER_OUTFIT);
}

function normalizeClothingIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => normalizeString(item, 160)).filter(Boolean))].sort();
}

function getOutfitIdentity(event) {
  const outfitKey = normalizeString(event && event.outfitKey, 160);
  if (outfitKey) return outfitKey;
  const clothingIds = normalizeClothingIds(event && event.clothingIds);
  if (clothingIds.length) return `clothes:${clothingIds.join('|')}`;
  return normalizeString(event && event.outfitId, 160);
}

function wearWeight(wearIndex) {
  if (wearIndex <= 1) return 4;
  if (wearIndex === 2) return 5.5;
  return 7;
}

function parseTime(value) {
  if (typeof value !== 'string' && !(value instanceof Date)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function isInsideWindow(eventMs, nowMs) {
  return eventMs >= nowMs - WINDOW_DAYS * DAY_MS;
}

function compareEventItems(left, right) {
  if (left.timeMs !== right.timeMs) return left.timeMs - right.timeMs;
  const leftId = normalizeString(left.raw && left.raw.eventId, 160);
  const rightId = normalizeString(right.raw && right.raw.eventId, 160);
  if (leftId !== rightId) return leftId.localeCompare(rightId);
  return left.inputIndex - right.inputIndex;
}

function compareSignals(left, right) {
  return (right.confidence - left.confidence)
    || (Math.abs(right.score) - Math.abs(left.score))
    || (right.supportWeight - left.supportWeight)
    || left.value.localeCompare(right.value);
}

function normalizeString(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

function round(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 10000) / 10000;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function shortHash(value) {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function sanitizeProfile(profile) {
  return JSON.parse(JSON.stringify(profile, (_key, value) => (
    typeof value === 'number' && !Number.isFinite(value) ? 0 : value
  )));
}

module.exports = {
  DIMENSIONS,
  PROFILE_VERSION,
  SCENES,
  WINDOW_DAYS,
  buildLearnedStyleProfile,
  calculateEventWeight,
  extractLearnableFeatures,
};
