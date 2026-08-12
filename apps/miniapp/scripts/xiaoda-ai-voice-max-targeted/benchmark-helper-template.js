'use strict';

const crypto = require('node:crypto');
const fetch = require('node-fetch');

const MODEL = 'qwen3.7-max';
const ACTION = 'xiaodaVoiceMaxTargeted';
const PROMPT_VERSION = 'xiaoda-today-voice-v2-dev4';
const BRIEF_SCHEMA_VERSION = 'xiaoda-styling-brief-v2';
const TOKEN_HASH = '__MAX_TARGETED_TOKEN_SHA256__';
const sha256 = (value) => crypto.createHash('sha256').update(String(value || '')).digest('hex');

function assertRequest(event = {}) {
  if (sha256(event.benchmarkToken) !== TOKEN_HASH) throw new Error('BENCHMARK_NOT_AUTHORIZED');
  if (event.action !== ACTION || event.modelAlias !== 'max') throw new Error('MODEL_NOT_ALLOWED');
  if (event.promptVersion !== PROMPT_VERSION || event.briefSchemaVersion !== BRIEF_SCHEMA_VERSION) throw new Error('VERSION_MISMATCH');
  if (!Array.isArray(event.briefs) || event.briefs.length < 1 || event.briefs.length > 8) throw new Error('BATCH_SIZE');
  if (typeof event.systemPrompt !== 'string' || event.systemPrompt.length < 100) throw new Error('PROMPT_INVALID');
  for (const brief of event.briefs) {
    if (!brief || typeof brief.id !== 'string' || !brief.id) throw new Error('BRIEF_ID_INVALID');
    if (brief.briefSchemaVersion !== BRIEF_SCHEMA_VERSION) throw new Error('BRIEF_SCHEMA_INVALID');
  }
}

async function runXiaodaVoiceMaxTargeted(event = {}) {
  assertRequest(event);
  const key = process.env.BAILIAN_API_KEY || process.env.DASHSCOPE_API_KEY;
  if (!key) throw new Error('PROVIDER_KEY_MISSING');
  const base = process.env.BAILIAN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  const startedAt = Date.now();
  try {
    const response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      timeout: 120000,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.3,
        top_p: 0.8,
        max_tokens: 900,
        stream: false,
        enable_thinking: false,
        messages: [
          { role: 'system', content: event.systemPrompt },
          { role: 'user', content: JSON.stringify(event.briefs) },
        ],
      }),
    });
    const rawBody = await response.text();
    let providerResponse = null;
    try { providerResponse = JSON.parse(rawBody); } catch {}
    return {
      benchmarkOnly: true,
      requestedModel: MODEL,
      returnedModel: providerResponse?.model || null,
      action: ACTION,
      promptVersion: PROMPT_VERSION,
      briefSchemaVersion: BRIEF_SCHEMA_VERSION,
      requestShape: { batchSize: event.briefs.length, temperature: 0.3, topP: 0.8, maxTokens: 900, stream: false, enableThinking: false },
      httpStatus: response.status,
      providerLatencyMs: Date.now() - startedAt,
      retryCount: 0,
      rawBody,
      providerResponse,
      usage: providerResponse?.usage || null,
    };
  } catch (error) {
    return { benchmarkOnly: true, requestedModel: MODEL, returnedModel: null, action: ACTION, httpStatus: 0, providerLatencyMs: Date.now() - startedAt, retryCount: 0, rawBody: null, providerResponse: null, usage: null, providerError: String(error?.message || error) };
  }
}

module.exports = { assertRequest, runXiaodaVoiceMaxTargeted };
