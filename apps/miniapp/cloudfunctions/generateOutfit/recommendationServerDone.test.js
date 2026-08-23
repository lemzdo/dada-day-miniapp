const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

function loadInternals() {
  const originalLoad = Module._load;
  Module._load = function loadWithCloudStub(request, parent, isMain) {
    if (request === 'wx-server-sdk') {
      return {
        DYNAMIC_CURRENT_ENV: 'test',
        init() {},
        database() { return { command: { in: (values) => values } }; },
        getWXContext() { return { OPENID: 'test-openid' }; },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  try {
    delete require.cache[require.resolve('./index.js')];
    return require('./index.js').__test;
  } finally {
    Module._load = originalLoad;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
}

test('RecommendationServerDone emits the complete server timing envelope', () => {
  const internals = loadInternals();
  const diagnostics = internals.createRecommendationDiagnostics({ auditId: 'timing-test' }, Date.now() - 5);
  const entries = [];
  const originalLog = console.log;
  console.log = (...args) => entries.push(args);
  try {
    const result = internals.emitRecommendationServerDone({
      diagnostics,
      executionMode: 'full_compute',
      response: { code: 0, data: { light: { cards: [] } }, message: 'ok' },
    });
    assert.equal(entries.length, 1);
    assert.equal(entries[0][0], '[RecommendationServerDone]');
    assert.equal(entries[0][1].executionMode, 'full_compute');
    assert.equal(typeof entries[0][1].timings.totalMs, 'number');
    assert.equal(entries[0][1].responseBytes, result.responseBytes);
    assert.ok(result.responseBytes > 0);
    assert.ok(Object.hasOwn(entries[0][1].timings, 'cardCompilationMs'));
    assert.ok(Object.hasOwn(entries[0][1].timings, 'batchPersistenceMs'));
    assert.ok(Object.hasOwn(entries[0][1].timings, 'serializationMs'));
  } finally {
    console.log = originalLog;
  }
});
