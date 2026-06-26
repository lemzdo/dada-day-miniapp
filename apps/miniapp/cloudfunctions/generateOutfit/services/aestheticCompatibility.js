const ENGINE_VERSION = 'aesthetic-compat-v1';

const DIMENSION_KEYS = [
  'silhouetteBalance',
  'proportionBalance',
  'colorHarmony',
  'patternBalance',
  'formalityConsistency',
  'detailBalance',
];

const DIMENSION_WEIGHTS = {
  silhouetteBalance: 25,
  proportionBalance: 15,
  colorHarmony: 25,
  patternBalance: 15,
  formalityConsistency: 10,
  detailBalance: 10,
};

const RELIABLE_CONFIDENCE = new Set(['high', 'medium']);
const OBVIOUS_PATTERNS = new Set([
  'stripe',
  'plaid',
  'floral',
  'graphic',
  'polkaDot',
  'animal',
  'abstract',
  'colorBlock',
  'other',
]);
const EXTREME_VOLUME_FITS = new Set(['oversized']);
const EXTREME_VOLUME_SILHOUETTES = new Set(['boxy', 'cocoon', 'wideLeg', 'flare']);
const LOW_VOLUME_FITS = new Set(['fitted']);
const LOW_VOLUME_SILHOUETTES = new Set(['bodycon', 'tapered']);
const NEUTRAL_COLOR_NAMES = new Set([
  'black',
  'white',
  'gray',
  'grey',
  'beige',
  'cream',
  'ivory',
  'brown',
  'navy',
  '黑',
  '白',
  '灰',
  '米',
  '棕',
  '藏青',
]);

function evaluateAestheticCompatibility(items) {
  const normalizedItems = normalizeItems(items);
  const evidenceMap = new Map();
  const addEvidence = createEvidenceCollector(evidenceMap);

  const dimensions = {
    silhouetteBalance: evaluateSilhouette(normalizedItems, addEvidence),
    proportionBalance: evaluateProportion(normalizedItems, addEvidence),
    colorHarmony: evaluateColor(normalizedItems, addEvidence),
    patternBalance: evaluatePattern(normalizedItems, addEvidence),
    formalityConsistency: evaluateFormality(normalizedItems, addEvidence),
    detailBalance: evaluateDetail(normalizedItems, addEvidence),
  };

  const evidence = Array.from(evidenceMap.values()).sort(compareEvidence);
  for (const key of DIMENSION_KEYS) {
    dimensions[key].evidenceCodes = dimensions[key].evidenceCodes
      .filter((code, index, codes) => codes.indexOf(code) === index)
      .sort();
  }

  const coverageWeight = DIMENSION_KEYS.reduce((sum, key) => {
    return dimensions[key].score === null ? sum : sum + DIMENSION_WEIGHTS[key];
  }, 0);
  const coverage = clamp01(coverageWeight / 100);
  const weightedScore = coverage < 0.25
    ? null
    : roundInt(
        DIMENSION_KEYS.reduce((sum, key) => {
          const score = dimensions[key].score;
          return score === null ? sum : sum + score * DIMENSION_WEIGHTS[key];
        }, 0) / coverageWeight,
      );

  return {
    version: 1,
    engineVersion: ENGINE_VERSION,
    score: weightedScore === null ? null : clampScore(weightedScore),
    coverage,
    dimensions,
    evidence,
  };
}

function attachAestheticEvaluation(outfit, items) {
  return {
    ...outfit,
    aestheticEvaluation: evaluateAestheticCompatibility(items),
  };
}

function createEmptyDimension() {
  return {
    score: null,
    coverage: 0,
    evidenceCodes: [],
  };
}

function createDimension(score, evidenceCodes) {
  return {
    score: score === null ? null : clampScore(score),
    coverage: score === null ? 0 : 1,
    evidenceCodes,
  };
}

function createEvidenceCollector(evidenceMap) {
  return function addEvidence(code, polarity, strength, itemIds, data) {
    const stableIds = uniqueStrings(itemIds).sort();
    if (stableIds.length === 0) return code;
    const current = evidenceMap.get(code);
    if (current) {
      current.itemIds = uniqueStrings([...current.itemIds, ...stableIds]).sort();
      current.strength = Math.max(current.strength, strength);
      return code;
    }
    evidenceMap.set(code, {
      code,
      polarity,
      strength,
      itemIds: stableIds,
      ...(data && Object.keys(data).length ? { data } : {}),
    });
    return code;
  };
}

function evaluateSilhouette(items, addEvidence) {
  const wearableItems = items.filter((item) => ['top', 'bottom', 'onepiece'].includes(item.category));
  if (wearableItems.length === 0) return createEmptyDimension();

  const top = wearableItems.find((item) => item.category === 'top');
  const bottom = wearableItems.find((item) => item.category === 'bottom');
  const onepiece = wearableItems.find((item) => item.category === 'onepiece');
  const evidenceCodes = [];

  if (top && bottom) {
    const topFit = readFeature(top, 'fit');
    const topSilhouette = readFeature(top, 'silhouette');
    const bottomFit = readFeature(bottom, 'fit');
    const bottomSilhouette = readFeature(bottom, 'silhouette');

    if (topFit === 'fitted' && ['wideLeg', 'flare'].includes(bottomSilhouette)) {
      evidenceCodes.push(addEvidence('SILHOUETTE_BALANCED_CONTRAST', 'positive', 3, [top.id, bottom.id]));
      return createDimension(86, evidenceCodes);
    }

    if (['oversized', 'relaxed'].includes(topFit) && (LOW_VOLUME_FITS.has(bottomFit) || LOW_VOLUME_SILHOUETTES.has(bottomSilhouette))) {
      evidenceCodes.push(addEvidence('SILHOUETTE_BALANCED_CONTRAST', 'positive', 3, [top.id, bottom.id]));
      return createDimension(84, evidenceCodes);
    }

    if (topFit === 'relaxed' && bottomSilhouette === 'straight') {
      evidenceCodes.push(addEvidence('SILHOUETTE_BALANCED_CONTINUITY', 'positive', 2, [top.id, bottom.id]));
      return createDimension(76, evidenceCodes);
    }

    const extremeItems = [top, bottom].filter((item) => hasExtremeVolume(item));
    if (extremeItems.length >= 2) {
      evidenceCodes.push(addEvidence('SILHOUETTE_EXTREME_VOLUME_STACK', 'negative', 1, extremeItems.map((item) => item.id)));
      return createDimension(62, evidenceCodes);
    }

    if ([topFit, topSilhouette, bottomFit, bottomSilhouette].some(Boolean)) {
      evidenceCodes.push(addEvidence('SILHOUETTE_BALANCED_CONTINUITY', 'neutral', 1, [top.id, bottom.id]));
      return createDimension(70, evidenceCodes);
    }
  }

  if (onepiece && (readFeature(onepiece, 'fit') || readFeature(onepiece, 'silhouette'))) {
    evidenceCodes.push(addEvidence('SILHOUETTE_BALANCED_CONTINUITY', 'positive', 2, [onepiece.id]));
    return createDimension(78, evidenceCodes);
  }

  return createEmptyDimension();
}

function evaluateProportion(items, addEvidence) {
  const top = items.find((item) => item.category === 'top');
  const bottom = items.find((item) => item.category === 'bottom');
  const onepiece = items.find((item) => item.category === 'onepiece');
  const evidenceCodes = [];

  if (top && bottom) {
    const topLength = readFeature(top, 'length');
    const bottomLength = readFeature(bottom, 'length');
    if (!topLength && !bottomLength) return createEmptyDimension();

    if (['cropped', 'short'].includes(topLength) && ['long', 'extraLong'].includes(bottomLength)) {
      evidenceCodes.push(addEvidence('PROPORTION_CLEAR_LAYERING', 'positive', 3, [top.id, bottom.id]));
      return createDimension(84, evidenceCodes);
    }

    if (topLength === 'extraLong' && bottomLength === 'extraLong') {
      evidenceCodes.push(addEvidence('PROPORTION_EXTREME_LENGTH_STACK', 'negative', 1, [top.id, bottom.id]));
      return createDimension(62, evidenceCodes);
    }

    if (topLength || bottomLength) {
      evidenceCodes.push(addEvidence('PROPORTION_BALANCED_LENGTH', 'neutral', 1, [top.id, bottom.id]));
      return createDimension(72, evidenceCodes);
    }
  }

  if (onepiece && readFeature(onepiece, 'length')) {
    evidenceCodes.push(addEvidence('PROPORTION_BALANCED_LENGTH', 'neutral', 1, [onepiece.id]));
    return createDimension(72, evidenceCodes);
  }

  return createEmptyDimension();
}

function evaluateColor(items, addEvidence) {
  const colors = items.map(readPrimaryColor).filter(Boolean);
  if (colors.length === 0) return createEmptyDimension();

  const neutralColors = colors.filter((color) => color.neutral);
  const hueColors = colors.filter((color) => Number.isFinite(color.hue));
  if (hueColors.length === 0) {
    if (neutralColors.length >= 2) {
      const code = addEvidence('COLOR_MONOCHROMATIC', 'positive', 2, neutralColors.map((color) => color.itemId));
      return createDimension(78, [code]);
    }
    return createEmptyDimension();
  }

  const dominantHueColors = hueColors.filter((color) => color.ratio === null || color.ratio >= 0.45);
  const distinctDominantHues = groupDistinctHues(dominantHueColors.map((color) => color.hue), 55);
  if (distinctDominantHues >= 3) {
    const code = addEvidence('COLOR_TOO_MANY_DOMINANT_HUES', 'negative', 1, dominantHueColors.map((color) => color.itemId));
    return createDimension(62, [code]);
  }

  if (neutralColors.length >= 1 && groupDistinctHues(hueColors.map((color) => color.hue), 45) <= 1) {
    const code = addEvidence('COLOR_NEUTRAL_ACCENT', 'positive', 3, colors.map((color) => color.itemId));
    return createDimension(86, [code]);
  }

  if (maxCircularHueDistance(hueColors.map((color) => color.hue)) <= 20) {
    const code = addEvidence('COLOR_MONOCHROMATIC', 'positive', 3, hueColors.map((color) => color.itemId));
    return createDimension(84, [code]);
  }

  if (maxCircularHueDistance(hueColors.map((color) => color.hue)) <= 75) {
    const code = addEvidence('COLOR_ANALOGOUS', 'positive', 2, hueColors.map((color) => color.itemId));
    return createDimension(80, [code]);
  }

  if (hueColors.length === 2 && hueDistance(hueColors[0].hue, hueColors[1].hue) >= 110) {
    const code = addEvidence('COLOR_CONTROLLED_CONTRAST', 'positive', 1, hueColors.map((color) => color.itemId));
    return createDimension(74, [code]);
  }

  return createDimension(70, []);
}

function evaluatePattern(items, addEvidence) {
  const patternItems = items
    .map((item) => ({ item, pattern: readFeature(item, 'patternType') }))
    .filter((entry) => entry.pattern);
  if (patternItems.length === 0) return createEmptyDimension();

  const obviousItems = patternItems.filter((entry) => OBVIOUS_PATTERNS.has(entry.pattern));
  if (obviousItems.length === 0) return createDimension(70, []);

  const evidenceCodes = [];
  const distinctPatterns = uniqueStrings(obviousItems.map((entry) => entry.pattern));
  if (obviousItems.length === 1) {
    evidenceCodes.push(addEvidence('PATTERN_SINGLE_FOCUS', 'positive', 3, [obviousItems[0].item.id]));
    return createDimension(82, evidenceCodes);
  }

  if (distinctPatterns.length === 1) {
    evidenceCodes.push(addEvidence('PATTERN_COHERENT_REPEAT', 'positive', 1, obviousItems.map((entry) => entry.item.id)));
    return createDimension(74, evidenceCodes);
  }

  evidenceCodes.push(addEvidence('PATTERN_COMPETING_FOCUS', 'negative', 1, obviousItems.map((entry) => entry.item.id)));
  return createDimension(62, evidenceCodes);
}

function evaluateFormality(items, addEvidence) {
  const values = items
    .map((item) => ({ item, value: readFeature(item, 'formalityLevel') }))
    .filter((entry) => Number.isInteger(entry.value) && entry.value >= 1 && entry.value <= 5);
  if (values.length < 2) return createEmptyDimension();

  const levels = values.map((entry) => entry.value);
  const gap = Math.max(...levels) - Math.min(...levels);
  if (gap <= 1) {
    const code = addEvidence('FORMALITY_ALIGNED', 'positive', 2, values.map((entry) => entry.item.id), { gap });
    return createDimension(78, [code]);
  }
  if (gap === 2) {
    const code = addEvidence('FORMALITY_INTENTIONAL_MIX', 'neutral', 1, values.map((entry) => entry.item.id), { gap });
    return createDimension(70, [code]);
  }
  const code = addEvidence('FORMALITY_LARGE_GAP', 'negative', 1, values.map((entry) => entry.item.id), { gap });
  return createDimension(62, [code]);
}

function evaluateDetail(items, addEvidence) {
  const detailItems = items
    .map((item) => {
      const elements = readFeature(item, 'designElements') || [];
      const pattern = readFeature(item, 'patternType');
      const obviousPattern = OBVIOUS_PATTERNS.has(pattern);
      return { item, elements, obviousPattern };
    })
    .filter((entry) => entry.elements.length > 0 || entry.obviousPattern);

  if (detailItems.length === 0) return createEmptyDimension();

  const evidenceCodes = [];
  if (detailItems.length === 1) {
    evidenceCodes.push(addEvidence('DETAIL_SINGLE_FOCUS', 'positive', 3, [detailItems[0].item.id]));
    return createDimension(82, evidenceCodes);
  }

  const strongItems = detailItems.filter((entry) => entry.elements.length >= 2 || (entry.elements.length >= 1 && entry.obviousPattern));
  if (strongItems.length >= 2) {
    evidenceCodes.push(addEvidence('DETAIL_COMPETING_FOCUS', 'negative', 1, strongItems.map((entry) => entry.item.id)));
    return createDimension(62, evidenceCodes);
  }

  evidenceCodes.push(addEvidence('DETAIL_BALANCED_DISTRIBUTION', 'positive', 1, detailItems.map((entry) => entry.item.id)));
  return createDimension(74, evidenceCodes);
}

function normalizeItems(items) {
  const map = new Map();
  if (!Array.isArray(items)) return [];

  for (const source of items) {
    if (!source || typeof source !== 'object') continue;
    const id = readId(source);
    if (!id || map.has(id)) continue;
    map.set(id, {
      id,
      category: normalizeCategory(source),
      source,
      features: normalizeFeatures(source.aestheticFeatures),
    });
  }

  return Array.from(map.values()).sort((a, b) => a.id.localeCompare(b.id));
}

function readId(item) {
  const value = item._id || item.id || item.clothingId || item.itemId;
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function normalizeCategory(item) {
  const raw = String(item.category || item.type || '').trim();
  if (['top', 'bottom', 'onepiece', 'shoes', 'accessory', 'other'].includes(raw)) return raw;
  const text = `${raw} ${item.subcategory || ''} ${item.subCategory || ''}`.toLowerCase();
  if (/(dress|jumpsuit|suit_set)/.test(text)) return 'onepiece';
  if (/(trousers|pants|jeans|shorts|skirt|leggings)/.test(text)) return 'bottom';
  if (/(sneakers|heels|boots|sandals|loafers|flats|shoe)/.test(text)) return 'shoes';
  if (/(hat|scarf|necklace|bag|glasses|belt|watch)/.test(text)) return 'accessory';
  if (/(tshirt|shirt|sweater|hoodie|jacket|coat|blazer|vest|top)/.test(text)) return 'top';
  return 'other';
}

function normalizeFeatures(value) {
  if (!value || typeof value !== 'object' || value.version !== 1) return null;
  const confidence = value.confidence && typeof value.confidence === 'object' ? value.confidence : {};
  return {
    fit: readKnownString(value.fit, ['fitted', 'regular', 'relaxed', 'oversized']),
    length: readKnownString(value.length, ['cropped', 'short', 'regular', 'long', 'extraLong']),
    silhouette: readKnownString(value.silhouette, ['straight', 'boxy', 'aLine', 'xLine', 'cocoon', 'tapered', 'wideLeg', 'flare', 'bodycon']),
    patternType: readKnownString(value.patternType, ['solid', ...OBVIOUS_PATTERNS]),
    designElements: Array.isArray(value.designElements)
      ? uniqueStrings(value.designElements.filter((item) => typeof item === 'string')).sort()
      : [],
    formalityLevel: Number.isInteger(value.formalityLevel) && value.formalityLevel >= 1 && value.formalityLevel <= 5
      ? value.formalityLevel
      : null,
    confidence,
  };
}

function readKnownString(value, allowed) {
  return typeof value === 'string' && allowed.includes(value) ? value : null;
}

function readFeature(item, key) {
  if (!item.features || !isReliableConfidence(item.features.confidence[key])) return null;
  if (key === 'designElements') return item.features.designElements;
  return item.features[key] ?? null;
}

function isReliableConfidence(value) {
  return RELIABLE_CONFIDENCE.has(value);
}

function hasExtremeVolume(item) {
  const fit = readFeature(item, 'fit');
  const silhouette = readFeature(item, 'silhouette');
  return EXTREME_VOLUME_FITS.has(fit) || EXTREME_VOLUME_SILHOUETTES.has(silhouette);
}

function readPrimaryColor(item) {
  const palette = Array.isArray(item.source.colorPalette) ? item.source.colorPalette : [];
  const color = palette.find((entry) => entry && entry.role === 'primary') || palette.find(Boolean);
  if (!color || typeof color !== 'object') return null;

  const hsl = parseHexColor(color.hex);
  const name = typeof color.name === 'string' ? color.name.trim().toLowerCase() : '';
  const neutralByName = NEUTRAL_COLOR_NAMES.has(name);
  if (!hsl && !neutralByName) return null;

  return {
    itemId: item.id,
    hue: hsl ? hsl.h : null,
    neutral: hsl ? hsl.s < 0.15 || hsl.l < 0.15 || hsl.l > 0.9 : true,
    ratio: readRatio(color.ratio),
  };
}

function parseHexColor(value) {
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value.trim())) return null;
  const hex = value.trim();
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const delta = max - min;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
  let h = 0;

  if (delta !== 0) {
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
  }
  if (h < 0) h += 360;

  return { h, s, l };
}

function readRatio(value) {
  const ratio = Number(value);
  return Number.isFinite(ratio) && ratio >= 0 && ratio <= 1 ? ratio : null;
}

function groupDistinctHues(hues, threshold) {
  const sorted = hues.filter(Number.isFinite).slice().sort((a, b) => a - b);
  const groups = [];
  for (const hue of sorted) {
    if (!groups.some((groupHue) => hueDistance(groupHue, hue) <= threshold)) groups.push(hue);
  }
  return groups.length;
}

function maxCircularHueDistance(hues) {
  const values = hues.filter(Number.isFinite);
  if (values.length <= 1) return 0;
  let maxDistance = 0;
  for (let i = 0; i < values.length; i += 1) {
    for (let j = i + 1; j < values.length; j += 1) {
      maxDistance = Math.max(maxDistance, hueDistance(values[i], values[j]));
    }
  }
  return maxDistance;
}

function hueDistance(a, b) {
  const diff = Math.abs(a - b) % 360;
  return Math.min(diff, 360 - diff);
}

function uniqueStrings(values) {
  return Array.isArray(values)
    ? values.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim())
        .filter((value, index, array) => array.indexOf(value) === index)
    : [];
}

function compareEvidence(a, b) {
  if (a.code !== b.code) return a.code.localeCompare(b.code);
  return a.itemIds.join('|').localeCompare(b.itemIds.join('|'));
}

function roundInt(value) {
  return Number.isFinite(value) ? Math.round(value) : null;
}

function clampScore(value) {
  return Math.max(0, Math.min(100, roundInt(value)));
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
}

module.exports = {
  ENGINE_VERSION,
  attachAestheticEvaluation,
  evaluateAestheticCompatibility,
};
