'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { buildRaceCases, observedCostCny, percentile, run } = require('./runner');

function responseFor(request) {
  const input = JSON.parse(request.messages[1].content)[0];
  const text = input.m
    ? input.m
    : `${input.g[0]}和其他衣物搭得简单日常。`;
  const frames = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify({ copies: [{ id: '1', text }] }) } }] })}\n`,
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n`,
    'data: [DONE]\n',
  ];
  return {
    status: 200,
    body: (async function* body() {
      for (const frame of frames) yield Buffer.from(frame);
    }()),
  };
}

test('model race uses identical real Narrative Plans with production streaming validation', async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'homepage-model-race-'));
  const cases = buildRaceCases().slice(0, 2);
  const { artifact, target } = await run({
    cases,
    repetitions: 1,
    outputDir,
    invoke: async ({ request }) => responseFor(request),
    pricingByModel: {
      'qwen3.7-max': { inputCnyPerMillionTokens: 12, outputCnyPerMillionTokens: 36 },
      'qwen-flash': { inputCnyPerMillionTokens: 1, outputCnyPerMillionTokens: 2 },
    },
  });
  assert.equal(artifact.calls.length, 4);
  assert.equal(artifact.summary.max.validated, 2);
  assert.equal(artifact.summary.fast.validated, 2);
  assert.equal(artifact.calls[0].planHash, artifact.calls[2].planHash);
  assert.equal(artifact.calls[0].requestFingerprint, artifact.calls[2].requestFingerprint);
  assert.ok(artifact.calls.every((call) => Number.isFinite(call.responseHeadersMs)));
  assert.ok(artifact.calls.every((call) => Number.isFinite(call.firstValidatedMs)));
  assert.ok(fs.existsSync(target));
});

test('summary helpers use observed usage only', () => {
  assert.equal(percentile([30, 10, 20], 0.5), 20);
  assert.equal(observedCostCny({ promptTokens: 10, completionTokens: 5 }, {
    inputCnyPerMillionTokens: 12,
    outputCnyPerMillionTokens: 36,
  }), 0.0003);
  assert.equal(observedCostCny({ promptTokens: 10, completionTokens: 5 }), null);
});
