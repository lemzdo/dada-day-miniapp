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
    structuredOutput: event.promptVariant === 'current' ? 'strict_json_array' : 'json_object',
    requestChars: Buffer.byteLength(JSON.stringify(request), 'utf8'), promptChars: request.messages.reduce((sum, message) => sum + message.content.length, 0),
    callsExecuted: 0, providerCall: 'disabled_without_execute_flag',
  };
}

async function executeProvider(event, apiKey, fetchImpl = require('node-fetch')) {
  if (!apiKey) throw Object.assign(new Error('LAB_CREDENTIAL_MISSING'), { code: 'LAB_CREDENTIAL_MISSING' });
  const batchCases = event.batch ? event.cases : null;
  const request = buildRequest(batchCases ? { ...event, inputs: batchCases.map((entry) => entry.input) } : event);
  const started = process.hrtime.bigint();
  const response = await fetchImpl(`${process.env.BAILIAN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1'}/chat/completions`, {
    method: 'POST', timeout: 120000, headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(request),
  });
  if (event.stream === true) return consumeStream(response, request, batchCases || [{ caseId: event.caseId, input: event.input }], event, started, Boolean(batchCases));
  const bodyText = await response.text();
  let body;
  try { body = JSON.parse(bodyText); } catch { throw new Error('PROVIDER_JSON'); }
  const e2eLatencyMs = elapsedMs(started);
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
    structuredOutput: event.promptVariant === 'current' ? 'strict_json_array' : 'json_object',
    requestChars: Buffer.byteLength(JSON.stringify(request), 'utf8'), promptChars: request.messages.reduce((sum, message) => sum + message.content.length, 0),
    inputChars: request.messages[1].content.length, outputChars: typeof rawContent === 'string' ? rawContent.length : 0,
    promptTokens: Number(body.usage?.prompt_tokens) || null, completionTokens: Number(body.usage?.completion_tokens) || null,
    e2eLatencyMs, providerLatencyMs: e2eLatencyMs, parserPass: true, contractPass: true,
    validatorPass: canonicalCopies.every((entry) => entry.validatorPass), factualViolation: canonicalCopies.some((entry) => entry.factualViolation), personaNaturalness: canonicalCopies.every((entry) => entry.personaNaturalness),
    retryCount: 0, outputCount: canonicalCopies.length, canonicalCopies, ...(batchCases ? {} : { canonicalCopy: result.canonicalCopy, validatorFailures: result.validatorFailures }),
  };
}

async function consumeStream(response, request, batchCases, event, started, isBatch = true) {
  if (!response.ok) throw new Error(`PROVIDER_HTTP_${response.status}`);
  if (!response.body || typeof response.body[Symbol.asyncIterator] !== 'function') throw Object.assign(new Error('STREAM_BODY_UNSUPPORTED'), { code: 'STREAM_BODY_UNSUPPORTED' });
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let firstOutputMs = null;
  const validated = [];
  let usage = null;
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let eventBody;
      try { eventBody = JSON.parse(payload); } catch { continue; }
      if (eventBody.usage) usage = eventBody.usage;
      const delta = eventBody.choices?.[0]?.delta?.content;
      if (typeof delta !== 'string') continue;
      content += delta;
      if (firstOutputMs === null && delta.length > 0) firstOutputMs = elapsedMs(started);
      const copies = extractCompleteCopies(content);
      for (const copy of copies) {
        if (validated.some((item) => item.id === copy.id)) continue;
        const index = Number(copy.id) - 1;
        if (!Number.isInteger(index) || index < 0 || !batchCases?.[index]) continue;
        // The existing single-item compressed contract intentionally requires id=1;
        // normalize the request-local frame id while retaining the batch index binding.
        const parseableMs = elapsedMs(started);
        const parsed = parseAndValidate(JSON.stringify({ copies: [{ ...copy, id: '1' }] }), event.promptVariant, batchCases[index].input, batchCases[index].caseId);
        validated.push({ id: copy.id, result: parsed, parseableMs, validatedMs: elapsedMs(started) });
      }
    }
  }
  const allStreamCompleteMs = elapsedMs(started);
  const allResults = isBatch
    ? parseAndValidateBatch(content, event.promptVariant, batchCases)
    : [{ caseId: batchCases[0].caseId, result: parseAndValidate(content, event.promptVariant, batchCases[0].input, batchCases[0].caseId) }];
  const allValidatedMs = elapsedMs(started);
  const canonicalCopies = allResults.map((entry) => ({ caseId: entry.caseId, ...entry.result }));
  const expectedCount = batchCases.length;
  const first = validated.find((entry) => entry.id === '1');
  const second = validated.find((entry) => entry.id === '2');
  return {
    benchmarkOnly: true, action: ACTION, status: 'completed', ...(isBatch ? { batch: true } : { caseId: batchCases[0].caseId }),
    caseIds: batchCases.map((entry) => entry.caseId), model: request.model, promptVariant: event.promptVariant,
    nonThinking: request.enable_thinking === false, streamSupported: true, streamFormat: 'SSE:data JSON delta.content; final JSON object copies[]',
    structuredOutput: 'json_object', requestChars: Buffer.byteLength(JSON.stringify(request), 'utf8'),
    promptChars: request.messages.reduce((sum, message) => sum + message.content.length, 0), inputChars: request.messages[1].content.length,
    outputChars: content.length, promptTokens: Number(usage?.prompt_tokens) || null, completionTokens: Number(usage?.completion_tokens) || null,
    T0_REQUEST_SENT: 0, TTFT_MS: firstOutputMs, FIRST_ITEM_PARSEABLE_MS: first?.parseableMs || null,
    FIRST_ITEM_VALIDATED_MS: first?.validatedMs || null, SECOND_ITEM_VALIDATED_MS: second?.validatedMs || null,
    ALL_8_STREAM_COMPLETE_MS: allStreamCompleteMs, ALL_8_VALIDATED_MS: allValidatedMs,
    parserPass: true, parserPassCount: `${canonicalCopies.length}/${expectedCount}`, contractPass: true, contractPassCount: `${canonicalCopies.length}/${expectedCount}`, validatorPass: canonicalCopies.every((entry) => entry.validatorPass), validatorPassCount: `${canonicalCopies.filter((entry) => entry.validatorPass).length}/${expectedCount}`,
    factualViolation: canonicalCopies.some((entry) => entry.factualViolation), personaNaturalness: canonicalCopies.every((entry) => entry.personaNaturalness),
    factualFailures: canonicalCopies.filter((entry) => entry.factualViolation).length,
    personaFailures: canonicalCopies.filter((entry) => !entry.personaNaturalness).length,
    metaLanguageFailures: canonicalCopies.reduce((sum, entry) => sum + (entry.validatorFailures?.filter((failure) => failure === 'PERSONA_OR_EDITORIAL_LANGUAGE').length || 0), 0),
    retryCount: 0, outputCount: canonicalCopies.length, canonicalCopies,
  };
}

function extractCompleteCopies(source) {
  const start = source.indexOf('"copies"');
  if (start < 0) return [];
  const arrayStart = source.indexOf('[', start);
  if (arrayStart < 0) return [];
  const result = [];
  for (let i = arrayStart + 1; i < source.length; i += 1) {
    if (source[i] !== '{') continue;
    let depth = 0; let quoted = false; let escaped = false;
    for (let j = i; j < source.length; j += 1) {
      const char = source[j];
      if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; continue; }
      if (char === '"') { quoted = true; continue; }
      if (char === '{') depth += 1;
      if (char === '}') depth -= 1;
      if (depth === 0) { try { const parsed = JSON.parse(source.slice(i, j + 1)); if (parsed && typeof parsed.id === 'string' && typeof parsed.text === 'string') result.push(parsed); } catch { /* incomplete frame */ } i = j; break; }
    }
  }
  return result;
}

function elapsedMs(started) { return Number(process.hrtime.bigint() - started) / 1e6; }

function assertEvent(event) {
  const allowed = new Set(['caseId', 'model', 'promptVariant', 'input', 'execute', 'batch', 'cases', 'stream', 'sequencing', 'tcbContext', 'userInfo']);
  for (const key of Object.keys(event || {})) if (!allowed.has(key)) throw new Error(`EVENT_KEY_NOT_ALLOWED:${key}`);
  if (event.batch === true) {
    if (event.model !== 'max' || !['compressed', 'compressed-v2'].includes(event.promptVariant)) throw new Error('BATCH_ROUTE_FIXED_TO_MAX_COMPRESSED');
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
  if (event.stream !== undefined && typeof event.stream !== 'boolean') throw new Error('STREAM_FLAG');
  if (event.sequencing !== undefined && typeof event.sequencing !== 'boolean') throw new Error('SEQUENCING_FLAG');
}

function safeErrorCode(error) {
  const code = typeof error?.code === 'string' ? error.code : String(error?.message || 'LAB_FAILED');
  return code.replace(/[^A-Z0-9_.:-]/gi, '_').slice(0, 80);
}

exports.__test = { ACTION, MODELS, PROMPT_VARIANTS, CASE_IDS, assertEvent, executeProvider, extractCompleteCopies };
