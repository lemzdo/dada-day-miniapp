'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ensureDevToolsDirectSession } = require('../devtools-direct-session');
const { buildRendererInput, INPUT_VERSION, PROMPT_VERSION } = require('./core');
const { buildGoldPlans } = require('./gold-plans');
const { ACTION, callGenerateOutfit } = require('./cloud-client');

async function smokeCloud({
  artifactDirectory = path.resolve(__dirname, '../../../../artifacts/voice-renderer-v2-lab'),
  deps = {},
} = {}) {
  const token = fs.readFileSync(path.join(artifactDirectory, '.cloud-benchmark-token'), 'utf8').trim();
  const session = deps.mini ? null : await ensureDevToolsDirectSession({ deps });
  const mini = deps.mini || session.mini;
  const request = (overrides = {}) => ({
    action: ACTION,
    benchmarkToken: token,
    modelAlias: 'max',
    promptVersion: PROMPT_VERSION,
    inputVersion: INPUT_VERSION,
    inputs: [buildRendererInput(buildGoldPlans()[0])],
    ...overrides,
  });
  try {
    const normalProbe = await callGenerateOutfit(mini, { action: 'transport_probe_small', diagnostic: true });
    if (normalProbe.code !== 0) throw new Error('NORMAL_PATH_PROBE_FAILED');
    const unauthorized = await callGenerateOutfit(mini, request({ benchmarkToken: undefined }));
    if (unauthorized.code !== 1 || !String(unauthorized.message).includes('BENCHMARK_NOT_AUTHORIZED')) {
      throw new Error(`UNAUTHORIZED_GATE_FAILED:${unauthorized.code}:${unauthorized.message}`);
    }
    const forbiddenInput = { ...request().inputs[0], reason: 'must be rejected before provider' };
    const forbidden = await callGenerateOutfit(mini, request({ inputs: [forbiddenInput] }));
    if (forbidden.code !== 1 || !String(forbidden.message).includes('INPUT_KEY_NOT_ALLOWED:reason')) {
      throw new Error(`MINIMAL_INPUT_GATE_FAILED:${forbidden.code}:${forbidden.message}`);
    }
    const valid = await callGenerateOutfit(mini, request());
    if (valid.code !== 0 || valid.data?.outputs?.length !== 1 || valid.data?.requestedModel !== 'qwen3.7-max') {
      throw new Error(`VALID_CLOUD_SMOKE_FAILED:${valid.message || 'unknown'}`);
    }
    return {
      normalPathProbe: 'PASS',
      unauthorizedGate: 'PASS',
      minimalInputGate: 'PASS',
      providerKeyReadableInCloud: 'PASS',
      requestedModel: valid.data.requestedModel,
      returnedModel: valid.data.returnedModel,
      output: valid.data.outputs[0],
    };
  } finally {
    if (!deps.mini && mini?.disconnect) mini.disconnect();
  }
}

if (require.main === module) {
  smokeCloud().then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}

module.exports = { smokeCloud };
