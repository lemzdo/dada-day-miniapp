const crypto = require('crypto');

const STYLIST_EVIDENCE_VERSION = 'stylist-evidence-v1';
const STYLIST_EVIDENCE_SCHEMA_VERSION = 1;
const MAX_EVIDENCE_COUNT = 16;
const VALID_POLARITIES = new Set(['positive', 'negative', 'neutral']);
const SCORE_KEYS = ['total', 'weatherAdaptation', 'styleUnity', 'freshness', 'preference'];
const SAFE_ITEM_FIELDS = [
  'category',
  'type',
  'subcategory',
  'subCategory',
  'colorPalette',
  'fit',
  'length',
  'silhouette',
  'patternType',
  'designElements',
  'formalityLevel',
  'styleTags',
  'material',
  'thickness',
  'aestheticFeatures',
];

function buildStylistEvidenceV1({ outfit, scene, weather, explicitProfile } = {}) {
  const safeItems = buildSafeItems(outfit);
  const aestheticEvaluation = normalizeAestheticEvaluation(outfit?.aestheticEvaluation);
  const context = {
    scene: normalizeScene(scene || outfit?.scene),
    temperatureBand: getTemperatureBand(weather || outfit?.weatherSnapshot || outfit?.weather),
    conditionBucket: getConditionBucket(weather || outfit?.weatherSnapshot || outfit?.weather),
  };
  const scores = sanitizeScores(outfit?.scores);
  const evidence = normalizeEvidence(aestheticEvaluation);
  const limitations = buildLimitations(aestheticEvaluation);
  const canonicalInput = {
    evidenceVersion: STYLIST_EVIDENCE_VERSION,
    context,
    outfit: buildCanonicalOutfit(safeItems, explicitProfile),
    scores,
    aesthetic: aestheticEvaluation,
    evidence,
    limitations,
  };

  return {
    schemaVersion: STYLIST_EVIDENCE_SCHEMA_VERSION,
    evidenceVersion: STYLIST_EVIDENCE_VERSION,
    context,
    outfit: {
      itemCount: safeItems.length,
      categories: uniqueStrings(safeItems.map((item) => item.category)).sort(),
      colors: uniqueColors(safeItems.flatMap((item) => item.colorPalette)).sort(compareColor),
      styleTags: uniqueStrings(safeItems.flatMap((item) => item.styleTags)).sort(),
    },
    scores,
    aesthetic: {
      engineVersion: aestheticEvaluation.engineVersion,
      score: aestheticEvaluation.score,
      coverage: aestheticEvaluation.coverage,
      dimensions: aestheticEvaluation.dimensions,
    },
    evidence,
    limitations,
    inputDigest: sha256(stableStringify(canonicalInput)),
  };
}

function buildSafeItems(outfit) {
  const sources = [
    ...(Array.isArray(outfit?.items) ? outfit.items : []),
    ...(Array.isArray(outfit?.itemsSnapshot) ? outfit.itemsSnapshot : []),
    ...(Array.isArray(outfit?.snapshotItems) ? outfit.snapshotItems : []),
  ];
  const map = new Map();
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    const rawId = readString(source.clothingId || source.itemId || source._id || source.id);
    const semanticKey = rawId || stableStringify(pickSafeItemFields(source));
    if (!semanticKey) continue;
    const safe = normalizeSafeItem(source, semanticKey);
    const key = safe.identity;
    map.set(key, { ...(map.get(key) || {}), ...safe });
  }

  const clothingIds = Array.isArray(outfit?.clothingIds) ? outfit.clothingIds : [];
  for (const id of clothingIds) {
    const rawId = readString(id);
    if (!rawId) continue;
    const identity = hashIdentity(rawId);
    if (!map.has(identity)) map.set(identity, normalizeSafeItem({ clothingId: rawId }, rawId));
  }

  return Array.from(map.values()).sort((a, b) => a.identity.localeCompare(b.identity));
}

function normalizeSafeItem(source, identitySource) {
  const picked = pickSafeItemFields(source);
  const colorPalette = normalizeColorPalette(picked.colorPalette || (picked.color ? [{ name: picked.color }] : []));
  const aestheticFeatures = normalizeAestheticFeatures(picked.aestheticFeatures);
  return {
    identity: hashIdentity(identitySource),
    category: readString(picked.category || picked.type),
    subcategory: readString(picked.subcategory || picked.subCategory || picked.name),
    colorPalette,
    fit: readString(picked.fit || aestheticFeatures.fit),
    length: readString(picked.length || aestheticFeatures.length),
    silhouette: readString(picked.silhouette || aestheticFeatures.silhouette),
    patternType: readString(picked.patternType || aestheticFeatures.patternType),
    designElements: uniqueStrings([...(picked.designElements || []), ...(aestheticFeatures.designElements || [])]).sort(),
    formalityLevel: normalizeFiniteNumber(picked.formalityLevel ?? aestheticFeatures.formalityLevel),
    styleTags: uniqueStrings(parseTagList(picked.styleTags || picked.style)).sort(),
    material: readString(picked.material),
    thickness: readString(picked.thickness),
  };
}

function pickSafeItemFields(source) {
  const result = {};
  for (const key of SAFE_ITEM_FIELDS) {
    if (source[key] !== undefined) result[key] = source[key];
  }
  if (source.name !== undefined) result.name = source.name;
  if (source.style !== undefined) result.style = source.style;
  if (source.color !== undefined) result.color = source.color;
  if (source.clothingId !== undefined) result.clothingId = source.clothingId;
  if (source.itemId !== undefined) result.itemId = source.itemId;
  if (source._id !== undefined) result._id = source._id;
  if (source.id !== undefined) result.id = source.id;
  return result;
}

function buildCanonicalOutfit(safeItems, explicitProfile) {
  return {
    itemCount: safeItems.length,
    items: safeItems.map((item) => ({
      identity: item.identity,
      category: item.category,
      subcategory: item.subcategory,
      colors: item.colorPalette,
      fit: item.fit,
      length: item.length,
      silhouette: item.silhouette,
      patternType: item.patternType,
      designElements: item.designElements,
      formalityLevel: item.formalityLevel,
      styleTags: item.styleTags,
      material: item.material,
      thickness: item.thickness,
    })),
    explicitProfile: normalizeExplicitProfile(explicitProfile),
  };
}

function normalizeAestheticEvaluation(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    engineVersion: readString(source.engineVersion),
    score: normalizeNullableScore(source.score),
    coverage: clamp01(source.coverage),
    dimensions: normalizeDimensions(source.dimensions),
    evidence: Array.isArray(source.evidence) ? source.evidence : [],
  };
}

function normalizeDimensions(value) {
  if (!value || typeof value !== 'object') return {};
  const result = {};
  for (const key of Object.keys(value).sort()) {
    const entry = value[key];
    if (!entry || typeof entry !== 'object') continue;
    result[key] = {
      score: normalizeNullableScore(entry.score),
      coverage: clamp01(entry.coverage),
      evidenceCodes: uniqueStrings(entry.evidenceCodes).sort(),
    };
  }
  return result;
}

function normalizeEvidence(aestheticEvaluation) {
  const dimensionByCode = new Map();
  for (const [dimension, entry] of Object.entries(aestheticEvaluation.dimensions || {})) {
    for (const code of entry.evidenceCodes || []) dimensionByCode.set(code, dimension);
  }

  const map = new Map();
  for (const source of aestheticEvaluation.evidence || []) {
    if (!source || typeof source !== 'object') continue;
    const code = readString(source.code);
    if (!code) continue;
    const current = map.get(code);
    const normalized = {
      code,
      dimension: dimensionByCode.get(code) || readString(source.dimension),
      polarity: VALID_POLARITIES.has(source.polarity) ? source.polarity : 'neutral',
      strength: clampStrength(source.strength),
      facts: normalizeEvidenceFacts(source),
    };
    if (current) {
      current.strength = Math.max(current.strength, normalized.strength);
      current.facts = mergeFacts(current.facts, normalized.facts);
    } else {
      map.set(code, normalized);
    }
  }

  return Array.from(map.values())
    .sort((a, b) => a.code.localeCompare(b.code))
    .slice(0, MAX_EVIDENCE_COUNT);
}

function normalizeEvidenceFacts(source) {
  return {
    itemRefs: uniqueStrings(source.itemIds).map(hashIdentity).sort(),
    data: sanitizeFactObject(source.data),
  };
}

function mergeFacts(left, right) {
  return {
    itemRefs: uniqueStrings([...(left.itemRefs || []), ...(right.itemRefs || [])]).sort(),
    data: { ...(left.data || {}), ...(right.data || {}) },
  };
}

function sanitizeFactObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};
  for (const key of Object.keys(value).sort()) {
    const safeKey = readString(key);
    const safeValue = sanitizeFactValue(value[key]);
    if (safeKey && safeValue !== undefined) result[safeKey] = safeValue;
  }
  return result;
}

function sanitizeFactValue(value) {
  if (value === null) return null;
  if (typeof value === 'string') return value.trim().slice(0, 48);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    return value.map(sanitizeFactValue).filter((item) => item !== undefined).slice(0, 12);
  }
  return undefined;
}

function buildLimitations(aestheticEvaluation) {
  const coverage = Number(aestheticEvaluation.coverage || 0);
  const limitations = [];
  if (aestheticEvaluation.score === null || coverage < 0.25) {
    limitations.push('INSUFFICIENT_AESTHETIC_EVIDENCE');
  } else if (coverage < 0.5) {
    limitations.push('LIMITED_AESTHETIC_COVERAGE');
  }
  return limitations.sort();
}

function sanitizeScores(scores) {
  const result = {};
  for (const key of SCORE_KEYS) result[key] = normalizeFiniteNumber(scores?.[key]);
  return result;
}

function normalizeExplicitProfile(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    styleTags: uniqueStrings(value.styleTags).sort(),
    colorPreference: uniqueStrings(value.colorPreference).sort(),
    fitPreference: readString(value.fitPreference),
    temperatureSensitivity: readString(value.temperatureSensitivity),
  };
}

function normalizeAestheticFeatures(value) {
  if (!value || typeof value !== 'object') return {};
  return {
    fit: readString(value.fit),
    length: readString(value.length),
    silhouette: readString(value.silhouette),
    patternType: readString(value.patternType),
    designElements: uniqueStrings(value.designElements).sort(),
    formalityLevel: normalizeFiniteNumber(value.formalityLevel),
  };
}

function normalizeColorPalette(value) {
  return Array.isArray(value)
    ? value
        .map((entry) => {
          if (typeof entry === 'string') return { name: entry.trim(), role: '' };
          if (!entry || typeof entry !== 'object') return null;
          return {
            name: readString(entry.name),
            role: readString(entry.role),
          };
        })
        .filter((entry) => entry && entry.name)
    : [];
}

function uniqueColors(colors) {
  const map = new Map();
  for (const color of colors || []) {
    if (!color || !color.name) continue;
    const key = `${color.name}|${color.role || ''}`;
    map.set(key, { name: color.name, role: color.role || '' });
  }
  return Array.from(map.values());
}

function compareColor(a, b) {
  if (a.name !== b.name) return a.name.localeCompare(b.name);
  return (a.role || '').localeCompare(b.role || '');
}

function parseTagList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return value.split(/[,/，、\s]+/);
  return [];
}

function getTemperatureBand(weather) {
  const temp = normalizeFiniteNumber(weather?.temp ?? weather?.temperature);
  if (temp === null) return '';
  if (temp < 12) return 'cold';
  if (temp < 22) return 'cool';
  if (temp <= 28) return 'mild';
  return 'hot';
}

function getConditionBucket(weather) {
  const text = readString(weather?.conditionBucket || weather?.weather || weather?.condition).toLowerCase();
  if (!text) return '';
  if (/rain|雨|shower/.test(text)) return 'rain';
  if (/snow|雪/.test(text)) return 'snow';
  if (/sun|晴|clear/.test(text)) return 'clear';
  if (/cloud|阴|云|overcast/.test(text)) return 'cloudy';
  return 'other';
}

function normalizeScene(value) {
  return readString(value).slice(0, 32);
}

function readString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function uniqueStrings(values) {
  return Array.isArray(values)
    ? values
        .filter((value) => typeof value === 'string' && value.trim())
        .map((value) => value.trim())
        .filter((value, index, array) => array.indexOf(value) === index)
    : [];
}

function normalizeFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : null;
}

function normalizeNullableScore(value) {
  if (value === null) return null;
  return normalizeFiniteNumber(value);
}

function clamp01(value) {
  const number = normalizeFiniteNumber(value);
  if (number === null) return 0;
  return Math.max(0, Math.min(1, Math.round(number * 100) / 100));
}

function clampStrength(value) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return 1;
  return Math.max(1, Math.min(3, number));
}

function hashIdentity(value) {
  return sha256(String(value || '')).slice(0, 16);
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) return 'null';
  return JSON.stringify(value);
}

module.exports = {
  STYLIST_EVIDENCE_SCHEMA_VERSION,
  STYLIST_EVIDENCE_VERSION,
  buildStylistEvidenceV1,
  stableStringify,
};
