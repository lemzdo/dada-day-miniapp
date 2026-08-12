'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { DEVELOPMENT_FIXTURES } = require('./development-fixtures');
const { briefSchema } = require('./prepare-artifacts');

test('development fixtures cover every required prompt-development dimension', () => {
  const coverage = new Set(DEVELOPMENT_FIXTURES.flatMap((fixture) => fixture.coverage));
  for (const required of ['上繁下简', '上简下繁', '图案 + 纯色', '基础 + 设计', '强颜色重点 + 简单支持', '同色呼应', '邻近/协调颜色', '松紧关系', '比例关系', 'onepiece + shoe', 'layer', 'ordinary basic outfit', 'Work', 'Date', 'Home', 'Sport', 'sparse facts', 'competing insights']) {
    assert.equal(coverage.has(required), true, required);
  }
  assert.ok(DEVELOPMENT_FIXTURES.length >= 16 && DEVELOPMENT_FIXTURES.length <= 24);
});

test('brief schema freezes the required top-level contract', () => {
  const schema = briefSchema();
  assert.equal(schema.properties.briefSchemaVersion.const, 'xiaoda-styling-brief-v1');
  assert.ok(schema.required.includes('primaryStylingPoint'));
  assert.ok(schema.required.includes('cacheDependencies'));
});
