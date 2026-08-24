'use strict';

const ACTION = 'voiceRendererLatencyLab';
const { MODELS, PROMPT_VARIANTS, buildRequest, parseAndValidate } = require('./renderer');
const CASE_IDS = new Set([
  'primary-pattern-focus', 'primary-silhouette-contrast', 'primary-monochromatic', 'scene-primary-work-structure',
  'weak-formality-only', 'sparse-low-confidence-pattern', 'sparse-basic-no-evidence', 'competing-pattern-and-silhouette',
]);

exports.main = async function main(event = {}) {
  try {
    assertEvent(event);
    const apiKey = process.env.BAILIAN_API_KEY || process.env.DASHSCOPE_API_KEY;
    if (!apiKey) throw Object.assign(new Error('LAB_CREDENTIAL_MISSING'), { code: 'LAB_CREDENTIAL_MISSING' });
    if (event.execute === true) return await executeProvider(event, apiKey);
    return readyResult(event);
  } catch (error) {
    return { benchmarkOnly: true, action: ACTION, status: 'failed', errorCode: safeErrorCode(error) };
  }
};

function readyResult(event) {
  const request = buildRequest(event);
  return {
    benchmarkOnly: true, action: ACTION, status: 'ready', caseId: event.caseId, model: request.model,
    promptVariant: event.promptVariant, nonThinking: true,
    structuredOutput: event.promptVariant === 'compressed' ? 'json_object' : 'strict_json_array',
    requestChars: Buffer.byteLength(JSON.stringify(request), 'utf8'), promptChars: request.messages.reduce((sum, message) => sum + message.content.length, 0),
    callsExecuted: 0, providerCall: 'disabled_without_execute_flag',
  };
}

async function executeProvider(event, apiKey, fetchImpl = require('node-fetch')) {
  if (!apiKey) throw Object.assign(new Error('LAB_CREDENTIAL_MISSING'), { code: 'LAB_CREDENTIAL_MISSING' });
  const request = buildRequest(event);
  const started = Date.now();
  const response = await fetchImpl(`${process.env.BAILIAN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1'}/chat/completions`, {
    method: 'POST', timeout: 120000, headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(request),
  });
  const bodyText = await response.text();
  let body;
  try { body = JSON.parse(bodyText); } catch { throw new Error('PROVIDER_JSON'); }
  const e2eLatencyMs = Date.now() - started;
  if (!response.ok) throw new Error(`PROVIDER_HTTP_${response.status}`);
  if (body?.model !== request.model) throw new Error('MODEL_MISMATCH');
  const rawContent = body?.choices?.[0]?.message?.content;
  const result = parseAndValidate(rawContent, event.promptVariant, event.input);
  return {
    benchmarkOnly: true, action: ACTION, status: 'completed', caseId: event.caseId, model: request.model,
    promptVariant: event.promptVariant, nonThinking: request.enable_thinking === false,
    structuredOutput: event.promptVariant === 'compressed' ? 'json_object' : 'strict_json_array',
    requestChars: Buffer.byteLength(JSON.stringify(request), 'utf8'), promptChars: request.messages.reduce((sum, message) => sum + message.content.length, 0),
    inputChars: request.messages[1].content.length, outputChars: typeof rawContent === 'string' ? rawContent.length : 0,
    promptTokens: Number(body.usage?.prompt_tokens) || null, completionTokens: Number(body.usage?.completion_tokens) || null,
    e2eLatencyMs, providerLatencyMs: e2eLatencyMs, parserPass: true, contractPass: result.contractPass,
    validatorPass: result.validatorPass, factualViolation: result.factualViolation, personaNaturalness: result.personaNaturalness,
    retryCount: 0, outputCount: 1,
  };
}

function assertEvent(event) {
  const allowed = new Set(['caseId', 'model', 'promptVariant', 'input', 'execute']);
  for (const key of Object.keys(event || {})) if (!allowed.has(key)) throw new Error(`EVENT_KEY_NOT_ALLOWED:${key}`);
  if (typeof event.caseId !== 'string' || !CASE_IDS.has(event.caseId)) throw new Error('CASE_ID_NOT_ALLOWED');
  if (!Object.hasOwn(MODELS, event.model)) throw new Error('MODEL_NOT_ALLOWED');
  if (!PROMPT_VARIANTS.includes(event.promptVariant)) throw new Error('PROMPT_VARIANT_NOT_ALLOWED');
  if (!event.input || typeof event.input !== 'object' || Array.isArray(event.input)) throw new Error('INPUT_OBJECT');
  if (event.execute !== undefined && event.execute !== true && event.execute !== false) throw new Error('EXECUTE_FLAG');
}

function safeErrorCode(error) {
  const code = typeof error?.code === 'string' ? error.code : String(error?.message || 'LAB_FAILED');
  return code.replace(/[^A-Z0-9_.:-]/gi, '_').slice(0, 80);
}

exports.__test = { ACTION, MODELS, PROMPT_VARIANTS, CASE_IDS, assertEvent, executeProvider };
