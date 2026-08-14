'use strict';

/* global __VOICE_RENDERER_V2_PROMPT_VERSION__, __VOICE_RENDERER_V2_INPUT_VERSION__, __VOICE_RENDERER_V2_PERSONA_VERSION__, __VOICE_RENDERER_V2_SYSTEM_PROMPT__, __VOICE_RENDERER_V2_MODEL_ALLOWLIST__, __VOICE_RENDERER_V2_GENERATION_PARAMETERS__ */

const crypto = require('node:crypto');

const ACTION = 'voiceRendererV2Benchmark';
const TOKEN_HASH = '__VOICE_RENDERER_V2_TOKEN_HASH__';
const PROMPT_VERSION = __VOICE_RENDERER_V2_PROMPT_VERSION__;
const INPUT_VERSION = __VOICE_RENDERER_V2_INPUT_VERSION__;
const PERSONA_VERSION = __VOICE_RENDERER_V2_PERSONA_VERSION__;
const SYSTEM_PROMPT = __VOICE_RENDERER_V2_SYSTEM_PROMPT__;
const MODEL_ALLOWLIST = Object.freeze(__VOICE_RENDERER_V2_MODEL_ALLOWLIST__);
const GENERATION_PARAMETERS = Object.freeze(__VOICE_RENDERER_V2_GENERATION_PARAMETERS__);
const EVENT_KEYS = new Set([
  'action', 'benchmarkToken', 'modelAlias', 'promptVersion', 'inputVersion', 'inputs',
  'tcbContext', 'userInfo',
]);
const INPUT_KEYS = new Set([
  'inputVersion', 'planId', 'task', 'surface', 'personaVersion', 'expressionMode',
  'primary', 'garments', 'allowedClaims', 'scene', 'languageConstraints',
]);
const PRIMARY_KEYS = new Set(['insightId', 'meaning', 'subjectGarments']);
const LANGUAGE_KEYS = new Set([
  'locale', 'maxSentences', 'friendLike', 'admitSimpleWhenBaseline', 'noNewMeaning', 'noNewFacts',
]);
const FORBIDDEN_KEYS = new Set([
  'candidates', 'candidateSet', 'scores', 'secondary', 'selectedSecondary', 'weatherSnapshot',
  'profile', 'legacyCopy', 'reason', 'reasoning', 'todayReason', 'detailExplanation',
  'stylingConclusionVoiceBank', 'wardrobe', 'clothes', 'userProfile',
]);

function assertRequest(event = {}) {
  assertExactKeys(event, EVENT_KEYS, 'EVENT');
  if (event.action !== ACTION) throw new Error('ACTION_INVALID');
  if (!authorized(event.benchmarkToken)) throw new Error('BENCHMARK_NOT_AUTHORIZED');
  if (!MODEL_ALLOWLIST[event.modelAlias]) throw new Error('MODEL_NOT_ALLOWED');
  if (event.promptVersion !== PROMPT_VERSION || event.inputVersion !== INPUT_VERSION) throw new Error('VERSION_MISMATCH');
  if (!Array.isArray(event.inputs) || event.inputs.length < 1 || event.inputs.length > 8) throw new Error('BATCH_SIZE');
  if (Buffer.byteLength(JSON.stringify(event.inputs), 'utf8') > 48 * 1024) throw new Error('PAYLOAD_TOO_LARGE');
  event.inputs.forEach(assertRendererInput);
  return event;
}

function assertRendererInput(input) {
  if (!isObject(input)) throw new Error('INPUT_OBJECT');
  assertExactKeys(input, INPUT_KEYS, 'INPUT');
  const forbidden = findForbiddenKeys(input);
  if (forbidden.length > 0) throw new Error(`FORBIDDEN_INPUT_KEYS:${forbidden.join(',')}`);
  if (input.inputVersion !== INPUT_VERSION) throw new Error('INPUT_VERSION');
  if (input.task !== 'render_canonical_recommendation_copy') throw new Error('TASK');
  if (input.surface !== 'today_and_detail') throw new Error('SURFACE');
  if (input.personaVersion !== PERSONA_VERSION) throw new Error('PERSONA_VERSION');
  if (!['primary', 'baseline'].includes(input.expressionMode)) throw new Error('EXPRESSION_MODE');
  assertText(input.planId, 'PLAN_ID', 512);
  assertStringArray(input.garments, 'GARMENTS', 1, 6, 64);
  assertStringArray(input.allowedClaims, 'ALLOWED_CLAIMS', 1, 6, 96);
  if (input.scene !== undefined) assertText(input.scene, 'SCENE', 24);
  if (input.expressionMode === 'baseline') {
    if (input.primary !== null) throw new Error('BASELINE_PRIMARY');
  } else {
    if (!isObject(input.primary)) throw new Error('PRIMARY_REQUIRED');
    assertExactKeys(input.primary, PRIMARY_KEYS, 'PRIMARY');
    assertText(input.primary.insightId, 'INSIGHT_ID', 768);
    assertText(input.primary.meaning, 'PRIMARY_MEANING', 320);
    assertStringArray(input.primary.subjectGarments, 'SUBJECT_GARMENTS', 1, 6, 64);
  }
  if (!isObject(input.languageConstraints)) throw new Error('LANGUAGE_CONSTRAINTS');
  assertExactKeys(input.languageConstraints, LANGUAGE_KEYS, 'LANGUAGE_CONSTRAINTS');
  const language = input.languageConstraints;
  if (language.locale !== 'zh-CN' || language.maxSentences !== 2) throw new Error('LANGUAGE_VALUES');
  for (const key of ['friendLike', 'admitSimpleWhenBaseline', 'noNewMeaning', 'noNewFacts']) {
    if (language[key] !== true) throw new Error(`LANGUAGE_FLAG:${key}`);
  }
}

async function runVoiceRendererV2Benchmark(event = {}) {
  assertRequest(event);
  const fetch = require('node-fetch');
  const apiKey = process.env.BAILIAN_API_KEY || process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error('PROVIDER_KEY_MISSING_IN_CLOUD');
  const baseUrl = process.env.BAILIAN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  const requestedModel = MODEL_ALLOWLIST[event.modelAlias];
  const startedAt = Date.now();
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    timeout: 120000,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: requestedModel,
      ...GENERATION_PARAMETERS,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(event.inputs) },
      ],
    }),
  });
  const ttftMs = Date.now() - startedAt;
  const rawBody = await response.text();
  let providerResponse;
  try { providerResponse = JSON.parse(rawBody); } catch { throw new Error(`PROVIDER_JSON:${response.status}`); }
  if (!response.ok) throw new Error(`PROVIDER_HTTP:${response.status}:${providerResponse?.error?.code || 'unknown'}`);
  if (providerResponse?.model !== requestedModel) throw new Error(`MODEL_MISMATCH:${providerResponse?.model || 'missing'}`);
  const outputs = parseOutputs(providerResponse?.choices?.[0]?.message?.content, event.inputs);
  return {
    benchmarkOnly: true,
    action: ACTION,
    promptVersion: PROMPT_VERSION,
    inputVersion: INPUT_VERSION,
    modelAlias: event.modelAlias,
    requestedModel,
    returnedModel: providerResponse.model,
    httpStatus: response.status,
    providerLatencyMs: Date.now() - startedAt,
    ttftMs,
    requestShape: {
      batchSize: event.inputs.length,
      temperature: GENERATION_PARAMETERS.temperature,
      topP: GENERATION_PARAMETERS.top_p,
      maxTokens: GENERATION_PARAMETERS.max_tokens,
      stream: GENERATION_PARAMETERS.stream,
      enableThinking: GENERATION_PARAMETERS.enable_thinking,
    },
    promptSha256: sha256(SYSTEM_PROMPT),
    inputSha256: sha256(stableStringify(event.inputs)),
    usage: sanitizeUsage(providerResponse.usage),
    outputs,
  };
}

function parseOutputs(rawText, inputs) {
  const text = typeof rawText === 'string' ? rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '') : '';
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error('OUTPUT_PARSE'); }
  if (!Array.isArray(parsed) || parsed.length !== inputs.length) throw new Error('OUTPUT_COMPLETENESS');
  const expected = new Map(inputs.map((input) => [input.planId, input.primary?.insightId || null]));
  const seen = new Set();
  return parsed.map((entry) => {
    if (!isObject(entry)) throw new Error('OUTPUT_OBJECT');
    assertExactKeys(entry, new Set(['planId', 'insightId', 'text']), 'OUTPUT');
    const planId = typeof entry.planId === 'string' ? entry.planId.trim() : '';
    if (!expected.has(planId) || seen.has(planId)) throw new Error('OUTPUT_PLAN_BINDING');
    seen.add(planId);
    if (entry.insightId !== expected.get(planId)) throw new Error('OUTPUT_INSIGHT_BINDING');
    assertText(entry.text, 'OUTPUT_TEXT', 240);
    return { planId, insightId: entry.insightId, text: entry.text.trim() };
  });
}

function authorized(token) {
  if (typeof token !== 'string') return false;
  const actual = Buffer.from(sha256(token), 'hex');
  const expected = Buffer.from(TOKEN_HASH, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function authorizeVoiceRendererV2BenchmarkToken(token) { return authorized(token); }

function sanitizeUsage(usage) {
  return {
    prompt_tokens: Number(usage?.prompt_tokens) || 0,
    completion_tokens: Number(usage?.completion_tokens) || 0,
    total_tokens: Number(usage?.total_tokens) || 0,
    prompt_tokens_details: {
      cached_tokens: Number(usage?.prompt_tokens_details?.cached_tokens) || 0,
    },
  };
}

function assertExactKeys(value, allowed, label) {
  for (const key of Object.keys(value || {})) if (!allowed.has(key)) throw new Error(`${label}_KEY_NOT_ALLOWED:${key}`);
}
function assertText(value, label, max) {
  if (typeof value !== 'string' || !value.trim() || [...value].length > max) throw new Error(label);
}
function assertStringArray(value, label, min, max, maxText) {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new Error(label);
  value.forEach((entry) => assertText(entry, label, maxText));
}
function findForbiddenKeys(value, path = '', found = []) {
  if (!value || typeof value !== 'object') return found;
  for (const [key, child] of Object.entries(value)) {
    const next = path ? `${path}.${key}` : key;
    if (FORBIDDEN_KEYS.has(key)) found.push(next);
    findForbiddenKeys(child, next, found);
  }
  return found;
}
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}
function sha256(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function isObject(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }

module.exports = {
  ACTION,
  assertRendererInput,
  assertRequest,
  authorizeVoiceRendererV2BenchmarkToken,
  parseOutputs,
  runVoiceRendererV2Benchmark,
};
