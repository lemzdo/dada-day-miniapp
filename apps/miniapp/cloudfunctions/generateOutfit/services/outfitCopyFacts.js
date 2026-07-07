const COLOR_ALIAS_MAP = {
  '米白色': ['米白', '米色', '白色', '米色系', '白色系'],
  '米白': ['米白', '米色', '白色', '米色系', '白色系'],
  '米色': ['米色', '米色系'],
  '军绿色': ['军绿', '绿色', '绿色系', '低饱和色'],
  '军绿': ['军绿', '绿色', '绿色系', '低饱和色'],
  '白色': ['白色', '白色系'],
  '灰色': ['灰色', '灰色系'],
  '黑色': ['黑色', '黑色系'],
};

const FORBIDDEN_CLAIMS = ['紫色', '牛仔', '皮质', '印花', '宽松版型', '街头感', '透气', '亲肤', '舒适自在'];

function buildOutfitCopyFacts(input = {}) {
  const outfit = input.outfit && typeof input.outfit === 'object' ? input.outfit : {};
  const sourceItems = Array.isArray(input.items) ? input.items : readItems(outfit);
  const scene = readString(input.scene || outfit.scene);
  const weather = input.weather || outfit.weatherSnapshot || outfit.weather || {};
  const items = sourceItems.map(normalizeFactItem).filter(Boolean);
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
    if (item.patternType) {
      fieldsPresent.pattern = true;
      allowedFacts.push(`pattern:${item.patternType}`);
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
    allowedFacts: uniqueStrings(allowedFacts),
    colorAliases,
    forbiddenClaims: FORBIDDEN_CLAIMS.slice(),
    fieldsPresent,
  };
}

function normalizeFactItem(item, index) {
  if (!item || typeof item !== 'object') return null;
  const id = readString(item.clothingId || item.itemId || item.id || item._id) || `item-${index}`;
  const slot = normalizeSlot(item.category || item.type || item.slot);
  const rawColor = readColor(item);
  return {
    id,
    slot,
    category: slot,
    name: readString(item.subcategory || item.subCategory || item.name || item.type || item.category) || defaultItemName(slot),
    rawColor,
    displayColor: rawColor,
    colorAliases: rawColor ? getColorAliases(rawColor) : [],
    material: readString(item.material || item.materialGuess),
    patternType: readString(item.patternType || item.aestheticFeatures?.patternType),
    fit: readString(item.fit || item.aestheticFeatures?.fit),
    silhouette: readString(item.silhouette || item.aestheticFeatures?.silhouette),
    thickness: readString(item.thickness),
    styleTags: uniqueStrings(Array.isArray(item.styleTags) ? item.styleTags : stringToArray(item.style)),
  };
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

function stringToArray(value) {
  return typeof value === 'string' ? value.split(/[,/，、\s]+/) : [];
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
  colorTermsForFacts,
  getColorAliases,
};
