'use strict';

// Build-only staging helper. The generated directory is disposable and must
// never be committed: it places the single generateOutfit source beside the
// HTTP wrapper so CloudBase does not resolve a sibling workspace dependency.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { collectRuntimeDependencies } = require('./check-generate-outfit-package');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'cloudfunctions', 'generateOutfit');
const aiCoreSource = path.resolve(root, '..', '..', 'packages', 'ai-core');
const garmentAssetsSource = path.resolve(root, '..', '..', 'packages', 'garment-assets');
const destination = path.resolve(process.argv[2] || path.join(root, '.staging', 'recommendationStream'));
const environmentFile = process.argv[3] ? path.resolve(process.argv[3]) : null;
const environmentId = String(process.argv[4] || process.env.CLOUDBASE_ENV_ID || '').trim();

function assertSafeDisposableDirectory(directory) {
  const parsed = path.parse(directory);
  const forbidden = new Set([
    path.resolve(parsed.root),
    path.resolve(os.homedir()),
    path.resolve(root),
    path.resolve(root, '..'),
  ]);
  if (forbidden.has(directory)) {
    throw new Error(`Refusing to replace unsafe staging directory: ${directory}`);
  }
}

function parseEnvironmentFile(file) {
  const variables = {};
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    variables[key] = value;
  }
  return variables;
}

assertSafeDisposableDirectory(destination);
fs.rmSync(destination, { recursive: true, force: true });
fs.mkdirSync(destination, { recursive: true });
const stagedRuntime = path.join(destination, 'generateOutfit');
for (const sourceFile of collectRuntimeDependencies(source)) {
  const relative = path.relative(source, sourceFile);
  const target = path.join(stagedRuntime, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(sourceFile, target);
}
const stagedPackage = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
stagedPackage.dependencies['@d1d/ai-core'] = 'file:vendor/ai-core';
stagedPackage.dependencies['@d1d/garment-assets'] = 'file:vendor/garment-assets';
fs.writeFileSync(path.join(stagedRuntime, 'package.json'), `${JSON.stringify(stagedPackage, null, 2)}\n`);
// CloudBase remote npm cannot resolve workspace:* (and ai-core is private),
// so stage the shared package as a deploy-local file dependency. This is a
// generated copy only; source of truth remains packages/ai-core.
if (!fs.existsSync(path.join(aiCoreSource, 'package.json'))) {
  throw new Error(`Shared AI core package is missing: ${aiCoreSource}`);
}
const stagedAiCore = path.join(stagedRuntime, 'vendor', 'ai-core');
fs.mkdirSync(stagedAiCore, { recursive: true });
fs.copyFileSync(path.join(aiCoreSource, 'package.json'), path.join(stagedAiCore, 'package.json'));
const copyAiCoreRuntime = (directory, target) => {
  fs.mkdirSync(target, { recursive: true });
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    if (item.name.endsWith('.test.js')) continue;
    const from = path.join(directory, item.name);
    const to = path.join(target, item.name);
    if (item.isDirectory()) copyAiCoreRuntime(from, to);
    else if (item.isFile()) fs.copyFileSync(from, to);
  }
};
copyAiCoreRuntime(path.join(aiCoreSource, 'src'), path.join(stagedAiCore, 'src'));
if (!fs.existsSync(path.join(garmentAssetsSource, 'package.json'))) {
  throw new Error(`Shared garment assets package is missing: ${garmentAssetsSource}`);
}
const stagedGarmentAssets = path.join(stagedRuntime, 'vendor', 'garment-assets');
fs.mkdirSync(stagedGarmentAssets, { recursive: true });
fs.cpSync(garmentAssetsSource, stagedGarmentAssets, { recursive: true, filter: (sourcePath) => !sourcePath.endsWith('.test.js') && !sourcePath.includes(`${path.sep}node_modules${path.sep}`) });
fs.cpSync(path.join(root, 'cloudfunctions', 'recommendationStream', 'index.js'), path.join(destination, 'index.js'));
fs.cpSync(path.join(root, 'cloudfunctions', 'recommendationStream', 'package.json'), path.join(destination, 'package.json'));
fs.cpSync(path.join(root, 'cloudfunctions', 'recommendationStream', 'scf_bootstrap'), path.join(destination, 'scf_bootstrap'));
if (environmentFile) {
  const envVariables = parseEnvironmentFile(environmentFile);
  if (!environmentId) {
    throw new Error('CloudBase environment id is required for deployment staging');
  }
  if (!envVariables.BAILIAN_API_KEY) {
    throw new Error('BAILIAN_API_KEY is required for the direct recommendation renderer');
  }
  fs.writeFileSync(path.join(destination, 'cloudbaserc.json'), `${JSON.stringify({
    envId: environmentId,
    functions: [{
      name: 'recommendationStream',
      runtime: 'Nodejs20.19',
      timeout: 10,
      handler: 'index.main',
      envVariables,
    }],
  }, null, 2)}\n`, { mode: 0o600 });
}
console.log(`[recommendationStream-stage] ${destination}`);
