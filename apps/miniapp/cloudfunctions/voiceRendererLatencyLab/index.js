'use strict';

const ACTION = 'voiceRendererLatencyLab';
const { MODELS, PROMPT_VARIANTS, buildRequest, parseAndValidate, parseAndValidateBatch } = require('./renderer');
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
  const request = buildRequest(event.batch ? { ...event, inputs: event.cases.map((entry) => entry.input) } : event);
  return {
    benchmarkOnly: true, action: ACTION, status: 'ready', ...(event.batch ? { batch: true, caseIds: event.cases.map((entry) => entry.caseId) } : { caseId: event.caseId }), model: request.model,
    promptVariant: event.promptVariant, nonThinking: true,
    structuredOutput: event.promptVariant === 'compressed' ? 'json_object' : 'strict_json_array',
    requestChars: Buffer.byteLength(JSON.stringify(request), 'utf8'), promptChars: request.messages.reduce((sum, message) => sum + message.content.length, 0),
    callsExecuted: 0, providerCall: 'disabled_without_execute_flag',
  };
}

async function executeProvider(event, apiKey, fetchImpl = require('node-fetch')) {
  if (!apiKey) throw Object.assign(new Error('LAB_CREDENTIAL_MISSING'), { code: 'LAB_CREDENTIAL_MISSING' });
  const batchCases = event.batch ? event.cases : null;
  const request = buildRequest(batchCases ? { ...event, inputs: batchCases.map((entry) => entry.input) } : event);
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
  const batchResults = batchCases ? parseAndValidateBatch(rawContent, event.promptVariant, batchCases) : null;
  const result = batchResults ? null : parseAndValidate(rawContent, event.promptVariant, event.input, event.caseId);
  const canonicalCopies = batchResults
    ? batchResults.map((entry) => ({ caseId: entry.caseId, ...entry.result }))
    : [{ caseId: event.caseId, ...result }];
  return {
    benchmarkOnly: true, action: ACTION, status: 'completed', ...(batchCases ? { batch: true, caseIds: batchCases.map((entry) => entry.caseId) } : { caseId: event.caseId }), model: request.model,
    promptVariant: event.promptVariant, nonThinking: request.enable_thinking === false,
    structuredOutput: event.promptVariant === 'compressed' ? 'json_object' : 'strict_json_array',
    requestChars: Buffer.byteLength(JSON.stringify(request), 'utf8'), promptChars: request.messages.reduce((sum, message) => sum + message.content.length, 0),
    inputChars: request.messages[1].content.length, outputChars: typeof rawContent === 'string' ? rawContent.length : 0,
    promptTokens: Number(body.usage?.prompt_tokens) || null, completionTokens: Number(body.usage?.completion_tokens) || null,
    e2eLatencyMs, providerLatencyMs: e2eLatencyMs, parserPass: true, contractPass: true,
    validatorPass: canonicalCopies.every((entry) => entry.validatorPass), factualViolation: canonicalCopies.some((entry) => entry.factualViolation), personaNaturalness: canonicalCopies.every((entry) => entry.personaNaturalness),
    retryCount: 0, outputCount: canonicalCopies.length, canonicalCopies, ...(batchCases ? {} : { canonicalCopy: result.canonicalCopy, validatorFailures: result.validatorFailures }),
  };
}

function assertEvent(event) {
  const allowed = new Set(['caseId', 'model', 'promptVariant', 'input', 'execute', 'batch', 'cases', 'tcbContext', 'userInfo']);
  for (const key of Object.keys(event || {})) if (!allowed.has(key)) throw new Error(`EVENT_KEY_NOT_ALLOWED:${key}`);
  if (event.batch === true) {
    if (event.model !== 'max' || event.promptVariant !== 'compressed') throw new Error('BATCH_ROUTE_FIXED_TO_MAX_COMPRESSED');
    if (!Array.isArray(event.cases) || event.cases.length < 1 || event.cases.length > 8) throw new Error('BATCH_CASE_COUNT');
    const ids = new Set();
    event.cases.forEach((entry) => {
      if (!entry || typeof entry.caseId !== 'string' || !CASE_IDS.has(entry.caseId) || ids.has(entry.caseId)) throw new Error('BATCH_CASE_ID_NOT_ALLOWED');
      if (!entry.input || typeof entry.input !== 'object' || Array.isArray(entry.input)) throw new Error('BATCH_INPUT_OBJECT');
      ids.add(entry.caseId);
    });
  } else {
    if (typeof event.caseId !== 'string' || !CASE_IDS.has(event.caseId)) throw new Error('CASE_ID_NOT_ALLOWED');
  }
  if (!Object.hasOwn(MODELS, event.model)) throw new Error('MODEL_NOT_ALLOWED');
  if (!PROMPT_VARIANTS.includes(event.promptVariant)) throw new Error('PROMPT_VARIANT_NOT_ALLOWED');
  if (!event.batch && (!event.input || typeof event.input !== 'object' || Array.isArray(event.input))) throw new Error('INPUT_OBJECT');
  if (event.execute !== undefined && event.execute !== true && event.execute !== false) throw new Error('EXECUTE_FLAG');
}

function safeErrorCode(error) {
  const code = typeof error?.code === 'string' ? error.code : String(error?.message || 'LAB_FAILED');
  return code.replace(/[^A-Z0-9_.:-]/gi, '_').slice(0, 80);
}

exports.__test = { ACTION, MODELS, PROMPT_VARIANTS, CASE_IDS, assertEvent, executeProvider };
