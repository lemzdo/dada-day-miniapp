const COLOR_ALIAS_MAP = {
  '米白色': ['米白', '米色', '白色', '米色系', '白色系'],
  '米白': ['米白', '米色', '白色', '米色系', '白色系'],
  '米色': ['米色', '米色系'],
  '军绿色': ['军绿', '绿色', '绿色系', '低饱和色'],
  '军绿': ['军绿', '绿色', '绿色系', '低饱和色'],
  '白色': ['白色', '白色系'],
  '灰白色': ['灰白色', '灰色', '灰色系', '白色', '白色系'],
  '灰色': ['灰色', '灰色系'],
  '黑色': ['黑色', '黑色系'],
};

const FORBIDDEN_CLAIMS = ['紫色', '牛仔', '皮质', '印花', '宽松版型', '街头感', '透气', '亲肤', '舒适自在'];

const {
  buildCopyNames,
  extractItemFactRecords,
  isFactCategoryCompatible,
  scopeOutfitFactsToItems,
} = require('./recommendationClaimBinding');

function buildOutfitCopyFacts(input = {}) {
  recordMetric(input.instrumentation, 'buildOutfitCopyFacts');
  const outfit = input.outfit && typeof input.outfit === 'object' ? input.outfit : {};
  const sourceItems = Array.isArray(input.items) ? input.items : readItems(outfit);
  const scene = readString(input.scene || outfit.scene);
  const weather = input.weather || outfit.weatherSnapshot || outfit.weather || {};
  const explicitContractFacts = uniqueStrings([
    ...stringArray(outfit.contractFacts),
    ...stringArray(outfit.availableFacts),
    ...stringArray(input.contractFacts),
  ]);
  const precomputedItems = resolvePrecomputedCopyItems(sourceItems, input.itemFactsContext);
  const canReusePrecomputedItems = precomputedItems !== null && explicitContractFacts.length === 0;
  const items = canReusePrecomputedItems
    ? precomputedItems
    : sourceItems.map((item, index) => normalizeFactItem(item, index, input.instrumentation)).filter(Boolean);
  const legacyScopedFacts = scopeOutfitFactsToItems(
    items.map((item) => ({ ...item, facts: [] })),
    explicitContractFacts,
  );
  const itemFactsById = Object.fromEntries(items.map((item) => {
    const factRecords = canReusePrecomputedItems
      ? item.factRecords
      : extractItemFactRecords(item.raw, item.slot);
    const legacy = legacyScopedFacts[item.id];
    if (!canReusePrecomputedItems) {
      for (const fact of legacy?.facts || []) {
        if (factRecords.some((record) => record.fact === fact)) continue;
        const compatibleItems = items.filter((candidate) => isFactCategoryCompatible(fact, candidate.slot));
        if (compatibleItems.length !== 1 || compatibleItems[0].id !== item.id) continue;
        factRecords.push({
          factId: `item:${item.id}:${fact}`,
          itemId: item.id,
          fact,
          value: true,
          source: 'structured_ai',
          confidence: item.confidence,
          authorized: true,
        });
      }
    }
    const facts = canReusePrecomputedItems ? item.facts : uniqueStrings(factRecords.map((record) => record.fact));
    return [item.id, {
      category: item.slot,
      facts,
      evidenceFactIds: canReusePrecomputedItems
        ? item.evidenceFactIds
        : uniqueStrings(factRecords.map((record) => record.factId)),
      factRecords: canReusePrecomputedItems ? factRecords : factRecords.slice(),
    }];
  }));
  const relationFacts = buildRelationFacts({ outfit, scene, items, itemFactsById });
  if (!canReusePrecomputedItems) {
    for (const item of items) {
      const scoped = itemFactsById[item.id];
      item.facts = scoped ? scoped.facts.slice() : [];
      item.evidenceFactIds = scoped ? scoped.evidenceFactIds.slice() : [];
      item.factRecords = scoped ? scoped.factRecords.slice() : [];
      delete item.raw;
    }
  }
  const colorAliases = {};
  const allowedFacts = [];
  const fieldsPresent = {
    color: false,
    material: false,
    pattern: false,
    fit: false,
    style: false,
    thickness: false,
    scene: Boolean(scene),
    weather: hasWeather(weather),
  };

  for (const item of items) {
    allowedFacts.push(`item:${item.id}:${item.name}`);
    allowedFacts.push(`category:${item.id}:${item.slot}`);
    allowedFacts.push(...item.evidenceFactIds);
    if (item.rawColor) {
      fieldsPresent.color = true;
      allowedFacts.push(`color:${item.rawColor}`);
      colorAliases[item.rawColor] = getColorAliases(item.rawColor);
      for (const alias of colorAliases[item.rawColor]) {
        allowedFacts.push(`colorAlias:${item.rawColor}:${alias}`);
      }
    }
    if (item.material) {
      fieldsPresent.material = true;
      allowedFacts.push(`material:${item.material}`);
    }
    const patternStyleTags = item.styleTags.filter(isPatternStyleTag);
    if (item.patternType || patternStyleTags.length > 0) {
      fieldsPresent.pattern = true;
      if (item.patternType) allowedFacts.push(`pattern:${item.patternType}`);
      for (const tag of patternStyleTags) allowedFacts.push(`pattern:${tag}`);
    }
    if (item.fit || item.silhouette) {
      fieldsPresent.fit = true;
      allowedFacts.push(`fit:${item.fit || item.silhouette}`);
    }
    if (item.thickness) {
      fieldsPresent.thickness = true;
      allowedFacts.push(`thickness:${item.thickness}`);
    }
    if (item.styleTags.length > 0) {
      fieldsPresent.style = true;
      for (const tag of item.styleTags) allowedFacts.push(`style:${tag}`);
    }
  }
  if (scene) allowedFacts.push(`scene:${scene}`);
  const weatherText = renderWeatherText(weather);
  if (weatherText) allowedFacts.push(`weather:${weatherText}`);

  return {
    items,
    scene: { raw: scene, normalized: normalizeScene(scene) },
    weather: {
      raw: weather,
      temp: normalizeNumber(weather.temp ?? weather.temperature),
      condition: readString(weather.weather || weather.condition),
      text: weatherText,
    },
    itemFactsById,
    relationFacts,
    contractFacts: explicitContractFacts,
    allowedFacts: uniqueStrings(allowedFacts),
    colorAliases,
    forbiddenClaims: FORBIDDEN_CLAIMS.slice(),
    fieldsPresent,
  };
}

function prepareCopyItemFacts(item, index = 0, instrumentation) {
  recordMetric(instrumentation, 'prepareCopyItemFacts');
  const normalized = normalizeFactItem(item, index, instrumentation);
  if (!normalized) return null;
  const factRecords = extractItemFactRecords(normalized.raw, normalized.slot);
  const prepared = {
    ...normalized,
    facts: uniqueStrings(factRecords.map((record) => record.fact)),
    evidenceFactIds: uniqueStrings(factRecords.map((record) => record.factId)),
    factRecords,
  };
  delete prepared.raw;
  return prepared;
}

function isPatternStyleTag(value) {
  return /印花|图案|条纹|格纹|波点|字母|logo/i.test(readString(value));
}

function resolvePrecomputedCopyItems(sourceItems, itemFactsContext) {
  if (!itemFactsContext || typeof itemFactsContext.resolveItemFacts !== 'function') return null;
  return sourceItems.map((item) => {
    const facts = itemFactsContext.resolveItemFacts(item);
    if (!facts?.copyItemFacts) throw new Error('canonical copy item facts are required');
    return facts.copyItemFacts;
  });
}

function recordMetric(instrumentation, name) {
  if (!instrumentation || typeof instrumentation !== 'object') return;
  const counters = instrumentation.counters && typeof instrumentation.counters === 'object'
    ? instrumentation.counters
    : instrumentation;
  counters[name] = (Number(counters[name]) || 0) + 1;
}

function normalizeFactItem(item, index, instrumentation) {
  recordMetric(instrumentation, 'copyItemParse');
  if (!item || typeof item !== 'object') return null;
  const id = readString(item.clothingId || item.itemId || item.id || item._id) || `item-${index}`;
  const slot = normalizeSlot(item.category || item.type || item.slot);
  const rawColor = readColor(item);
  const copyNames = buildCopyNames(item);
  return {
    id,
    slot,
    category: slot,
    name: readString(item.subcategory || item.subCategory || item.name || item.type || item.category) || defaultItemName(slot),
    displayName: copyNames.displayName,
    copyLabel: copyNames.copyLabel,
    rawColor,
    displayColor: rawColor,
    colorAliases: rawColor ? getColorAliases(rawColor) : [],
    material: readString(item.material || item.materialGuess),
    patternType: readString(item.patternType || item.aestheticFeatures?.patternType),
    fit: readString(item.fit || item.aestheticFeatures?.fit),
    silhouette: readString(item.silhouette || item.aestheticFeatures?.silhouette),
    thickness: readString(item.thickness),
    styleTags: uniqueStrings(Array.isArray(item.styleTags) ? item.styleTags : stringToArray(item.style)),
    facts: [],
    evidenceFactIds: [],
    factRecords: [],
    confidence: normalizeConfidence(
      item.factConfidence ?? item.recognitionConfidence ?? item.aiConfidence ?? item.confidence,
    ),
    raw: item,
    aestheticFeatures: item.aestheticFeatures && typeof item.aestheticFeatures === 'object'
      ? { ...item.aestheticFeatures }
      : {},
  };
}

function buildRelationFacts({ outfit, scene, items, itemFactsById }) {
  return [
    buildWorkEligibilityRelation(outfit, scene, items, itemFactsById),
    buildColorCoordinationRelation(items, itemFactsById),
  ].filter(Boolean);
}

function buildWorkEligibilityRelation(outfit, scene, items, itemFactsById) {
  const sceneResult = outfit?.eligibility?.scene;
  if (normalizeSceneKey(scene || outfit?.scene) !== 'work'
    || !sceneResult
    || sceneResult.eligible !== true
    || sceneResult.hardRejected === true) return null;
  const subjectItemIds = items.map((item) => item.id);
  const supportingFactIds = uniqueStrings(subjectItemIds.flatMap((itemId) => {
    const records = itemFactsById[itemId]?.factRecords || [];
    return records
      .filter((record) => ['category', 'shirt', 'pants', 'straight_cut', 'simple_style', 'solid_color', 'pattern_visible'].includes(record.fact))
      .map((record) => record.factId);
  }));
  return {
    relationFactId: 'outfit:work_eligible',
    factId: 'outfit:work_eligible',
    fact: 'work_eligible',
    subjectItemIds,
    supportingFactIds,
    sourceRule: sceneResult.sceneEvidenceVersion ? 'sceneEvidenceV4' : 'sceneEligibilityV3',
    sourceVersion: sceneResult.sceneEvidenceVersion || '',
    sourceFingerprint: sceneResult.sceneEvidenceFingerprint || '',
    sourceRuleReasons: uniqueStrings(sceneResult.acceptReasons),
    source: 'scene_rule',
    confidence: sceneResult.sceneStrength === 'strong' ? 1 : 0.9,
    authorized: true,
  };
}

function buildColorCoordinationRelation(items, itemFactsById) {
  const upper = items.find((item) => ['top', 'outerwear', 'onepiece'].includes(item.slot));
  const bottom = items.find((item) => item.slot === 'bottom');
  if (!upper || !bottom) return null;
  const upperGroup = colorCoordinationGroup(upper.rawColor);
  const bottomGroup = colorCoordinationGroup(bottom.rawColor);
  if (!upperGroup || upperGroup !== bottomGroup) return null;
  const upperFactId = `item:${upper.id}:color`;
  const bottomFactId = `item:${bottom.id}:color`;
  if (!hasExactFactRecord(itemFactsById[upper.id], upperFactId, upper.id, 'color')
    || !hasExactFactRecord(itemFactsById[bottom.id], bottomFactId, bottom.id, 'color')) return null;
  const confidence = Math.min(upper.confidence, bottom.confidence);
  return {
    relationFactId: 'outfit:color_coordinated',
    factId: 'outfit:color_coordinated',
    fact: 'color_coordinated',
    subjectItemIds: [upper.id, bottom.id],
    supportingFactIds: [upperFactId, bottomFactId],
    relationRule: 'same_normalized_color_group',
    value: upperGroup,
    source: 'relation_rule',
    confidence,
    authorized: true,
  };
}

function hasExactFactRecord(scope, factId, itemId, fact) {
  return Array.isArray(scope?.factRecords) && scope.factRecords.some((record) => (
    record.factId === factId && record.itemId === itemId && record.fact === fact
  ));
}

function colorCoordinationGroup(value) {
  const text = readString(value).toLowerCase();
  if (!text) return '';
  if (/黑|black/.test(text)) return 'black';
  if (/白|米|white|ivory|beige/.test(text)) return 'light-neutral';
  if (/灰|gray|grey/.test(text)) return 'gray';
  if (/棕|咖|brown|camel/.test(text)) return 'brown';
  if (/蓝|navy|blue/.test(text)) return 'blue';
  if (/绿|green/.test(text)) return 'green';
  if (/红|red/.test(text)) return 'red';
  return text;
}

function readItems(outfit) {
  return outfit.items || outfit.snapshotItems || outfit.itemsSnapshot || [];
}

function readColor(item) {
  const direct = readString(item.color);
  if (direct) return direct;
  const palette = Array.isArray(item.colorPalette) ? item.colorPalette : [];
  for (const entry of palette) {
    const color = readString(typeof entry === 'string' ? entry : entry?.name || entry?.color);
    if (color) return color;
  }
  return '';
}

function getColorAliases(color) {
  return uniqueStrings(COLOR_ALIAS_MAP[color] || [color]);
}

function colorTermsForFacts(facts = {}) {
  const terms = new Set();
  for (const item of facts.items || []) {
    if (item.rawColor) terms.add(item.rawColor);
    for (const alias of item.colorAliases || []) terms.add(alias);
  }
  for (const aliases of Object.values(facts.colorAliases || {})) {
    for (const alias of aliases) terms.add(alias);
  }
  return Array.from(terms).filter(Boolean);
}

function normalizeScene(value) {
  const text = readString(value).toLowerCase();
  return { home: '居家', work: '上班', date: '约会', sport: '运动', sports: '运动' }[text] || readString(value);
}

function normalizeSceneKey(value) {
  const text = readString(value).toLowerCase();
  return { home: 'home', 居家: 'home', work: 'work', 上班: 'work', 通勤: 'work', date: 'date', 约会: 'date', sport: 'sport', sports: 'sport', 运动: 'sport' }[text] || text;
}

function normalizeSlot(value) {
  const text = readString(value).toLowerCase();
  if (/top|shirt|tee|t恤|上衣|衬衫|卫衣/.test(text)) return 'top';
  if (/bottom|pants|trouser|下装|裤|裙/.test(text)) return 'bottom';
  if (/shoe|sneaker|鞋/.test(text)) return 'shoes';
  if (/outer|coat|jacket|外套/.test(text)) return 'outerwear';
  if (/onepiece|dress|连衣裙/.test(text)) return 'onepiece';
  if (/accessory|配饰|包|帽/.test(text)) return 'accessory';
  return text || 'other';
}

function defaultItemName(slot) {
  return {
    top: '上衣',
    bottom: '下装',
    shoes: '鞋子',
    outerwear: '外套',
    onepiece: '连衣裙',
    accessory: '配饰',
  }[slot] || '单品';
}

function renderWeatherText(weather = {}) {
  const temp = normalizeNumber(weather.temp ?? weather.temperature);
  const condition = readString(weather.weather || weather.condition);
  if (temp === null && !condition) return '';
  if (temp !== null && condition) return `${temp}℃ ${condition}`;
  if (temp !== null) return `${temp}℃`;
  return condition;
}

function hasWeather(weather = {}) {
  return Boolean(renderWeatherText(weather));
}

function normalizeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : null;
}

function normalizeConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

function stringToArray(value) {
  return typeof value === 'string' ? value.split(/[,/，、\s]+/) : [];
}

function stringArray(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : [];
}

function readString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function uniqueStrings(values) {
  const result = [];
  const seen = new Set();
  for (const value of values || []) {
    const text = readString(value);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

module.exports = {
  COLOR_ALIAS_MAP,
  FORBIDDEN_CLAIMS,
  buildOutfitCopyFacts,
  prepareCopyItemFacts,
  colorTermsForFacts,
  getColorAliases,
};
