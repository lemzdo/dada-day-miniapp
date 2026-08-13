'use strict';

const { INPUT_VERSION, MODEL_ALLOWLIST, PROMPT_VERSION } = require('./core');

const ACTION = 'voiceRendererV2Benchmark';

async function callGenerateOutfit(mini, data) {
  const envelope = await mini.evaluate(
    async (payload) => globalThis.wx.cloud.callFunction({ name: 'generateOutfit', data: payload }),
    data,
  );
  const result = envelope?.result;
  if (!result || typeof result.code !== 'number') throw new Error('CLOUD_ENVELOPE_INVALID');
  return result;
}

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
        requestShape: data.requestShape,
        promptSha256: data.promptSha256,
        inputSha256: data.inputSha256,
      },
    };
  };
}

module.exports = { ACTION, callGenerateOutfit, createCloudInvoke };
