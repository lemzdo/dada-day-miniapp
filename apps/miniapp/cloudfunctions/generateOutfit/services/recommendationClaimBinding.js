const ITEM_NAME_SLOT_CATEGORIES = Object.freeze({
  topName: Object.freeze(['top']),
  bottomName: Object.freeze(['bottom']),
  shoeName: Object.freeze(['shoes']),
  outerName: Object.freeze(['outerwear']),
  innerName: Object.freeze(['inner', 'top']),
  bagName: Object.freeze(['accessory']),
  heroName: Object.freeze(['top', 'outerwear', 'onepiece', 'bottom', 'shoes', 'accessory']),
  colorName: Object.freeze(['top', 'outerwear', 'onepiece', 'bottom', 'shoes', 'accessory']),
  accentColor: Object.freeze(['top', 'outerwear', 'onepiece', 'bottom', 'shoes', 'accessory']),
  topColor: Object.freeze(['top']),
  bottomColor: Object.freeze(['bottom']),
  shoeColor: Object.freeze(['shoes']),
  heroColor: Object.freeze(['top', 'outerwear', 'onepiece', 'bottom', 'shoes', 'accessory']),
  patternColor: Object.freeze(['top', 'outerwear', 'onepiece', 'bottom', 'shoes', 'accessory']),
});

const ATTRIBUTE_CATEGORY_COMPATIBILITY = Object.freeze({
  color: Object.freeze(['top', 'bottom', 'outerwear', 'onepiece', 'shoes', 'accessory']),
  neckline: Object.freeze(['top', 'outerwear', 'onepiece']),
  collar: Object.freeze(['top', 'outerwear', 'onepiece']),
  sleeve: Object.freeze(['top', 'outerwear', 'onepiece']),
  cuff: Object.freeze(['top', 'outerwear', 'onepiece']),
  cuff_relaxed: Object.freeze(['top', 'outerwear', 'onepiece']),
  shoulder_line: Object.freeze(['top', 'outerwear', 'onepiece']),
  coverage: Object.freeze(['top', 'outerwear', 'onepiece']),
  coverage_stability: Object.freeze(['top', 'outerwear', 'onepiece']),
  closure: Object.freeze(['top', 'outerwear', 'onepiece', 'bottom']),
  waistband: Object.freeze(['bottom', 'onepiece']),
  waist_stretch: Object.freeze(['bottom', 'onepiece']),
  trouser_length: Object.freeze(['bottom']),
  leg_opening: Object.freeze(['bottom']),
  flexible_fit: Object.freeze(['bottom', 'onepiece']),
  movement: Object.freeze(['top', 'bottom', 'outerwear', 'onepiece']),
  shoulder_mobility: Object.freeze(['top', 'outerwear', 'onepiece']),
  movement_flexion: Object.freeze(['bottom', 'onepiece']),
  zip_pocket: Object.freeze(['bottom', 'outerwear']),
  small_item_security: Object.freeze(['bottom', 'outerwear', 'accessory']),
  hemline: Object.freeze(['top', 'outerwear', 'onepiece', 'bottom']),
  sole_grip: Object.freeze(['shoes']),
  slip_resistance: Object.freeze(['shoes']),
  anti_slip: Object.freeze(['shoes']),
  grip: Object.freeze(['shoes']),
  secure_lacing: Object.freeze(['shoes']),
  secure_fit: Object.freeze(['shoes']),
  heel_height: Object.freeze(['shoes']),
  sole_condition: Object.freeze(['shoes']),
  shoe_support: Object.freeze(['shoes']),
  shoe_silhouette: Object.freeze(['shoes']),
  shoe_weight: Object.freeze(['shoes']),
  shoe_fit_check: Object.freeze(['shoes']),
  clean_shoes: Object.freeze(['shoes']),
  qualified_shoes: Object.freeze(['shoes']),
  quick_dry: Object.freeze(['top', 'bottom', 'onepiece']),
  moisture_wicking: Object.freeze(['top', 'bottom', 'onepiece']),
  breathability: Object.freeze(['top', 'bottom', 'onepiece', 'shoes']),
  lightweight: Object.freeze(['top', 'bottom', 'outerwear', 'onepiece', 'shoes']),
  lightness: Object.freeze(['top', 'bottom', 'outerwear', 'onepiece', 'shoes']),
  warmth: Object.freeze(['top', 'bottom', 'outerwear', 'onepiece']),
  soft_material: Object.freeze(['top', 'bottom', 'outerwear', 'onepiece']),
  material: Object.freeze(['top', 'bottom', 'outerwear', 'onepiece', 'shoes', 'accessory']),
  drape: Object.freeze(['top', 'bottom', 'outerwear', 'onepiece']),
  silhouette: Object.freeze(['top', 'bottom', 'outerwear', 'onepiece', 'shoes']),
  shape_retention: Object.freeze(['top', 'bottom', 'outerwear', 'onepiece']),
  wrinkle_resistance: Object.freeze(['top', 'bottom', 'outerwear', 'onepiece']),
  wrinkle_risk: Object.freeze(['top', 'bottom', 'outerwear', 'onepiece']),
  lint_risk: Object.freeze(['top', 'bottom', 'outerwear', 'onepiece']),
  static_electricity: Object.freeze(['top', 'bottom', 'outerwear', 'onepiece']),
  easy_care: Object.freeze(['top', 'bottom', 'outerwear', 'onepiece']),
  machine_washable: Object.freeze(['top', 'bottom', 'outerwear', 'onepiece']),
  spot_cleanable: Object.freeze(['top', 'bottom', 'outerwear', 'onepiece']),
  storage: Object.freeze(['outerwear', 'bottom', 'accessory']),
  packability: Object.freeze(['outerwear', 'accessory']),
  structured_top: Object.freeze(['top', 'outerwear', 'onepiece']),
  formal_bottom: Object.freeze(['bottom', 'onepiece']),
  dress: Object.freeze(['onepiece']),
  pattern_detail: Object.freeze(['top', 'bottom', 'outerwear', 'onepiece', 'shoes', 'accessory']),
  pattern_hero: Object.freeze(['top', 'bottom', 'outerwear', 'onepiece', 'shoes', 'accessory']),
  styling_detail: Object.freeze(['top', 'bottom', 'outerwear', 'onepiece', 'shoes', 'accessory']),
  texture_detail: Object.freeze(['top', 'bottom', 'outerwear', 'onepiece', 'shoes', 'accessory']),
  hardware_detail: Object.freeze(['top', 'bottom', 'outerwear', 'onepiece', 'shoes', 'accessory']),
  formality: Object.freeze(['top', 'bottom', 'outerwear', 'onepiece', 'shoes']),
  movement_raise_arms: Object.freeze(['top', 'outerwear', 'onepiece']),
  long_sitting: Object.freeze(['top', 'bottom', 'onepiece']),
  color_accent: Object.freeze(['top', 'bottom', 'outerwear', 'onepiece', 'shoes', 'accessory']),
  accent_color: Object.freeze(['top', 'bottom', 'outerwear', 'onepiece', 'shoes', 'accessory']),
  shirt: Object.freeze(['top']),
  pants: Object.freeze(['bottom']),
  loose_fit: Object.freeze(['top', 'bottom', 'outerwear', 'onepiece']),
  not_fitted: Object.freeze(['top', 'bottom', 'outerwear', 'onepiece']),
  straight_cut: Object.freeze(['bottom']),
  waist_not_tight: Object.freeze(['bottom', 'onepiece']),
  shoulder_relaxed: Object.freeze(['top', 'outerwear', 'onepiece']),
  soft_sole: Object.freeze(['shoes']),
  cushioning: Object.freeze(['shoes']),
  shoe_laces: Object.freeze(['shoes']),
  fixed_strap: Object.freeze(['shoes']),
  simple_style: Object.freeze(['top', 'bottom', 'outerwear', 'onepiece', 'shoes', 'accessory']),
  solid_color: Object.freeze(['top', 'bottom', 'outerwear', 'onepiece', 'shoes', 'accessory']),
  basic_color: Object.freeze(['top', 'bottom', 'outerwear', 'onepiece', 'shoes', 'accessory']),
  bright_color: Object.freeze(['top', 'bottom', 'outerwear', 'onepiece', 'shoes', 'accessory']),
  neckline_detail: Object.freeze(['top', 'outerwear', 'onepiece']),
  pattern_visible: Object.freeze(['top', 'bottom', 'outerwear', 'onepiece', 'shoes', 'accessory']),
  long_sleeve: Object.freeze(['top', 'outerwear', 'onepiece']),
  thin_outerwear: Object.freeze(['outerwear']),
  sport_outerwear: Object.freeze(['outerwear']),
  home_conflict: Object.freeze(['top', 'bottom', 'outerwear', 'onepiece', 'shoes']),
  tight_fit: Object.freeze(['top', 'bottom', 'outerwear', 'onepiece']),
  restrictive: Object.freeze(['top', 'bottom', 'outerwear', 'onepiece']),
  stiff: Object.freeze(['top', 'bottom', 'outerwear', 'onepiece']),
  heavy: Object.freeze(['top', 'bottom', 'outerwear', 'onepiece', 'shoes']),
  home_shoe: Object.freeze(['shoes']),
  outing_shoe: Object.freeze(['shoes']),
  sport_shoe: Object.freeze(['shoes']),
});

const FIELD_FACT_ALIASES = Object.freeze({
  antiSlip: 'anti_slip',
  slipResistance: 'slip_resistance',
  soleGrip: 'sole_grip',
  secureLacing: 'secure_lacing',
  secureFit: 'secure_fit',
  heelHeight: 'heel_height',
  soleCondition: 'sole_condition',
  shoeSupport: 'shoe_support',
  shoeSilhouette: 'shoe_silhouette',
  shoeWeight: 'shoe_weight',
  shoeFitCheck: 'shoe_fit_check',
  quickDry: 'quick_dry',
  moistureWicking: 'moisture_wicking',
  waistStretch: 'waist_stretch',
  flexibleFit: 'flexible_fit',
  shoulderLine: 'shoulder_line',
  trouserLength: 'trouser_length',
  legOpening: 'leg_opening',
  cuffRelaxed: 'cuff_relaxed',
  shapeRetention: 'shape_retention',
  wrinkleResistance: 'wrinkle_resistance',
  wrinkleRisk: 'wrinkle_risk',
  machineWashable: 'machine_washable',
  spotCleanable: 'spot_cleanable',
  zipPocket: 'zip_pocket',
  movementFlexion: 'movement_flexion',
  movementRaiseArms: 'movement_raise_arms',
  softMaterial: 'soft_material',
  softSole: 'soft_sole',
  cushioning: 'cushioning',
  shoeLaces: 'shoe_laces',
  fixedStrap: 'fixed_strap',
  looseFit: 'loose_fit',
  notFitted: 'not_fitted',
  straightCut: 'straight_cut',
  waistNotTight: 'waist_not_tight',
  shoulderRelaxed: 'shoulder_relaxed',
  shoulderMobility: 'shoulder_mobility',
  simpleStyle: 'simple_style',
  solidColor: 'solid_color',
  basicColor: 'basic_color',
  brightColor: 'bright_color',
  necklineDetail: 'neckline_detail',
  patternVisible: 'pattern_visible',
  longSleeve: 'long_sleeve',
  thinOuterwear: 'thin_outerwear',
  sportOuterwear: 'sport_outerwear',
});

const SOURCE_FACT_ARRAYS = Object.freeze({
  userFacts: 'user',
  careLabelFacts: 'care_label',
  productFacts: 'product_data',
  structuredAiFacts: 'structured_ai',
  visualFacts: 'visual_inference',
});

const BASIC_COLOR_PATTERN = /黑|白|灰|米|棕|藏青|navy|black|white|gray|grey|beige|brown/i;
const BRIGHT_COLOR_PATTERN = /亮|荧光|鲜红|正红|橙|明黄|宝蓝|玫红|lime|neon|bright|vivid|orange|yellow|red/i;

function normalizeCategory(value) {
  const text = readString(value).toLowerCase();
  if (/top|shirt|tee|t恤|上衣|衬衫|卫衣/.test(text)) return 'top';
  if (/onepiece|dress|连衣裙/.test(text)) return 'onepiece';
  if (/bottom|pants|trouser|下装|裤|半身裙/.test(text)) return 'bottom';
  if (/shoe|sneaker|鞋|靴/.test(text)) return 'shoes';
  if (/outer|coat|jacket|外套|夹克|风衣/.test(text)) return 'outerwear';
  if (/inner|innerwear|内搭/.test(text)) return 'inner';
  if (/accessory|配饰|包|帽/.test(text)) return 'accessory';
  return text || 'other';
}

function isFactCategoryCompatible(fact, category) {
  const allowed = ATTRIBUTE_CATEGORY_COMPATIBILITY[fact];
  return !allowed || allowed.includes(normalizeCategory(category));
}

function categoriesForSlot(slot) {
  return (ITEM_NAME_SLOT_CATEGORIES[slot] || []).slice();
}

function buildCopyNames(item = {}) {
  const category = normalizeCategory(item.category || item.slot || item.type);
  const name = readString(item.subcategory || item.subCategory || item.name || item.type || item.category);
  const color = readString(item.color || item.rawColor || item.displayColor);
  const displayName = readString(item.displayName) || `${name.includes(color) ? '' : color}${name}` || defaultNoun(category);
  const explicit = readString(item.copyLabel);
  if (explicit) return { displayName, copyLabel: explicit };
  const noun = conciseNoun(name, category);
  const prefix = category === 'shoes' ? '这双' : ['bottom', 'onepiece'].includes(category) ? '这条' : '这件';
  return { displayName, copyLabel: `${prefix}${noun}` };
}

function conciseNoun(name, category) {
  const candidates = category === 'shoes'
    ? ['运动鞋', '乐福鞋', '帆布鞋', '训练鞋', '休闲鞋', '短靴', '靴子', '鞋子']
    : category === 'onepiece'
      ? ['连衣裙', '裙子']
      : category === 'bottom'
        ? ['运动长裤', '长裤', '短裤', '半身裙', '裙子', '裤子']
        : category === 'outerwear'
          ? ['风衣', '夹克', '外套']
          : category === 'accessory'
            ? ['手提包', '背包', '随身包', '包']
            : ['短袖T恤', 'T恤', '衬衫', '针织衫', '卫衣', '上衣'];
  return candidates.find((entry) => name.includes(entry)) || defaultNoun(category);
}

function defaultNoun(category) {
  return {
    top: '上衣', bottom: '长裤', shoes: '鞋子', outerwear: '外套', inner: '内搭',
    onepiece: '连衣裙', accessory: '配饰',
  }[category] || '衣服';
}

function extractItemFacts(item = {}, categoryValue) {
  const category = normalizeCategory(categoryValue || item.category || item.slot || item.type);
  const facts = [];
  const sources = [item, item.aestheticFeatures, item.functionalFeatures, item.attributes, item.performance];
  for (const source of sources) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
    for (const [rawKey, value] of Object.entries(source)) {
      if (!isPositiveValue(value)) continue;
      const canonical = FIELD_FACT_ALIASES[rawKey] || camelToSnake(rawKey);
      if (ATTRIBUTE_CATEGORY_COMPATIBILITY[canonical]) facts.push(canonical);
    }
  }
  for (const value of [item.facts, item.contractFacts, item.availableFacts, item.evidenceFacts]) {
    if (!Array.isArray(value)) continue;
    facts.push(...value.map(canonicalFactName));
  }
  const fit = readString(item.fit || item.silhouette || item.aestheticFeatures?.fit || item.aestheticFeatures?.silhouette).toLowerCase();
  if (/flex|stretch|relax|宽松|弹力/.test(fit)) facts.push('flexible_fit', 'movement', 'movement_flexion');
  if (/structur|tailor|clean|straight|挺括|利落/.test(fit)) facts.push(category === 'bottom' ? 'formal_bottom' : 'structured_top', 'shape_retention');
  const material = readString(item.material || item.materialGuess).toLowerCase();
  if (material) facts.push('material');
  if (/soft|cotton|knit|modal|柔软|棉|针织|莫代尔/.test(material)) facts.push('soft_material');
  if (/quick.?dry|速干/.test(material)) facts.push('quick_dry', 'moisture_wicking');
  if (/breath|mesh|透气|网眼/.test(material)) facts.push('breathability');
  const thickness = readString(item.thickness).toLowerCase();
  if (/thin|light|lightweight|轻薄|薄款|^薄$/.test(thickness)) facts.push('lightness', 'lightweight');
  if (/thick|heavy|warm|厚|保暖/.test(thickness)) facts.push('warmth');
  const pattern = readString(item.patternType || item.pattern || item.aestheticFeatures?.patternType).toLowerCase();
  if (pattern && !/solid|plain|none|纯色/.test(pattern)) facts.push('pattern_detail', 'pattern_hero', 'styling_detail');
  const formality = Number(item.formalityLevel ?? item.aestheticFeatures?.formalityLevel);
  if (Number.isFinite(formality)) {
    facts.push('formality');
    if (formality >= 3) facts.push(category === 'bottom' ? 'formal_bottom' : category === 'shoes' ? 'clean_shoes' : 'structured_top');
  }
  if (category === 'onepiece') facts.push('dress');
  if (category === 'shoes') facts.push('shoe_role');
  if (readString(item.color || item.rawColor || item.displayColor) || Array.isArray(item.colorPalette)) facts.push('color');
  return uniqueStrings(facts.map(canonicalFactName).filter((fact) => isFactCategoryCompatible(fact, category)));
}

function extractItemFactRecords(item = {}, categoryValue) {
  const category = normalizeCategory(categoryValue || item.category || item.slot || item.type);
  const itemId = readString(item.clothingId || item.itemId || item.id || item._id);
  const records = [];
  const defaultConfidence = normalizeConfidence(
    item.factConfidence ?? item.recognitionConfidence ?? item.aiConfidence ?? item.confidence,
  );
  const sourceByFact = isPlainObject(item.factSources) ? item.factSources : {};
  const confidenceByFact = isPlainObject(item.factConfidences) ? item.factConfidences : {};

  for (const listName of ['factEvidence', 'factRecords', 'factsWithSource']) {
    const values = Array.isArray(item[listName]) ? item[listName] : [];
    for (const value of values) {
      if (!isPlainObject(value)) continue;
      addFactRecord(records, {
        itemId,
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

  for (const [field, source] of Object.entries(SOURCE_FACT_ARRAYS)) {
    for (const value of Array.isArray(item[field]) ? item[field] : []) {
      const fact = isPlainObject(value) ? value.fact || value.name || value.factName : value;
      addFactRecord(records, {
        itemId,
        category,
        fact,
        value: isPlainObject(value) && value.value !== undefined ? value.value : true,
        source,
        confidence: isPlainObject(value) && value.confidence !== undefined
          ? value.confidence
          : confidenceByFact[fact] ?? (['user', 'care_label', 'product_data'].includes(source) ? 1 : defaultConfidence),
        authorized: !isPlainObject(value) || value.authorized !== false,
        sourceDetail: isPlainObject(value)
          ? value.sourceDetail || value.parsedFrom || value.origin || value.provenance
          : field,
      });
    }
  }

  for (const fact of Array.isArray(item.contractFacts) ? item.contractFacts : []) {
    const canonical = canonicalFactName(fact);
    addFactRecord(records, {
      itemId,
      category,
      fact: canonical,
      value: true,
      source: sourceByFact[canonical] || sourceByFact[fact] || item.factSource || 'structured_ai',
      confidence: confidenceByFact[canonical] ?? confidenceByFact[fact] ?? defaultConfidence,
      authorized: true,
    });
  }

  const visibleSource = item.userEdited === true || item.fieldSource === 'user' ? 'user' : 'visual_inference';
  const visibleConfidence = visibleSource === 'user' ? Math.max(defaultConfidence, 0.9) : defaultConfidence;
  const name = readString(item.subcategory || item.subCategory || item.name || item.customName || item.type).toLowerCase();
  addVisible('category', category);
  if (category === 'top' && /衬衫|衬衣|shirt/.test(name)) addVisible('shirt', true);
  if (category === 'bottom' && !/裙|skirt/.test(name)) addVisible('pants', true);
  if (category === 'onepiece') addVisible('dress', true);
  if (category === 'shoes') addVisible('shoe_role', true);
  if (category === 'outerwear') addVisible('outerwear', true);

  const fit = readString(item.fit || item.silhouette || item.aestheticFeatures?.fit || item.aestheticFeatures?.silhouette).toLowerCase();
  if (/loose|relax|oversize|wide|宽松|不贴身/.test(fit)) addVisible('loose_fit', fit);
  if (/loose|relax|oversize|wide|regular|宽松|不贴身/.test(fit)) addVisible('not_fitted', fit);
  if (/straight|直筒/.test(fit)) addVisible('straight_cut', fit);
  if (/tight|slim|fitted|skinny|紧身|修身/.test(fit)) addVisible('tight_fit', fit);

  const shoulder = readString(item.shoulderFit || item.shoulderLine || item.aestheticFeatures?.shoulderFit).toLowerCase();
  if (/loose|relax|drop|宽松|落肩|不紧/.test(shoulder)) addVisible('shoulder_relaxed', shoulder);

  const sleeve = readString(item.sleeveLength || item.sleeve || item.aestheticFeatures?.sleeveLength).toLowerCase();
  if (/long|长袖/.test(sleeve) || /长袖/.test(name)) addVisible('long_sleeve', sleeve || 'long');

  const pattern = readString(item.patternType || item.pattern || item.aestheticFeatures?.patternType).toLowerCase();
  if (pattern && !/solid|plain|none|纯色|无图案/.test(pattern)) addVisible('pattern_visible', pattern);
  if (/solid|plain|纯色|无图案/.test(pattern)) addVisible('solid_color', pattern);

  const color = readString(item.color || item.rawColor || item.displayColor || item.colorName);
  if (color) {
    addVisible('color', color);
    if (BASIC_COLOR_PATTERN.test(color)) addVisible('basic_color', color);
    if (BRIGHT_COLOR_PATTERN.test(color)) addVisible('bright_color', color);
  }

  const styleComplexity = readString(item.styleComplexity || item.aestheticFeatures?.styleComplexity).toLowerCase();
  if (/simple|clean|minimal|简洁|简约/.test(styleComplexity)) addVisible('simple_style', styleComplexity);
  const neckline = readString(item.neckline || item.aestheticFeatures?.neckline || item.collar).toLowerCase();
  if (neckline && !/basic|plain|round|基础|普通圆领/.test(neckline)) addVisible('neckline_detail', neckline);

  const closure = readString(item.closure || item.shoeClosure || item.functionalFeatures?.closure).toLowerCase();
  if (/lace|系带|鞋带/.test(closure)) addVisible('shoe_laces', closure);
  if (/strap|搭扣|固定带|袢带/.test(closure)) addVisible('fixed_strap', closure);

  const thickness = readString(item.thickness || item.aestheticFeatures?.thickness).toLowerCase();
  if (/thin|light|轻薄|薄款|^薄$/.test(thickness)) addVisible('lightweight', thickness);
  if (category === 'outerwear' && /thin|light|轻薄|薄款|^薄$/.test(thickness)) addVisible('thin_outerwear', thickness);
  const styles = [
    ...(Array.isArray(item.styleTags) ? item.styleTags : []),
    ...String(item.style || '').split(/[,/，、\s]+/),
    ...String(item.sceneTags || '').split(/[,/，、\s]+/),
  ].join(' ').toLowerCase();
  if (category === 'outerwear' && /sport|运动|训练/.test(styles)) addVisible('sport_outerwear', true);
  if (category === 'shoes' && /sport|运动|训练|sneaker/.test(`${styles} ${name}`)) addVisible('sport_shoe', true);
  if (category === 'shoes' && /slipper|拖鞋|洞洞鞋|居家/.test(`${styles} ${name}`)) addVisible('home_shoe', true);
  if (category === 'shoes' && !/slipper|拖鞋|洞洞鞋|居家/.test(`${styles} ${name}`)) addVisible('outing_shoe', true);

  return dedupeFactRecords(records);

  function addVisible(fact, value) {
    addFactRecord(records, {
      itemId,
      category,
      fact,
      value,
      source: visibleSource,
      confidence: visibleConfidence,
      authorized: true,
    });
  }
}

function addFactRecord(records, input) {
  const fact = canonicalFactName(input.fact);
  if (!fact || !isFactCategoryCompatible(fact, input.category)) return;
  const sourceDetail = readString(input.sourceDetail);
  const rawSource = readString(input.source).toLowerCase();
  const source = rawSource === 'structured_ai' && isCareLabelProvenance(sourceDetail)
    ? 'care_label'
    : rawSource;
  const confidence = normalizeConfidence(input.confidence);
  records.push({
    factId: input.itemId ? `item:${input.itemId}:${fact}` : fact,
    itemId: input.itemId,
    fact,
    value: input.value === undefined ? true : input.value,
    source,
    confidence,
    authorized: input.authorized !== false,
    ...(sourceDetail ? { sourceDetail } : {}),
  });
}

function isCareLabelProvenance(value) {
  return /care[_ -]?label|wash[_ -]?label|护理标签|洗标/i.test(readString(value));
}

function dedupeFactRecords(records) {
  const result = [];
  const byKey = new Map();
  for (const record of records) {
    const key = `${record.factId}|${record.source}`;
    const previous = byKey.get(key);
    if (!previous || record.confidence > previous.confidence) byKey.set(key, record);
  }
  for (const record of byKey.values()) result.push(record);
  return result.sort((left, right) => left.factId.localeCompare(right.factId) || right.confidence - left.confidence);
}

function normalizeConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

function scopeOutfitFactsToItems(items, outfitFacts) {
  const result = Object.fromEntries(items.map((item) => [item.id, new Set(item.facts || [])]));
  for (const rawFact of outfitFacts || []) {
    const fact = canonicalFactName(rawFact);
    if (!ATTRIBUTE_CATEGORY_COMPATIBILITY[fact]) continue;
    const compatible = items.filter((item) => isFactCategoryCompatible(fact, item.category || item.slot));
    if (compatible.length === 1) result[compatible[0].id].add(fact);
  }
  return Object.fromEntries(items.map((item) => {
    const facts = uniqueStrings(Array.from(result[item.id] || []));
    return [item.id, {
      category: normalizeCategory(item.category || item.slot),
      facts,
      evidenceFactIds: facts.map((fact) => `item:${item.id}:${fact}`),
    }];
  }));
}

function requiredBindingsForCluster(row) {
  const bindings = {};
  for (const slot of row.allowedSlots || []) {
    const slotCategories = categoriesForSlot(slot);
    if (slotCategories.length === 0) continue;
    const itemFacts = (row.requiredFacts || []).filter((fact) => ATTRIBUTE_CATEGORY_COMPATIBILITY[fact]);
    let categories = slotCategories;
    for (const fact of itemFacts) {
      categories = categories.filter((category) => isFactCategoryCompatible(fact, category));
    }
    bindings[slot] = Object.freeze({
      categories: Object.freeze(categories),
      requiredFacts: Object.freeze(itemFacts),
      subjectMustMatchEvidence: true,
    });
  }
  return Object.freeze(bindings);
}

function parseItemEvidenceId(value) {
  const match = /^item:([^:]+):([^:]+)$/.exec(readString(value));
  return match ? { itemId: match[1], fact: match[2] } : null;
}

function canonicalFactName(value) {
  const text = readString(value);
  if (!text) return '';
  if (/^item:[^:]+:[^:]+$/.test(text)) return text.split(':')[2];
  return FIELD_FACT_ALIASES[text] || camelToSnake(text);
}

function camelToSnake(value) {
  return readString(value).replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[\s-]+/g, '_').toLowerCase();
}

function isPositiveValue(value) {
  if (value === true) return true;
  if (typeof value === 'number') return Number.isFinite(value);
  return typeof value === 'string' && Boolean(value.trim()) && !/^(false|none|unknown|no|0)$/i.test(value.trim());
}

function uniqueStrings(values) {
  return [...new Set((values || []).filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))];
}

function readString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

module.exports = {
  ATTRIBUTE_CATEGORY_COMPATIBILITY,
  ITEM_NAME_SLOT_CATEGORIES,
  buildCopyNames,
  categoriesForSlot,
  extractItemFactRecords,
  extractItemFacts,
  isFactCategoryCompatible,
  normalizeCategory,
  parseItemEvidenceId,
  requiredBindingsForCluster,
  scopeOutfitFactsToItems,
};
