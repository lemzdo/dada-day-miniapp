'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function loadTypeScriptModule(file) {
  const source = fs.readFileSync(file, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = new Module(file, module);
  loaded.filename = file;
  loaded.paths = Module._nodeModulePaths(path.dirname(file));
  loaded._compile(output, file);
  return loaded.exports;
}

const runtimeCache = loadTypeScriptModule(path.join(__dirname, 'runtimeQueryCache.ts'));

test.beforeEach(() => runtimeCache.clearRuntimeQueryCache());

test('runtime cache physically removes expired entries', () => {
  runtimeCache.setRuntimeQueryCache('detail', 'a', { id: 'a' }, { ttl: 10, now: 100 });
  assert.equal(runtimeCache.getRuntimeQueryCacheSize('detail', 100), 1);
  assert.equal(runtimeCache.getRuntimeQueryCache('detail', 'a', { now: 110 }), null);
  assert.equal(runtimeCache.getRuntimeQueryCacheSize('detail', 110), 0);
});

test('runtime cache enforces a per-namespace LRU cap', () => {
  runtimeCache.setRuntimeQueryCache('detail', 'a', 1, { ttl: 1_000, maxEntries: 2, now: 100 });
  runtimeCache.setRuntimeQueryCache('detail', 'b', 2, { ttl: 1_000, maxEntries: 2, now: 101 });
  runtimeCache.getRuntimeQueryCache('detail', 'a', { now: 102 });
  runtimeCache.setRuntimeQueryCache('detail', 'c', 3, { ttl: 1_000, maxEntries: 2, now: 103 });

  assert.equal(runtimeCache.getRuntimeQueryCache('detail', 'b', { now: 104 }), null);
  assert.equal(runtimeCache.getRuntimeQueryCache('detail', 'a', { now: 104 }).data, 1);
  assert.equal(runtimeCache.getRuntimeQueryCache('detail', 'c', { now: 104 }).data, 3);
  assert.equal(runtimeCache.getRuntimeQueryCacheSize('detail', 104), 2);
});

test('namespace cap does not evict another namespace', () => {
  runtimeCache.setRuntimeQueryCache('favorites', 'first', 1, { ttl: 1_000, maxEntries: 1, now: 100 });
  runtimeCache.setRuntimeQueryCache('history', 'first', 2, { ttl: 1_000, maxEntries: 1, now: 100 });
  runtimeCache.setRuntimeQueryCache('favorites', 'second', 3, { ttl: 1_000, maxEntries: 1, now: 101 });

  assert.equal(runtimeCache.getRuntimeQueryCacheSize('favorites', 101), 1);
  assert.equal(runtimeCache.getRuntimeQueryCacheSize('history', 101), 1);
});
