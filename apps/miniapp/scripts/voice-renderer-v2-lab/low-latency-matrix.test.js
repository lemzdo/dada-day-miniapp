'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { runLowLatencyMatrix } = require('./low-latency-matrix');

function successResponse(request) {
  const compressed = Boolean(request.response_format);
  const payload = JSON.parse(request.messages[1].content);
  const content = compressed
    ? JSON.stringify({ copies: payload.map((entry) => ({ id: entry.id, text: entry.m || `${entry.g[0]}配${entry.g[1]}，就是简单日常的一套。` })) })
    : JSON.stringify(payload.map((entry) => ({
        planId: entry.planId,
        insightId: entry.primary?.insightId || null,
        text: entry.primary?.meaning || `${entry.garments[0]}配${entry.garments[1]}，就是简单日常的一套。`,
      })));
  return {
    status: 200,
    totalLatencyMs: 2,
    body: {
      model: request.model,
      usage: { prompt_tokens: compressed ? 300 : 2000, completion_tokens: 300 },
      choices: [{ message: { content } }],
    },
  };
}

test('matrix runs B then quality-gated C/D and records every required measurement', async () => {
  const outputFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'renderer-matrix-')), 'matrix.json');
  const artifact = await runLowLatencyMatrix({
    apiKey: 'test-only',
    outputFile,
    stableThresholdMs: -1,
    invoke: async ({ request }) => successResponse(request),
  });
  assert.equal(artifact.calls.length, 8);
  assert.deepEqual(artifact.calls.map((call) => call.scenarioId), ['B', 'B', 'C', 'C', 'C', 'D', 'D', 'D']);
  assert.equal(artifact.scenarios.B.validCalls, 2);
  assert.equal(artifact.scenarios.C.validCalls, 3);
  assert.equal(artifact.scenarios.D.validCalls, 3);
  assert.equal(artifact.promptSizes.current.promptChars, 5897);
  assert.equal(artifact.promptSizes.compressed.promptChars, 718);
  assert.equal(artifact.promptSizes.reductionPercent, 87.8);
  assert.equal(artifact.calls.every((call) => call.nonThinking), true);
  assert.equal(artifact.calls.every((call) => call.parserPass && call.contractPass && call.validatorPass), true);
  assert.equal(artifact.calls.every((call) => call.factualViolationCount === 0 && call.retryCount === 0), true);
  assert.equal(artifact.calls.every((call) => call.personaNaturalness.startsWith('automated-pass')), true);
  assert.equal(fs.existsSync(outputFile), true);
});

test('matrix stops Flash after two explicit model-unavailable responses and does not run D', async () => {
  const outputFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'renderer-matrix-')), 'matrix.json');
  const artifact = await runLowLatencyMatrix({
    apiKey: 'test-only',
    outputFile,
    invoke: async ({ request, scenario }) => {
      if (scenario.id === 'C') throw new Error('MODEL_NOT_ALLOWED');
      return successResponse(request);
    },
  });
  assert.equal(artifact.scenarios.C.calls, 2);
  assert.equal(artifact.scenarios.C.stopReason, 'MODEL_UNAVAILABLE_TWICE');
  assert.equal(artifact.scenarios.D.status, 'skipped');
  assert.equal(artifact.scenarios.D.stopReason, 'C_QUALITY_GATE_NOT_PASSED');
  assert.equal(artifact.calls.filter((call) => call.scenarioId === 'D').length, 0);
});
