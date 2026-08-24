'use strict';

const fetch = require('node-fetch');
const {
  VOICE_RENDERER_MODEL,
} = require('./voiceRendererV2Contract');
const {
  buildRenderInputFingerprint,
  buildRecommendationVoiceMaterializationEntry,
  validateMeaningPreservation,
} = require('./recommendationVoiceRendererShadowV2');

const PRODUCTION_VERSION = 'recommendation-voice-renderer-production-v2.1';
const PROMPT_VARIANT = 'compressed-v2';
const PRODUCTION_PROMPT_VERSION = 'voice-contract-v2.0-compressed-v2-production-1';
const PRODUCTION_MODEL_ROUTE_VERSION = 'voice-renderer-model-route-v2-max-compressed-v2-stream';
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
    '按输入顺序逐项完成输出，先完成 id=1 再继续其余项。',
  ].join('\n');
}
function buildProductionRequest(entries) {
  const inputs = entries.map((entry, index) => ({
    id: String(index + 1),
    m: entry.input?.primary?.meaning || null,
    g: readArray(entry.input?.garments),
  }));
  return {
    model: VOICE_RENDERER_MODEL,
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
function parseSseLine(line) { const value = line.startsWith('data:') ? line.slice(5).trim() : ''; if (!value || value === '[DONE]') return null; try { return JSON.parse(value); } catch { return null; } }
async function renderRecommendationVoiceRendererProductionV2({ preparedEntries = [], misses, onValidated = async () => {}, onInvalid = async () => {}, apiKey = process.env.BAILIAN_API_KEY || process.env.DASHSCOPE_API_KEY, baseUrl = process.env.BAILIAN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1', fetchImpl = fetch, invoke, timeoutMs = 25000 } = {}) {
  const entries = readArray(misses === undefined ? preparedEntries : misses);
  if (entries.length === 0) return { version: PRODUCTION_VERSION, status: 'noop', promptVariant: PROMPT_VARIANT, planCount: 0, providerCalls: 0, requestCount: 0, validatedCount: 0, invalidCount: 0 };
  if (entries.length > 8) throw new Error('VOICE_RENDERER_INPUT_COUNT');
  const normalized = entries.map((entry) => ({ ...entry, renderInputFingerprint: entry.renderInputFingerprint || buildRenderInputFingerprint(entry.input, { model: VOICE_RENDERER_MODEL, modelRouteVersion: PRODUCTION_MODEL_ROUTE_VERSION, generationParameters: GENERATION_PARAMETERS }) }));
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs); let response; let raw = ''; let content = ''; const seen = new Set(); const validated = []; const invalid = []; let usage = null;
  try {
    const request = buildProductionRequest(normalized);
    response = invoke
      ? await invoke({ apiKey, baseUrl, request, signal: controller.signal })
      : await fetchImpl(`${baseUrl.replace(/\/$/, '')}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey || ''}` }, body: JSON.stringify(request), signal: controller.signal });
    if (!response || Number(response.status) >= 400) throw new Error(`VOICE_RENDERER_PROVIDER_HTTP:${response?.status || 'unknown'}`);
    for await (const chunk of response.body || []) {
      raw += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
      const lines = raw.split(/\r?\n/); raw = lines.pop() || '';
      for (const line of lines) {
        const event = parseSseLine(line); if (!event) continue;
        const delta = event.choices?.[0]?.delta?.content; if (typeof delta === 'string') content += delta;
        if (event.usage) usage = event.usage;
        const copies = extractCompleteCopies(content);
        for (const copy of copies) {
          if (seen.has(copy.id)) continue;
          seen.add(copy.id);
          const index = Number(copy.id) - 1; const entry = normalized[index];
          if (!entry || String(index + 1) !== copy.id) { const issue = { copy, error: 'VOICE_RENDERER_OUTPUT_PLAN_BINDING' }; invalid.push(issue); await onInvalid(issue); continue; }
          const check = validateProductionCopy(copy, entry.input, normalized);
          if (!check.pass) { const issue = { copy, entry, failures: check.failures }; invalid.push(issue); await onInvalid(issue); continue; }
          const materialized = { ...copy, planId: entry.plan?.planId || entry.input?.planId, input: entry.input, renderInputFingerprint: entry.renderInputFingerprint };
          validated.push(materialized); await onValidated(materialized);
        }
      }
    }
    if (raw) {
      const event = parseSseLine(raw); const delta = event?.choices?.[0]?.delta?.content;
      if (typeof delta === 'string') content += delta;
      if (event?.usage) usage = event.usage;
    }
  } catch (error) {
    return { version: PRODUCTION_VERSION, status: 'failed_open', promptVariant: PROMPT_VARIANT, planCount: normalized.length, providerCalls: 1, requestCount: 1, validatedCount: validated.length, invalidCount: invalid.length, failureCode: error.name === 'AbortError' ? 'VOICE_RENDERER_TIMEOUT' : String(error.message || error) };
  } finally { clearTimeout(timer); }
  return { version: PRODUCTION_VERSION, status: validated.length === normalized.length ? 'completed' : 'failed_open', promptVariant: PROMPT_VARIANT, planCount: normalized.length, providerCalls: 1, requestCount: 1, validatedCount: validated.length, invalidCount: invalid.length, validated, invalid, usage, ...(validated.length === normalized.length ? {} : { failureCode: 'VOICE_RENDERER_STREAM_INCOMPLETE' }) };
}

function buildProductionRendererEntry(plan, recommendation, position, outfitKey) {
  const preparedEntry = buildRecommendationVoiceMaterializationEntry(plan, recommendation);
  return { position, outfitKey, preparedEntry, renderInputFingerprint: buildRenderInputFingerprint(preparedEntry.input, { model: VOICE_RENDERER_MODEL, modelRouteVersion: PRODUCTION_MODEL_ROUTE_VERSION, generationParameters: GENERATION_PARAMETERS }) };
}
async function consumeProductionRendererStream(options = {}) {
  return renderRecommendationVoiceRendererProductionV2(options);
}
module.exports = {
  PRODUCTION_VERSION, PRODUCTION_RENDERER_VERSION: PRODUCTION_VERSION,
  PROMPT_VARIANT, PRODUCTION_PROMPT_VERSION, PRODUCTION_MODEL_ROUTE_VERSION,
  PRODUCTION_MODEL: VOICE_RENDERER_MODEL, GENERATION_PARAMETERS,
  buildProductionRequest, buildProductionRendererEntry, extractCompleteCopies,
  validateProductionCopy, buildRecommendationVoiceMaterializationEntry,
  renderRecommendationVoiceRendererProductionV2, consumeProductionRendererStream,
};
