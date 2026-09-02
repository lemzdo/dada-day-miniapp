'use strict';

// Runs in a fresh child process whose cwd contains ONLY the artifact. No business
// handler is called. External effects fail closed; SDK init/database are inert.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { inside } = require('./cloud-dependency-audit');

function boot(root, spec, manifest) {
  const originalLoad = Module._load;
  const originalResolve = Module._resolveFilename;
  const sideEffects = [], resolutionFailures = [];
  let listeners = 0;
  const blocked = (name) => () => { sideEffects.push(name); throw new Error(`ARTIFACT_BOOT_SIDE_EFFECT: ${name}`); };
  const cloud = {
    DYNAMIC_CURRENT_ENV: 'artifact-isolated', init() {}, database() { return { command: {} }; },
    getWXContext: blocked('cloud.getWXContext'), callFunction: blocked('cloud.callFunction'),
  };
  for (const protocol of ['http', 'https']) {
    const api = require(`node:${protocol}`);
    api.request = blocked(`${protocol}.request`);
    api.get = blocked(`${protocol}.get`);
    api.createServer = () => ({ listen() { listeners += 1; }, on() {}, close() {} });
  }
  require('node:net').connect = blocked('net.connect');
  require('node:net').Socket.prototype.connect = blocked('socket.connect');
  global.fetch = blocked('fetch');
  Module._resolveFilename = function resolve(request, parent, ...args) {
    const resolved = originalResolve.call(this, request, parent, ...args);
    if (!Module.isBuiltin(resolved) && parent?.filename && inside(root, parent.filename) && !inside(root, resolved)) {
      resolutionFailures.push({ request, importer: path.relative(root, parent.filename) });
      throw new Error(`OUTSIDE_ARTIFACT_ROOT: ${request}`);
    }
    return resolved;
  };
  Module._load = function load(request, parent, isMain) {
    if (request === 'wx-server-sdk') return cloud;
    if (request === 'node-fetch') return blocked('node-fetch');
    if (request.startsWith('@d1d/')) {
      // Force the actual deployed fallback, never resolve workspace symlinks.
      const error = new Error(`Package alias unavailable in isolated fallback probe: ${request}`);
      error.code = 'MODULE_NOT_FOUND';
      throw error;
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const runtime = require(path.join(root, 'index.js'));
    if (spec.kind === 'event' && typeof runtime?.main !== 'function') throw new Error('EVENT_HANDLER_MISSING');
    if (spec.kind === 'http-handler' && typeof runtime !== 'function') throw new Error('HTTP_HANDLER_MISSING');
    if (spec.kind === 'http-server' && listeners !== 1) throw new Error('HTTP_SERVER_BOOT_MISSING');
    if (spec.nestedFunction) {
      const nested = require(path.join(root, spec.nestedFunction, 'index.js'));
      if (typeof nested?.main !== 'function') throw new Error('NESTED_HANDLER_MISSING');
    }
    // Lazy modules must also load, including finite dynamic fallback targets.
    for (const file of manifest.runtimeDependencies) {
      if (/\.(?:js|cjs)$/.test(file)) require(path.join(root, file));
    }
    for (const dependency of manifest.dynamicDependencies) {
      for (const target of dependency.targets) {
        if (target.startsWith('.')) Module.createRequire(path.join(root, dependency.importer))(target);
      }
    }
    if (sideEffects.length || resolutionFailures.length) throw new Error('ISOLATION_VIOLATION');
    return { passed: true, sideEffects, resolutionFailures, externalRuntimeStubs: ['wx-server-sdk', 'node-fetch'], handlersInvoked: false };
  } finally {
    Module._load = originalLoad;
    Module._resolveFilename = originalResolve;
  }
}

if (require.main === module) {
  try {
    const root = process.cwd();
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'artifact-manifest.json'), 'utf8'));
    const result = boot(root, manifest.functionContract, manifest);
    process.stdout.write(`ARTIFACT_BOOT_RESULT=${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack}\n`);
    process.exitCode = 1;
  }
}

module.exports = { boot };
