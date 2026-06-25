const AESTHETIC_SCHEMA_VERSION = 1;
const AESTHETIC_PROMPT_VERSION = 'aesthetic-v1';

const AESTHETIC_ENUMS = {
  confidenceLevels: ['high', 'medium', 'low'],
  fits: ['fitted', 'regular', 'relaxed', 'oversized', 'unknown'],
  lengths: ['cropped', 'short', 'regular', 'long', 'extraLong', 'unknown'],
  silhouettes: ['straight', 'boxy', 'aLine', 'xLine', 'cocoon', 'tapered', 'wideLeg', 'flare', 'bodycon', 'unknown'],
  patternTypes: ['solid', 'stripe', 'plaid', 'floral', 'graphic', 'polkaDot', 'animal', 'abstract', 'colorBlock', 'other', 'unknown'],
  designElements: ['ruffle', 'pleat', 'lace', 'cutout', 'asymmetry', 'hardware', 'embroidery', 'distressed', 'layered', 'bow', 'puffSleeve', 'sheer', 'fringe', 'belted'],
  colorRoles: ['primary', 'secondary', 'accent'],
};

const CONFIDENCE_FIELDS = ['fit', 'length', 'silhouette', 'patternType', 'designElements', 'formalityLevel'];
const CONFIDENCE_RANK = { low: 0, medium: 1, high: 2 };

const SILHOUETTE_BY_GROUP = {
  top: ['straight', 'boxy', 'aLine'],
  outerwear: ['straight', 'boxy', 'aLine', 'xLine', 'cocoon'],
  pants: ['straight', 'tapered', 'wideLeg', 'flare'],
  skirt: ['straight', 'aLine', 'xLine', 'bodycon', 'flare'],
  onepiece: ['straight', 'aLine', 'xLine', 'bodycon', 'cocoon'],
  nonGarment: ['unknown'],
  unknown: ['straight'],
};

function createDefaultAestheticFeaturesV1(meta = {}) {
  return {
    version: AESTHETIC_SCHEMA_VERSION,
    promptVersion: AESTHETIC_PROMPT_VERSION,
    fit: 'unknown',
    length: 'unknown',
    silhouette: 'unknown',
    patternType: 'unknown',
    designElements: [],
    formalityLevel: null,
    confidence: createDefaultConfidence(),
    provider: safeString(meta.provider),
    model: safeString(meta.model),
    recognizedAt: normalizeRecognizedAt(meta.recognizedAt),
  };
}

function normalizeAestheticFeaturesV1(input, meta = {}) {
  const source = isPlainObject(input) ? input : {};
  const result = createDefaultAestheticFeaturesV1(meta);
  const confidence = normalizeConfidenceMap(source.confidence);
  result.confidence = confidence;

  if (confidence.fit !== 'low') {
    result.fit = readEnum(source.fit, AESTHETIC_ENUMS.fits, 'unknown');
  }
  if (confidence.length !== 'low') {
    result.length = readEnum(source.length, AESTHETIC_ENUMS.lengths, 'unknown');
  }
  if (confidence.silhouette !== 'low') {
    result.silhouette = normalizeSilhouette(
      readEnum(source.silhouette, AESTHETIC_ENUMS.silhouettes, 'unknown'),
      meta,
    );
  }
  if (confidence.patternType !== 'low') {
    result.patternType = readEnum(source.patternType, AESTHETIC_ENUMS.patternTypes, 'unknown');
  }
  if (confidence.designElements !== 'low') {
    result.designElements = normalizeDesignElements(source.designElements);
  }
  if (confidence.formalityLevel !== 'low') {
    result.formalityLevel = normalizeFormalityLevel(source.formalityLevel);
  }

  return result;
}

function normalizeColorPaletteV1(input) {
  if (!Array.isArray(input)) return [];

  let primarySeen = false;
  const colors = [];
  for (const item of input) {
    const color = normalizeColorItem(item);
    if (!color) continue;
    if (color.role === 'primary') {
      if (primarySeen) {
        delete color.role;
      } else {
        primarySeen = true;
      }
    }
    colors.push(color);
    if (colors.length >= 3) break;
  }

  if (colors.length > 0 && !colors.some((color) => color.role === 'primary')) {
    colors[0].role = 'primary';
  }

  if (colors.length > 1 && colors.every((color) => typeof color.ratio === 'number')) {
    const total = colors.reduce((sum, color) => sum + color.ratio, 0);
    if (total > 0) {
      colors.forEach((color) => {
        color.ratio = color.ratio / total;
      });
    }
  }

  return colors;
}

function mergeAestheticFeaturesV1(existing, incoming, meta = {}) {
  const normalizedExisting = normalizeAestheticFeaturesV1(existing, {
    category: meta.category,
    subcategory: meta.subcategory,
    provider: isPlainObject(existing) ? existing.provider : undefined,
    model: isPlainObject(existing) ? existing.model : undefined,
    recognizedAt: isPlainObject(existing) ? existing.recognizedAt : undefined,
  });
  const normalizedIncoming = normalizeAestheticFeaturesV1(incoming, meta);
  const result = cloneAestheticFeatures(normalizedExisting);
  let usedIncoming = false;

  ['fit', 'length', 'silhouette', 'patternType', 'formalityLevel'].forEach((field) => {
    if (shouldUseIncomingField(field, normalizedExisting, normalizedIncoming)) {
      result[field] = normalizedIncoming[field];
      result.confidence[field] = normalizedIncoming.confidence[field];
      usedIncoming = true;
    }
  });

  if (shouldUseIncomingDesignElements(normalizedExisting, normalizedIncoming)) {
    result.designElements = [...normalizedIncoming.designElements];
    result.confidence.designElements = normalizedIncoming.confidence.designElements;
    usedIncoming = true;
  }

  if (usedIncoming) {
    result.version = AESTHETIC_SCHEMA_VERSION;
    result.promptVersion = AESTHETIC_PROMPT_VERSION;
    result.provider = normalizedIncoming.provider;
    result.model = normalizedIncoming.model;
    result.recognizedAt = normalizedIncoming.recognizedAt;
  } else {
    result.provider = normalizedExisting.provider;
    result.model = normalizedExisting.model;
    result.recognizedAt = normalizedExisting.recognizedAt;
  }

  return result;
}

function normalizeConfidenceMap(value) {
  const source = isPlainObject(value) ? value : {};
  return CONFIDENCE_FIELDS.reduce((confidence, field) => {
    confidence[field] = readEnum(source[field], AESTHETIC_ENUMS.confidenceLevels, 'low');
    return confidence;
  }, {});
}

function normalizeDesignElements(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const item of value) {
    if (!AESTHETIC_ENUMS.designElements.includes(item) || seen.has(item)) continue;
    seen.add(item);
    result.push(item);
    if (result.length >= 4) break;
  }
  return result;
}

function normalizeFormalityLevel(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(1, Math.min(5, Math.round(value)));
}

function normalizeSilhouette(value, meta) {
  if (value === 'unknown') return 'unknown';
  const group = resolveSilhouetteGroup(meta && meta.category, meta && meta.subcategory);
  const allowed = SILHOUETTE_BY_GROUP[group] || SILHOUETTE_BY_GROUP.unknown;
  return allowed.includes(value) ? value : 'unknown';
}

function resolveSilhouetteGroup(category, subcategory) {
  const categoryText = normalizeKey(category);
  const subcategoryText = normalizeKey(subcategory);
  const combined = `${categoryText} ${subcategoryText}`;

  if (matchesAny(combined, ['shoes', 'shoe', 'footwear', 'accessory', 'accessories', 'bag', 'hat', 'scarf', 'belt', 'watch', 'glasses', 'necklace', '鞋子', '配饰', '包', '帽子'])) {
    return 'nonGarment';
  }
  if (matchesAny(combined, ['onepiece', 'dress', 'jumpsuit', 'suit_set', '连衣裙', '连体'])) {
    return 'onepiece';
  }
  if (matchesAny(combined, ['outerwear', 'jacket', 'down_jacket', 'blazer', 'coat', 'trench', 'vest', '外套', '夹克', '西装', '羽绒服', '大衣', '风衣', '马甲'])) {
    return 'outerwear';
  }
  if (matchesAny(combined, ['skirt', '半身裙', '裙子'])) {
    return 'skirt';
  }
  if (matchesAny(combined, ['bottom', 'pants', 'trousers', 'jeans', 'shorts', 'leggings', '裤子', '下装', '长裤', '短裤', '牛仔裤'])) {
    return 'pants';
  }
  if (matchesAny(combined, ['top', 'tshirt', 't-shirt', 'shirt', 'sweater', 'hoodie', '上衣', '衬衫', '毛衣', '卫衣'])) {
    return 'top';
  }
  return 'unknown';
}

function normalizeColorItem(item) {
  const source = typeof item === 'string' ? { name: item } : item;
  if (!isPlainObject(source) || typeof source.name !== 'string' || !source.name.trim()) return null;

  const color = { name: source.name.trim() };
  const hex = normalizeHex(source.hex);
  const ratio = normalizeRatio(source.ratio);
  const role = readEnum(source.role, AESTHETIC_ENUMS.colorRoles, undefined);
  if (hex) color.hex = hex;
  if (ratio !== undefined) color.ratio = ratio;
  if (role) color.role = role;
  return color;
}

function normalizeHex(value) {
  if (typeof value !== 'string') return undefined;
  const match = value.trim().match(/^#?([0-9a-fA-F]{6})$/);
  return match ? `#${match[1].toUpperCase()}` : undefined;
}

function normalizeRatio(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(1, value));
}

function shouldUseIncomingField(field, existing, incoming) {
  if (!hasEffectiveValue(field, incoming[field])) return false;
  const incomingConfidence = incoming.confidence[field];
  const existingConfidence = existing.confidence[field];
  if (incomingConfidence === 'high') return true;
  if (incomingConfidence === 'medium') {
    return !hasEffectiveValue(field, existing[field])
      || CONFIDENCE_RANK[existingConfidence] <= CONFIDENCE_RANK.medium;
  }
  return false;
}

function shouldUseIncomingDesignElements(existing, incoming) {
  const incomingConfidence = incoming.confidence.designElements;
  const existingConfidence = existing.confidence.designElements;
  if (incomingConfidence === 'high') return true;
  if (incomingConfidence === 'medium') {
    return CONFIDENCE_RANK[existingConfidence] <= CONFIDENCE_RANK.medium;
  }
  return false;
}

function hasEffectiveValue(field, value) {
  if (field === 'formalityLevel') return value !== null;
  return value !== 'unknown' && value !== null && value !== undefined;
}

function cloneAestheticFeatures(value) {
  return {
    ...value,
    designElements: [...value.designElements],
    confidence: { ...value.confidence },
  };
}

function createDefaultConfidence() {
  return CONFIDENCE_FIELDS.reduce((confidence, field) => {
    confidence[field] = 'low';
    return confidence;
  }, {});
}

function readEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function normalizeRecognizedAt(value) {
  const text = safeString(value);
  return text && Number.isFinite(Date.parse(text)) ? text : new Date().toISOString();
}

function safeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeKey(value) {
  return safeString(value).toLowerCase();
}

function matchesAny(value, candidates) {
  return candidates.some((candidate) => value.includes(candidate));
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

module.exports = {
  AESTHETIC_SCHEMA_VERSION,
  AESTHETIC_PROMPT_VERSION,
  AESTHETIC_ENUMS,
  createDefaultAestheticFeaturesV1,
  normalizeAestheticFeaturesV1,
  normalizeColorPaletteV1,
  mergeAestheticFeaturesV1,
};
