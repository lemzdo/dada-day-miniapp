'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { MODEL_ALLOWLIST } = require('./core');
const { run } = require('./run');

test('batch runner repeats Max and Plus with equivalent controlled requests and archives checks', async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-renderer-v2-'));
  const requests = [];
  const artifact = await run({
    apiKey: 'test-only',
    repetitions: 2,
    outputDir,
    invoke: async ({ request }) => {
      requests.push(request);
      const inputs = JSON.parse(request.messages[1].content);
      return {
        status: 200,
        body: {
          model: request.model,
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          choices: [{
            message: {
              content: JSON.stringify(inputs.map((input) => ({
                planId: input.planId,
                insightId: input.primary?.insightId || null,
                text: input.primary?.meaning || `${input.garments[0]}配${input.garments[1]}，就是简单日常的一套。`,
              }))),
            },
          }],
        },
      };
    },
  });

  assert.equal(artifact.status, 'complete');
  assert.equal(artifact.calls.length, 4);
  assert.deepEqual(artifact.calls.map((call) => call.requestedModel), [
    MODEL_ALLOWLIST.max,
    MODEL_ALLOWLIST.max,
    MODEL_ALLOWLIST.plus,
    MODEL_ALLOWLIST.plus,
  ]);
  assert.equal(new Set(artifact.calls.map((call) => call.requestFingerprint)).size, 1);
  assert.equal(requests.every((request) => request.messages[0].content === requests[0].messages[0].content), true);
  assert.equal(requests.every((request) => request.messages[1].content === requests[0].messages[1].content), true);
  assert.equal(fs.existsSync(path.join(outputDir, 'raw-runs.json')), true);
  assert.equal(artifact.summary.max.automatedFail, 0);
  assert.equal(artifact.summary.plus.automatedFail, 0);
  assert.equal(artifact.summary.max.contractPassCalls, 2);
  assert.equal(artifact.summary.max.validatorPassCalls, 2);
  assert.equal(artifact.summary.max.factualViolationCount, 0);
  assert.equal(artifact.summary.max.parseRetryCount, 0);
  assert.equal(artifact.calls.every((call) => call.thinkingMode === 'disabled'), true);
  assert.equal(artifact.calls.every((call) => call.inputChars > call.systemPromptChars), true);
  assert.equal(artifact.calls.every((call) => call.userPayloadChars > 0), true);
  assert.equal(artifact.calls.every((call) => call.outputChars > 0), true);
  assert.equal(artifact.calls.every((call) => call.inputTokens === 1), true);
  assert.equal(artifact.calls.every((call) => call.outputTokens === 1), true);
  assert.equal(artifact.manualReviewRequired, true);
});
