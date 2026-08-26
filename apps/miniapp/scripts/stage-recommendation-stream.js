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
fs.copyFileSync(path.join(source, 'package.json'), path.join(stagedRuntime, 'package.json'));
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
