const crypto = require('crypto');
const {
  RECOMMENDATION_NARRATIVE_PLAN_VERSION,
  buildRecommendationNarrativePlanV2,
} = require('./recommendationNarrativePlanV2');
const { STYLING_INSIGHT_CANDIDATE_VERSION } = require('./stylingInsightCandidateV2');
const { STYLING_INSIGHT_RESOLVER_VERSION } = require('./stylingInsightResolverV2');

const RECOMMENDATION_STYLING_SHADOW_VERSION = 'recommendation-styling-shadow-v2.2';
const RECOMMENDATION_STYLING_TELEMETRY_SCHEMA_VERSION = 'styling-shadow-telemetry-v2';
const MAX_PLAN_DIAGNOSTIC_SAMPLES = 5;
const DEFAULT_TELEMETRY_SAMPLE_RATE = 0.1;

function runRecommendationStylingShadowV2({
  recommendations = [],
  scene,
  weather,
  recommendationInstanceSeed = 'shadow',
  telemetrySampleRate,
} = {}) {
  const inputs = Array.isArray(recommendations) ? recommendations : [];
  const planEntries = inputs.map((recommendation, index) => ({
    recommendation,
    plan: buildRecommendationNarrativePlanV2(recommendation, {
      scene,
      weather,
      recommendationInstanceId: `${recommendationInstanceSeed}:${index}`,
    }),
  }));
  const plans = planEntries.map((entry) => entry.plan);
  return {
    version: RECOMMENDATION_STYLING_SHADOW_VERSION,
    plans,
    distribution: buildShadowDistribution(plans),
    diagnostics: buildShadowDiagnostics(plans, {
      scene,
      telemetrySampleRate,
      recommendationCount: inputs.length,
      planEntries,
    }),
  };
}

function runRecommendationStylingShadowV2Safely(input = {}) {
  try {
    return runRecommendationStylingShadowV2Isolated(input);
  } catch (error) {
    return buildTotalFailOpenResult(error, input);
  }
}

function runRecommendationStylingShadowV2Isolated(input) {
  const recommendations = readArray(input.recommendations);
  const plans = [];
  const planEntries = [];
  const failureCodes = [];
  for (let index = 0; index < recommendations.length; index += 1) {
    try {
      const plan = buildRecommendationNarrativePlanV2(recommendations[index], {
        scene: input.scene,
        weather: input.weather,
        recommendationInstanceId: `${input.recommendationInstanceSeed || 'shadow'}:${index}`,
      });
      plans.push(plan);
      planEntries.push({ plan, recommendation: recommendations[index] });
    } catch (error) {
      failureCodes.push(readShadowErrorCode(error));
    }
  }
  const diagnostics = buildShadowDiagnostics(plans, {
    scene: input.scene,
    telemetrySampleRate: input.telemetrySampleRate,
    recommendationCount: recommendations.length,
    planEntries,
  });
  return {
    version: RECOMMENDATION_STYLING_SHADOW_VERSION,
    plans,
    distribution: buildShadowDistribution(plans),
    diagnostics: {
      ...diagnostics,
      status: failureCodes.length === 0
        ? 'completed'
        : plans.length > 0 ? 'partially_failed_open' : 'failed_open',
      shadowFailureCount: failureCodes.length,
      failureCodes: countValues(failureCodes),
    },
  };
}

function buildTotalFailOpenResult(error, input = {}) {
  const distribution = buildShadowDistribution([]);
  const recommendationCount = readArray(input.recommendations).length;
  return {
    version: RECOMMENDATION_STYLING_SHADOW_VERSION,
    plans: [],
    distribution,
    diagnostics: {
      schemaVersion: RECOMMENDATION_STYLING_TELEMETRY_SCHEMA_VERSION,
      shadowVersion: RECOMMENDATION_STYLING_SHADOW_VERSION,
      stylingVersion: STYLING_INSIGHT_CANDIDATE_VERSION,
      candidateVersion: STYLING_INSIGHT_CANDIDATE_VERSION,
      resolverVersion: STYLING_INSIGHT_RESOLVER_VERSION,
      narrativePlanVersion: RECOMMENDATION_NARRATIVE_PLAN_VERSION,
      status: 'failed_open',
      recommendationCount,
      shadowExecutionCount: recommendationCount > 0 ? recommendationCount : 1,
      shadowPlanSuccessCount: 0,
      shadowFailureCount: 1,
      sceneCategory: 'other',
      distribution,
      telemetrySampleRate: 0,
      sampledPlanCount: 0,
      planSamples: [],
      failureCodes: { [readShadowErrorCode(error)]: 1 },
    },
  };
}

function buildShadowDistribution(plans = []) {
  const entries = Array.isArray(plans) ? plans : [];
  return {
    version: RECOMMENDATION_STYLING_SHADOW_VERSION,
    planVersion: RECOMMENDATION_NARRATIVE_PLAN_VERSION,
    total: entries.length,
    materiality: countByKnownValues(entries, (plan) => plan?.resolution?.materiality, ['material', 'weak', 'none']),
    competition: countByKnownValues(entries, (plan) => plan?.resolution?.competition, ['competing', 'single', 'none']),
    recommendationLevel: {
      primary: entries.filter((plan) => Boolean(plan?.insights?.primary)).length,
      weakOnly: entries.filter((plan) => plan?.resolution?.materiality === 'weak').length,
      sparse: entries.filter((plan) => plan?.resolution?.materiality === 'none').length,
      competing: entries.filter((plan) => plan?.resolution?.competition === 'competing').length,
    },
    candidateMateriality: sumCandidateMateriality(entries),
    candidateCountDistribution: countValues(entries.map((plan) => String(readCandidateSummaries(plan).length))),
    materialCandidateCountDistribution: countValues(entries.map((plan) => (
      String(Number(plan?.resolution?.candidateMateriality?.material || 0))
    ))),
    candidateInsightCodes: countValues(entries.flatMap(readCandidateCodes)),
    decisionCodes: countValues(entries.flatMap((plan) => readArray(plan?.resolution?.decisionCodes))),
    relevantEvidenceTypes: countValues(entries.flatMap(readRelevantEvidenceTypes)),
    primaryInsightCodes: countValues(entries.map((plan) => plan?.insights?.primary?.insightCode)),
    secondaryInsightCodes: countValues(entries.flatMap((plan) => (
      plan?.insights?.selectedSecondary ? [plan.insights.selectedSecondary.insightCode] : []
    ))),
    primarySecondaryCombinations: countValues(entries.map((plan) => (
      `${plan?.insights?.primary?.insightCode || 'NONE'}+${plan?.insights?.selectedSecondary?.insightCode || 'NONE'}`
    ))),
    weakInsightCodes: countValues(entries.flatMap((plan) => (
      Array.isArray(plan?.insights?.weak) ? plan.insights.weak.map((insight) => insight.insightCode) : []
    ))),
  };
}

function buildShadowDiagnostics(plans = [], context = {}) {
  const planEntries = normalizePlanEntries(plans, context.planEntries);
  const sampledEntries = samplePlanEntries(planEntries, context.telemetrySampleRate);
  const recommendationCount = Number.isInteger(context.recommendationCount)
    ? Math.max(0, context.recommendationCount)
    : plans.length;
  return {
    schemaVersion: RECOMMENDATION_STYLING_TELEMETRY_SCHEMA_VERSION,
    shadowVersion: RECOMMENDATION_STYLING_SHADOW_VERSION,
    stylingVersion: STYLING_INSIGHT_CANDIDATE_VERSION,
    candidateVersion: STYLING_INSIGHT_CANDIDATE_VERSION,
    resolverVersion: STYLING_INSIGHT_RESOLVER_VERSION,
    narrativePlanVersion: RECOMMENDATION_NARRATIVE_PLAN_VERSION,
    status: 'completed',
    recommendationCount,
    shadowExecutionCount: recommendationCount,
    shadowPlanSuccessCount: plans.length,
    shadowFailureCount: 0,
    sceneCategory: normalizeSceneCategory(context.scene),
    distribution: buildShadowDistribution(plans),
    telemetrySampleRate: normalizeSampleRate(context.telemetrySampleRate),
    sampledPlanCount: sampledEntries.length,
    planSamples: sampledEntries.map(({ plan, recommendation }) => ({
      anonymousCaseId: shortHash(plan?.identity?.outfitComposition?.key || 'missing'),
      compositionHash: shortHash(plan?.identity?.outfitComposition?.key || 'missing'),
      sceneCategory: normalizeSceneCategory(context.scene),
      garments: buildCoarseGarmentFacts(recommendation, plan),
      materiality: plan.resolution.materiality,
      competition: plan.resolution.competition,
      primaryInsightCode: plan.insights.primary?.insightCode || null,
      selectedSecondaryInsightCode: plan.insights.selectedSecondary?.insightCode || null,
      unselectedInsightCodes: readArray(plan.insights.unselected).map((insight) => insight.insightCode),
      candidateInsightCodes: readCandidateCodes(plan),
      candidates: readCandidateSummaries(plan),
      decisionCodes: plan.resolution.decisionCodes.slice(),
      relevantEvidenceTypes: readRelevantEvidenceTypes(plan),
      expressionMode: plan.expressionStrategy?.mode || null,
      weakCount: plan.insights.weak.length,
    })),
  };
}

function isRecommendationStylingShadowEnabled(event = {}, env = process.env) {
  return event.shadowStylingIntelligence === true || env.STYLING_INTELLIGENCE_SHADOW_ENABLED === 'true';
}

function samplePlanEntries(planEntries, sampleRate) {
  const rate = normalizeSampleRate(sampleRate);
  return planEntries.filter(({ plan }) => deterministicUnitInterval(plan?.identity?.outfitComposition?.key) < rate)
    .slice(0, MAX_PLAN_DIAGNOSTIC_SAMPLES);
}

function normalizePlanEntries(plans, planEntries) {
  if (Array.isArray(planEntries) && planEntries.length === plans.length) return planEntries;
  return plans.map((plan) => ({ plan, recommendation: null }));
}

function normalizeSampleRate(value) {
  const number = Number(value ?? process.env.STYLING_INTELLIGENCE_SHADOW_SAMPLE_RATE);
  if (!Number.isFinite(number)) return DEFAULT_TELEMETRY_SAMPLE_RATE;
  return Math.max(0, Math.min(1, number));
}

function deterministicUnitInterval(value) {
  const prefix = crypto.createHash('sha256').update(String(value || 'missing')).digest('hex').slice(0, 8);
  return parseInt(prefix, 16) / 0xffffffff;
}

function countByKnownValues(entries, selector, knownValues) {
  return Object.fromEntries(knownValues.map((value) => [value, entries.filter((entry) => selector(entry) === value).length]));
}

function countValues(values) {
  const counts = new Map();
  for (const value of values.filter(Boolean)) counts.set(value, (counts.get(value) || 0) + 1);
  return Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function readCandidateCodes(plan) {
  return [...new Set([
    plan?.insights?.primary?.insightCode,
    plan?.insights?.selectedSecondary?.insightCode,
    ...readArray(plan?.insights?.unselected).map((insight) => insight.insightCode),
  ].filter(Boolean))].sort();
}

function readCandidateSummaries(plan) {
  const entries = [
    plan?.insights?.primary,
    plan?.insights?.selectedSecondary,
    ...readArray(plan?.insights?.unselected),
  ].filter(Boolean);
  return entries.map((insight) => ({
    insightCode: insight.insightCode,
    materiality: insight.materiality,
    selection: insight === plan?.insights?.primary
      ? 'primary'
      : insight === plan?.insights?.selectedSecondary ? 'secondary' : 'unselected',
  }));
}

function readRelevantEvidenceTypes(plan) {
  return [...new Set([
    plan?.insights?.primary?.evidenceType,
    plan?.insights?.selectedSecondary?.evidenceType,
    ...readArray(plan?.insights?.unselected).map((insight) => insight.evidenceType),
  ].flatMap((value) => typeof value === 'string' ? value.split('|') : []).filter(Boolean))].sort();
}

function buildCoarseGarmentFacts(recommendation, plan) {
  const evidenceTypes = new Set(readRelevantEvidenceTypes(plan));
  const includeShape = evidenceTypes.has('silhouette_relation') || evidenceTypes.has('proportion_relation');
  return readArray(recommendation?.items).map((item) => ({
    category: normalizeGarmentCategory(item?.category),
    coarseColor: normalizeCoarseColor(readPrimaryColor(item)),
    pattern: normalizePattern(item?.aestheticFeatures?.patternType),
    ...(includeShape ? {
      fit: normalizeShapeValue(item?.aestheticFeatures?.fit),
      silhouette: normalizeShapeValue(item?.aestheticFeatures?.silhouette),
    } : {}),
  }));
}

function normalizeGarmentCategory(value) {
  const category = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (['top', 'bottom', 'onepiece', 'outerwear', 'shoes', 'accessory'].includes(category)) return category;
  return 'other';
}

function readPrimaryColor(item) {
  const colors = readArray(item?.colorPalette);
  return colors.find((color) => color?.role === 'primary') || colors[0] || null;
}

function normalizeCoarseColor(color) {
  const name = typeof color?.name === 'string' ? color.name.trim().toLowerCase() : '';
  const namedGroups = [
    ['black', ['black']], ['white', ['white']], ['gray', ['gray', 'grey', 'silver']],
    ['warm_neutral', ['beige', 'cream', 'camel', 'khaki', 'brown', 'tan']],
    ['red', ['red', 'burgundy', 'maroon']], ['orange', ['orange']], ['yellow', ['yellow', 'gold']],
    ['green', ['green', 'olive']], ['blue', ['blue', 'navy', 'indigo', 'cyan', 'teal']],
    ['purple', ['purple', 'violet']], ['pink', ['pink', 'rose']],
  ];
  for (const [group, names] of namedGroups) {
    if (names.some((candidate) => name.includes(candidate))) return group;
  }
  const hex = typeof color?.hex === 'string' ? color.hex.trim() : '';
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!match) return name ? 'other' : 'unknown';
  const value = parseInt(match[1], 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  if (max < 45) return 'black';
  if (min > 220) return 'white';
  if (max - min < 28) return 'gray';
  const hue = rgbHue(red, green, blue);
  if (hue < 15 || hue >= 345) return 'red';
  if (hue < 45) return 'orange';
  if (hue < 70) return 'yellow';
  if (hue < 165) return 'green';
  if (hue < 255) return 'blue';
  if (hue < 290) return 'purple';
  return 'pink';
}

function rgbHue(red, green, blue) {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return 0;
  if (max === r) return 60 * (((g - b) / delta) % 6 + 6) % 360;
  if (max === g) return 60 * ((b - r) / delta + 2);
  return 60 * ((r - g) / delta + 4);
}

function normalizePattern(value) {
  const pattern = typeof value === 'string' ? value.trim().toLowerCase() : '';
  const allowed = ['solid', 'stripe', 'plaid', 'check', 'dot', 'floral', 'graphic', 'animal'];
  return allowed.includes(pattern) ? pattern : 'unknown';
}

function normalizeShapeValue(value) {
  const shape = typeof value === 'string' ? value.trim().toLowerCase() : '';
  const allowed = ['fitted', 'slim', 'regular', 'relaxed', 'oversized', 'straight', 'wideleg', 'a-line'];
  return allowed.includes(shape) ? shape : 'unknown';
}

function sumCandidateMateriality(plans) {
  return plans.reduce((total, plan) => ({
    material: total.material + Number(plan?.resolution?.candidateMateriality?.material || 0),
    weak: total.weak + Number(plan?.resolution?.candidateMateriality?.weak || 0),
    none: total.none + Number(plan?.resolution?.candidateMateriality?.none || 0),
  }), { material: 0, weak: 0, none: 0 });
}

function normalizeSceneCategory(value) {
  const scene = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return ['home', 'work', 'date', 'sport'].includes(scene) ? scene : 'other';
}

function shortHash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 12);
}

function readShadowErrorCode(error) {
  const value = readArray(error?.validationErrors)[0] || error?.businessCode || error?.code || error?.name;
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 80) : 'SHADOW_UNKNOWN_ERROR';
}

function readArray(value) { return Array.isArray(value) ? value : []; }

module.exports = {
  RECOMMENDATION_STYLING_SHADOW_VERSION,
  RECOMMENDATION_STYLING_TELEMETRY_SCHEMA_VERSION,
  buildShadowDiagnostics,
  buildShadowDistribution,
  isRecommendationStylingShadowEnabled,
  runRecommendationStylingShadowV2,
  runRecommendationStylingShadowV2Safely,
};
