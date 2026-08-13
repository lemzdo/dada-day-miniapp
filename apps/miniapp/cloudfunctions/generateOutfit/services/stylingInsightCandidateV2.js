const { evaluateAestheticCompatibility } = require('./aestheticCompatibility');

const STYLING_INSIGHT_CANDIDATE_VERSION = 'styling-insight-candidate-v2.1-shadow';

const CORE_COLOR_RELATION_CATEGORIES = new Set(['top', 'bottom', 'onepiece', 'outerwear']);
const NEUTRAL_COLOR_NAMES = new Set([
  'black', 'white', 'gray', 'grey', 'beige', 'cream', 'ivory', 'brown', 'navy',
  '黑', '白', '灰', '米', '棕', '藏青',
]);

// This is an allowlist, not a scoring table. The upstream evidence engines have
// already decided whether each fact exists. Phase A only decides whether the
// fact is material enough to compete for the one canonical styling insight.
const AESTHETIC_INSIGHT_DEFINITIONS = Object.freeze({
  PATTERN_SINGLE_FOCUS: definition('PATTERN_FOCUS', 'material', 'style.pattern_focus'),
  DETAIL_SINGLE_FOCUS: definition('DETAIL_FOCUS', 'material', 'style.detail_focus'),
  SILHOUETTE_BALANCED_CONTRAST: definition('SILHOUETTE_CONTRAST', 'material', 'style.silhouette_relation'),
  PROPORTION_CLEAR_LAYERING: definition('PROPORTION_LAYERING', 'material', 'style.proportion_structure'),
  COLOR_NEUTRAL_ACCENT: definition('COLOR_FOCUS', 'material', 'style.color_relation'),
  COLOR_MONOCHROMATIC: definition('COLOR_UNITY', 'material', 'style.color_relation'),
  COLOR_ANALOGOUS: definition('COLOR_HARMONY', 'weak', 'style.color_relation'),
  COLOR_CONTROLLED_CONTRAST: definition('COLOR_CONTRAST', 'weak', 'style.color_relation'),
  SILHOUETTE_BALANCED_CONTINUITY: definition('SILHOUETTE_CONTINUITY', 'weak', 'style.silhouette_relation'),
  PROPORTION_BALANCED_LENGTH: definition('PROPORTION_CONTINUITY', 'weak', 'style.proportion_structure'),
  PATTERN_COHERENT_REPEAT: definition('PATTERN_REPEAT', 'weak', 'style.pattern_relation'),
  FORMALITY_ALIGNED: definition('FORMALITY_ALIGNMENT', 'weak', 'style.formality_relation'),
  FORMALITY_INTENTIONAL_MIX: definition('FORMALITY_MIX', 'weak', 'style.formality_relation'),
  DETAIL_BALANCED_DISTRIBUTION: definition('DETAIL_DISTRIBUTION', 'weak', 'style.detail_relation'),
});

const SCENE_INSIGHT_DEFINITIONS = Object.freeze({
  HOME_RELAXED_CORE: definition('SCENE_HOME_RELAXED_STRUCTURE', 'material', 'scene.structure_fit'),
  HOME_SIMPLE_ONEPIECE: definition('SCENE_HOME_SIMPLE_ONEPIECE', 'weak', 'scene.structure_fit'),
  HOME_SIMPLE_TWO_PIECE: definition('SCENE_HOME_SIMPLE_TWO_PIECE', 'weak', 'scene.structure_fit'),
  HOME_WEATHER_LENGTH_SUPPORT: definition('WEATHER_LAYERING', 'material', 'weather.layering_fit'),
  HOME_SHORT_LIGHT_SET: definition('SCENE_HOME_LIGHT_SET', 'weak', 'scene.structure_fit'),
  HOME_COLOR_SUPPORT: definition('COLOR_UNITY', 'weak', 'style.color_relation'),
  WORK_STRUCTURED_SET: definition('SCENE_WORK_STRUCTURED_SET', 'material', 'scene.structure_fit'),
  WORK_SIMPLE_ONEPIECE: definition('SCENE_WORK_SIMPLE_ONEPIECE', 'material', 'scene.structure_fit'),
  WORK_DAILY_LONG_PANTS_SET: definition('SCENE_WORK_DAILY_STRUCTURE', 'weak', 'scene.structure_fit'),
  WORK_CLEAN_SNEAKER_SUPPORT: definition('SCENE_WORK_FOOTWEAR_SUPPORT', 'weak', 'scene.footwear_fit'),
  WORK_COMPLETE_DAILY_SET: definition('SCENE_WORK_COMPLETE_SET', 'weak', 'scene.completeness'),
  DATE_LOLITA_PREFERRED: definition('PREFERENCE_STYLE_MATCH', 'material', 'preference.style_match'),
  DATE_PATTERN_FOCAL_SUPPORT: definition('PATTERN_FOCUS', 'material', 'style.pattern_focus'),
  DATE_BRIGHT_FOCAL_SUPPORT: definition('COLOR_FOCUS', 'material', 'style.color_relation'),
  DATE_SIMPLE_STYLE_UNITY: definition('STYLE_UNITY', 'material', 'style.style_unity'),
  DATE_ONEPIECE_COMPLETE: definition('SCENE_DATE_ONEPIECE', 'weak', 'scene.structure_fit'),
  DATE_SIMPLE_COMPLETE: definition('STYLE_UNITY', 'weak', 'style.style_unity'),
  DATE_COMPLETE_CORE: definition('SCENE_DATE_COMPLETE_SET', 'weak', 'scene.completeness'),
  DATE_COLOR_COORDINATED: definition('COLOR_UNITY', 'weak', 'style.color_relation'),
  SPORT_EXPLICIT_SET: definition('SCENE_SPORT_PURPOSE_SET', 'material', 'scene.activity_fit'),
  SPORT_EXPLICIT_ONEPIECE: definition('SCENE_SPORT_PURPOSE_SET', 'material', 'scene.activity_fit'),
  SPORT_WEATHER_LAYER_SUPPORT: definition('WEATHER_LAYERING', 'material', 'weather.layering_fit'),
  SPORT_DAILY_LIGHT_SET: definition('SCENE_SPORT_LIGHT_ACTIVITY', 'material', 'scene.activity_fit'),
  SPORT_CASUAL_ACTIVITY: definition('SCENE_SPORT_CASUAL_ACTIVITY', 'weak', 'scene.activity_fit'),
});

const RELATION_INSIGHT_DEFINITIONS = Object.freeze({
  color_coordinated: definition('COLOR_UNITY', 'weak', 'style.color_relation'),
});

function buildStylingInsightCandidatesV2(input = {}) {
  const items = readArray(input.items).filter(isObject);
  const aestheticEvaluation = evaluateAestheticCompatibility(items);
  const sceneEligibility = readSceneEligibility(input);
  const weatherEligibility = readWeatherEligibility(input);
  const rawCandidates = [
    ...buildAestheticCandidates(aestheticEvaluation, items),
    ...buildSceneCandidates(sceneEligibility),
    ...buildRelationCandidates(input.copyFacts),
  ];
  const candidates = mergeEquivalentCandidates(rawCandidates);
  const limitations = buildLimitations({ aestheticEvaluation, sceneEligibility, weatherEligibility });
  const compositionKey = buildCompositionKey(input, items);

  return {
    version: STYLING_INSIGHT_CANDIDATE_VERSION,
    compositionKey,
    itemIds: readItemIds(input, items),
    candidates,
    limitations,
    compositionEvidenceRef: `composition:${compositionKey || 'missing'}`,
    sourceVersions: {
      aesthetic: readText(aestheticEvaluation.engineVersion),
      scene: readText(sceneEligibility.sceneEvidenceVersion),
      sceneFingerprint: readText(sceneEligibility.sceneEvidenceFingerprint),
    },
  };
}

function buildAestheticCandidates(evaluation, items) {
  const itemById = new Map(items.map((item) => [readItemId(item), item]));
  return readArray(evaluation?.evidence).flatMap((evidence) => {
    const sourceCode = readText(evidence?.code);
    const insight = AESTHETIC_INSIGHT_DEFINITIONS[sourceCode];
    if (!insight || !['positive', 'neutral'].includes(evidence?.polarity)) return [];
    if (sourceCode.startsWith('DETAIL_') && isPatternOnlyDetail(evidence, itemById)) return [];
    const subjectItemIds = uniqueSorted(evidence.itemIds);
    const materiality = classifyAestheticMateriality({ insight, sourceCode, evidence, items });
    return [createCandidate({
      ...insight,
      materiality,
      sourceKind: 'aesthetic',
      sourceCode,
      evidenceType: readAestheticEvidenceType(sourceCode),
      evidenceStrength: readEvidenceStrength(evidence?.strength),
      subjectItemIds,
      evidenceRefs: [`aesthetic:${readText(evaluation.engineVersion) || 'unknown'}:${sourceCode}:${subjectItemIds.join('|')}`],
      sourceAuthorization: 'aesthetic_evidence_engine',
    })];
  });
}

function buildSceneCandidates(sceneEligibility) {
  return readArray(sceneEligibility?.sceneEvidence).flatMap((evidence) => {
    const sourceCode = readText(evidence?.id);
    const insight = SCENE_INSIGHT_DEFINITIONS[sourceCode];
    if (!insight || evidence?.hardConflict === true || evidence?.severity === 'NEGATIVE_SIGNAL') return [];
    const subjectItemIds = uniqueSorted(evidence.subjectItemIds);
    const sourceVersion = readText(evidence.version || sceneEligibility.sceneEvidenceVersion) || 'unknown';
    return [createCandidate({
      ...insight,
      sourceKind: 'scene',
      sourceCode,
      evidenceType: readText(evidence.evidenceFamily) || 'scene_evidence',
      evidenceStrength: readSceneEvidenceStrength(evidence.severity),
      subjectItemIds,
      evidenceRefs: [`scene:${sourceVersion}:${sourceCode}:${subjectItemIds.join('|')}`],
      sourceAuthorization: readText(evidence.authorization),
      contextDependencies: {
        scene: true,
        weather: readText(evidence.evidenceFamily) === 'weather_layering',
        preference: /user_preference/.test(readText(evidence.authorization)),
      },
    })];
  });
}

function buildRelationCandidates(copyFacts) {
  return readArray(copyFacts?.relationFacts).flatMap((relation) => {
    if (relation?.authorized !== true) return [];
    const sourceCode = readText(relation.fact);
    const insight = RELATION_INSIGHT_DEFINITIONS[sourceCode];
    if (!insight) return [];
    const evidenceRefs = uniqueSorted([
      relation.relationFactId,
      relation.factId,
      ...readArray(relation.supportingFactIds),
    ]);
    return [createCandidate({
      ...insight,
      sourceKind: 'relation',
      sourceCode,
      evidenceType: 'relation_fact',
      evidenceStrength: 'supporting',
      subjectItemIds: uniqueSorted(relation.subjectItemIds),
      evidenceRefs,
      sourceAuthorization: readText(relation.sourceRule || relation.relationRule),
      contextDependencies: { scene: sourceCode === 'work_eligible' },
    })];
  });
}

function buildLimitations({ aestheticEvaluation, sceneEligibility, weatherEligibility }) {
  const limitations = [];
  for (const evidence of readArray(aestheticEvaluation?.evidence)) {
    if (evidence?.polarity !== 'negative') continue;
    const subjectItemIds = uniqueSorted(evidence.itemIds);
    limitations.push({
      sourceKind: 'aesthetic',
      sourceCode: readText(evidence.code),
      subjectItemIds,
      evidenceRefs: [`aesthetic:${readText(aestheticEvaluation.engineVersion) || 'unknown'}:${readText(evidence.code)}:${subjectItemIds.join('|')}`],
      contextDependencies: {},
    });
  }
  for (const evidence of readArray(sceneEligibility?.sceneEvidence)) {
    if (evidence?.severity !== 'NEGATIVE_SIGNAL' && evidence?.hardConflict !== true) continue;
    const subjectItemIds = uniqueSorted(evidence.subjectItemIds);
    limitations.push({
      sourceKind: 'scene',
      sourceCode: readText(evidence.id),
      subjectItemIds,
      evidenceRefs: [`scene:${readText(evidence.version || sceneEligibility.sceneEvidenceVersion) || 'unknown'}:${readText(evidence.id)}:${subjectItemIds.join('|')}`],
      contextDependencies: { scene: true },
    });
  }
  for (const sourceCode of uniqueSorted([
    ...readArray(weatherEligibility?.rejectReasons),
    ...readArray(weatherEligibility?.warningReasons),
  ])) {
    const matchingEvidence = readArray(weatherEligibility?.evidence).filter((entry) => (
      normalizeCode(entry?.reason) === normalizeCode(sourceCode)
    ));
    const subjectItemIds = uniqueSorted(matchingEvidence.map((entry) => entry?.itemId));
    limitations.push({
      sourceKind: 'wearability',
      sourceCode,
      subjectItemIds,
      evidenceRefs: [`wearability:${sourceCode}:${subjectItemIds.join('|')}`],
      contextDependencies: { weather: true },
    });
  }
  return limitations.sort(compareSourceRecord);
}

function createCandidate(input) {
  const subjectItemIds = uniqueSorted(input.subjectItemIds);
  const evidenceRefs = uniqueSorted(input.evidenceRefs);
  const insightId = [input.insightCode, subjectItemIds.join('|'), evidenceRefs.join('|')].join(':');
  return {
    version: STYLING_INSIGHT_CANDIDATE_VERSION,
    insightId,
    insightCode: input.insightCode,
    materiality: input.materiality,
    claimCode: input.claimCode,
    semanticFamily: readSemanticFamily(input.insightCode),
    selectionClass: readSelectionClass(input.insightCode),
    valueClass: readValueClass(input.insightCode),
    secondaryEligible: input.materiality === 'material' && isSecondaryEligible(input.insightCode),
    evidenceType: readText(input.evidenceType) || 'unknown',
    evidenceStrength: readText(input.evidenceStrength) || 'supporting',
    subjectItemIds,
    evidenceRefs,
    sources: [{
      kind: input.sourceKind,
      code: input.sourceCode,
      authorization: input.sourceAuthorization || '',
    }],
    contextDependencies: {
      scene: input.contextDependencies?.scene === true,
      weather: input.contextDependencies?.weather === true,
      preference: input.contextDependencies?.preference === true,
    },
  };
}

function mergeEquivalentCandidates(candidates) {
  const byCode = new Map();
  for (const candidate of candidates) {
    const current = byCode.get(candidate.insightCode);
    if (!current) {
      byCode.set(candidate.insightCode, { ...candidate });
      continue;
    }
    const subjectItemIds = uniqueSorted([...current.subjectItemIds, ...candidate.subjectItemIds]);
    const evidenceRefs = uniqueSorted([...current.evidenceRefs, ...candidate.evidenceRefs]);
    const sources = uniqueSources([...current.sources, ...candidate.sources]);
    byCode.set(candidate.insightCode, {
      ...current,
      insightId: [candidate.insightCode, subjectItemIds.join('|'), evidenceRefs.join('|')].join(':'),
      materiality: current.materiality === 'material' || candidate.materiality === 'material' ? 'material' : 'weak',
      secondaryEligible: current.secondaryEligible || candidate.secondaryEligible,
      evidenceType: mergeEvidenceTypes(current.evidenceType, candidate.evidenceType),
      evidenceStrength: strongerEvidenceStrength(current.evidenceStrength, candidate.evidenceStrength),
      subjectItemIds,
      evidenceRefs,
      sources,
      contextDependencies: {
        scene: current.contextDependencies.scene || candidate.contextDependencies.scene,
        weather: current.contextDependencies.weather || candidate.contextDependencies.weather,
        preference: current.contextDependencies.preference || candidate.contextDependencies.preference,
      },
    });
  }
  return [...byCode.values()].sort((left, right) => left.insightCode.localeCompare(right.insightCode));
}

function classifyAestheticMateriality({ insight, sourceCode, evidence, items }) {
  if (sourceCode === 'COLOR_MONOCHROMATIC') {
    return isMaterialColorUnity(evidence, items) ? 'material' : 'weak';
  }
  if (sourceCode === 'COLOR_NEUTRAL_ACCENT') {
    return hasActualNeutralAccentRelation(evidence, items) ? insight.materiality : 'weak';
  }
  return insight.materiality;
}

function isMaterialColorUnity(evidence, items) {
  const subjects = readColorSubjects(evidence, items);
  const coreSubjects = subjects.filter((entry) => (
    CORE_COLOR_RELATION_CATEGORIES.has(entry.category) && entry.color.dominant
  ));
  if (coreSubjects.length < 2) return false;
  return coreSubjects.filter((entry) => entry.color.neutral === false).length >= 2;
}

function hasActualNeutralAccentRelation(evidence, items) {
  const subjects = readColorSubjects(evidence, items).filter((entry) => entry.color.dominant);
  const coreSubjects = subjects.filter((entry) => CORE_COLOR_RELATION_CATEGORIES.has(entry.category));
  if (coreSubjects.length < 2) return false;
  return subjects.some((entry) => entry.color?.neutral === true)
    && subjects.some((entry) => entry.color?.neutral === false);
}

function readColorSubjects(evidence, items) {
  const itemById = new Map(items.map((item) => [readItemId(item), item]));
  return uniqueSorted(evidence?.itemIds).map((itemId) => {
    const item = itemById.get(itemId);
    return {
      itemId,
      category: normalizeColorRelationCategory(item),
      color: readColorSignal(item),
    };
  }).filter((entry) => entry.color);
}

function normalizeColorRelationCategory(item) {
  const category = readText(item?.category || item?.type).toLowerCase();
  if (CORE_COLOR_RELATION_CATEGORIES.has(category) || category === 'shoes' || category === 'accessory') return category;
  const text = `${category} ${readText(item?.subcategory || item?.subCategory)}`.toLowerCase();
  if (/(coat|jacket|blazer|outerwear)/.test(text)) return 'outerwear';
  if (/(dress|jumpsuit|suit_set)/.test(text)) return 'onepiece';
  if (/(pants|trousers|jeans|shorts|skirt|leggings)/.test(text)) return 'bottom';
  if (/(shoe|sneaker|boot|heel|sandal|loafer|flat)/.test(text)) return 'shoes';
  if (/(shirt|tshirt|sweater|hoodie|vest|top)/.test(text)) return 'top';
  return category || 'other';
}

function readColorSignal(item) {
  const palette = readArray(item?.colorPalette);
  const color = palette.find((entry) => entry?.role === 'primary') || palette.find(isObject);
  if (!color) return null;
  const name = readText(color.name).toLowerCase();
  const hsl = readHexHsl(color.hex);
  if (!hsl && !NEUTRAL_COLOR_NAMES.has(name)) return null;
  return {
    neutral: hsl
      ? hsl.saturation < 0.15 || hsl.lightness < 0.15 || hsl.lightness > 0.9
      : true,
    dominant: color.ratio === null
      || color.ratio === undefined
      || !Number.isFinite(Number(color.ratio))
      || Number(color.ratio) >= 0.45,
  };
}

function readHexHsl(value) {
  const hex = readText(value);
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return null;
  const channels = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const max = Math.max(...channels);
  const min = Math.min(...channels);
  const lightness = (max + min) / 2;
  const delta = max - min;
  return {
    saturation: delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1)),
    lightness,
  };
}

function readSemanticFamily(insightCode) {
  if (insightCode === 'PATTERN_FOCUS') return 'pattern_focus';
  if (insightCode === 'DETAIL_FOCUS') return 'detail_focus';
  if (insightCode === 'COLOR_FOCUS') return 'color_focus';
  if (['COLOR_UNITY', 'COLOR_HARMONY', 'COLOR_CONTRAST'].includes(insightCode)) return 'color_relation';
  if (['SILHOUETTE_CONTRAST', 'SILHOUETTE_CONTINUITY'].includes(insightCode)) return 'silhouette_relation';
  if (['PROPORTION_LAYERING', 'PROPORTION_CONTINUITY'].includes(insightCode)) return 'proportion_relation';
  if (['PREFERENCE_STYLE_MATCH', 'STYLE_UNITY'].includes(insightCode)) return 'style_alignment';
  if (insightCode === 'WEATHER_LAYERING') return 'weather_practicality';
  if (insightCode.startsWith('SCENE_')) return 'scene_practicality';
  return insightCode.toLowerCase();
}

function readSelectionClass(insightCode) {
  if (insightCode === 'WEATHER_LAYERING' || insightCode === 'SCENE_SPORT_PURPOSE_SET') return 'decisive_context';
  if (insightCode.startsWith('SCENE_') || insightCode === 'PREFERENCE_STYLE_MATCH') return 'generic_context';
  return 'strong_outfit_relation';
}

function readValueClass(insightCode) {
  if (['PATTERN_FOCUS', 'DETAIL_FOCUS', 'COLOR_FOCUS'].includes(insightCode)) return 'distinctive_focus';
  if (['SILHOUETTE_CONTRAST', 'PROPORTION_LAYERING'].includes(insightCode)) return 'structural_relation';
  if (insightCode === 'COLOR_UNITY') return 'specific_relation';
  if (insightCode === 'WEATHER_LAYERING' || insightCode === 'SCENE_SPORT_PURPOSE_SET') return 'decisive_practicality';
  if (insightCode.startsWith('SCENE_') || insightCode === 'PREFERENCE_STYLE_MATCH') return 'context_description';
  return 'supporting_relation';
}

function isSecondaryEligible(insightCode) {
  return !['SCENE_WORK_SIMPLE_ONEPIECE'].includes(insightCode);
}

function readAestheticEvidenceType(sourceCode) {
  if (sourceCode.startsWith('COLOR_')) return 'color_relation';
  if (sourceCode.startsWith('PATTERN_')) return 'pattern_relation';
  if (sourceCode.startsWith('SILHOUETTE_')) return 'silhouette_relation';
  if (sourceCode.startsWith('PROPORTION_')) return 'proportion_relation';
  if (sourceCode.startsWith('DETAIL_')) return 'detail_relation';
  if (sourceCode.startsWith('FORMALITY_')) return 'formality_relation';
  return 'aesthetic_relation';
}

function readEvidenceStrength(value) {
  if (Number(value) >= 3) return 'strong';
  if (Number(value) >= 2) return 'moderate';
  return 'supporting';
}

function readSceneEvidenceStrength(severity) {
  if (severity === 'STRONG_POSITIVE') return 'strong';
  if (severity === 'MEDIUM_POSITIVE') return 'moderate';
  return 'supporting';
}

function mergeEvidenceTypes(left, right) {
  return uniqueSorted(`${left}|${right}`.split('|')).join('|');
}

function strongerEvidenceStrength(left, right) {
  const order = ['strong', 'moderate', 'supporting'];
  return order.find((value) => value === left || value === right) || 'supporting';
}

function isPatternOnlyDetail(evidence, itemById) {
  const subjects = uniqueSorted(evidence?.itemIds).map((itemId) => itemById.get(itemId)).filter(Boolean);
  if (subjects.length === 0) return false;
  return subjects.every((item) => {
    const features = isObject(item.aestheticFeatures) ? item.aestheticFeatures : {};
    const details = readArray(features.designElements);
    return details.length === 0 && readText(features.patternType) && readText(features.patternType) !== 'solid';
  });
}

function definition(insightCode, materiality, claimCode) {
  return Object.freeze({ insightCode, materiality, claimCode });
}

function readSceneEligibility(input) {
  return isObject(input.sceneEligibility)
    ? input.sceneEligibility
    : isObject(input.eligibility?.scene) ? input.eligibility.scene : {};
}

function readWeatherEligibility(input) {
  return isObject(input.weatherEligibility)
    ? input.weatherEligibility
    : isObject(input.eligibility?.weather) ? input.eligibility.weather : {};
}

function readItemIds(input, items) {
  const explicit = readArray(input.itemIds).length > 0
    ? input.itemIds
    : items.map(readItemId);
  return uniqueSorted(explicit);
}

function buildCompositionKey(input, items) {
  const explicit = readText(input.outfitKey || input.selectionSignatures?.itemSignature);
  return explicit || readItemIds(input, items).join('_');
}

function readItemId(item) {
  return readText(item?._id || item?.id || item?.clothingId || item?.itemId);
}

function uniqueSources(sources) {
  const seen = new Set();
  return sources.filter((source) => {
    const key = `${source.kind}:${source.code}:${source.authorization}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((left, right) => `${left.kind}:${left.code}`.localeCompare(`${right.kind}:${right.code}`));
}

function compareSourceRecord(left, right) {
  return `${left.sourceKind}:${left.sourceCode}`.localeCompare(`${right.sourceKind}:${right.sourceCode}`);
}

function uniqueSorted(values) {
  return [...new Set(readArray(values).map(readText).filter(Boolean))].sort();
}

function normalizeCode(value) {
  return readText(value).replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function readArray(value) { return Array.isArray(value) ? value : []; }
function readText(value) { return typeof value === 'string' ? value.trim() : ''; }
function isObject(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }

module.exports = {
  AESTHETIC_INSIGHT_DEFINITIONS,
  RELATION_INSIGHT_DEFINITIONS,
  SCENE_INSIGHT_DEFINITIONS,
  STYLING_INSIGHT_CANDIDATE_VERSION,
  buildStylingInsightCandidatesV2,
};
