'use strict';
const { createFailureEnvelope, describeFailure, providerMetadata, emitAudit } = require('./firstCardObservability');

const fetch = require('node-fetch');
const { TextDecoder } = require('node:util');
const {
  VOICE_RENDERER_FLASH_MODEL,
} = require('./voiceRendererV2Contract');
const {
  buildRenderInputFingerprint,
  buildRecommendationVoiceMaterializationEntry,
  validateMeaningPreservation,
} = require('./recommendationVoiceRendererShadowV2');

const PRODUCTION_VERSION = 'recommendation-voice-renderer-production-v2.2';
const PROMPT_VARIANT = 'compressed-v2';
const PRODUCTION_PROMPT_VERSION = 'voice-contract-v2.0-compressed-v2-production-4';
const PRODUCTION_MODEL = VOICE_RENDERER_FLASH_MODEL;
const PRODUCTION_MODEL_ROUTE_VERSION = 'voice-renderer-model-route-v2-flash-compressed-v2-prompt4-stream';
const GENERATION_PARAMETERS = Object.freeze({
  temperature: 0.3, top_p: 0.8, max_tokens: 1200, stream: true, enable_thinking: false,
});
const PERSONA_FAILURE_TERMS = ['算法', '模型判断', '候选', '主洞察', '次要洞察', '视觉焦点', '视觉结构', '色彩关系', '轮廓关系', '搭配公式', '编辑感', '高级感拉满', '氛围感拉满', '绝绝子', '拿捏'];
const UNSUPPORTED_FACT_TERMS = ['显瘦', '显高', '显腿长', '显白', '修饰身材', '遮肉', '透气', '保暖', '舒适', '柔软', '省心', '不用想', '百搭', '显精神'];

function readText(value) { return typeof value === 'string' ? value.trim() : ''; }
function readArray(value) { return Array.isArray(value) ? value : []; }
function compressedSystemPrompt() {
  return [
    '你是小搭，像熟悉用户衣橱的朋友，表达自然、克制、有判断。穿搭和语义已由 Narrative Plan 决定，你只负责改写，不能重新搭配。',
    '每项 m 是唯一获准表达的意思；m=null 时只诚实说这套简单日常。g 是可用衣物名。不得增加第二个分析点、理由、事实、效果或衣物。',
    '禁止推断身体效果、体感、材质、天气、偏好或便利性；禁止算法腔、报告腔、杂志腔、营销流行语。通常一句，最多两句短句。',
    '只返回 JSON 对象：{"copies":[{"id":"原样复制输入id","text":"中文文案"}]}。不得增加字段、Markdown 或解释。',
    '逐项独立按 id 对应：每条只依据自己的 m 和 g，不借用其他项；至少自然提及本项 g 中的一个衣物名。m=null 或证据弱时也要以本项衣物关系落地，不得只写泛化套话。',
    'm 非空时须完整保留其中的核心关系，不得只改写一半；轮廓关系可直接写“上衣和下装一紧一松，轮廓有了对比”，不要写“上衣收紧”。m=null 时必须原样写出 g 中至少一个衣物名，禁止只写“这套简单日常”。每条写成完整句并以句号结尾。',
    '按输入顺序逐项完成输出，先完成 id=1 再继续其余项。',
  ].join('\n');
}
function buildProductionRequest(entries, { model = PRODUCTION_MODEL } = {}) {
  const inputs = entries.map((entry, index) => ({
    id: String(index + 1),
    m: entry.input?.primary?.meaning || null,
    g: readArray(entry.input?.garments),
  }));
  return {
    model,
    ...GENERATION_PARAMETERS,
    stream_options: { include_usage: true },
    response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: compressedSystemPrompt() }, { role: 'user', content: JSON.stringify(inputs) }],
  };
}

function extractCompleteCopies(source) {
  const text = readText(source);
  const start = text.indexOf('"copies"');
  if (start < 0) return [];
  const arrayStart = text.indexOf('[', start);
  if (arrayStart < 0) return [];
  const result = []; let objectStart = -1; let depth = 0; let quoted = false; let escaped = false;
  for (let index = arrayStart + 1; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; continue; }
    if (char === '"') { quoted = true; continue; }
    if (char === '{') { if (depth === 0) objectStart = index; depth += 1; }
    if (char === '}') { depth -= 1; if (depth === 0 && objectStart >= 0) { try { const value = JSON.parse(text.slice(objectStart, index + 1)); if (readText(value.id) && readText(value.text)) result.push({ ...value, id: readText(value.id), text: readText(value.text) }); } catch {} objectStart = -1; } }
    if (char === ']' && depth === 0) break;
  }
  return result;
}
function validateProductionCopy(copy, input, allInputs) {
  const failures = []; const text = readText(copy?.text);
  if (Object.keys(copy || {}).sort().join(',') !== 'id,text') failures.push('OUTPUT_CONTRACT');
  if (!text || [...text].length > 72) failures.push('OUTPUT_TEXT');
  if ((text.match(/[。！？!?]/g) || []).length > 2) failures.push('MAX_SENTENCES');
  if (!readText(copy?.id)) failures.push('OUTPUT_ID');
  if (!readArray(input?.garments).some((garment) => text.includes(garment))) failures.push('GARMENT_GROUNDING');
  if (PERSONA_FAILURE_TERMS.some((term) => text.includes(term))) failures.push('PERSONA_OR_EDITORIAL_LANGUAGE');
  if (UNSUPPORTED_FACT_TERMS.some((term) => text.includes(term))) failures.push('UNSUPPORTED_FACT');
  const own = new Set(readArray(input?.garments));
  const foreign = [...new Set(readArray(allInputs).flatMap((entry) => readArray(entry?.input?.garments)))].filter((garment) => !own.has(garment)).filter((garment) => ![...own].some((item) => garment.includes(item) || item.includes(garment)));
  if (foreign.some((garment) => text.includes(garment))) failures.push('CROSS_PLAN_CONTAMINATION');
  if (input?.expressionMode === 'baseline' && !['简单', '日常', '基础', '直接', '普通', '利落'].some((term) => text.includes(term))) failures.push('BASELINE_RESTRAINT');
  if (input?.expressionMode === 'primary') failures.push(...validateMeaningPreservation(
    input.primary?.insightId,
    input.primary?.meaning,
    text,
  ));
  return { pass: failures.length === 0, failures: [...new Set(failures)] };
}
function parseSseLine(line) {
  const value = line.startsWith('data:') ? line.slice(5).trim() : '';
  if (!value) return { kind: 'ignored' };
  if (value === '[DONE]') return { kind: 'done' };
  try { return { kind: 'event', event: JSON.parse(value) }; } catch { return { kind: 'parse_error' }; }
}
function chunkByteLength(chunk) {
  if (typeof chunk === 'string') return Buffer.byteLength(chunk);
  if (Buffer.isBuffer(chunk) || ArrayBuffer.isView(chunk)) return chunk.byteLength;
  if (chunk instanceof ArrayBuffer) return chunk.byteLength;
  return Buffer.byteLength(String(chunk));
}
function decodeStreamChunk(chunk, decoder, decoderState) {
  if (typeof chunk === 'string') {
    const prefix = decoderState.active ? decoder.decode() : '';
    decoderState.active = false;
    return prefix + chunk;
  }
  if (Buffer.isBuffer(chunk) || ArrayBuffer.isView(chunk)) {
    decoderState.active = true;
    return decoder.decode(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength), { stream: true });
  }
  if (chunk instanceof ArrayBuffer) {
    decoderState.active = true;
    return decoder.decode(new Uint8Array(chunk), { stream: true });
  }
  return String(chunk);
}
async function renderRecommendationVoiceRendererProductionV2({ preparedEntries = [], misses, onValidated = async () => {}, onInvalid = async () => {}, failureContext = {}, onAuditStage, apiKey = process.env.BAILIAN_API_KEY || process.env.DASHSCOPE_API_KEY, baseUrl = process.env.BAILIAN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1', fetchImpl = fetch, invoke, timeoutMs = 25000, stopAfterAllValidated = false, model = PRODUCTION_MODEL, modelRouteVersion = PRODUCTION_MODEL_ROUTE_VERSION } = {}) {
  const entries = readArray(misses === undefined ? preparedEntries : misses);
  if (entries.length === 0) return { version: PRODUCTION_VERSION, status: 'noop', promptVariant: PROMPT_VARIANT, planCount: 0, providerCalls: 0, requestCount: 0, validatedCount: 0, invalidCount: 0 };
  if (entries.length > 8) throw new Error('VOICE_RENDERER_INPUT_COUNT');
  const normalized = entries.map((entry) => ({ ...entry, renderInputFingerprint: entry.renderInputFingerprint || buildRenderInputFingerprint(entry.input, { model, modelRouteVersion, generationParameters: GENERATION_PARAMETERS }) }));
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs); let response; let raw = ''; let content = ''; const seen = new Set(); const validated = []; const invalid = []; let usage = null;
  const decoder = new TextDecoder(); const decoderState = { active: false };
  const stream = { chunkCount: 0, firstChunkBytes: 0, lastChunkBytes: 0, rawLength: 0, finishReason: null, doneReceived: false, parseErrorCount: 0, errorEventCount: 0 };
  let streamFailureProvider = null;
  let validatedEarlyStop = false;
  const consumeLine = async (line) => {
    const parsed = parseSseLine(line);
    if (parsed.kind === 'ignored') return;
    if (parsed.kind === 'done') { stream.doneReceived = true; return; }
    if (parsed.kind === 'parse_error') { stream.parseErrorCount += 1; return; }
    const event = parsed.event;
    const finishReason = event?.choices?.[0]?.finish_reason;
    if (typeof finishReason === 'string' && finishReason) stream.finishReason = finishReason;
    if (event?.error) {
      stream.errorEventCount += 1;
      const errorCode = event.error.code ?? event.error.error_code;
      streamFailureProvider = providerMetadata(response, {
        model,
        errorCode: typeof errorCode === 'number' && Number.isFinite(errorCode) ? String(errorCode) : errorCode || null,
        requestId: event.request_id || event.requestId || event.error.request_id || providerMetadata(response).requestId,
      });
      throw new Error(`VOICE_RENDERER_PROVIDER_STREAM_ERROR:${readText(event.error.code) || 'unknown'}`);
    }
    const delta = event?.choices?.[0]?.delta?.content;
    if (typeof delta === 'string') content += delta;
    if (event?.usage) usage = event.usage;
    const copies = extractCompleteCopies(content);
    for (const copy of copies) {
      if (seen.has(copy.id)) continue;
      seen.add(copy.id);
      emitAudit(onAuditStage, 'FIRST_COMPLETE_CANDIDATE', 'extracted');
      const index = Number(copy.id) - 1; const entry = normalized[index];
      if (!entry || String(index + 1) !== copy.id) { const issue = { copy, error: 'VOICE_RENDERER_OUTPUT_PLAN_BINDING' }; invalid.push(issue); await onInvalid(issue); continue; }
      const check = validateProductionCopy(copy, entry.input, normalized);
      if (!check.pass) { const issue = { copy, entry, failures: check.failures }; invalid.push(issue); await onInvalid(issue); continue; }
      const materialized = { ...copy, planId: entry.plan?.planId || entry.input?.planId, input: entry.input, renderInputFingerprint: entry.renderInputFingerprint };
      validated.push(materialized);
      emitAudit(onAuditStage, 'FIRST_VALIDATED', 'accepted');
      await onValidated(materialized);
    }
  };
  let providerResponseReceived = false;
  try {
    const request = buildProductionRequest(normalized, { model });
    response = invoke
      ? await invoke({ apiKey, baseUrl, request, signal: controller.signal })
      : await fetchImpl(`${baseUrl.replace(/\/$/, '')}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey || ''}` }, body: JSON.stringify(request), signal: controller.signal });
    providerResponseReceived = true;
    if (!response || Number(response.status) >= 400) throw new Error(`VOICE_RENDERER_PROVIDER_HTTP:${response?.status || 'unknown'}`);
    providerStream: for await (const chunk of response.body || []) {
      const bytes = chunkByteLength(chunk);
      stream.chunkCount += 1;
      stream.firstChunkBytes ||= bytes;
      stream.lastChunkBytes = bytes;
      stream.rawLength += bytes;
      raw += decodeStreamChunk(chunk, decoder, decoderState);
      const lines = raw.split(/\r?\n/); raw = lines.pop() || '';
      for (const line of lines) {
        await consumeLine(line);
        if (stopAfterAllValidated && validated.length === normalized.length) {
          validatedEarlyStop = true;
          break providerStream;
        }
      }
    }
    if (!validatedEarlyStop) {
      if (decoderState.active) raw += decoder.decode();
      if (raw) await consumeLine(raw);
    }
  } catch (error) {
    const failure = describeFailure(error, failureContext, {
      stage: providerResponseReceived ? 'stream_read' : 'request',
      provider: streamFailureProvider || providerMetadata(response, { model }),
      providerStreamError: streamFailureProvider !== null,
      rendererTimedOut: controller.signal.aborted,
      abortReason: controller.signal.reason,
    });
    if (providerResponseReceived) emitAudit(onAuditStage, 'PROVIDER_COMPLETE', 'failed', { failure });
    emitAudit(onAuditStage, 'STREAM_COMPLETE', 'failed', { failure });
    return { version: PRODUCTION_VERSION, status: 'failed_open', promptVariant: PROMPT_VARIANT, planCount: normalized.length, providerCalls: 1, requestCount: 1, validatedCount: validated.length, invalidCount: invalid.length, stream, failureCode: error.name === 'AbortError' ? 'VOICE_RENDERER_TIMEOUT' : String(error.message || error), ...(failure ? { failure } : {}) };
  } finally { clearTimeout(timer); }
  const incomplete = validated.length !== normalized.length;
  let failure;
  if (incomplete) {
    const validatorCodes = invalid.flatMap((issue) => issue.failures || [issue.error]).filter(Boolean);
    const structural = new Set(['OUTPUT_CONTRACT', 'OUTPUT_TEXT', 'OUTPUT_ID', 'VOICE_RENDERER_OUTPUT_PLAN_BINDING']);
    let parseFailed = stream.parseErrorCount > 0;
    // Inspect only already-buffered output, after the existing failed outcome.
    // A partial JSON suffix remains OUTPUT_INCOMPLETE; no new reject condition.
    if (content.trim() && /[}\]]$/.test(content.trim())) {
      try { JSON.parse(content); } catch { parseFailed = true; }
    }
    const provider = providerMetadata(response, { model });
    if (provider.httpStatus >= 400) {
      failure = describeFailure(new Error('VOICE_RENDERER_STREAM_INCOMPLETE'), failureContext, { provider });
    } else {
      failure = createFailureEnvelope(new Error('VOICE_RENDERER_STREAM_INCOMPLETE'), failureContext, {
        stage: invalid.length ? 'validation' : 'output_parse',
        code: invalid.length ? 'VALIDATION_REJECTED' : parseFailed ? 'OUTPUT_PARSE_FAILED' : 'OUTPUT_INCOMPLETE',
        retryability: 'unknown', providerIssue: invalid.length ? 'no' : 'unknown',
        businessRejected: validatorCodes.some((code) => !structural.has(code)) ? 'yes' : 'no',
        deadline: { causedFailure: 'no', source: null }, provider, validatorCodes,
      });
    }
  }
  emitAudit(onAuditStage, 'PROVIDER_COMPLETE', incomplete ? 'failed' : 'completed', failure ? { failure } : {});
  emitAudit(onAuditStage, 'STREAM_COMPLETE', incomplete ? 'failed' : 'completed', failure ? { failure } : {});
  return { version: PRODUCTION_VERSION, status: incomplete ? 'failed_open' : 'completed', promptVariant: PROMPT_VARIANT, planCount: normalized.length, providerCalls: 1, requestCount: 1, validatedCount: validated.length, invalidCount: invalid.length, validated, invalid, usage, stream, ...(incomplete ? { failureCode: 'VOICE_RENDERER_STREAM_INCOMPLETE', ...(failure ? { failure } : {}) } : {}) };
}

function buildProductionRendererEntry(plan, recommendation, position, outfitKey, observer, rendererOptions = {}) {
  const preparedEntry = buildRecommendationVoiceMaterializationEntry(plan, recommendation, observer);
  if (typeof observer === 'function') {
    try { observer('RENDERER_FINGERPRINT_START'); } catch { /* side-channel only */ }
  }
  const model = rendererOptions.model || PRODUCTION_MODEL;
  const modelRouteVersion = rendererOptions.modelRouteVersion || PRODUCTION_MODEL_ROUTE_VERSION;
  const renderInputFingerprint = buildRenderInputFingerprint(preparedEntry.input, { model, modelRouteVersion, generationParameters: GENERATION_PARAMETERS });
  if (typeof observer === 'function') {
    try { observer('RENDERER_FINGERPRINT_DONE'); } catch { /* side-channel only */ }
  }
  return { position, outfitKey, preparedEntry, renderInputFingerprint };
}
async function consumeProductionRendererStream(options = {}) {
  return renderRecommendationVoiceRendererProductionV2(options);
}
module.exports = {
  PRODUCTION_VERSION, PRODUCTION_RENDERER_VERSION: PRODUCTION_VERSION,
  PROMPT_VARIANT, PRODUCTION_PROMPT_VERSION, PRODUCTION_MODEL_ROUTE_VERSION,
  PRODUCTION_MODEL, GENERATION_PARAMETERS,
  buildProductionRequest, buildProductionRendererEntry, extractCompleteCopies,
  validateProductionCopy, buildRecommendationVoiceMaterializationEntry,
  renderRecommendationVoiceRendererProductionV2, consumeProductionRendererStream,
};
