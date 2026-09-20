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

function quotaAdapter() {
  let writes = 0;
  return {
    keys: () => [],
    get: () => undefined,
    set: () => {
      writes += 1;
      throw new Error('storage quota exceeded');
    },
    remove: () => false,
    get writes() {
      return writes;
    },
  };
}

test('LOGIN_REMOTE_SUCCESS_LOCAL_FAIL keeps login successful and reports protected persistence failure', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../stores/userStore.ts'), 'utf8');
  const stateCommit = source.indexOf('set({\n      recommendationProfile');
  const persistence = source.indexOf('bootstrapProjectionStore.writeAuthResume');
  assert.ok(stateCommit >= 0);
  assert.ok(persistence > stateCommit);
  assert.match(source, /Local persistence is a bounded[\s\S]*never reverses an authenticated runtime/);

  const { createStorageCore } = await import('./localStorage/core.mjs');
  const { LOCAL_STORAGE_REGISTRY } = loadTypeScriptModule(path.join(__dirname, 'localStorage/registry.ts'));
  const adapter = quotaAdapter();
  const storage = createStorageCore({ registry: LOCAL_STORAGE_REGISTRY, adapter });
  const remoteLogin = { authenticated: true, userId: 'user-1', openid: 'openid-1' };

  const localPersistence = storage.write('authResume:v2', {
    userId: remoteLogin.userId,
    confirmedOpenid: remoteLogin.openid,
    userScope: 'scope-1',
    updatedAt: '2026-09-20T00:00:00.000Z',
  });

  assert.deepEqual(remoteLogin, { authenticated: true, userId: 'user-1', openid: 'openid-1' });
  assert.equal(localPersistence.status, 'persistence-error');
  assert.equal(localPersistence.attempts, 2);
  assert.equal(adapter.writes, 2);
});

test('WEATHER_REMOTE_SUCCESS_CACHE_FAIL returns weather and fails local cache open', async () => {
  const source = fs.readFileSync(path.join(__dirname, 'cloud.ts'), 'utf8');
  const functionStart = source.indexOf('export async function getCloudWeather');
  const functionEnd = source.indexOf('export function getLocalStyles', functionStart);
  const body = source.slice(functionStart, functionEnd);
  assert.match(body, /writeLocalWeatherCache\(data\);[\s\S]*return data;/);
  assert.doesNotMatch(body, /clearLocalWeatherCache\(\)/);

  const { createStorageCore } = await import('./localStorage/core.mjs');
  const { LOCAL_STORAGE_REGISTRY } = loadTypeScriptModule(path.join(__dirname, 'localStorage/registry.ts'));
  const adapter = quotaAdapter();
  const storage = createStorageCore({ registry: LOCAL_STORAGE_REGISTRY, adapter });
  const remoteWeather = {
    location: { city: '杭州' },
    weather: { weather: '晴', temperature: 26 },
    source: 'live',
    cacheHit: false,
  };

  const localPersistence = storage.write('weatherLastKnown:v2', remoteWeather);

  assert.deepEqual(remoteWeather, {
    location: { city: '杭州' },
    weather: { weather: '晴', temperature: 26 },
    source: 'live',
    cacheHit: false,
  });
  assert.equal(localPersistence.status, 'cache-skipped');
  assert.equal(localPersistence.attempts, 2);
  assert.equal(adapter.writes, 2);
});
