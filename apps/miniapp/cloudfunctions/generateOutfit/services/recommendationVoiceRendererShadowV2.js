const crypto = require('crypto');
const fetch = require('node-fetch');
const { validateRecommendationNarrativePlanV2 } = require('./recommendationNarrativePlanV2');
const {
  VOICE_RENDERER_CONTRACT_VERSION,
  VOICE_RENDERER_GENERATION_PARAMETERS,
  VOICE_RENDERER_INPUT_VERSION,
  VOICE_RENDERER_MODEL,
  VOICE_RENDERER_MODEL_ROUTE_VERSION,
  VOICE_RENDERER_PERSONA_VERSION,
  buildVoiceRendererV2Request,
  parseVoiceRendererV2Outputs,
} = require('./voiceRendererV2Contract');

const RECOMMENDATION_VOICE_RENDERER_SHADOW_VERSION = 'recommendation-voice-renderer-shadow-v2.0';
const MAX_CACHE_ENTRIES = 256;
const MAX_REVIEW_SAMPLES = 8;
const PERSONA_FAILURE_TERMS = Object.freeze([
  '算法', '模型判断', '候选', '主洞察', '次要洞察', '视觉焦点', '视觉结构', '色彩关系',
  '轮廓关系', '搭配公式', '编辑感', '高级感拉满', '氛围感拉满', '绝绝子', '拿捏',
]);
const UNSUPPORTED_FACT_TERMS = Object.freeze([
  '显瘦', '显高', '显腿长', '显白', '修饰身材', '遮肉', '透气', '保暖', '舒适', '柔软',
  '省心', '不用想', '百搭', '显精神',
]);
const shadowCopyCache = new Map();
const authorizedBenchmarkEvents = new WeakMap();

function authorizeRecommendationVoiceRendererBenchmark(event, config = {}) {
  if (!event || typeof event !== 'object') throw new Error('VOICE_BENCHMARK_EVENT');
  authorizedBenchmarkEvents.set(event, {
    compare: config.compare === true,
    review: config.review === true,
  });
}

function readRecommendationVoiceRendererBenchmarkConfig(event) {
  return authorizedBenchmarkEvents.get(event) || null;
}

function isRecommendationVoiceRendererShadowEnabled(event = {}, env = process.env) {
  return env.RECOMMENDATION_VOICE_RENDERER_SHADOW_ENABLED === 'true'
    || authorizedBenchmarkEvents.has(event);
}

function buildRecommendationVoiceRendererExecution(event, stylingShadow, recommendations, env = process.env) {
  if (!stylingShadow || !isRecommendationVoiceRendererShadowEnabled(event, env)) return { enabled: false };
  const benchmark = readRecommendationVoiceRendererBenchmarkConfig(event);
  const common = { plans: readArray(stylingShadow.plans), recommendations: readArray(recommendations) };
  if (benchmark?.compare) return {
    enabled: true,
    promise: runRecommendationVoiceRendererBenchmarkV2Safely(common),
  };
  return {
    enabled: true,
    promise: runRecommendationVoiceRendererShadowV2Safely({
      ...common,
      mode: 'single',
      includeReview: benchmark?.review === true,
    }),
  };
}

async function runRecommendationVoiceRendererShadowV2Safely(input = {}) {
  try {
    return await runRecommendationVoiceRendererShadowV2(input);
  } catch (error) {
    return buildFailOpenResult(error, input);
  }
}

async function runRecommendationVoiceRendererBenchmarkV2Safely(input = {}) {
  clearRecommendationVoiceRendererShadowCache();
  const [single, batch] = await Promise.all([
    runRecommendationVoiceRendererShadowV2Safely({ ...input, mode: 'single', cacheMode: 'bypass', includeReview: true }),
    runRecommendationVoiceRendererShadowV2Safely({ ...input, mode: 'batch', cacheMode: 'use', includeReview: true }),
  ]);
  const cacheProbe = await runRecommendationVoiceRendererShadowV2Safely({ ...input, mode: 'single', cacheMode: 'use', includeReview: false });
  return {
      version: RECOMMENDATION_VOICE_RENDERER_SHADOW_VERSION,
      status: single.status === 'completed' && batch.status === 'completed' ? 'completed' : 'partially_failed_open',
      benchmark: true,
      contractVersion: VOICE_RENDERER_CONTRACT_VERSION,
      modelRouteVersion: VOICE_RENDERER_MODEL_ROUTE_VERSION,
      model: VOICE_RENDERER_MODEL,
      samePlanSet: samePlanSet(single.reviewSamples, batch.reviewSamples),
      qualityNotDegraded: isBatchQualityNotDegraded(single, batch),
      exactTextAgreementCount: countExactTextAgreement(single.reviewSamples, batch.reviewSamples),
      single,
      batch,
      cacheProbe,
  };
}

async function runRecommendationVoiceRendererShadowV2({
  plans = [],
  recommendations = [],
  mode = 'single',
  cacheMode = 'use',
  includeReview = false,
  apiKey = process.env.BAILIAN_API_KEY || process.env.DASHSCOPE_API_KEY,
  baseUrl = process.env.BAILIAN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  invoke = invokeProvider,
} = {}) {
  const startedAt = Date.now();
  if (!['single', 'batch'].includes(mode)) throw new Error('VOICE_RENDERER_MODE');
  const entries = matchPlansToRecommendations(plans, recommendations).map(({ plan, recommendation }) => ({
    plan,
    input: buildRendererInputFromNarrativePlan(plan, recommendation),
  }));
  const resolved = [];
  const misses = [];
  for (const entry of entries) {
    const cacheKey = buildCacheKey(entry.plan);
    const cached = cacheMode === 'use' ? shadowCopyCache.get(cacheKey) : null;
    if (cached) resolved.push({ ...cached, cacheHit: true });
    else misses.push({ ...entry, cacheKey });
  }
  const groups = mode === 'batch' ? chunk(misses, 8) : misses.map((entry) => [entry]);
  const callResults = await Promise.all(groups.map(async (group) => {
    const callStartedAt = Date.now();
    const request = buildVoiceRendererV2Request(group.map((entry) => entry.input));
    const response = await invoke({ apiKey, baseUrl, request });
    if (Number(response.status) !== 200) throw new Error(`VOICE_RENDERER_HTTP:${response.status}`);
    if (response.body?.model !== VOICE_RENDERER_MODEL) throw new Error('VOICE_RENDERER_MODEL_MISMATCH');
    const outputs = parseVoiceRendererV2Outputs(response.body?.choices?.[0]?.message?.content, group.map((entry) => entry.input));
    outputs.forEach((output) => {
      const entry = group.find((candidate) => candidate.input.planId === output.planId);
      if (!entry) throw new Error('VOICE_RENDERER_OUTPUT_PLAN_BINDING');
      const copy = buildCopyRecord(entry.plan, entry.input, output, false);
      if (cacheMode === 'use') writeCache(entry.cacheKey, copy);
    });
    return {
      copies: outputs.map((output) => {
        const entry = group.find((candidate) => candidate.input.planId === output.planId);
        return buildCopyRecord(entry.plan, entry.input, output, false);
      }),
      planCount: group.length,
      latencyMs: Date.now() - callStartedAt,
      usage: sanitizeUsage(response.body?.usage),
    };
  }));
  const calls = callResults.map(({ copies, ...call }) => call);
  resolved.push(...callResults.flatMap((result) => result.copies));
  const ordered = entries.map((entry) => resolved.find((copy) => copy.planHash === entry.plan.planHash));
  if (ordered.some((entry) => !entry)) throw new Error('VOICE_RENDERER_RESULT_COMPLETENESS');
  const usage = sumUsage(calls.map((call) => call.usage));
  const cacheHitCount = ordered.filter((entry) => entry.cacheHit).length;
  const checks = ordered.map((copy, index) => validateShadowCopy(copy, entries[index].input, entries.map((entry) => entry.input)));
  return {
    version: RECOMMENDATION_VOICE_RENDERER_SHADOW_VERSION,
    status: 'completed',
    contractVersion: VOICE_RENDERER_CONTRACT_VERSION,
    modelRouteVersion: VOICE_RENDERER_MODEL_ROUTE_VERSION,
    model: VOICE_RENDERER_MODEL,
    executionMode: mode,
    planCount: entries.length,
    renderedCount: ordered.length,
    shadowFailureCount: 0,
    cacheHitCount,
    cacheMissCount: entries.length - cacheHitCount,
    requestCount: calls.length,
    latencyMs: Date.now() - startedAt,
    providerLatencyMs: calls.reduce((sum, call) => sum + call.latencyMs, 0),
    usage,
    automatedContract: {
      passCount: checks.filter((check) => check.pass).length,
      failCount: checks.filter((check) => !check.pass).length,
      failureCounts: countValues(checks.flatMap((check) => check.failures)),
    },
    planIdentities: ordered.map(toPlanIdentity),
    ...(includeReview ? { reviewSamples: ordered.slice(0, MAX_REVIEW_SAMPLES).map(toReviewSample) } : {}),
  };
}

function buildRendererInputFromNarrativePlan(plan, recommendation = {}) {
  const validation = validateRecommendationNarrativePlanV2(plan);
  if (!validation.valid) throw new Error(`VOICE_RENDERER_PLAN_INVALID:${validation.errors[0] || 'unknown'}`);
  const items = readArray(recommendation.items);
  const itemById = new Map(items.map((item) => [readItemId(item), item]));
  const garments = plan.identity.outfitComposition.itemIds.map((itemId) => readGarmentName(itemById.get(itemId))).filter(Boolean);
  if (garments.length === 0) throw new Error('VOICE_RENDERER_PLAN_GARMENTS');
  const primary = plan.insights.primary;
  const permission = primary
    ? readArray(plan.claimPermission.authorizedClaims).find((entry) => entry.insightId === primary.insightId)
    : plan.claimPermission.baselineCompositionClaim;
  if (!permission) throw new Error('VOICE_RENDERER_PLAN_PERMISSION');
  const subjectGarments = primary
    ? primary.subjectItemIds.map((itemId) => readGarmentName(itemById.get(itemId))).filter(Boolean)
    : [];
  if (primary && subjectGarments.length === 0) throw new Error('VOICE_RENDERER_PRIMARY_GARMENTS');
  const input = {
    inputVersion: VOICE_RENDERER_INPUT_VERSION,
    planId: plan.planId,
    task: 'render_canonical_recommendation_copy',
    surface: 'today_and_detail',
    personaVersion: VOICE_RENDERER_PERSONA_VERSION,
    expressionMode: plan.expressionStrategy.mode,
    primary: primary ? {
      insightId: primary.insightId,
      meaning: buildAuthorizedPrimaryMeaning(primary, subjectGarments, plan.relevantContext),
      subjectGarments,
    } : null,
    garments,
    allowedClaims: [permission.claimCode],
    ...(primary?.contextDependencies?.scene && readText(plan.relevantContext?.scene)
      ? { scene: readText(plan.relevantContext.scene) }
      : {}),
    languageConstraints: {
      locale: 'zh-CN', maxSentences: 2, friendLike: true,
      admitSimpleWhenBaseline: true, noNewMeaning: true, noNewFacts: true,
    },
  };
  return input;
}

function buildAuthorizedPrimaryMeaning(primary, subjectGarments, context = {}) {
  const names = joinNames(subjectGarments);
  const scene = sceneLabel(context.scene);
  const meanings = {
    PATTERN_FOCUS: `${subjectGarments[0]}是这套搭配明确的图案重点，其他单品保持简单。`,
    DETAIL_FOCUS: `${subjectGarments[0]}的设计细节是这套搭配的明确重点，其他单品保持简单。`,
    COLOR_FOCUS: `${subjectGarments[0]}是这套搭配的颜色重点，其他单品保持简单。`,
    COLOR_UNITY: `${names}形成统一的颜色关系。`,
    SILHOUETTE_CONTRAST: `${names}形成一紧一松的轮廓对比。`,
    PROPORTION_LAYERING: `${names}形成清楚的长短层次。`,
    WEATHER_LAYERING: `${names}形成适合当前温度的层次搭配。`,
    PREFERENCE_STYLE_MATCH: `${names}符合已经确认的风格偏好。`,
    STYLE_UNITY: `${names}保持一致的风格方向。`,
    SCENE_HOME_RELAXED_STRUCTURE: `${names}组成适合居家的放松组合。`,
    SCENE_WORK_STRUCTURED_SET: `${names}组成清楚完整的上班搭配。`,
    SCENE_WORK_SIMPLE_ONEPIECE: `${names}组成简洁明确的上班搭配。`,
    SCENE_SPORT_PURPOSE_SET: `${names}组成用途明确的运动搭配。`,
    SCENE_SPORT_LIGHT_ACTIVITY: `${names}组成适合轻量活动的运动搭配。`,
  };
  if (meanings[primary.insightCode]) return meanings[primary.insightCode];
  if (primary.insightCode?.startsWith('SCENE_') && scene) return `${names}组成适合${scene}的完整搭配。`;
  throw new Error(`VOICE_RENDERER_PRIMARY_MEANING_UNSUPPORTED:${primary.insightCode || 'missing'}`);
}

async function invokeProvider({ apiKey, baseUrl, request }) {
  if (!apiKey) throw new Error('VOICE_RENDERER_PROVIDER_KEY_MISSING_IN_CLOUD');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  let response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST', signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
  } finally {
    clearTimeout(timeout);
  }
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { throw new Error(`VOICE_RENDERER_PROVIDER_JSON:${response.status}`); }
  if (!response.ok) throw new Error(`VOICE_RENDERER_PROVIDER_HTTP:${response.status}:${body?.error?.code || 'unknown'}`);
  return { status: response.status, body };
}

function matchPlansToRecommendations(plans, recommendations) {
  const available = readArray(recommendations);
  return readArray(plans).map((plan) => {
    const ids = readArray(plan?.identity?.outfitComposition?.itemIds).slice().sort().join('|');
    const recommendation = available.find((entry) => readArray(entry?.items).map(readItemId).filter(Boolean).sort().join('|') === ids);
    if (!recommendation) throw new Error('VOICE_RENDERER_PLAN_RECOMMENDATION_BINDING');
    return { plan, recommendation };
  });
}

function buildCopyRecord(plan, input, output, cacheHit) {
  return {
    planId: plan.planId,
    planHash: plan.planHash,
    insightId: output.insightId,
    text: output.text,
    expressionMode: plan.expressionStrategy.mode,
    primaryInsightCode: plan.insights.primary?.insightCode || null,
    sceneCategory: sceneLabel(plan.relevantContext?.scene) || 'other',
    authorizedMeaning: input.primary?.meaning || null,
    garments: input.garments.slice(),
    allowedClaims: input.allowedClaims.slice(),
    cacheHit,
  };
}
function buildCacheKey(plan) { return `${plan.planHash}:${VOICE_RENDERER_CONTRACT_VERSION}:${VOICE_RENDERER_MODEL_ROUTE_VERSION}`; }
function writeCache(key, copy) {
  if (shadowCopyCache.has(key)) shadowCopyCache.delete(key);
  shadowCopyCache.set(key, { ...copy, cacheHit: false });
  while (shadowCopyCache.size > MAX_CACHE_ENTRIES) shadowCopyCache.delete(shadowCopyCache.keys().next().value);
}
function clearRecommendationVoiceRendererShadowCache() { shadowCopyCache.clear(); }
function buildFailOpenResult(error, input = {}) {
  return {
    version: RECOMMENDATION_VOICE_RENDERER_SHADOW_VERSION,
    status: 'failed_open',
    contractVersion: VOICE_RENDERER_CONTRACT_VERSION,
    modelRouteVersion: VOICE_RENDERER_MODEL_ROUTE_VERSION,
    model: VOICE_RENDERER_MODEL,
    executionMode: input.mode === 'batch' ? 'batch' : 'single',
    planCount: readArray(input.plans).length,
    renderedCount: 0,
    shadowFailureCount: 1,
    failureCodes: { [readErrorCode(error)]: 1 },
    cacheHitCount: 0,
    cacheMissCount: readArray(input.plans).length,
    requestCount: 0,
    latencyMs: 0,
    providerLatencyMs: 0,
    usage: sanitizeUsage(),
    automatedContract: { passCount: 0, failCount: readArray(input.plans).length, failureCounts: { SHADOW_FAIL_OPEN: 1 } },
    planIdentities: [],
    ...(input.includeReview ? { reviewSamples: [] } : {}),
  };
}
function toPlanIdentity(copy) { return { planHash: copy.planHash, contractVersion: VOICE_RENDERER_CONTRACT_VERSION, modelRouteVersion: VOICE_RENDERER_MODEL_ROUTE_VERSION, cacheHit: copy.cacheHit }; }
function toReviewSample(copy) { return { anonymousCaseId: shortHash(copy.planHash), planHash: copy.planHash, insightIdHash: shortHash(copy.insightId || 'baseline'), expressionMode: copy.expressionMode, primaryInsightCode: copy.primaryInsightCode, sceneCategory: copy.sceneCategory, authorizedMeaning: copy.authorizedMeaning, garments: copy.garments.slice(), allowedClaims: copy.allowedClaims.slice(), text: copy.text, cacheHit: copy.cacheHit }; }
function samePlanSet(left, right) { return readArray(left).map((entry) => entry.planHash).sort().join('|') === readArray(right).map((entry) => entry.planHash).sort().join('|'); }
function isBatchQualityNotDegraded(single, batch) {
  return batch?.status === 'completed'
    && batch?.automatedContract?.failCount <= single?.automatedContract?.failCount
    && samePlanSet(single?.reviewSamples, batch?.reviewSamples);
}
function countExactTextAgreement(single, batch) {
  const byPlan = new Map(readArray(batch).map((entry) => [entry.planHash, entry.text]));
  return readArray(single).filter((entry) => byPlan.get(entry.planHash) === entry.text).length;
}
function validateShadowCopy(copy, input, allInputs = []) {
  const failures = [];
  const text = readText(copy?.text);
  if (!input.garments.some((garment) => text.includes(garment))) failures.push('GARMENT_GROUNDING');
  if (PERSONA_FAILURE_TERMS.some((term) => text.includes(term))) failures.push('PERSONA_OR_EDITORIAL_LANGUAGE');
  if (UNSUPPORTED_FACT_TERMS.some((term) => text.includes(term))) failures.push('UNSUPPORTED_FACT');
  const ownGarments = new Set(input.garments);
  const foreignGarments = [...new Set(readArray(allInputs).flatMap((entry) => readArray(entry?.garments)))]
    .filter((garment) => !ownGarments.has(garment))
    .filter((garment) => ![...ownGarments].some((own) => garment.includes(own) || own.includes(garment)));
  if (foreignGarments.some((garment) => text.includes(garment))) failures.push('CROSS_PLAN_CONTAMINATION');
  if (input.expressionMode === 'baseline') {
    if (!['简单', '日常', '基础', '直接', '普通', '利落'].some((term) => text.includes(term))) failures.push('BASELINE_RESTRAINT');
  } else {
    const groups = meaningGroups(input.primary?.insightId, input.primary?.meaning);
    for (const group of groups) if (!group.some((term) => text.includes(term))) failures.push('MEANING_NOT_PRESERVED');
  }
  return { pass: failures.length === 0, failures: [...new Set(failures)] };
}
function meaningGroups(insightId, meaning) {
  const code = readText(insightId).split(':')[0];
  const byCode = {
    PATTERN_FOCUS: [['图案', '条纹', '印花', '花纹'], ['重点', '简单']],
    DETAIL_FOCUS: [['细节', '设计'], ['重点', '简单']],
    COLOR_FOCUS: [['颜色', '色彩'], ['重点', '简单']],
    COLOR_UNITY: [['颜色', '色系', '同色'], ['统一', '呼应', '协调']],
    SILHOUETTE_CONTRAST: [['一紧一松', '修身'], ['轮廓', '阔腿', '宽松']],
    PROPORTION_LAYERING: [['长短', '层次', '比例']],
    WEATHER_LAYERING: [['温度', '天气', '层次']],
    SCENE_WORK_STRUCTURED_SET: [['上班', '通勤'], ['完整', '清楚']],
    SCENE_WORK_SIMPLE_ONEPIECE: [['上班', '通勤'], ['简洁', '明确']],
    SCENE_SPORT_PURPOSE_SET: [['运动'], ['明确', '完整']],
    SCENE_SPORT_LIGHT_ACTIVITY: [['运动', '活动'], ['轻量', '日常']],
  };
  return byCode[code] || [[...new Set(readText(meaning).match(/[\u4e00-\u9fff]{2,4}/g) || [])].slice(0, 1)];
}
function countValues(values) {
  return values.reduce((counts, value) => ({
    ...counts,
    [value]: (counts[value] || 0) + 1,
  }), {});
}
function sanitizeUsage(usage = {}) { return { promptTokens: Number(usage.prompt_tokens) || 0, completionTokens: Number(usage.completion_tokens) || 0, totalTokens: Number(usage.total_tokens) || 0, cachedTokens: Number(usage.prompt_tokens_details?.cached_tokens) || 0 }; }
function sumUsage(entries) { return entries.reduce((sum, entry) => ({ promptTokens: sum.promptTokens + entry.promptTokens, completionTokens: sum.completionTokens + entry.completionTokens, totalTokens: sum.totalTokens + entry.totalTokens, cachedTokens: sum.cachedTokens + entry.cachedTokens }), sanitizeUsage()); }
function chunk(values, size) { const groups = []; for (let index = 0; index < values.length; index += size) groups.push(values.slice(index, index + size)); return groups; }
function joinNames(values) { return values.length <= 1 ? values[0] : `${values.slice(0, -1).join('、')}和${values.at(-1)}`; }
function readGarmentName(item) { return limitText(item?.customName || item?.displayName || item?.subCategory || item?.subcategory || item?.name || item?.category || '单品', 32); }
function readItemId(item) { return readText(item?._id || item?.id || item?.clothingId || item?.itemId); }
function sceneLabel(value) { return ({ home: '居家', '居家': '居家', work: '上班', '上班': '上班', date: '约会', '约会': '约会', sport: '运动', '运动': '运动' })[readText(value).toLowerCase()] || ''; }
function limitText(value, max) { return [...readText(value)].slice(0, max).join(''); }
function shortHash(value) { return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 12); }
function readErrorCode(error) { return limitText(error?.businessCode || error?.code || error?.message || error?.name || 'VOICE_RENDERER_UNKNOWN', 80).replace(/[^A-Z0-9_:.-]/gi, '_'); }
function readText(value) { return typeof value === 'string' ? value.trim() : ''; }
function readArray(value) { return Array.isArray(value) ? value : []; }

module.exports = {
  RECOMMENDATION_VOICE_RENDERER_SHADOW_VERSION,
  authorizeRecommendationVoiceRendererBenchmark,
  buildRecommendationVoiceRendererExecution,
  buildRendererInputFromNarrativePlan,
  clearRecommendationVoiceRendererShadowCache,
  isRecommendationVoiceRendererShadowEnabled,
  readRecommendationVoiceRendererBenchmarkConfig,
  runRecommendationVoiceRendererBenchmarkV2Safely,
  runRecommendationVoiceRendererShadowV2,
  runRecommendationVoiceRendererShadowV2Safely,
};
