'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

test('local AI core module resolves and exposes recommendation task without network', () => {
  const core = require('@d1d/ai-core');
  const task = core.getTask('recommendation_reason');
  assert.ok(task);
  assert.equal(task.model, 'qwen3.7-max');
  assert.equal(task.promptVariant, 'compressed-v2');
  assert.equal(typeof core.xiaodaAI?.execute, 'function');
});
