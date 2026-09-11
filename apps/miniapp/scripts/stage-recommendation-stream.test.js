'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');
const { collectRuntimeDependencies } = require('./check-generate-outfit-package');

test('HTTP staging contains one deploy-local copy of the canonical generateOutfit dependency graph', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'd1d-recommendation-stream-'));
  const stage = path.join(parent, 'recommendationStream');
  try {
    execFileSync(process.execPath, [path.join(__dirname, 'stage-recommendation-stream.js'), stage], { stdio: 'pipe' });
    assert.ok(fs.existsSync(path.join(stage, 'index.js')));
    assert.ok(fs.existsSync(path.join(stage, 'scf_bootstrap')));
    const bootstrap = fs.readFileSync(path.join(stage, 'scf_bootstrap'));
    assert.equal(bootstrap.includes(13), false);
    assert.equal(bootstrap.toString('utf8'), '#!/bin/bash\nnode index.js\n');
    assert.ok(fs.existsSync(path.join(stage, 'generateOutfit', 'runtime', 'recommendationCore.js')));
    assert.ok(fs.existsSync(path.join(stage, 'generateOutfit', 'runtime', 'recommendationOrchestrator.js')));
    assert.equal(fs.existsSync(path.join(stage, 'generateOutfit', 'runtime', 'recommendationRuntime.js')), false);
    assert.doesNotMatch(fs.readFileSync(path.join(stage, 'index.js'), 'utf8'), /recommendationTransportLab|httpFunctionSmokeLab/);
    const stagedFiles = [];
    const walk = (directory) => fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else stagedFiles.push(absolute);
    });
    walk(stage);
    assert.equal(stagedFiles.some((file) => file.endsWith('.test.js')), false);
    const dependencies = collectRuntimeDependencies(path.join(stage, 'generateOutfit'));
    assert.ok(dependencies.length > 20);
    assert.ok(dependencies.every((file) => file.startsWith(`${path.join(stage, 'generateOutfit')}${path.sep}`)));
    const packageJson = JSON.parse(fs.readFileSync(path.join(stage, 'package.json'), 'utf8'));
    assert.equal(packageJson.dependencies['wx-server-sdk'], '3.0.4');
    assert.equal(packageJson.dependencies['node-fetch'], '2.7.0');
    const generatePackageJson = JSON.parse(fs.readFileSync(path.join(stage, 'generateOutfit', 'package.json'), 'utf8'));
    assert.equal(generatePackageJson.dependencies['@d1d/ai-core'], 'file:vendor/ai-core');
    assert.ok(fs.existsSync(path.join(stage, 'generateOutfit', 'vendor', 'ai-core', 'src', 'index.js')));
    const stagedIndex = fs.readFileSync(path.join(stage, 'index.js'), 'utf8');
    const preloadCall = stagedIndex.indexOf('  loadGenerateOutfitModule();');
    assert.ok(preloadCall > 0 && preloadCall < stagedIndex.indexOf('const handler = createRecommendationStreamHandler();'));
    const vendorProbe = [
      "const resolver = require('./generateOutfit/services/deployPackageResolver');",
      "const core = resolver.loadDeployPackage('@d1d/ai-core', ['..', 'vendor', 'ai-core']);",
      "if (core.getTask('recommendation_reason')?.model !== 'qwen3.7-max') process.exit(1);",
      "const assets = resolver.loadDeployPackage('@d1d/garment-assets', ['..', 'vendor', 'garment-assets']);",
      "if (assets.getStableFactReference({ cleanImageUrl: 'cloud://clean' }) !== 'cloud://clean') process.exit(1);",
    ].join(' ');
    execFileSync(process.execPath, ['-e', vendorProbe], { cwd: stage, stdio: 'pipe' });
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('HTTP staging creates a private Node 20 deployment config from an environment file', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'd1d-recommendation-stream-config-'));
  const stage = path.join(parent, 'recommendationStream');
  const environmentFile = path.join(parent, 'generateOutfit.env');
  try {
    fs.writeFileSync(environmentFile, 'BAILIAN_API_KEY="test-only-key"\nBAILIAN_MODEL=qwen-test\n');
    execFileSync(process.execPath, [
      path.join(__dirname, 'stage-recommendation-stream.js'),
      stage,
      environmentFile,
      'cloud-test-environment',
    ], { stdio: 'pipe' });
    const configPath = path.join(stage, 'cloudbaserc.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.equal(config.envId, 'cloud-test-environment');
    assert.equal(config.functions[0].runtime, 'Nodejs20.19');
    assert.equal(config.functions[0].memorySize, 1024);
    assert.equal(config.functions[0].timeout, 10);
    assert.equal(config.functions[0].envVariables.BAILIAN_API_KEY, 'test-only-key');
    assert.equal(config.functions[0].envVariables.BAILIAN_MODEL, 'qwen-test');
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});
