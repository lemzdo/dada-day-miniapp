'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createRecommendationStreamConsumer,
  createSseParser,
} = require('./recommendationSseCore');

function encode(text) { return new TextEncoder().encode(text); }

test('SSE parser preserves split UTF-8 and frame boundaries', () => {
  const frames = [];
  const parser = createSseParser({ onEvent: (frame) => frames.push(frame) });
  const bytes = encode('event: canonical.copy\ndata: {"text":"针织衫"}\n\n');
  parser.push(bytes.slice(0, 43));
  parser.push(bytes.slice(43, 45));
  parser.push(bytes.slice(45));
  parser.finish();
  assert.equal(frames.length, 1);
  assert.equal(frames[0].event, 'canonical.copy');
  assert.equal(frames[0].data.text, '针织衫');
});

test('consumer buffers early copy then applies it after recommendation.ready', () => {
  const applied = [];
  const ready = [];
  const consumer = createRecommendationStreamConsumer({
    generation: 7,
    onRecommendationReady: (response) => ready.push(response.batch.batchId),
    onCanonicalCopy: (copy) => applied.push(copy.text),
  });
  assert.equal(consumer.handle({ event: 'canonical.copy', data: {
    generation: '7', batchId: 'batch-1', copy: { outfitKey: 'look-1', text: 'AI 先到' },
  } }).status, 'buffered');
  assert.equal(consumer.handle({ event: 'recommendation.ready', data: {
    generation: '7', batchId: 'batch-1', response: { batch: { batchId: 'batch-1' } },
  } }).status, 'ready');
  assert.deepEqual(ready, ['batch-1']);
  assert.deepEqual(applied, ['AI 先到']);
});

test('consumer isolates stale generation and stale batch copies', () => {
  const applied = [];
  const consumer = createRecommendationStreamConsumer({
    generation: 'current',
    onCanonicalCopy: (copy) => applied.push(copy.text),
  });
  consumer.handle({ event: 'recommendation.ready', data: {
    generation: 'current', batchId: 'batch-1', response: { batch: { batchId: 'batch-1' } },
  } });
  assert.equal(consumer.handle({ event: 'canonical.copy', data: {
    generation: 'old', batchId: 'batch-1', copy: { outfitKey: 'look-1', text: 'old' },
  } }).status, 'stale');
  assert.equal(consumer.handle({ event: 'canonical.copy', data: {
    generation: 'current', batchId: 'batch-2', copy: { outfitKey: 'look-2', text: 'other batch' },
  } }).status, 'stale');
  assert.deepEqual(applied, []);
});
