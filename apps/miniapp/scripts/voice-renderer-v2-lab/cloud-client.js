'use strict';

const crypto = require('node:crypto');
const { INPUT_VERSION, MODEL_ALLOWLIST, PROMPT_VERSION } = require('./core');

const ACTION = 'voiceRendererV2Benchmark';

async function callGenerateOutfit(mini, data, { timeoutMs = 120000, pollMs = 250 } = {}) {
  const requestId = crypto.randomUUID();
  const started = await mini.evaluate((payload) => {
    const registryKey = '__voiceRendererV2CloudCalls';
    const registry = globalThis[registryKey] || (globalThis[registryKey] = {});
    registry[payload.requestId] = { status: 'pending' };
    globalThis.wx.cloud.callFunction({ name: 'generateOutfit', data: payload.data }).then((envelope) => {
      registry[payload.requestId] = { status: 'resolved', envelope };
    }).catch((error) => {
      registry[payload.requestId] = { status: 'rejected', error: String(error?.message || error) };
    });
    return { requestId: payload.requestId, status: 'pending' };
  }, { requestId, data });
  if (started?.requestId !== requestId) throw new Error('CLOUD_ASYNC_START_FAILED');
  const deadline = Date.now() + timeoutMs;
  let settled;
  try {
    while (Date.now() < deadline) {
      settled = await mini.evaluate((id) => globalThis.__voiceRendererV2CloudCalls?.[id] || null, requestId);
      if (settled?.status === 'resolved' || settled?.status === 'rejected') break;
      await delay(pollMs);
    }
  } finally {
    try {
      await mini.evaluate((id) => {
        if (globalThis.__voiceRendererV2CloudCalls) delete globalThis.__voiceRendererV2CloudCalls[id];
      }, requestId);
    } catch {}
  }
  if (!settled || settled.status === 'pending') throw new Error('CLOUD_CALL_TIMEOUT');
  if (settled.status === 'rejected') throw new Error(settled.error || 'CLOUD_CALL_REJECTED');
  const envelope = settled.envelope;
  const result = envelope?.result;
  if (!result || typeof result.code !== 'number') throw new Error('CLOUD_ENVELOPE_INVALID');
  return result;
}

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function createCloudInvoke(mini, benchmarkToken) {
  if (typeof benchmarkToken !== 'string' || benchmarkToken.length < 32) throw new Error('BENCHMARK_TOKEN_INVALID');
  return async ({ request }) => {
    const modelAlias = Object.entries(MODEL_ALLOWLIST).find(([, model]) => model === request.model)?.[0];
    if (!modelAlias) throw new Error('MODEL_NOT_ALLOWED');
    const inputs = JSON.parse(request.messages?.[1]?.content || 'null');
    const result = await callGenerateOutfit(mini, {
      action: ACTION,
      benchmarkToken,
      modelAlias,
      promptVersion: PROMPT_VERSION,
      inputVersion: INPUT_VERSION,
      inputs,
    });
    if (result.code !== 0) throw new Error(`CLOUD_BENCHMARK:${result.message || 'unknown'}`);
    const data = result.data || {};
    return {
      status: data.httpStatus,
      body: {
        model: data.returnedModel,
        usage: data.usage,
        choices: [{ message: { content: JSON.stringify(data.outputs) } }],
      },
      benchmarkMetadata: {
        benchmarkOnly: data.benchmarkOnly,
        action: data.action,
        promptVersion: data.promptVersion,
        inputVersion: data.inputVersion,
        providerLatencyMs: data.providerLatencyMs,
        ttftMs: data.ttftMs,
        requestShape: data.requestShape,
        promptSha256: data.promptSha256,
        inputSha256: data.inputSha256,
      },
    };
  };
}

module.exports = { ACTION, callGenerateOutfit, createCloudInvoke };
