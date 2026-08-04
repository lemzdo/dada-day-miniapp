const WARM_HINTS = /毛衣|厚针织|卫衣|厚|加绒|羊毛|毛呢|羽绒|保暖|sweater|hoodie|fleece|wool|down|thick/i;
const LIGHT_HINTS = ['轻薄', '薄款', '夏季', '防晒', '透气', '速干', '冰丝', '纯棉', '薄针织', '薄'];
const ENGLISH_LIGHT_HINTS = ['lightweight', 'breathable', 'thin knit'];
const SPORT_HINT_RE = /sport|sports|yoga|tennis|athletic|training|running|gym|运动|瑜伽|网球|训练|速干|跑步|健身|田径/i;
const WORK_HINT_RE = /commute|office|work|business|通勤|上班|开会|衬衫|西裤|西装|乐福|皮鞋|单鞋|利落|规整|挺括|简洁|正式/i;
const DATE_HINT_RE = /date|约会|半裙|连衣裙|裙装|针织|柔和|甜美|优雅|单鞋|复古|浪漫|法式/i;
const HOME_HINT_RE = /home|indoor|居家|家居|室内|睡衣|拖鞋|洞洞鞋|宽松/i;

function classifyWearabilityItem(item = {}, options = {}) {
  increment(options.instrumentation, 'classifyWearabilityItem');
  const normalizedType = options.normalizedType || normalizeType(item);
  const category = options.normalizedCategory || normalizeCategory(item, options.itemText, options);
  const text = options.itemText || itemText(item, options);
  const lowerText = text.toLowerCase();
  const lightnessSignals = [...LIGHT_HINTS, ...ENGLISH_LIGHT_HINTS]
    .filter((hint) => text.includes(hint) || lowerText.includes(hint.toLowerCase()));
  const hasLightness = lightnessSignals.length > 0;
  const sportSignals = matches(SPORT_HINT_RE, text);
  const workSignals = matches(WORK_HINT_RE, text);
  const dateSignals = matches(DATE_HINT_RE, text);
  const homeSignals = matches(HOME_HINT_RE, text);
  const isSweaterLike = /毛衣|针织|卫衣|sweater|hoodie|knit/i.test(text);
  const isOuterwearLike = category === 'outerwear' || /外套|大衣|风衣|夹克|羽绒|coat|jacket|blazer|cardigan/i.test(text);
  const isWarmByText = WARM_HINTS.test(text) && !hasLightness;
  const isWarmTop = ['top', 'outerwear'].includes(category)
    && (isWarmByText || ((isSweaterLike || /hoodie|卫衣/i.test(text)) && !hasLightness));
  const isWarmOuterwear = isOuterwearLike && (/大衣|羽绒|厚外套|厚|down|coat/i.test(text) && !hasLightness);
  const isWarmBottom = ['bottom', 'skirt'].includes(category) && (/厚裤|厚重|加绒|羊毛|毛呢|厚/i.test(text) && !hasLightness);
  const isDressLike = category === 'onepiece' || /连衣裙|裙装|dress|onepiece/i.test(text);
  const isSportDress = isDressLike && sportSignals.length > 0;
  const isNormalDress = isDressLike && !isSportDress;
  const isSkirtLike = category === 'skirt' || /半裙|裙子|skirt/i.test(text);
  const isShorts = /短裤|shorts|bermuda/i.test(text);
  const isTshirtLike = /T恤|tee|t-shirt|短袖/i.test(text);
  const isFormalLike = /正装|正式|西装|衬衫|西裤|皮鞋|乐福|blazer|suit|formal|office/i.test(text);
  const isSlipperLike = /拖鞋|凉拖|slipper|slide/i.test(text);
  const isCrocsLike = /洞洞鞋|crocs/i.test(text);
  const isHomeShoe = category === 'shoes' && (isSlipperLike || isCrocsLike || /家居鞋|室内鞋|沙滩|beach/i.test(text));
  const isCleanSneaker = category === 'shoes' && /干净运动鞋|通勤运动鞋|白色运动鞋|简洁运动鞋|clean sneaker|sneaker/i.test(text) && !isHomeShoe;
  const isSportShoe = category === 'shoes' && /跑步鞋|训练鞋|运动鞋|健身鞋|网球鞋|running|training|sports? shoe|sneaker/i.test(text) && !isHomeShoe;
  const warmthLevel = getWarmthLevel({
    text,
    category,
    isWarmTop,
    isWarmOuterwear,
    isWarmBottom,
    isSweaterLike,
    hasLightness,
  });

  return {
    itemId: readString(item._id || item.id || item.clothingId || item.itemId),
    category,
    subcategory: readString(item.subcategory || item.subCategory),
    itemType: readString(item.type || item.subcategory || item.subCategory || item.category),
    normalizedType,
    isSweaterLike,
    isWarmTop,
    isWarmOuterwear,
    isWarmBottom,
    isDressLike,
    isNormalDress,
    isSportDress,
    isSkirtLike,
    isFormalLike,
    isShorts,
    isTshirtLike,
    isSlipperLike,
    isCrocsLike,
    isHomeShoe,
    isCleanSneaker,
    isSportShoe,
    isBootLike: category === 'shoes' && /靴|boots?/i.test(text),
    isLongPants: ['bottom', 'skirt'].includes(category) && /长裤|西裤|裤|pants|trouser|jeans|long/i.test(text) && !isShorts,
    warmthLevel,
    lightnessSignals: uniqueStrings(lightnessSignals),
    sportSignals,
    workSignals: isHomeShoe ? [] : workSignals,
    dateSignals: isHomeShoe ? [] : dateSignals,
    homeSignals,
    confidence: normalizeConfidence(item.confidence ?? item.aiConfidence ?? item.recognitionConfidence),
    evidence: buildEvidence(item, text, {
      isSweaterLike,
      isWarmTop,
      isWarmOuterwear,
      isWarmBottom,
      isHomeShoe,
      isSportDress,
      lightnessSignals,
      sportSignals,
      workSignals,
      dateSignals,
    }),
  };
}

// This is the sole scene-eligibility parser. Callers may supply the visible facts
// already derived by recommendationEligibilityFacts; the raw-field path remains the
// fallback for confirmed clothes that predate scene tags.
function deriveSceneEligibilityFacts(item = {}, visibleFactItem = null, options = {}) {
  increment(options.instrumentation, 'deriveSceneEligibilityFacts');
  const wearability = options.wearabilityClassification || classifyWearabilityItem(item, options);
  const visibleFacts = new Set(readVisibleFacts(item, visibleFactItem));
  const capabilities = new Set(readStringArray(item.capabilities));
  const formalityLevel = Number(item.aestheticFeatures?.formalityLevel ?? item.formalityLevel);
  const hasFact = (fact) => visibleFacts.has(fact);
  const hasCapability = (capability) => capabilities.has(capability);
  const workSignals = uniqueStrings([
    ...wearability.workSignals,
    ...(wearability.isFormalLike ? ['formal_like'] : []),
    ...(hasCapability('commute') ? ['capability:commute'] : []),
    ...(hasCapability('structured') ? ['capability:structured'] : []),
    ...(hasFact('shirt') ? ['visible:shirt'] : []),
    ...(hasFact('straight_cut') ? ['visible:straight_cut'] : []),
    ...(hasFact('long_pants') ? ['visible:long_pants'] : []),
    ...(hasFact('simple_style') ? ['visible:simple_style'] : []),
    ...(hasFact('outing_shoe') ? ['visible:outing_shoe'] : []),
    ...(Number.isFinite(formalityLevel) && formalityLevel >= 3 ? ['aesthetic:formality'] : []),
  ]);
  const sportSignals = uniqueStrings([
    ...wearability.sportSignals,
    ...(hasCapability('formal_training') ? ['capability:formal_training'] : []),
    ...(hasCapability('light_activity') ? ['capability:light_activity'] : []),
    ...(hasFact('sport_top') ? ['visible:sport_top'] : []),
    ...(hasFact('sport_bottom') ? ['visible:sport_bottom'] : []),
    ...(hasFact('sport_shoe') ? ['visible:sport_shoe'] : []),
  ]);
  const explicitHomeSignals = uniqueStrings([
    ...wearability.homeSignals.filter((signal) => /home|indoor|居家|家居|室内|睡衣|拖鞋|洞洞鞋/i.test(signal)),
    ...(hasFact('home_shoe') ? ['visible:home_shoe'] : []),
    ...(hasCapability('indoor') ? ['capability:indoor'] : []),
  ]);
  const sportTopEvidence = wearability.category === 'top'
    && (sportSignals.length > 0 || hasFact('sport_top'));
  const sportCompatibleTop = wearability.category === 'top'
    && (wearability.isTshirtLike || hasFact('short_sleeve') || hasFact('sleeveless'));
  const sportBottomEvidence = wearability.category === 'bottom'
    && (sportSignals.length > 0 || hasFact('sport_bottom'));
  const sportApparelEvidence = sportTopEvidence || sportBottomEvidence || wearability.isSportDress;
  const polishEvidence = uniqueStrings([
    ...(wearability.isFormalLike ? ['formal_like'] : []),
    ...(hasFact('shirt') ? ['visible:shirt'] : []),
    ...(hasFact('straight_cut') ? ['visible:straight_cut'] : []),
    ...(hasFact('simple_style') ? ['visible:simple_style'] : []),
    ...(hasFact('long_pants') ? ['visible:long_pants'] : []),
    ...(hasFact('outing_shoe') ? ['visible:outing_shoe'] : []),
    ...(wearability.isCleanSneaker ? ['clean_sneaker'] : []),
    ...(Number.isFinite(formalityLevel) && formalityLevel >= 3 ? ['aesthetic:formality'] : []),
  ]);
  const explicitSceneTags = readStringArray(item.sceneTags);

  return {
    ...wearability,
    wearabilityFacts: wearability,
    visibleFacts: [...visibleFacts].sort(),
    capabilities: [...capabilities].sort(),
    explicitSceneTags,
    workSignals,
    sportSignals,
    explicitHomeSignals,
    invalidWorkShoe: wearability.category === 'shoes'
      && (wearability.isHomeShoe || wearability.isSlipperLike || wearability.isCrocsLike || hasFact('home_shoe')),
    invalidSportShoe: wearability.category === 'shoes'
      && (wearability.isHomeShoe || wearability.isSlipperLike || wearability.isCrocsLike
        || ((hasFact('outing_shoe') || hasCapability('commute')) && !wearability.isSportShoe && !hasFact('sport_shoe'))),
    casualShortsTee: wearability.isTshirtLike || hasFact('short_sleeve'),
    sportApparelEvidence,
    sportCompatibleTop,
    sportBottomEvidence,
    polishEvidence,
  };
}

function deriveConfirmableSceneTags(item = {}) {
  const facts = deriveSceneEligibilityFacts(item);
  const tags = new Set();
  const explicit = facts.explicitSceneTags.join(' ').toLowerCase();
  if (/通勤|上班|work|office|commute/.test(explicit)) tags.add('上班');
  if (/运动|sport|training|running|gym|瑜伽|网球/.test(explicit)) tags.add('运动');
  // Only facts that identify a scene by themselves become persisted tags. General
  // polish and generic casual clothes stay untagged and use this same parser at runtime.
  if (facts.sportApparelEvidence || facts.isSportShoe || facts.visibleFacts.includes('sport_shoe')) tags.add('运动');
  if (facts.isFormalLike || facts.workSignals.some((signal) => /通勤|上班|office|work|business|formal|commute/.test(signal))) tags.add('上班');
  return [...tags];
}

function getWarmthLevel({ text, category, isWarmTop, isWarmOuterwear, isWarmBottom, isSweaterLike, hasLightness }) {
  if (hasLightness && !/羽绒|大衣|厚外套|down/i.test(text)) return isSweaterLike ? 2 : 1;
  if (isWarmOuterwear || /羽绒|大衣|厚外套|down|overcoat/i.test(text)) return 4;
  if (isWarmTop || isWarmBottom) return 3;
  if (category === 'shoes' && /靴|boots?/i.test(text)) return 3;
  if (/长袖|针织|外套|长裤|jacket|cardigan/i.test(text)) return 2;
  if (/短袖|短裤|背心|凉鞋|薄|透气|棉麻|linen/i.test(text)) return 1;
  return 2;
}

function buildEvidence(item, text, flags) {
  const evidence = [];
  for (const key of ['customName', 'name', 'subcategory', 'subCategory', 'category', 'material', 'materialGuess', 'thickness', 'fit', 'patternType']) {
    const value = readString(item[key]);
    if (value) evidence.push(`${key}:${value}`);
  }
  for (const key of ['styleTags', 'sceneTags', 'seasonTags', 'designElements']) {
    for (const value of readStringArray(item[key])) evidence.push(`${key}:${value}`);
  }
  const features = item.aestheticFeatures && typeof item.aestheticFeatures === 'object' ? item.aestheticFeatures : {};
  for (const key of ['fit', 'length', 'silhouette', 'patternType']) {
    const value = readString(features[key]);
    if (value) evidence.push(`aesthetic.${key}:${value}`);
  }
  if (flags.lightnessSignals.length) evidence.push(`light:${flags.lightnessSignals.join('/')}`);
  if (flags.sportSignals.length) evidence.push(`sport:${flags.sportSignals.join('/')}`);
  if (flags.workSignals.length) evidence.push(`work:${flags.workSignals.join('/')}`);
  if (flags.dateSignals.length) evidence.push(`date:${flags.dateSignals.join('/')}`);
  if (flags.isWarmTop || flags.isWarmOuterwear || flags.isWarmBottom) evidence.push('warm:true');
  if (flags.isHomeShoe) evidence.push('homeShoe:true');
  if (flags.isSportDress) evidence.push('sportDress:true');
  return uniqueStrings(evidence).filter((entry) => text.includes(entry.split(':').slice(1).join(':')) || entry.includes(':') || entry.includes('true'));
}

function readVisibleFacts(item, visibleFactItem) {
  if (visibleFactItem && typeof visibleFactItem === 'object') {
    const fromRecords = Array.isArray(visibleFactItem.factRecords)
      ? visibleFactItem.factRecords.map((record) => record?.fact).filter(Boolean)
      : [];
    return uniqueStrings([...(visibleFactItem.facts || []), ...fromRecords]);
  }
  const records = Array.isArray(item.factRecords) ? item.factRecords : [];
  return uniqueStrings([
    ...(Array.isArray(item.visibleFacts) ? item.visibleFacts : []),
    ...(Array.isArray(item.contractFacts) ? item.contractFacts : []),
    ...records.map((record) => record?.fact).filter(Boolean),
  ]);
}

function normalizeType(item) {
  return [item.type, item.subcategory, item.subCategory, item.customName, item.name, item.category]
    .map(readString).filter(Boolean).join(' ').toLowerCase();
}

function normalizeCategory(item = {}, suppliedText, options = {}) {
  if (suppliedText && typeof suppliedText === 'object') {
    options = suppliedText;
    suppliedText = '';
  }
  increment(options.instrumentation, 'normalizeCategory');
  const raw = readString(item.category || item.type).toLowerCase();
  const text = (suppliedText || itemText(item, options)).toLowerCase();
  if (raw === 'outerwear' || /外套|大衣|风衣|夹克|西装外套|羽绒|coat|jacket|blazer|cardigan/.test(text)) return 'outerwear';
  if (raw === 'onepiece' || /连衣裙|连体|onepiece|dress|jumpsuit/.test(text)) return 'onepiece';
  if (raw === 'shoes' || /鞋|靴|sneaker|loafer|shoe|boots|crocs|slipper/.test(text)) return 'shoes';
  if (raw === 'accessory' || /包|帽|项链|耳环|腰带|配饰|accessory|bag|hat/.test(text)) return 'accessory';
  if (raw === 'skirt' || (raw === 'bottom' && /半裙|裙子|skirt/.test(text))) return 'skirt';
  if (raw === 'bottom' || /裤|下装|pants|trouser|jeans|shorts/.test(text)) return 'bottom';
  if (raw === 'top' || /上衣|衬衫|T恤|针织|卫衣|毛衣|shirt|tee|sweater|hoodie/.test(text)) return 'top';
  return raw || 'other';
}

function itemText(item = {}, options = {}) {
  increment(options.instrumentation, 'itemText');
  const features = item.aestheticFeatures && typeof item.aestheticFeatures === 'object' ? item.aestheticFeatures : {};
  return [
    item.category, item.subcategory, item.subCategory, item.type, item.customName, item.name,
    item.material, item.materialGuess, item.thickness, item.fit, item.patternType,
    item.sleeveLength, item.sleeve, item.length, item.pantsLength, item.trouserLength,
    item.shoeType, item.footwearType,
    features.fit, features.length, features.silhouette, features.patternType,
    ...readStringArray(features.designElements), ...readStringArray(item.designElements),
    ...readStringArray(item.styleTags || item.style), ...readStringArray(item.sceneTags),
    ...readStringArray(item.seasonTags), ...normalizeColors(item).map((color) => color.name),
  ].filter(Boolean).join(' ');
}

function matches(regex, text) {
  const result = [];
  const sources = String(text || '').split(/[,/，、\s]+/).filter(Boolean);
  for (const source of sources) if (regex.test(source)) result.push(source);
  if (result.length === 0 && regex.test(text)) result.push(String(text).match(regex)?.[0] || '');
  return uniqueStrings(result.filter(Boolean));
}

function normalizeColors(item = {}) {
  if (Array.isArray(item.colorPalette) && item.colorPalette.length > 0) {
    return item.colorPalette.map((entry) => typeof entry === 'string' ? { name: entry, hex: '' } : entry || {}).filter((entry) => entry.name);
  }
  return readStringArray(item.colors).map((name) => ({ name, hex: '' }));
}

function normalizeConfidence(value) {
  if (value === undefined || value === null || value === '') return null;
  if (value === 'high') return 0.9;
  if (value === 'medium') return 0.7;
  if (value === 'low') return 0.3;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return number > 1 ? number / 100 : number;
}

function increment(instrumentation, name) {
  if (!instrumentation || typeof instrumentation !== 'object') return;
  const counters = instrumentation.counters && typeof instrumentation.counters === 'object'
    ? instrumentation.counters
    : instrumentation;
  counters[name] = (Number(counters[name]) || 0) + 1;
}

function readString(value) { return typeof value === 'string' ? value.trim() : ''; }
function readStringArray(value) {
  if (Array.isArray(value)) return value.filter((entry) => typeof entry === 'string' && entry.trim()).map((entry) => entry.trim());
  if (typeof value === 'string') return value.split(/[,/，、\s]+/).filter(Boolean);
  return [];
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
  classifyWearabilityItem,
  deriveSceneEligibilityFacts,
  deriveConfirmableSceneTags,
  itemText,
  normalizeCategory,
  normalizeType,
  uniqueStrings,
};
