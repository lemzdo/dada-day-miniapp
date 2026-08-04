const {
  VISIBLE_FACTS,
  getFactAuthorizationPolicy,
} = require('./recommendationFactAuthorization');
const { mapPatternLabel } = require('./recommendationPatternLabel');

const LEGACY_VISIBLE_SOURCE = 'legacy_snapshot';
const LEGACY_VISIBLE_SOURCE_DETAIL = 'legacy-visible-fact-adapter';
const EXPLICIT_FACT_ARRAY_SOURCES = Object.freeze({
  userFacts: 'user',
  careLabelFacts: 'care_label',
  productFacts: 'product_data',
  structuredAiFacts: 'structured_ai',
  visualFacts: 'visual_inference',
});
const KNOWN_SOURCES = new Set([
  'user',
  'care_label',
  'product_data',
  'structured_ai',
  'visual_inference',
  LEGACY_VISIBLE_SOURCE,
]);
const VISIBLE_FACT_SET = new Set(VISIBLE_FACTS);
const BASIC_COLOR_PATTERN = /黑|白|灰|米|棕|咖|卡其|藏青|navy|black|white|gray|grey|beige|brown|khaki/i;
const TSHIRT_ENUMS = new Set(['tshirt', 't_shirt', 'tee', 't恤', '短袖t恤']);
const SPORT_DRESS_ENUMS = new Set(['sport_dress', 'athletic_dress', 'tennis_dress', '运动连衣裙', '网球连衣裙']);
const SHOE_LACE_ENUMS = new Set(['laces', 'lace_up', 'shoelace', '系带', '鞋带']);
const FIXED_STRAP_ENUMS = new Set(['fixed_strap', 'strap', '固定带', '固定绑带']);

function adaptLegacyVisibleFacts(items = [], options = {}) {
  const normalizedItems = (Array.isArray(items) ? items : [])
    .map((item, index) => adaptLegacyVisibleFactItem(item, index, options))
    .filter(Boolean);
  return composeLegacyVisibleFacts(normalizedItems);
}

function adaptLegacyVisibleFactItem(item, index = 0, options = {}) {
  recordMetric(options.instrumentation, 'adaptLegacyVisibleFactItem');
  return adaptItem(item, index);
}

function composeLegacyVisibleFacts(normalizedItems = []) {
  return {
    items: normalizedItems,
    itemFactsById: Object.fromEntries(normalizedItems.map((item) => [item.id, {
      category: item.category,
      facts: item.facts.slice(),
      factRecords: item.factRecords.map((record) => ({ ...record })),
    }])),
  };
}

function recordMetric(instrumentation, name) {
  if (!instrumentation || typeof instrumentation !== 'object') return;
  const counters = instrumentation.counters && typeof instrumentation.counters === 'object'
    ? instrumentation.counters
    : instrumentation;
  counters[name] = (Number(counters[name]) || 0) + 1;
}

function adaptItem(item, index) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const id = readString(item._id || item.id || item.clothingId || item.itemId) || `item-${index}`;
  const category = normalizeCategory(item);
  const records = new Map();
  const defaultConfidence = normalizeConfidence(
    item.factConfidence ?? item.recognitionConfidence ?? item.aiConfidence ?? item.confidence,
  );

  for (const listName of ['factEvidence', 'factRecords', 'factsWithSource']) {
    for (const value of Array.isArray(item[listName]) ? item[listName] : []) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      addRecord(records, {
        id,
        category,
        fact: value.fact || value.name || value.factName || value.factId,
        value: value.value,
        source: value.source,
        confidence: value.confidence,
        authorized: value.authorized !== false,
        sourceDetail: value.sourceDetail || value.parsedFrom || value.origin || value.provenance,
      });
    }
  }

  for (const [field, source] of Object.entries(EXPLICIT_FACT_ARRAY_SOURCES)) {
    for (const value of Array.isArray(item[field]) ? item[field] : []) {
      const fact = value && typeof value === 'object' && !Array.isArray(value)
        ? value.fact || value.name || value.factName
        : value;
      addRecord(records, {
        id,
        category,
        fact,
        value: value && typeof value === 'object' && value.value !== undefined ? value.value : true,
        source,
        confidence: value && typeof value === 'object' && value.confidence !== undefined
          ? value.confidence
          : (['user', 'care_label', 'product_data'].includes(source) ? 1 : defaultConfidence),
        authorized: !value || typeof value !== 'object' || value.authorized !== false,
        sourceDetail: value && typeof value === 'object'
          ? value.sourceDetail || value.parsedFrom || value.origin || value.provenance || field
          : field,
      });
    }
  }

  for (const rawFact of Array.isArray(item.contractFacts) ? item.contractFacts : []) {
    const fact = canonicalFact(rawFact);
    addRecord(records, {
      id,
      category,
      fact,
      value: true,
      source: item.factSources?.[fact] || item.factSource,
      confidence: item.factConfidences?.[fact] ?? defaultConfidence,
      authorized: true,
      sourceDetail: 'contractFacts',
    });
  }

  const name = fieldText(item.category, item.subCategory, item.subcategory, item.type, item.customName, item.name);
  const sleeve = fieldText(item.sleeveLength, item.sleeve, item.aestheticFeatures?.sleeveLength);
  const pantsLength = fieldText(item.pantsLength, item.trouserLength, item.aestheticFeatures?.pantsLength, item.aestheticFeatures?.length);
  const fit = fieldText(item.fit, item.silhouette, item.aestheticFeatures?.fit, item.aestheticFeatures?.silhouette);
  const rawPattern = readFirstString(item.pattern, item.patternType, item.aestheticFeatures?.patternType);
  const patternLabel = mapPatternLabel(rawPattern);
  const color = readColor(item);
  const shoeType = fieldText(item.shoeType, item.aestheticFeatures?.shoeType, item.subCategory, item.subcategory, item.type, item.customName, item.name);
  const styles = fieldText(
    item.style,
    item.styleTags,
    item.sceneTags,
    item.styleComplexity,
    item.aestheticFeatures?.styleComplexity,
    item.aestheticFeatures?.style,
    item.aestheticFeatures?.styleTags,
  );
  const combinedStyle = `${name} ${styles}`.trim();
  const auditedSubtype = normalizeEnum(readFirstString(item.subCategory, item.subcategory, item.type));
  const auditedClosure = normalizeEnum(readFirstString(
    item.shoeClosure,
    item.closureType,
    item.fastening,
    item.aestheticFeatures?.closureType,
  ));
  const legacyVisibleTraits = {
    tshirt: category === 'top' && TSHIRT_ENUMS.has(auditedSubtype),
    sportDress: category === 'onepiece' && SPORT_DRESS_ENUMS.has(auditedSubtype),
  };

  addDerived('category', category, ['category', 'type']);
  if (color) addDerived('color', color, ['color', 'colorPalette', 'colors']);
  if (category === 'top' && /衬衫|衬衣|shirt/i.test(name)) addDerived('shirt', true, ['subCategory', 'subcategory', 'type']);
  if (category === 'onepiece') addDerived('dress', true, ['category', 'type']);
  if (/无袖|背心|吊带|sleeveless|tank/i.test(`${sleeve} ${name}`)) addDerived('sleeveless', sleeve || name, ['sleeveLength', 'sleeve', 'subCategory']);
  if (/短袖|short.?sleeve/i.test(sleeve) || legacyVisibleTraits.tshirt) {
    addDerived('short_sleeve', sleeve || auditedSubtype, ['sleeveLength', 'sleeve', 'subCategory']);
  }
  if (/长袖|long.?sleeve/i.test(`${sleeve} ${name}`)) addDerived('long_sleeve', sleeve || name, ['sleeveLength', 'sleeve', 'subCategory']);
  if (category === 'bottom' && /短裤|shorts|bermuda|五分裤/i.test(`${pantsLength} ${name}`)) addDerived('shorts', pantsLength || name, ['pantsLength', 'subCategory']);
  if (category === 'bottom'
    && !/短裤|shorts|bermuda|半裙|裙子|skirt/i.test(`${pantsLength} ${name}`)
    && (/长裤|西裤|牛仔裤|运动裤|训练裤|直筒裤|阔腿裤|pants|trouser|jeans|long/i.test(`${pantsLength} ${name}`)
      || (/裤/i.test(name) && !/短/i.test(name)))) {
    addDerived('long_pants', pantsLength || name, ['pantsLength', 'subCategory']);
  }
  if (/宽松|不贴身|loose|relaxed|oversize|wide/i.test(fit)) addDerived('loose_fit', fit, ['fit', 'silhouette']);
  if (/直筒|straight/i.test(`${fit} ${name}`)) addDerived('straight_cut', fit || name, ['fit', 'silhouette', 'subCategory']);
  if (patternLabel) addDerived('pattern_visible', rawPattern, ['pattern', 'patternType']);
  if (['solid', 'plain', '纯色'].includes(normalizeEnum(rawPattern))) addDerived('solid_color', rawPattern, ['pattern', 'patternType']);
  if (color && BASIC_COLOR_PATTERN.test(color)) addDerived('basic_color', color, ['color', 'colorPalette']);
  if (/简洁|简约|基础|minimal|simple|clean|basic/i.test(combinedStyle)) addDerived('simple_style', combinedStyle, ['styleTags', 'style', 'subCategory']);
  if (/休闲|日常|居家|casual|relaxed|home/i.test(combinedStyle)) addDerived('casual_style', combinedStyle, ['styleTags', 'sceneTags', 'style']);
  if (category === 'top' && (
    /运动|训练|瑜伽|跑步|健身|sport|athletic|training|yoga|running|gym/i.test(combinedStyle)
    || legacyVisibleTraits.tshirt
    || hasFact(records, 'sleeveless')
  )) {
    addDerived('sport_top', combinedStyle, ['styleTags', 'sceneTags', 'subCategory']);
  }
  if (category === 'bottom' && /运动|训练|瑜伽|跑步|健身|sport|athletic|training|yoga|running|gym/i.test(combinedStyle)) {
    addDerived('sport_bottom', combinedStyle, ['styleTags', 'sceneTags', 'subCategory']);
  }
  if (category === 'outerwear' && /运动|训练|瑜伽|跑步|健身|sport|athletic|training|yoga|running|gym/i.test(combinedStyle)) {
    addDerived('sport_outerwear', combinedStyle, ['styleTags', 'sceneTags', 'subCategory']);
  }
  if (category === 'shoes' && /运动鞋|跑步鞋|训练鞋|健身鞋|网球鞋|sneaker|sport|running|training/i.test(`${shoeType} ${styles}`)) {
    addDerived('sport_shoe', shoeType || styles, ['shoeType', 'subCategory', 'styleTags']);
  }
  if (category === 'shoes' && /拖鞋|凉拖|洞洞鞋|家居鞋|室内鞋|slipper|slide|crocs|home/i.test(`${shoeType} ${styles}`)) {
    addDerived('home_shoe', shoeType || styles, ['shoeType', 'subCategory', 'sceneTags']);
  }
  if (category === 'shoes'
    && !hasFact(records, 'home_shoe')
    && /运动鞋|跑步鞋|训练鞋|球鞋|板鞋|乐福|单鞋|皮鞋|短靴|长靴|牛津鞋|高跟鞋|玛丽珍|凉鞋|sneaker|running|training|loafer|flat|leather|boot|oxford|heel|sandal/i.test(`${shoeType} ${styles}`)) {
    addDerived('outing_shoe', shoeType || styles, ['shoeType', 'subCategory', 'styleTags']);
  }
  if (category === 'shoes' && SHOE_LACE_ENUMS.has(auditedClosure)) {
    addDerived('shoe_laces', auditedClosure, ['shoeClosure', 'closureType', 'fastening']);
  }
  if (category === 'shoes' && FIXED_STRAP_ENUMS.has(auditedClosure)) {
    addDerived('fixed_strap', auditedClosure, ['shoeClosure', 'closureType', 'fastening']);
  }

  const factRecords = Array.from(records.values()).sort((left, right) => left.factId.localeCompare(right.factId));
  return {
    id,
    category,
    facts: factRecords.map((record) => record.fact),
    factRecords,
    patternLabel,
    legacyVisibleTraits,
    raw: item,
  };

  function addDerived(fact, value, sourceFields) {
    if (hasFact(records, fact)) return;
    const explicitSource = normalizeSource(item.factSources?.[fact] || item.fieldSource);
    const source = explicitSource || (item.userEdited === true ? 'user' : LEGACY_VISIBLE_SOURCE);
    addRecord(records, {
      id,
      category,
      fact,
      value,
      source,
      confidence: item.factConfidences?.[fact] ?? (source === LEGACY_VISIBLE_SOURCE ? 1 : defaultConfidence),
      authorized: true,
      sourceDetail: source === LEGACY_VISIBLE_SOURCE
        ? LEGACY_VISIBLE_SOURCE_DETAIL
        : `visible-fields:${sourceFields.join(',')}`,
    });
  }
}

function addRecord(records, input) {
  const fact = canonicalFact(input.fact);
  if (!fact || !VISIBLE_FACT_SET.has(fact) || !isFactCategoryCompatible(fact, input.category)) return;
  const source = normalizeSource(input.source) || LEGACY_VISIBLE_SOURCE;
  const policy = getFactAuthorizationPolicy(fact);
  if (source === LEGACY_VISIBLE_SOURCE && policy.policy !== 'visible') return;
  if (source !== LEGACY_VISIBLE_SOURCE && !policy.allowedSources.includes(source)) return;
  const confidence = normalizeConfidence(input.confidence, source === LEGACY_VISIBLE_SOURCE ? 1 : 0);
  const record = {
    factId: `item:${input.id}:${fact}`,
    itemId: input.id,
    fact,
    value: input.value === undefined ? true : input.value,
    source,
    confidence,
    authorized: input.authorized !== false,
    ...(readString(input.sourceDetail) ? { sourceDetail: readString(input.sourceDetail) } : {}),
  };
  const previous = records.get(fact);
  if (!previous || sourceRank(record) > sourceRank(previous)) records.set(fact, record);
}

function sourceRank(record) {
  const rank = { user: 6, care_label: 5, product_data: 4, structured_ai: 3, visual_inference: 2, legacy_snapshot: 1 };
  return (rank[record.source] || 0) * 10 + record.confidence;
}

function hasFact(records, fact) {
  return records.has(fact);
}

function normalizeCategory(item) {
  const raw = readString(item.category || item.type).toLowerCase();
  const text = fieldText(item.category, item.type, item.subCategory, item.subcategory, item.customName, item.name).toLowerCase();
  if (raw === 'outerwear' || /外套|夹克|风衣|大衣|coat|jacket|cardigan|blazer/.test(text)) return 'outerwear';
  if (raw === 'onepiece' || /连衣裙|连体|onepiece|dress|jumpsuit/.test(text)) return 'onepiece';
  if (raw === 'shoes' || /鞋|靴|sneaker|loafer|shoe|boots|slipper|crocs/.test(text)) return 'shoes';
  if (raw === 'bottom' || raw === 'skirt' || /裤|下装|半裙|裙子|pants|trouser|jeans|shorts|skirt/.test(text)) return 'bottom';
  if (raw === 'top' || /上衣|衬衫|t恤|背心|吊带|针织|卫衣|shirt|tee|tank|sweater/.test(text)) return 'top';
  return raw || 'other';
}

function isFactCategoryCompatible(fact, category) {
  const compatibility = {
    shirt: ['top'], dress: ['onepiece'], sleeveless: ['top', 'onepiece'], short_sleeve: ['top', 'onepiece'],
    long_sleeve: ['top', 'outerwear', 'onepiece'], shorts: ['bottom'], long_pants: ['bottom'],
    loose_fit: ['top', 'bottom', 'outerwear', 'onepiece'], straight_cut: ['bottom'],
    sport_top: ['top'], sport_bottom: ['bottom'], sport_shoe: ['shoes'], outing_shoe: ['shoes'], home_shoe: ['shoes'],
  };
  return !compatibility[fact] || compatibility[fact].includes(category);
}

function canonicalFact(value) {
  const text = readString(value);
  const match = /^item:[^:]+:([^:]+)$/.exec(text);
  const raw = match ? match[1] : text;
  return raw.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[\s-]+/g, '_').toLowerCase();
}

function normalizeSource(value) {
  const source = readString(value).toLowerCase();
  return KNOWN_SOURCES.has(source) ? source : '';
}

function normalizeConfidence(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number > 1 ? number / 100 : number));
}

function readColor(item) {
  const direct = readString(item.color || item.colorName);
  if (direct) return direct;
  const colors = Array.isArray(item.colorPalette) ? item.colorPalette : Array.isArray(item.colors) ? item.colors : [];
  return colors.map((entry) => readString(typeof entry === 'string' ? entry : entry?.name || entry?.color)).filter(Boolean).join(' / ');
}

function fieldText(...values) {
  return values.flatMap((value) => {
    if (Array.isArray(value)) return value;
    return value === undefined || value === null ? [] : [value];
  }).map(readString).filter(Boolean).join(' ');
}

function readFirstString(...values) {
  for (const value of values) {
    const text = readString(value);
    if (text) return text;
  }
  return '';
}

function normalizeEnum(value) {
  return readString(value).trim().replace(/[\s-]+/g, '_').toLowerCase();
}

function readString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

module.exports = {
  LEGACY_VISIBLE_SOURCE,
  LEGACY_VISIBLE_SOURCE_DETAIL,
  adaptLegacyVisibleFactItem,
  adaptLegacyVisibleFacts,
  composeLegacyVisibleFacts,
};
