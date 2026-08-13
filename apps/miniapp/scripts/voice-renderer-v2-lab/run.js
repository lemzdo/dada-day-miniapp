'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  LAB_VERSION,
  MODEL_ALLOWLIST,
  PROMPT_VERSION,
  buildRendererInput,
  buildRequestBody,
  hash,
  parseRendererOutputs,
  validateRendererOutput,
} = require('./core');
const { buildGoldPlans } = require('./gold-plans');

async function run({
  modelAliases = ['max', 'plus'],
  repetitions = 2,
  apiKey = process.env.BAILIAN_API_KEY || process.env.DASHSCOPE_API_KEY,
  baseUrl = process.env.BAILIAN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  outputDir = path.resolve(__dirname, '../../../../artifacts/voice-renderer-v2-lab'),
  invoke = invokeProvider,
} = {}) {
  if (!apiKey) throw new Error('PROVIDER_KEY_MISSING');
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 5) throw new Error('REPETITIONS_RANGE');
  const goldPlans = buildGoldPlans();
  const inputs = goldPlans.map(buildRendererInput);
  fs.mkdirSync(outputDir, { recursive: true });
  const calls = [];

  for (const modelAlias of modelAliases) {
    if (!MODEL_ALLOWLIST[modelAlias]) throw new Error(`MODEL_NOT_ALLOWED:${modelAlias}`);
    for (let repetition = 1; repetition <= repetitions; repetition += 1) {
      const request = buildRequestBody(modelAlias, inputs);
      const startedAt = new Date().toISOString();
      const started = Date.now();
      const response = await invoke({ apiKey, baseUrl, request });
      if (Number(response.status) !== 200) throw new Error(`PROVIDER_HTTP:${response.status}`);
      if (response.body?.model !== request.model) throw new Error(`MODEL_MISMATCH:${response.body?.model || 'missing'}`);
      const rawContent = response.body?.choices?.[0]?.message?.content;
      const outputs = parseRendererOutputs(rawContent, inputs);
      const checks = outputs.map((output) => {
        const goldPlan = goldPlans.find((plan) => plan.planId === output.planId);
        return { caseId: goldPlan.caseId, ...validateRendererOutput(output, goldPlan) };
      });
      calls.push({
        modelAlias,
        requestedModel: request.model,
        returnedModel: response.body?.model || null,
        repetition,
        startedAt,
        latencyMs: Date.now() - started,
        httpStatus: response.status,
        usage: response.body?.usage || null,
        requestFingerprint: hash({ modelAlias: 'controlled-variable', ...request, model: 'controlled-variable' }),
        outputs,
        checks,
      });
      atomicJson(path.join(outputDir, 'raw-runs.json'), buildArtifact(goldPlans, inputs, calls, repetitions, modelAliases));
    }
  }
  const artifact = buildArtifact(goldPlans, inputs, calls, repetitions, modelAliases);
  atomicJson(path.join(outputDir, 'raw-runs.json'), artifact);
  return artifact;
}

async function invokeProvider({ apiKey, baseUrl, request }) {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    signal: AbortSignal.timeout(120000),
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`PROVIDER_JSON:${response.status}`);
  }
  if (!response.ok) throw new Error(`PROVIDER_HTTP:${response.status}:${body?.error?.code || 'unknown'}`);
  return { status: response.status, body };
}

function buildArtifact(goldPlans, inputs, calls, repetitions, modelAliases = Object.keys(MODEL_ALLOWLIST)) {
  return {
    version: LAB_VERSION,
    status: calls.length === modelAliases.length * repetitions ? 'complete' : 'in_progress',
    promptVersion: PROMPT_VERSION,
    goldPlanCount: goldPlans.length,
    repetitions,
    models: Object.fromEntries(modelAliases.map((alias) => [alias, MODEL_ALLOWLIST[alias]])),
    inputFingerprint: hash(inputs),
    goldPlans,
    inputs,
    calls,
    summary: Object.fromEntries(Object.keys(MODEL_ALLOWLIST).map((alias) => {
      const selected = calls.filter((call) => call.modelAlias === alias);
      const checks = selected.flatMap((call) => call.checks);
      return [alias, {
        calls: selected.length,
        outputs: selected.flatMap((call) => call.outputs).length,
        automatedPass: checks.filter((check) => check.pass).length,
        automatedFail: checks.filter((check) => !check.pass).length,
      }];
    })),
    manualReviewRequired: true,
  };
}

function atomicJson(file, value) {
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, file);
}

if (require.main === module) {
  run().then((artifact) => {
    process.stdout.write(`${JSON.stringify({ status: artifact.status, summary: artifact.summary }, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { buildArtifact, invokeProvider, run };
