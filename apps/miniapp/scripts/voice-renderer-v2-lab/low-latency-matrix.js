'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  COMPRESSED_PROMPT_VERSION,
  GENERATION_PARAMETERS,
  LAB_VERSION,
  MODEL_ALLOWLIST,
  PROMPT_VERSION,
  buildRendererInput,
  buildRequestBody,
  hash,
  parseRequestOutputs,
  validateRendererOutput,
} = require('./core');
const { buildGoldPlans } = require('./gold-plans');
const { invokeProvider } = require('./run');

const MATRIX_VERSION = 'voice-renderer-low-latency-matrix-v1';
const DEFAULT_OUTPUT_FILE = path.resolve(__dirname, '../../../../artifacts/voice-renderer-v2-lab/low-latency-matrix.json');

const SCENARIOS = Object.freeze([
  { id: 'B', modelAlias: 'max', promptVariant: 'compressed', maxCalls: 2 },
  { id: 'C', modelAlias: 'flash', promptVariant: 'current', maxCalls: 3 },
  { id: 'D', modelAlias: 'flash', promptVariant: 'compressed', maxCalls: 3, requires: 'C' },
]);

async function runLowLatencyMatrix({
  apiKey = process.env.BAILIAN_API_KEY || process.env.DASHSCOPE_API_KEY,
  baseUrl = process.env.BAILIAN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  invoke = invokeProvider,
  outputFile = DEFAULT_OUTPUT_FILE,
  stableThresholdMs = 3000,
} = {}) {
  if (invoke === invokeProvider && !apiKey) throw new Error('PROVIDER_KEY_MISSING');
  const goldPlans = buildGoldPlans();
  const inputs = goldPlans.map(buildRendererInput);
  const artifact = createArtifact(inputs);

  for (const scenario of SCENARIOS) {
    if (scenario.requires && !scenarioQualityPassed(artifact, scenario.requires)) {
      artifact.scenarios[scenario.id].status = 'skipped';
      artifact.scenarios[scenario.id].stopReason = `${scenario.requires}_QUALITY_GATE_NOT_PASSED`;
      persist(outputFile, artifact);
      continue;
    }
    artifact.scenarios[scenario.id].status = 'running';
    for (let repetition = 1; repetition <= scenario.maxCalls; repetition += 1) {
      const call = await executeCall({ scenario, repetition, inputs, goldPlans, apiKey, baseUrl, invoke });
      artifact.calls.push(call);
      updateScenario(artifact, scenario.id);
      persist(outputFile, artifact);
      const stopReason = stopReasonForScenario(artifact, scenario.id);
      if (stopReason) {
        artifact.scenarios[scenario.id].status = 'stopped';
        artifact.scenarios[scenario.id].stopReason = stopReason;
        persist(outputFile, artifact);
        break;
      }
    }
    if (artifact.scenarios[scenario.id].status === 'running') artifact.scenarios[scenario.id].status = 'complete';
    persist(outputFile, artifact);

    if (scenario.id === 'C' && stableAtOrBelow(artifact, 'C', stableThresholdMs)) {
      artifact.stopReason = 'FLASH_CURRENT_STABLE_AT_OR_BELOW_3S';
      artifact.scenarios.D.status = 'skipped';
      artifact.scenarios.D.stopReason = 'GLOBAL_STOP_RULE';
      break;
    }
  }

  artifact.status = 'complete';
  artifact.completedAt = new Date().toISOString();
  artifact.fastestValid = fastestValid(artifact.calls);
  persist(outputFile, artifact);
  return artifact;
}

async function executeCall({ scenario, repetition, inputs, goldPlans, apiKey, baseUrl, invoke }) {
  const request = buildRequestBody(scenario.modelAlias, inputs, { promptVariant: scenario.promptVariant });
  const startedAt = new Date().toISOString();
  const started = Date.now();
  let response;
  try {
    response = await invoke({ apiKey, baseUrl, request, scenario });
  } catch (error) {
    return failedCall({ scenario, repetition, request, startedAt, started, error });
  }
  const e2eLatencyMs = Date.now() - started;
  if (Number(response?.status) !== 200) {
    return failedCall({ scenario, repetition, request, startedAt, started, error: new Error(`PROVIDER_HTTP:${response?.status || 'missing'}`) });
  }
  if (response.body?.model !== request.model) {
    return failedCall({ scenario, repetition, request, startedAt, started, error: new Error(`MODEL_MISMATCH:${response.body?.model || 'missing'}`) });
  }
  const rawContent = response.body?.choices?.[0]?.message?.content;
  let outputs;
  try {
    outputs = parseRequestOutputs(rawContent, inputs, scenario.promptVariant);
  } catch (error) {
    return failedCall({ scenario, repetition, request, startedAt, started, error, response, rawContent });
  }
  const checks = outputs.map((output) => {
    const goldPlan = goldPlans.find((plan) => plan.planId === output.planId);
    return { caseId: goldPlan.caseId, planId: goldPlan.planId, ...validateRendererOutput(output, goldPlan) };
  });
  const failures = checks.flatMap((check) => check.failures);
  const usage = response.body?.usage || {};
  const providerLatencyMs = Number(response.benchmarkMetadata?.providerLatencyMs || response.totalLatencyMs) || null;
  const validatorPass = checks.every((check) => check.pass);
  return {
    scenarioId: scenario.id,
    model: request.model,
    promptVariant: scenario.promptVariant,
    nonThinking: request.enable_thinking === false,
    repetition,
    startedAt,
    requestChars: JSON.stringify(request).length,
    promptChars: request.messages.reduce((sum, message) => sum + message.content.length, 0),
    systemPromptChars: request.messages[0].content.length,
    userPayloadChars: request.messages[1].content.length,
    outputChars: typeof rawContent === 'string' ? rawContent.length : 0,
    promptTokens: Number(usage.prompt_tokens) || null,
    completionTokens: Number(usage.completion_tokens) || null,
    e2eLatencyMs,
    providerLatencyMs,
    httpStatus: response.status,
    parserPass: true,
    contractPass: true,
    validatorPass,
    factualViolationCount: failures.filter((failure) => failure === 'UNSUPPORTED_FACT').length,
    personaNaturalness: failures.includes('PERSONA_OR_EDITORIAL_LANGUAGE') ? 'automated-fail' : 'automated-pass;manual-review-pending',
    retryCount: 0,
    qualityPass: validatorPass,
    error: null,
    outputs,
    checks,
  };
}

function failedCall({ scenario, repetition, request, startedAt, started, error, response, rawContent }) {
  const message = String(error?.message || error || 'UNKNOWN_ERROR').slice(0, 500);
  const usage = response?.body?.usage || {};
  return {
    scenarioId: scenario.id,
    model: request.model,
    promptVariant: scenario.promptVariant,
    nonThinking: request.enable_thinking === false,
    repetition,
    startedAt,
    requestChars: JSON.stringify(request).length,
    promptChars: request.messages.reduce((sum, item) => sum + item.content.length, 0),
    systemPromptChars: request.messages[0].content.length,
    userPayloadChars: request.messages[1].content.length,
    promptTokens: Number(usage.prompt_tokens) || null,
    completionTokens: Number(usage.completion_tokens) || null,
    e2eLatencyMs: Date.now() - started,
    providerLatencyMs: Number(response?.benchmarkMetadata?.providerLatencyMs || response?.totalLatencyMs) || null,
    httpStatus: Number(response?.status) || null,
    parserPass: false,
    contractPass: false,
    validatorPass: false,
    factualViolationCount: 0,
    personaNaturalness: 'not-assessed',
    retryCount: 0,
    qualityPass: false,
    error: message,
    outputChars: typeof rawContent === 'string' ? rawContent.length : 0,
    outputs: [],
    checks: [],
  };
}

function createArtifact(inputs) {
  const current = buildRequestBody('max', inputs, { promptVariant: 'current' });
  const compressed = buildRequestBody('max', inputs, { promptVariant: 'compressed' });
  const size = (request) => ({
    systemChars: request.messages[0].content.length,
    userChars: request.messages[1].content.length,
    promptChars: request.messages.reduce((sum, message) => sum + message.content.length, 0),
    requestChars: JSON.stringify(request).length,
  });
  const currentSize = size(current);
  const compressedSize = size(compressed);
  return {
    version: MATRIX_VERSION,
    labVersion: LAB_VERSION,
    status: 'in_progress',
    startedAt: new Date().toISOString(),
    nonThinking: GENERATION_PARAMETERS.enable_thinking === false,
    baseline: { model: MODEL_ALLOWLIST.max, promptVersion: PROMPT_VERSION, historicalE2eMs: [13424, 13140] },
    promptSizes: {
      current: currentSize,
      compressed: compressedSize,
      reductionPercent: Number(((1 - compressedSize.promptChars / currentSize.promptChars) * 100).toFixed(1)),
    },
    inputFingerprint: hash(inputs),
    scenarios: Object.fromEntries(SCENARIOS.map((scenario) => [scenario.id, {
      model: MODEL_ALLOWLIST[scenario.modelAlias],
      promptVariant: scenario.promptVariant,
      promptVersion: scenario.promptVariant === 'compressed' ? COMPRESSED_PROMPT_VERSION : PROMPT_VERSION,
      maxCalls: scenario.maxCalls,
      calls: 0,
      validCalls: 0,
      status: 'pending',
      stopReason: null,
    }])),
    calls: [],
    fastestValid: null,
    stopReason: null,
  };
}

function updateScenario(artifact, scenarioId) {
  const calls = artifact.calls.filter((call) => call.scenarioId === scenarioId);
  artifact.scenarios[scenarioId].calls = calls.length;
  artifact.scenarios[scenarioId].validCalls = calls.filter((call) => call.qualityPass).length;
}

function scenarioQualityPassed(artifact, scenarioId) {
  const scenario = artifact.scenarios[scenarioId];
  return scenario.calls >= 2 && scenario.validCalls === scenario.calls;
}

function stopReasonForScenario(artifact, scenarioId) {
  const calls = artifact.calls.filter((call) => call.scenarioId === scenarioId);
  const lastTwo = calls.slice(-2);
  if (lastTwo.length < 2) return null;
  if (lastTwo.every((call) => /MODEL_NOT_ALLOWED|MODEL.*(?:NOT_FOUND|NOT_SUPPORTED)|INVALID_PARAMETER.*MODEL/i.test(call.error || ''))) {
    return 'MODEL_UNAVAILABLE_TWICE';
  }
  if (lastTwo.every((call) => !call.contractPass || call.factualViolationCount > 0)) return 'CONSECUTIVE_CONTRACT_OR_FACT_FAILURES';
  return null;
}

function stableAtOrBelow(artifact, scenarioId, thresholdMs) {
  const valid = artifact.calls.filter((call) => call.scenarioId === scenarioId && call.qualityPass);
  return valid.length >= 2 && valid.every((call) => call.e2eLatencyMs <= thresholdMs);
}

function fastestValid(calls) {
  const valid = calls.filter((call) => call.qualityPass && Number.isFinite(call.e2eLatencyMs));
  return valid.sort((left, right) => left.e2eLatencyMs - right.e2eLatencyMs)[0] || null;
}

function persist(file, artifact) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, file);
}

if (require.main === module) {
  runLowLatencyMatrix().then((artifact) => {
    process.stdout.write(`${JSON.stringify({ status: artifact.status, scenarios: artifact.scenarios, fastestValid: artifact.fastestValid }, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  SCENARIOS,
  createArtifact,
  runLowLatencyMatrix,
  scenarioQualityPassed,
  stableAtOrBelow,
  stopReasonForScenario,
};
