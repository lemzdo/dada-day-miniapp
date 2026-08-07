const ELIGIBILITY_REASON_CATALOG_VERSION = 'eligibility-reason-v6';

const ELIGIBILITY_REASON_CATALOG = Object.freeze([
  definition('HOME_HOT_SLEEVELESS_SHORTS', 'home', 'weather', 1, false, 'hot', ['sleeveless', 'shorts'],
    '今天{temp}℃，无袖上衣配短裤，宅家穿正合适，整身也不会显得厚重。', matchHomeHotSleevelessShorts),
  definition('HOME_SLEEVELESS_SHORTS', 'home', 'category', 2, false, 'no_weather', ['sleeveless', 'shorts'],
    '无袖上衣配短裤，宅家穿这身正合适，整身也不会显得厚重。', matchHomeHotSleevelessShorts),
  definition('HOME_HOT_SHORT_SLEEVE_SHORTS', 'home', 'weather', 1, false, 'hot', ['short_sleeve', 'shorts'],
    '今天{temp}℃，短袖配短裤，宅家穿正合适，也不会裹得太多。', matchHomeHotShortSleeveShorts),
  definition('HOME_SHORT_SLEEVE_SHORTS', 'home', 'category', 2, false, 'no_weather', ['short_sleeve', 'shorts'],
    '短袖配短裤，宅家穿这身正合适，整身也不会显得厚重。', matchHomeHotShortSleeveShorts),
  definition('HOME_PATTERN_TOP_SOLID_BOTTOM', 'home', 'pattern', 3, false, null, ['pattern_visible', 'solid_color'],
    '{patternLabel}上衣配纯色下装，宅家穿挺合适，整身看着也不会太花。', matchHomePatternTopSolidBottom),
  definition('HOME_LOOSE_TWO_PIECE', 'home', 'fit', 4, false, null, ['loose_fit'],
    '上衣和下装都比较宽松，宅家穿这身正合适，整身看着也不会紧绷。', matchHomeLooseTwoPiece),
  definition('HOME_TSHIRT_LOOSE_PANTS', 'home', 'category', 2, false, null, ['short_sleeve', 'loose_fit'],
    'T恤配宽松裤子，宅家穿很合适，整身看着也比较轻松。', matchHomeTshirtLoosePants),
  definition('HOME_SHORT_SLEEVE_LONG_PANTS', 'home', 'category', 3, false, null, ['short_sleeve', 'long_pants'],
    '短袖上衣配长裤，在家穿得轻松，临时下楼也方便。', matchHomeShortSleeveLongPants),
  definition('HOME_TOP_LONG_PANTS', 'home', 'category', 5, false, null, ['category', 'long_pants'],
    '上衣配长裤，居家活动和临时出门都能自然衔接。', matchHomeTopLongPants),
  definition('HOME_LOOSE_DRESS', 'home', 'fit', 4, false, null, ['dress', 'loose_fit'],
    '这条连衣裙版型比较宽松，宅家穿正合适，整身看着也不会紧绷。', matchHomeLooseDress),
  definition('HOME_DRESS_NORMAL_SHOES', 'home', 'category', 5, false, null, ['dress', 'outing_shoe'],
    '连衣裙配日常鞋，居家后临时出门也不用再换一身。', matchHomeDressNormalShoes),
  definition('HOME_COOL_LONG_SLEEVE', 'home', 'weather', 1, false, 'cool', ['long_sleeve', 'category'],
    '今天有点凉，长袖上衣配这条下装，宅家穿刚刚好。', matchHomeCoolLongSleeve),
  definition('HOME_CASUAL_TWO_PIECE', 'home', 'fallback', 6, true, null, ['casual_style'],
    '上衣和下装都偏休闲，宅家穿这身正合适。', matchHomeCasualTwoPiece),

  definition('WORK_SHIRT_STRAIGHT_PANTS', 'work', 'category', 2, false, null, ['shirt', 'straight_cut'],
    '衬衫配直筒裤，穿去上班很利落。', matchWorkShirtStraightPants),
  definition('WORK_PATTERN_TOP_SOLID_BOTTOM', 'work', 'pattern', 3, false, null, ['pattern_visible', 'solid_color'],
    '{patternLabel}上衣配纯色裤子，穿去上班也合适，整身看着不会太花。', matchWorkPatternTopSolidBottom),
  definition('WORK_SIMPLE_DRESS_SHOES', 'work', 'simple', 5, false, null, ['dress', 'simple_style', 'outing_shoe'],
    '简洁的连衣裙配这双鞋，穿去上班很利落。', matchWorkSimpleDressShoes),
  definition('WORK_SIMPLE_TOP_PANTS_SHOES', 'work', 'simple', 5, false, null, ['simple_style', 'long_pants', 'outing_shoe'],
    '上衣、长裤和鞋子都比较简洁，穿去上班正合适，整身看着也很利落。', matchWorkSimpleTopPantsShoes),
  definition('WORK_BASELINE_PRESENTABLE', 'work', 'baseline', 6, true, null, ['category'],
    '这套衣物搭配完整，日常通勤比较稳妥。', matchWorkBaselinePresentable),
  definition('WORK_HOT_SHORT_SLEEVE_PANTS', 'work', 'weather', 1, false, 'hot', ['short_sleeve', 'long_pants'],
    '今天{temp}℃，短袖配长裤，穿去上班正合适，也不会裹得太多。', matchWorkHotShortSleevePants),
  definition('WORK_COOL_LONG_SLEEVE_PANTS', 'work', 'weather', 1, false, 'cool', ['long_sleeve', 'long_pants'],
    '今天有点凉，长袖配长裤，穿去上班刚刚好。', matchWorkCoolLongSleevePants),

  definition('DATE_PATTERN_TOP_SIMPLE_SUPPORT', 'date', 'pattern', 3, false, null, ['pattern_visible', 'solid_color', 'simple_style'],
    '{patternLabel}上衣配纯色裤子和简洁鞋子，约会穿挺合适，整身看着也不会太花。', matchDatePatternTopSimpleSupport),
  definition('DATE_PATTERN_DRESS_SIMPLE_SHOES', 'date', 'pattern', 3, false, null, ['dress', 'pattern_visible', 'simple_style'],
    '这条{patternLabel}连衣裙配简洁鞋子，约会穿挺合适，整身看着也不会太花。', matchDatePatternDressSimpleShoes),
  definition('DATE_BRIGHT_TOP_BASIC_SUPPORT', 'date', 'color', 3, false, null, ['bright_color', 'basic_color'],
    '亮色上衣配基础色裤子和鞋子，约会穿更顺眼，也不会堆太多颜色。', matchDateBrightTopBasicSupport),
  definition('DATE_BRIGHT_SHOES_BASIC_CLOTHES', 'date', 'color', 3, false, null, ['bright_color', 'basic_color'],
    '这双鞋颜色比较亮，约会穿时让衣服简单一点就好。', matchDateBrightShoesBasicClothes),
  definition('DATE_COLOR_COORDINATED', 'date', 'color', 3, false, null, ['color'],
    '上衣和下装的颜色很搭，约会穿挺顺眼，配饰简单一点就够了。', matchDateColorCoordinated),
  definition('DATE_SIMPLE_DRESS_SHOES', 'date', 'simple', 5, false, null, ['dress', 'simple_style', 'outing_shoe'],
    '连衣裙和鞋子都比较简洁，约会穿这身很顺眼。', matchDateSimpleDressShoes),
  definition('DATE_SIMPLE_COMPLETE', 'date', 'simple', 5, false, null, ['simple_style', 'outing_shoe'],
    '衣服和鞋子都比较简洁，约会穿这身很顺眼。', matchDateSimpleComplete),

  definition('SPORT_COMPLETE_SET', 'sport', 'category', 2, false, null, ['sport_top', 'sport_bottom', 'sport_shoe'],
    '运动上衣、运动裤和运动鞋都配齐了，穿这身去运动正合适。', matchSportCompleteSet),
  definition('SPORT_LIGHT_ACTIVITY_SET', 'sport', 'category', 2, false, null, ['category', 'sport_bottom', 'sport_shoe'],
    'T恤配活动方便的下装和稳定包脚鞋，用于日常轻运动正合适。', matchSportLightActivitySet),
  definition('SPORT_HOT_SLEEVELESS_SHORTS', 'sport', 'weather', 1, false, 'hot', ['sleeveless', 'shorts', 'sport_bottom', 'sport_shoe'],
    '今天{temp}℃，无袖上衣配运动短裤，穿去运动正合适，也不会裹得太多。', matchSportHotSleevelessShorts),
  definition('SPORT_HOT_SHORT_SLEEVE_SHORTS', 'sport', 'weather', 1, false, 'hot', ['short_sleeve', 'shorts', 'sport_bottom', 'sport_shoe'],
    '今天{temp}℃，短袖配运动短裤，穿去运动正合适，也不会裹得太多。', matchSportHotShortSleeveShorts),
  definition('SPORT_COOL_OUTERWEAR', 'sport', 'weather', 1, false, 'cool', ['sport_outerwear', 'sport_shoe'],
    '今天有点凉，加上这件运动外套，穿去运动更合适。', matchSportCoolOuterwear),
  definition('SPORT_COOL_LONG_SET', 'sport', 'weather', 1, false, 'cool', ['long_sleeve', 'sport_top', 'long_pants', 'sport_bottom', 'sport_shoe'],
    '天气偏凉时，长袖运动上衣配运动裤，穿去运动更合适。', matchSportCoolLongSet),
  definition('SPORT_DRESS_SHOES', 'sport', 'category', 2, false, null, ['dress', 'sport_shoe'],
    '运动连衣裙配运动鞋，穿这身去运动正合适。', matchSportDressShoes),
]);

const ELIGIBILITY_REASON_BY_CODE = new Map(ELIGIBILITY_REASON_CATALOG.map((entry) => [entry.reasonCode, entry]));
const ELIGIBILITY_REASON_CATALOG_CONTEXT_INDEX = buildEligibilityReasonContextIndex();
const CATALOG_VISIBLE_FACTS = new Set(
  ELIGIBILITY_REASON_CATALOG.flatMap((entry) => entry.requiredVisibleFacts),
);

function buildEligibilityReasonContextIndex() {
  const index = new Map();
  for (const scene of ['home', 'work', 'date', 'sport']) {
    for (const band of ['no_weather', 'hot', 'warm', 'mild', 'cool', 'cold']) {
      index.set(`${scene}|${band}`, ELIGIBILITY_REASON_CATALOG.flatMap((entry, catalogOrder) => (
        entry.scene === scene && matchesWeatherCondition(entry.weatherCondition, band)
          ? [{ entry, catalogOrder }]
          : []
      )));
    }
  }
  return index;
}

function collectEligibilityReasonCandidates({ scene, weather, visibleFacts, sceneResult, instrumentation } = {}) {
  recordMetric(instrumentation, 'collectEligibilityReasonCandidates');
  if (!sceneResult || sceneResult.eligible !== true || sceneResult.hardRejected === true) return [];
  const normalizedScene = normalizeScene(scene);
  const band = weatherBand(weather);
  const items = Array.isArray(visibleFacts?.items) ? visibleFacts.items : [];
  const candidates = [];
  const catalogEntries = ELIGIBILITY_REASON_CATALOG_CONTEXT_INDEX.get(`${normalizedScene}|${band}`) || [];
  for (const { entry, catalogOrder } of catalogEntries) {
    const matched = entry.match(items);
    if (!matched) continue;
    const patternLabel = readMatchedPatternLabel(matched, items);
    if (entry.text.includes('{patternLabel}') && !patternLabel) continue;
    const itemEvidence = dedupeEvidence(matched.evidence || []);
    const relationEvidence = buildRelationEvidence({
      scene: normalizedScene,
      matched,
      sceneResult,
      supportingFactIds: itemEvidence.map((record) => record.factId),
    });
    const coreEligibilityEvidence = relationEvidence
      ? [...itemEvidence, relationEvidence]
      : itemEvidence;
    const subjectItemIds = uniqueStrings([
      ...(matched.subjectItemIds || []),
      ...itemEvidence.map((record) => record.itemId),
    ]);
    const supportingFactIds = uniqueStrings(itemEvidence.map((record) => record.factId));
    const relationFactIds = relationEvidence ? [relationEvidence.factId] : [];
    const result = {
      code: entry.reasonCode,
      family: entry.family,
      qualityTier: entry.qualityTier,
      isGenericFallback: entry.isGenericFallback,
      subjectItemIds,
      supportingFactIds,
      relationFactIds,
      sourceRule: 'sceneEligibilityV3',
      sourceRuleReasons: uniqueStrings([
        ...(sceneResult.acceptReasons || []),
        `WEATHER_BAND_${band.toUpperCase()}`,
        `ELIGIBILITY_REASON_${entry.reasonCode}`,
      ]),
      evidence: coreEligibilityEvidence,
      text: renderEligibilityReason(entry.reasonCode, weather, { patternLabel }),
      patternLabel,
      catalogOrder,
      catalogVersion: ELIGIBILITY_REASON_CATALOG_VERSION,
    };
    if (validateEligibilityReason(result, { scene: normalizedScene, weather })) candidates.push(result);
  }
  return candidates;
}

function resolveEligibilityReason(context = {}, precomputedCandidates) {
  const candidates = Array.isArray(precomputedCandidates)
    ? precomputedCandidates
    : collectEligibilityReasonCandidates(context);
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  return candidates.slice().sort((left, right) => left.qualityTier - right.qualityTier
    || left.catalogOrder - right.catalogOrder
    || left.code.localeCompare(right.code))[0];
}

function validateEligibilityReason(value, context = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const code = readString(value.code);
  const entry = ELIGIBILITY_REASON_BY_CODE.get(code);
  if (!entry || (context.scene && entry.scene !== normalizeScene(context.scene))) return false;
  if (!matchesWeatherCondition(entry.weatherCondition, weatherBand(context.weather))) return false;
  const subjectItemIds = uniqueStrings(value.subjectItemIds);
  const supportingFactIds = uniqueStrings(value.supportingFactIds);
  const relationFactIds = uniqueStrings(value.relationFactIds);
  const sourceRuleReasons = uniqueStrings(value.sourceRuleReasons);
  const evidence = Array.isArray(value.evidence) ? value.evidence : [];
  const evidenceIds = new Set(evidence.map((record) => readString(record?.factId || record?.relationFactId)).filter(Boolean));
  if (subjectItemIds.length === 0 || supportingFactIds.length === 0
    || !readString(value.sourceRule) || sourceRuleReasons.length === 0) return false;
  if (!supportingFactIds.every((factId) => evidenceIds.has(factId))) return false;
  if (!relationFactIds.every((factId) => evidenceIds.has(factId))) return false;
  const requiredFactsSatisfied = entry.requiredVisibleFacts.every((fact) => evidence.some((record) => record?.fact === fact));
  const lightSportBaselineSatisfied = entry.reasonCode === 'SPORT_LIGHT_ACTIVITY_SET'
    && ['sport_top', 'shorts', 'sport_shoe'].every((fact) => evidence.some((record) => record?.fact === fact));
  if (!requiredFactsSatisfied && !lightSportBaselineSatisfied) return false;
  if (evidence.some((record) => record?.source === 'legacy_snapshot' && !isCatalogVisibleFact(record.fact))) return false;
  const selectedOutfitItemIds = uniqueStrings(context.selectedOutfitItemIds);
  if (selectedOutfitItemIds.length > 0) {
    const selected = new Set(selectedOutfitItemIds);
    if (!subjectItemIds.every((itemId) => selected.has(itemId))) return false;
  }
  return true;
}

function cloneEligibilityReason(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return {
    code: readString(value.code),
    family: readString(value.family) || ELIGIBILITY_REASON_BY_CODE.get(readString(value.code))?.family || '',
    qualityTier: Number(value.qualityTier) || ELIGIBILITY_REASON_BY_CODE.get(readString(value.code))?.qualityTier || 6,
    isGenericFallback: value.isGenericFallback === true,
    subjectItemIds: uniqueStrings(value.subjectItemIds),
    supportingFactIds: uniqueStrings(value.supportingFactIds),
    relationFactIds: uniqueStrings(value.relationFactIds),
    sourceRule: readString(value.sourceRule),
    sourceRuleReasons: uniqueStrings(value.sourceRuleReasons),
    evidence: (Array.isArray(value.evidence) ? value.evidence : []).map((record) => ({ ...record })),
    text: readString(value.text),
    patternLabel: readString(value.patternLabel),
    catalogOrder: Number.isInteger(value.catalogOrder) ? value.catalogOrder : 0,
    catalogVersion: readString(value.catalogVersion) || ELIGIBILITY_REASON_CATALOG_VERSION,
  };
}

function toCoreEligibilityPayload(value, context = {}) {
  if (!validateEligibilityReason(value, context)) return null;
  const reason = cloneEligibilityReason(value);
  return {
    coreEligibilityReasonCode: reason.code,
    coreEligibilityReason: reason.text || renderEligibilityReason(reason.code, context.weather, { patternLabel: reason.patternLabel }),
    coreEligibilityReasonFamily: reason.family,
    coreEligibilityReasonQualityTier: reason.qualityTier,
    coreEligibilityReasonIsGenericFallback: reason.isGenericFallback,
    coreEligibilityPatternLabel: reason.patternLabel || undefined,
    coreEligibilityCatalogOrder: reason.catalogOrder,
    coreEligibilityEvidence: reason.evidence.map((record) => ({ ...record })),
    subjectItemIds: reason.subjectItemIds.slice(),
    supportingFactIds: reason.supportingFactIds.slice(),
    relationFactIds: reason.relationFactIds.slice(),
    sourceRule: reason.sourceRule,
    sourceRuleReasons: reason.sourceRuleReasons.slice(),
  };
}

function fromCoreEligibilityPayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const code = readString(value.coreEligibilityReasonCode);
  const text = readString(value.coreEligibilityReason);
  return {
    code,
    family: readString(value.coreEligibilityReasonFamily),
    qualityTier: Number(value.coreEligibilityReasonQualityTier) || 0,
    isGenericFallback: value.coreEligibilityReasonIsGenericFallback === true,
    subjectItemIds: uniqueStrings(value.subjectItemIds),
    supportingFactIds: uniqueStrings(value.supportingFactIds),
    relationFactIds: uniqueStrings(value.relationFactIds),
    sourceRule: readString(value.sourceRule),
    sourceRuleReasons: uniqueStrings(value.sourceRuleReasons),
    evidence: (Array.isArray(value.coreEligibilityEvidence) ? value.coreEligibilityEvidence : [])
      .map((record) => ({ ...record })),
    text,
    patternLabel: readString(value.coreEligibilityPatternLabel) || inferPatternLabelFromRenderedText(code, text),
    catalogOrder: Number.isInteger(value.coreEligibilityCatalogOrder) ? value.coreEligibilityCatalogOrder : 0,
    catalogVersion: ELIGIBILITY_REASON_CATALOG_VERSION,
  };
}

function inferPatternLabelFromRenderedText(code, text) {
  const template = ELIGIBILITY_REASON_BY_CODE.get(code)?.text || '';
  if (!template.includes('{patternLabel}')) return '';
  const [prefix, suffix] = template.split('{patternLabel}');
  if (!text.startsWith(prefix) || !text.endsWith(suffix)) return '';
  const label = text.slice(prefix.length, text.length - suffix.length);
  return ['条纹', '格纹', '碎花', '波点', '动物纹', '抽象图案', '拼色', '有图案的'].includes(label)
    ? label
    : '';
}

function validateCoreEligibilityPayload(value, context = {}) {
  const reason = fromCoreEligibilityPayload(value);
  if (!reason || !validateEligibilityReason(reason, context)) return false;
  return readString(value.coreEligibilityReason) === renderEligibilityReason(
    reason.code,
    context.weather,
    { patternLabel: reason.patternLabel },
  );
}

function validateEligibilityReasonPayload(value, context = {}) {
  return readString(value?.code)
    ? validateEligibilityReason(value, context)
    : validateCoreEligibilityPayload(value, context);
}

function assertEligibilityReasonCatalogCoverage(reasonCodes) {
  const codes = uniqueStrings(reasonCodes);
  const missing = codes.filter((code) => !ELIGIBILITY_REASON_BY_CODE.has(code));
  if (missing.length > 0) throw new Error(`eligibility reason code missing from catalog: ${missing.join(',')}`);
  return true;
}

function getEligibilityReasonCatalogInventory() {
  return {
    version: ELIGIBILITY_REASON_CATALOG_VERSION,
    total: ELIGIBILITY_REASON_CATALOG.length,
    scenes: Object.fromEntries(['home', 'work', 'date', 'sport'].map((scene) => [
      scene,
      ELIGIBILITY_REASON_CATALOG.filter((entry) => entry.scene === scene).length,
    ])),
  };
}

function renderEligibilityReason(code, weather = {}, replacements = {}) {
  const entry = ELIGIBILITY_REASON_BY_CODE.get(readString(code));
  if (!entry) return '';
  let text = entry.text;
  if (text.includes('{temp}')) {
    const temp = Math.round(Number(weather?.temp ?? weather?.temperature));
    if (!Number.isFinite(temp) || !hasRealWeather(weather)) return '';
    text = text.replace('{temp}', String(temp));
  }
  if (text.includes('{patternLabel}')) {
    const patternLabel = readString(replacements.patternLabel);
    if (!patternLabel) return '';
    text = text.replace('{patternLabel}', patternLabel);
  }
  return text;
}

function definition(reasonCode, scene, family, qualityTier, isGenericFallback, weatherCondition, requiredVisibleFacts, text, match) {
  return Object.freeze({
    reasonCode,
    scene,
    family,
    qualityTier,
    isGenericFallback,
    weatherCondition,
    requiredVisibleFacts: Object.freeze(requiredVisibleFacts),
    text,
    match,
  });
}

function matchHomeHotSleevelessShorts(items) { return matchTwo(items, ['top'], ['sleeveless'], ['bottom'], ['shorts']); }
function matchHomeHotShortSleeveShorts(items) { return matchTwo(items, ['top'], ['short_sleeve'], ['bottom'], ['shorts']); }
function matchHomeCoolLongSleeve(items) { return matchTwo(items, ['top'], ['long_sleeve'], ['bottom'], ['category']); }
function matchHomePatternTopSolidBottom(items) { return matchPatternPair(items, ['top'], ['bottom']); }
function matchHomeLooseTwoPiece(items) { return matchTwo(items, ['top'], ['loose_fit'], ['bottom'], ['loose_fit']); }
function matchHomeTshirtLoosePants(items) {
  const top = items.find((item) => item.category === 'top' && item.legacyVisibleTraits?.tshirt === true && getFact(item, 'short_sleeve'));
  const bottom = findItem(items, ['bottom'], ['loose_fit']);
  return top && bottom ? collectMatch([top, bottom], { top: ['short_sleeve'], bottom: ['loose_fit'] }) : null;
}
function matchHomeShortSleeveLongPants(items) { return matchTwo(items, ['top'], ['short_sleeve'], ['bottom'], ['long_pants']); }
function matchHomeTopLongPants(items) { return matchTwo(items, ['top'], ['category'], ['bottom'], ['long_pants']); }
function matchHomeLooseDress(items) { return matchOne(items, ['onepiece'], ['dress', 'loose_fit']); }
function matchHomeDressNormalShoes(items) { return matchTwo(items, ['onepiece'], ['dress'], ['shoes'], ['outing_shoe']); }
function matchHomeCasualTwoPiece(items) { return matchTwo(items, ['top'], ['casual_style'], ['bottom'], ['casual_style']); }
function matchWorkHotShortSleevePants(items) { return matchTwo(items, ['top'], ['short_sleeve'], ['bottom'], ['long_pants']); }
function matchWorkCoolLongSleevePants(items) { return matchTwo(items, ['top'], ['long_sleeve'], ['bottom'], ['long_pants']); }
function matchWorkShirtStraightPants(items) { return matchTwo(items, ['top'], ['shirt'], ['bottom'], ['straight_cut']); }
function matchWorkPatternTopSolidBottom(items) { return matchPatternPair(items, ['top'], ['bottom']); }
function matchWorkSimpleDressShoes(items) { return matchTwo(items, ['onepiece'], ['dress', 'simple_style'], ['shoes'], ['simple_style', 'outing_shoe']); }
function matchWorkSimpleTopPantsShoes(items) {
  return matchThree(items, ['top'], ['simple_style'], ['bottom'], ['long_pants', 'simple_style'], ['shoes'], ['simple_style', 'outing_shoe']);
}
function matchWorkBaselinePresentable(items) {
  const onepieceWithShoes = matchTwo(items, ['onepiece'], ['category'], ['shoes'], ['category']);
  if (onepieceWithShoes) return onepieceWithShoes;
  return matchThree(items, ['top'], ['category'], ['bottom'], ['category'], ['shoes'], ['category']);
}
function matchDatePatternTopSimpleSupport(items) {
  const matched = matchThree(items, ['top'], ['pattern_visible'], ['bottom'], ['solid_color', 'simple_style'], ['shoes'], ['simple_style', 'outing_shoe']);
  return withPatternLabel(matched, items);
}
function matchDatePatternDressSimpleShoes(items) {
  return withPatternLabel(matchTwo(items, ['onepiece'], ['dress', 'pattern_visible'], ['shoes'], ['simple_style', 'outing_shoe']), items);
}
function matchDateBrightTopBasicSupport(items) {
  return matchThree(items, ['top'], ['bright_color'], ['bottom'], ['basic_color'], ['shoes'], ['basic_color', 'outing_shoe']);
}
function matchDateBrightShoesBasicClothes(items) {
  const shoe = findItem(items, ['shoes'], ['bright_color', 'outing_shoe']);
  const main = items.filter((item) => ['top', 'bottom', 'outerwear', 'onepiece'].includes(item.category));
  if (!shoe || main.length === 0 || main.some((item) => !getFact(item, 'basic_color'))) return null;
  return collectMatch([shoe, ...main], { shoes: ['bright_color', 'outing_shoe'], main: ['basic_color'] });
}
function matchDateColorCoordinated(items) {
  const top = items.find((item) => item.category === 'top' && getFact(item, 'color'));
  const bottom = items.find((item) => item.category === 'bottom' && getFact(item, 'color'));
  if (!top || !bottom) return null;
  const topColor = normalizeColorGroup(getFact(top, 'color').value);
  const bottomColor = normalizeColorGroup(getFact(bottom, 'color').value);
  if (!topColor || topColor !== bottomColor) return null;
  return {
    ...collectMatch([top, bottom], { top: ['color'], bottom: ['color'] }),
    relation: { factId: 'outfit:color_coordinated', fact: 'color_coordinated', relationRule: 'same_normalized_color_group' },
  };
}
function matchDateSimpleDressShoes(items) { return matchTwo(items, ['onepiece'], ['dress', 'simple_style'], ['shoes'], ['simple_style', 'outing_shoe']); }
function matchDateSimpleComplete(items) {
  const shoe = findItem(items, ['shoes'], ['simple_style', 'outing_shoe']);
  const main = items.filter((item) => ['top', 'bottom', 'outerwear', 'onepiece'].includes(item.category));
  if (!shoe || main.length === 0 || main.some((item) => !getFact(item, 'simple_style'))) return null;
  return collectMatch([shoe, ...main], { shoes: ['simple_style', 'outing_shoe'], main: ['simple_style'] });
}
function matchSportHotSleevelessShorts(items) {
  return matchThree(items, ['top'], ['sleeveless', 'sport_top'], ['bottom'], ['shorts', 'sport_bottom'], ['shoes'], ['sport_shoe']);
}
function matchSportHotShortSleeveShorts(items) {
  return matchThree(items, ['top'], ['short_sleeve', 'sport_top'], ['bottom'], ['shorts', 'sport_bottom'], ['shoes'], ['sport_shoe']);
}
function matchSportCoolOuterwear(items) { return matchTwo(items, ['outerwear'], ['sport_outerwear'], ['shoes'], ['sport_shoe']); }
function matchSportCoolLongSet(items) {
  return matchThree(items, ['top'], ['long_sleeve', 'sport_top'], ['bottom'], ['long_pants', 'sport_bottom'], ['shoes'], ['sport_shoe']);
}
function matchSportCompleteSet(items) {
  return matchThree(items, ['top'], ['sport_top'], ['bottom'], ['sport_bottom'], ['shoes'], ['sport_shoe']);
}
function matchSportLightActivitySet(items) {
  return matchThree(items, ['top'], ['category'], ['bottom'], ['sport_bottom'], ['shoes'], ['sport_shoe'])
    || matchThree(items, ['top'], ['sport_top'], ['bottom'], ['shorts'], ['shoes'], ['sport_shoe']);
}
function matchSportDressShoes(items) {
  const dress = items.find((item) => item.category === 'onepiece'
    && item.legacyVisibleTraits?.sportDress === true
    && getFact(item, 'dress'));
  const shoes = findItem(items, ['shoes'], ['sport_shoe']);
  return dress && shoes ? collectMatch([dress, shoes], { onepiece: ['dress'], shoes: ['sport_shoe'] }) : null;
}

function matchPatternPair(items, topCategories, bottomCategories) {
  return withPatternLabel(matchTwo(items, topCategories, ['pattern_visible'], bottomCategories, ['solid_color']), items);
}

function withPatternLabel(matched, items) {
  if (!matched) return null;
  const matchedIds = new Set(matched.subjectItemIds || []);
  const patterned = items.find((item) => matchedIds.has(item.id) && getFact(item, 'pattern_visible') && item.patternLabel);
  return patterned ? { ...matched, patternLabel: patterned.patternLabel } : null;
}

function matchOne(items, categories, facts) {
  const item = findItem(items, categories, facts);
  return item ? collectMatch([item], { [item.category]: facts }) : null;
}

function matchTwo(items, firstCategories, firstFacts, secondCategories, secondFacts) {
  const first = findItem(items, firstCategories, firstFacts);
  const second = findItem(items, secondCategories, secondFacts);
  return first && second ? collectMatch([first, second], { [first.category]: firstFacts, [second.category]: secondFacts }) : null;
}

function matchThree(items, firstCategories, firstFacts, secondCategories, secondFacts, thirdCategories, thirdFacts) {
  const first = findItem(items, firstCategories, firstFacts);
  const second = findItem(items, secondCategories, secondFacts);
  const third = findItem(items, thirdCategories, thirdFacts);
  return first && second && third
    ? collectMatch([first, second, third], { [first.category]: firstFacts, [second.category]: secondFacts, [third.category]: thirdFacts })
    : null;
}

function findItem(items, categories, facts) {
  return items.find((item) => categories.includes(item.category) && facts.every((fact) => getFact(item, fact)));
}

function collectMatch(items, requirements) {
  const evidence = [];
  for (const item of items) {
    const factNames = requirements[item.category] || requirements.main || [];
    for (const fact of factNames) {
      const record = getFact(item, fact);
      if (record) evidence.push(record);
    }
  }
  return { subjectItemIds: items.map((item) => item.id), evidence };
}

function getFact(item, fact) {
  return Array.isArray(item?.factRecords)
    ? item.factRecords.find((record) => record.fact === fact && record.authorized !== false)
    : null;
}

function buildRelationEvidence({ scene, matched, sceneResult, supportingFactIds }) {
  if (matched.relation) {
    return {
      relationFactId: matched.relation.factId,
      factId: matched.relation.factId,
      fact: matched.relation.fact,
      subjectItemIds: uniqueStrings(matched.subjectItemIds),
      supportingFactIds: uniqueStrings(supportingFactIds),
      source: 'relation_rule',
      relationRule: matched.relation.relationRule,
      confidence: 1,
      authorized: true,
    };
  }
  if (!['work', 'date', 'sport'].includes(scene)) return null;
  return {
    relationFactId: `outfit:${scene}_eligible`,
    factId: `outfit:${scene}_eligible`,
    fact: `${scene}_eligible`,
    subjectItemIds: uniqueStrings(matched.subjectItemIds),
    supportingFactIds: uniqueStrings(supportingFactIds),
    source: 'scene_rule',
    sourceRule: 'sceneEligibilityV3',
    sourceRuleReasons: uniqueStrings(sceneResult.acceptReasons),
    confidence: sceneResult.sceneStrength === 'strong' ? 1 : 0.9,
    authorized: true,
  };
}

function normalizeColorGroup(value) {
  const text = readString(value).toLowerCase();
  if (/黑|black/.test(text)) return 'black';
  if (/白|米|ivory|white|beige/.test(text)) return 'light-neutral';
  if (/灰|gray|grey/.test(text)) return 'gray';
  if (/棕|咖|brown|camel/.test(text)) return 'brown';
  if (/蓝|藏青|navy|blue/.test(text)) return 'blue';
  if (/绿|green/.test(text)) return 'green';
  if (/红|red/.test(text)) return 'red';
  return text;
}

function isCatalogVisibleFact(fact) {
  return CATALOG_VISIBLE_FACTS.has(readString(fact));
}

function weatherBand(weather = {}) {
  if (!hasRealWeather(weather)) return 'no_weather';
  const temp = Number(weather?.temp ?? weather?.temperature);
  if (Number.isFinite(temp) && temp >= 28) return 'hot';
  if (Number.isFinite(temp) && temp >= 11 && temp <= 17) return 'cool';
  if (Number.isFinite(temp) && temp <= 10) return 'cold';
  return 'mild';
}

function hasRealWeather(weather = {}) {
  const mode = readString(weather?.mode || weather?.weatherMode).toLowerCase();
  if (mode && !['live', 'cached'].includes(mode)) return false;
  return Number.isFinite(Number(weather?.temp ?? weather?.temperature));
}

function matchesWeatherCondition(condition, band) {
  if (!condition) return true;
  if (condition === 'no_weather') return band === 'no_weather';
  return condition === band;
}

function readMatchedPatternLabel(matched, items) {
  const direct = readString(matched?.patternLabel);
  if (direct) return direct;
  const ids = new Set(uniqueStrings(matched?.subjectItemIds));
  return readString(items.find((item) => ids.has(item.id) && item.patternLabel)?.patternLabel);
}

function normalizeScene(value) {
  const text = readString(value).toLowerCase();
  return { home: 'home', 居家: 'home', work: 'work', 上班: 'work', 通勤: 'work', date: 'date', 约会: 'date', sport: 'sport', sports: 'sport', 运动: 'sport' }[text] || text;
}

function dedupeEvidence(values) {
  const result = [];
  const seen = new Set();
  for (const value of values) {
    if (!value?.factId || seen.has(value.factId)) continue;
    seen.add(value.factId);
    result.push({ ...value });
  }
  return result;
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(readString).filter(Boolean))];
}

function recordMetric(instrumentation, name) {
  if (!instrumentation || typeof instrumentation !== 'object') return;
  const counters = instrumentation.counters && typeof instrumentation.counters === 'object'
    ? instrumentation.counters
    : instrumentation;
  counters[name] = (Number(counters[name]) || 0) + 1;
}

function readString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

module.exports = {
  ELIGIBILITY_REASON_CATALOG,
  ELIGIBILITY_REASON_CATALOG_VERSION,
  assertEligibilityReasonCatalogCoverage,
  cloneEligibilityReason,
  collectEligibilityReasonCandidates,
  fromCoreEligibilityPayload,
  getEligibilityReasonCatalogInventory,
  renderEligibilityReason,
  resolveEligibilityReason,
  toCoreEligibilityPayload,
  validateCoreEligibilityPayload,
  validateEligibilityReason,
  validateEligibilityReasonPayload,
  weatherBand,
};
