'use strict';

const crypto = require('node:crypto');
const fetch = require('node-fetch');
const MODEL_ALLOWLIST = Object.freeze({ plus: 'qwen3.7-plus' });
const PROMPT_VERSION = 'xiaoda-today-voice-v2-dev4';
const BRIEF_SCHEMA_VERSION = 'xiaoda-styling-brief-v2';
const TOKEN_HASH = '__PHASE2_TOKEN_SHA256__';
const sha = (x) => crypto.createHash('sha256').update(String(x || '')).digest('hex');

function assertRequest(e = {}) {
  if (sha(e.benchmarkToken) !== TOKEN_HASH) throw Error('BENCHMARK_NOT_AUTHORIZED');
  if (e.modelAlias !== 'plus') throw Error('MODEL_NOT_ALLOWED');
  if (e.promptVersion !== PROMPT_VERSION || e.briefSchemaVersion !== BRIEF_SCHEMA_VERSION) throw Error('VERSION_MISMATCH');
  if (!Array.isArray(e.briefs) || e.briefs.length < 1 || e.briefs.length > 8) throw Error('BATCH_SIZE');
  if (typeof e.systemPrompt !== 'string' || e.systemPrompt.length < 100) throw Error('PROMPT_INVALID');
  for (const brief of e.briefs) {
    if (!brief || typeof brief.id !== 'string' || !brief.id) throw Error('BRIEF_ID_INVALID');
    if (brief.briefSchemaVersion !== BRIEF_SCHEMA_VERSION) throw Error('BRIEF_SCHEMA_INVALID');
  }
}

async function runXiaodaVoicePhase2Benchmark(e = {}) {
  assertRequest(e);
  const key = process.env.BAILIAN_API_KEY || process.env.DASHSCOPE_API_KEY;
  if (!key) throw Error('PROVIDER_KEY_MISSING');
  const base = process.env.BAILIAN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  const requestStartedAt = Date.now();
  const providerEndpointHost = new URL(`${base}/chat/completions`).host;
  try {
    const response = await fetch(`${base}/chat/completions`, {
      method: 'POST', timeout: 120000,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'qwen3.7-plus', temperature: .3, top_p: .8, max_tokens: 900, stream: false, enable_thinking: false, messages: [{ role: 'system', content: e.systemPrompt }, { role: 'user', content: JSON.stringify(e.briefs) }] }),
    });
    const rawBody = await response.text();
    let providerResponse; try { providerResponse = JSON.parse(rawBody); } catch {}
    const requestEndedAt = Date.now();
    return { benchmarkOnly: true, modelAlias: 'plus', requestedModel: 'qwen3.7-plus', promptVersion: PROMPT_VERSION, briefSchemaVersion: BRIEF_SCHEMA_VERSION, httpStatus: response.status, wallLatencyMs: requestEndedAt - requestStartedAt, requestStartedAt, requestEndedAt, providerEndpointHost, batchSize: e.briefs.length, ttft: null, usage: providerResponse?.usage || null, rawBody, providerResponse };
  } catch (error) {
    const requestEndedAt = Date.now();
    return { benchmarkOnly: true, modelAlias: 'plus', requestedModel: 'qwen3.7-plus', promptVersion: PROMPT_VERSION, briefSchemaVersion: BRIEF_SCHEMA_VERSION, httpStatus: 0, wallLatencyMs: requestEndedAt - requestStartedAt, requestStartedAt, requestEndedAt, providerEndpointHost, batchSize: e.briefs.length, ttft: null, usage: null, providerError: String(error?.message || error) };
  }
}

module.exports = { assertRequest, runXiaodaVoicePhase2Benchmark, MODEL_ALLOWLIST, PROMPT_VERSION, BRIEF_SCHEMA_VERSION };
