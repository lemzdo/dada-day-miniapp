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
  const sportCompatibleTop = wearability.category === 'top'
    && (wearability.isTshirtLike || hasFact('short_sleeve') || hasFact('sleeveless'));
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
  const canonical = deriveCanonicalSceneFacts(item, wearability, visibleFacts);
  const hasControlledSportSignal = canonical.specialStyles.includes('sport')
    || hasCapability('formal_training')
    || hasCapability('light_activity')
    || hasFact('sport_top')
    || hasFact('sport_bottom');
  const sportTopEvidenceV4 = wearability.category === 'top' && hasControlledSportSignal;
  const sportBottomEvidenceV4 = wearability.category === 'bottom' && hasControlledSportSignal;

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
    sportApparelEvidence: sportTopEvidenceV4 || sportBottomEvidenceV4 || wearability.isSportDress,
    sportCompatibleTop,
    sportBottomEvidence: sportBottomEvidenceV4,
    polishEvidence,
    ...canonical,
  };
}

function deriveCanonicalSceneFacts(item, wearability, visibleFacts) {
  const controlledStyleTags = readStringArray(item.styleTags || item.style);
  const controlledSceneTags = readStringArray(item.sceneTags);
  const controlledCategoryText = [
    item.category, item.subcategory, item.subCategory, item.type, item.shoeType, item.footwearType,
  ].map(readString).filter(Boolean).join(' ');
  const controlledStyleText = controlledStyleTags.join(' ');
  const controlledSceneText = controlledSceneTags.join(' ');
  const controlledText = `${controlledCategoryText} ${controlledStyleText}`;
  const controlledActivityText = `${controlledText} ${controlledSceneText}`;
  const specialStyles = uniqueStrings([
    ...(/正装|正式|商务|formal|business|suit|blazer|西装|礼服/i.test(controlledText) ? ['formal'] : []),
    ...(/家居|居家|homewear|loungewear/i.test(controlledText) ? ['homewear'] : []),
    ...(/睡衣|睡袍|sleepwear|pajama|pyjama/i.test(controlledText) ? ['sleepwear'] : []),
    ...(/lolita|洛丽塔/i.test(controlledText) ? ['lolita'] : []),
    ...(/cosplay|角色服/i.test(controlledText) ? ['cosplay'] : []),
    ...(/舞台|演出|表演|performance|stage/i.test(controlledText) ? ['performance'] : []),
    ...(/运动|训练|瑜伽|跑步|健身|sport|athletic|training|yoga|running|gym/i.test(controlledActivityText) ? ['sport'] : []),
    ...(/休闲|日常|casual|relaxed/i.test(controlledActivityText) ? ['casual'] : []),
    ...(/泳装|游泳|swimwear|专业用途|特殊用途|special.?purpose/i.test(controlledText) ? ['special-purpose'] : []),
  ]);
  const canonicalSubtype = normalizeCanonicalSubtype(controlledCategoryText);
  const colorFacts = normalizeCanonicalColors(item);
  const patternFact = deriveControlledPatternFact(item, controlledStyleTags);
  const canonicalFacts = uniqueStrings([
    `category:${wearability.category}`,
    ...(canonicalSubtype ? [`subcategory:${canonicalSubtype}`] : []),
    ...specialStyles.map((style) => `style:${style}`),
    ...colorFacts.map((color) => `color:${color.family}`),
    ...(patternFact ? [`pattern:${patternFact.canonicalFact}`] : []),
    ...visibleFacts,
  ]);
  const isFormalShoe = wearability.category === 'shoes' && /商务皮鞋|正装皮鞋|德比鞋|牛津鞋|formal shoe|business shoe|oxford|derby/i.test(controlledText);
  const isHighHeel = wearability.category === 'shoes' && /高跟|high heel|pump/i.test(controlledText);
  const isDressShoe = wearability.category === 'shoes' && /礼服鞋|宴会鞋|dress shoe|evening shoe/i.test(controlledText);
  const isOpenOrUnsafeShoe = wearability.category === 'shoes' && /拖鞋|凉拖|洞洞鞋|家居鞋|高跟|礼服鞋|slipper|slide|crocs|high heel/i.test(controlledText);
  const isFormalDress = wearability.category === 'onepiece' && specialStyles.includes('formal');
  const isSuitCore = wearability.category === 'outerwear'
    && (canonicalSubtype === 'blazer' || /西装|suit|blazer/i.test(controlledCategoryText));
  const isFormalTop = wearability.category === 'top' && specialStyles.includes('formal');
  const isComplexStyle = /华丽|繁复|复杂|高装饰|ornate|elaborate|complex/i.test(controlledStyleText);

  return {
    canonicalCategory: wearability.category,
    canonicalSubtype,
    canonicalFacts,
    colorFacts,
    patternFact,
    specialStyles,
    isFormalCore: isSuitCore,
    isFormalDress,
    isFormalTop,
    isFormalShoe,
    isHighHeel,
    isDressShoe,
    isOpenOrUnsafeShoe,
    isHomewear: specialStyles.includes('homewear'),
    isSleepwear: specialStyles.includes('sleepwear'),
    isLolita: specialStyles.includes('lolita'),
    isCosplay: specialStyles.includes('cosplay'),
    isPerformance: specialStyles.includes('performance'),
    isSwimwear: /泳装|游泳|swimwear/i.test(controlledText),
    isSpecialPurpose: specialStyles.includes('special-purpose'),
    isProfessionalTraining: /专业训练|竞赛|比赛服|professional training|competition/i.test(controlledText),
    isCasual: specialStyles.includes('casual') || visibleFacts.has('casual_style'),
    isSimple: visibleFacts.has('simple_style') || /简洁|简约|基础|minimal|simple|clean|basic/i.test(controlledStyleText),
    isLoose: visibleFacts.has('loose_fit') || /宽松|loose|relaxed|oversize/i.test(controlledStyleText),
    isStructured: visibleFacts.has('straight_cut') || /挺括|利落|结构|直筒|structured|straight/i.test(controlledStyleText),
    isComplexStyle,
    isShirt: wearability.category === 'top' && /衬衫|衬衣|shirt/i.test(controlledCategoryText),
    isKnit: wearability.category === 'top' && /针织|毛衣|knit|sweater/i.test(controlledCategoryText),
    isSweatshirt: wearability.category === 'top' && /卫衣|hoodie|sweatshirt/i.test(controlledCategoryText),
    isDenim: wearability.category === 'bottom' && /牛仔|denim|jeans/i.test(`${controlledCategoryText} ${readString(item.material)}`),
    isExplicitSportTop: wearability.category === 'top' && specialStyles.includes('sport'),
    isExplicitSportBottom: wearability.category === 'bottom' && specialStyles.includes('sport'),
    isSportCompatibleBottom: wearability.category === 'bottom' && (wearability.isShorts || specialStyles.includes('sport') || /运动裤|卫裤|jogger|track pants/i.test(controlledCategoryText)),
    isSportApparel: ['top', 'bottom', 'skirt', 'onepiece', 'outerwear'].includes(wearability.category) && specialStyles.includes('sport'),
  };
}

function normalizeCanonicalSubtype(value) {
  const text = readString(value).toLowerCase();
  const mappings = [
    [/t恤|t-shirt|tshirt|\btee\b/i, 'tshirt'], [/polo/i, 'polo'], [/衬衫|衬衣|shirt/i, 'shirt'],
    [/卫衣|hoodie|sweatshirt/i, 'sweatshirt'], [/毛衣|sweater/i, 'sweater'], [/针织|knit/i, 'knit'],
    [/短裤|shorts/i, 'shorts'], [/西裤|dress pants|suit pants/i, 'tailored_pants'], [/牛仔|denim|jeans/i, 'denim_pants'],
    [/运动裤|卫裤|track pants|jogger/i, 'sport_pants'], [/休闲长裤|长裤|casual pants|trouser/i, 'casual_pants'],
    [/连衣裙|dress/i, 'dress'], [/西装|blazer|suit/i, 'blazer'], [/风衣|trench/i, 'trench'],
    [/大衣|overcoat/i, 'coat'], [/羽绒|down/i, 'down_jacket'], [/运动外套|sport jacket|track jacket/i, 'sport_jacket'],
    [/运动鞋|sneaker|running shoe|training shoe/i, 'sport_shoe'], [/商务皮鞋|business shoe|oxford|derby/i, 'business_shoe'],
    [/高跟|high heel|pump/i, 'high_heel'], [/礼服鞋|dress shoe|evening shoe/i, 'dress_shoe'],
    [/靴|boot/i, 'boots'], [/拖鞋|slipper|slide/i, 'slipper'],
  ];
  return mappings.find(([pattern]) => pattern.test(text))?.[1] || '';
}

function normalizeCanonicalColors(item = {}) {
  return normalizeColors(item).flatMap((entry) => {
    const name = readString(entry.name || entry.color);
    const hex = normalizeHex(entry.hex || entry.value);
    const family = canonicalColorFamily(name, hex);
    if (!family) return [];
    return [{
      sourceField: Array.isArray(item.colorPalette) && item.colorPalette.length > 0 ? 'colorPalette' : 'colors',
      sourceValue: name || hex,
      family,
      isNeutral: ['black', 'white', 'gray', 'beige', 'brown', 'navy'].includes(family),
      isBright: ['red', 'orange', 'yellow', 'pink', 'purple', 'green', 'blue'].includes(family) && !/浅|灰|暗|淡|light|muted|pastel/i.test(name),
      mappingRule: hex ? 'canonical-color-hex-hsl-v1' : 'canonical-color-controlled-name-v1',
    }];
  });
}

function canonicalColorFamily(name, hex) {
  const text = readString(name).toLowerCase().replace(/\s+/g, '');
  const explicit = [
    [/灰蓝|蓝灰|雾霾蓝|steelblue|slateblue/i, 'blue'], [/浅绿|灰绿|墨绿|军绿|olive|green/i, 'green'],
    [/藏青|海军蓝|navy/i, 'navy'], [/米白|象牙|奶油|ivory|cream/i, 'white'], [/卡其|米色|杏色|beige|khaki/i, 'beige'],
    [/咖|棕|褐|camel|brown/i, 'brown'], [/黑|black/i, 'black'], [/白|white/i, 'white'], [/灰|gray|grey/i, 'gray'],
    [/蓝|blue/i, 'blue'], [/绿|green/i, 'green'], [/红|red/i, 'red'], [/粉|pink/i, 'pink'],
    [/紫|purple|violet/i, 'purple'], [/橙|orange/i, 'orange'], [/黄|yellow/i, 'yellow'],
  ].find(([pattern]) => pattern.test(text));
  if (explicit) return explicit[1];
  return hex ? familyFromHex(hex) : '';
}

function familyFromHex(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return '';
  const max = Math.max(rgb.r, rgb.g, rgb.b);
  const min = Math.min(rgb.r, rgb.g, rgb.b);
  const lightness = (max + min) / 510;
  const saturation = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255));
  if (lightness <= 0.16) return 'black';
  if (lightness >= 0.9 && saturation <= 0.2) return 'white';
  if (saturation <= 0.12) return 'gray';
  const hue = hueFromRgb(rgb);
  if (hue < 15 || hue >= 345) return 'red';
  if (hue < 45) return lightness < 0.45 ? 'brown' : 'orange';
  if (hue < 70) return 'yellow';
  if (hue < 165) return 'green';
  if (hue < 255) return lightness < 0.32 ? 'navy' : 'blue';
  if (hue < 290) return 'purple';
  if (hue < 345) return 'pink';
  return '';
}

function normalizeHex(value) {
  const text = readString(value).toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(text)) return text;
  if (/^#[0-9a-f]{3}$/.test(text)) return `#${text[1]}${text[1]}${text[2]}${text[2]}${text[3]}${text[3]}`;
  return '';
}

function hexToRgb(value) {
  const hex = normalizeHex(value);
  if (!hex) return null;
  return { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) };
}

function hueFromRgb({ r, g, b }) {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  if (delta === 0) return 0;
  if (max === red) return 60 * (((green - blue) / delta) % 6 + 6) % 360;
  if (max === green) return 60 * ((blue - red) / delta + 2);
  return 60 * ((red - green) / delta + 4);
}

function deriveControlledPatternFact(item, styleTags) {
  const rawPattern = readString(item.pattern || item.patternType || item.aestheticFeatures?.patternType);
  const direct = normalizePattern(rawPattern);
  if (direct) return { sourceField: 'patternType', sourceValue: rawPattern, canonicalFact: direct, mappingRule: 'controlled-pattern-field-v1' };
  for (const tag of styleTags) {
    const mapped = normalizePattern(tag);
    if (mapped) return { sourceField: 'styleTags', sourceValue: tag, canonicalFact: mapped, mappingRule: 'controlled-style-pattern-map-v1' };
  }
  return null;
}

function normalizePattern(value) {
  const text = readString(value).toLowerCase();
  if (/^(纯色|solid|plain)$/.test(text)) return 'solid';
  if (/^(印花|印花图案|print|printed)$/.test(text)) return 'print';
  if (/^(条纹|stripe|striped)$/.test(text)) return 'stripe';
  if (/^(格纹|格子|plaid|check|checked)$/.test(text)) return 'plaid';
  if (/^(波点|polka dot|dots?)$/.test(text)) return 'polka_dot';
  if (/^(碎花|floral)$/.test(text)) return 'floral';
  return '';
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
