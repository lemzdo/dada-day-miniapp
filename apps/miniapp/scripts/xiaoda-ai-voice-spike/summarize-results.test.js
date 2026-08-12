'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildBlindComparison, calculateCost, finalizeRunMetadata, percentile, stats } = require('./summarize-results');

test('latency summaries use deterministic interpolated percentiles', () => {
  assert.equal(percentile([1, 2, 3, 4], 0.5), 2.5);
  assert.deepEqual(stats([1, 2, 3]).sampleCount, 3);
});

test('cost is calculated only from observed token usage', () => {
  const calls = [{ batchSize: 8, usage: { inputTokens: 1000, outputTokens: 100 } }];
  const value = calculateCost(calls, { inputCnyPerMillionTokens: 2, outputCnyPerMillionTokens: 8 });
  assert.equal(value.costPer8Cny, 0.0028);
  assert.equal(value.costPer1000UncachedBatchesCny, 2.8);
});

test('blind ordering is reproducible for a saved seed and hides model identity', () => {
  const holdout = { batches: [{ briefs: [{ benchmarkId: 'x', scene: 'home', garments: [], weatherDependency: { weatherRelevant: false } }] }] };
  const plus = [{ parsedItems: [{ id: 'x', reason: 'plus text' }] }];
  const max = [{ parsedItems: [{ id: 'x', reason: 'max text' }] }];
  const first = buildBlindComparison(holdout, plus, max, 'seed');
  const second = buildBlindComparison(holdout, plus, max, 'seed');
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(first.comparison).includes('plus text'), true);
  assert.equal(Object.prototype.hasOwnProperty.call(first.comparison.entries[0], 'model'), false);
});

test('final metadata records observed endpoint, models, cache tokens, and freeze ordering', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoda-summary-'));
  fs.writeFileSync(path.join(directory, '00-environment.json'), '{"provider":"DashScope"}\n');
  fs.writeFileSync(path.join(directory, 'prompt-freeze.json'), '{"frozenAt":"2026-08-12T00:00:00.000Z"}\n');
  const base = {
    clientStartedAt: '2026-08-12T00:00:01.000Z',
    providerEndpointHost: 'dashscope.aliyuncs.com',
    usage: { cachedInputTokens: 0 },
  };
  const metadata = finalizeRunMetadata(directory,
    [{ ...base, requestedModel: 'qwen3.7-plus', returnedModel: 'qwen3.7-plus' }],
    [{ ...base, requestedModel: 'qwen3.7-max', returnedModel: 'qwen3.7-max' }],
    []);
  const environment = JSON.parse(fs.readFileSync(path.join(directory, '00-environment.json'), 'utf8'));
  const freeze = JSON.parse(fs.readFileSync(path.join(directory, 'prompt-freeze.json'), 'utf8'));
  assert.equal(metadata.holdoutOpenedAfterFreeze, true);
  assert.deepEqual(environment.providerEndpointHosts, ['dashscope.aliyuncs.com']);
  assert.deepEqual(environment.cachedTokensObservation.values, [0]);
  assert.deepEqual(environment.actualModels.max.returned, ['qwen3.7-max']);
  assert.equal(freeze.holdoutOpenedAfterFreeze, true);
});
