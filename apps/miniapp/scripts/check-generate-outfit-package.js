'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const DEFAULT_ROOT = path.resolve(__dirname, '..', 'cloudfunctions', 'generateOutfit');
const BUILTINS = new Set(Module.builtinModules);
const REQUIRE_RE = /\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g;
const IMPORT_RE = /\b(?:import|export)\s+(?:[^'";]*?\sfrom\s*)?(['"])([^'"]+)\1/g;

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function normalizeRelative(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join('/');
}

function resolveLocalDependency(specifier, importer, root) {
  if (!specifier.startsWith('.')) return null;
  const requested = path.resolve(path.dirname(importer), specifier);
  const candidates = [requested, `${requested}.js`, `${requested}.json`, path.join(requested, 'index.js'), path.join(requested, 'index.json')];
  const resolved = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  if (!resolved) throw new Error(`Missing local runtime dependency: ${normalizeRelative(root, requested)} imported by ${normalizeRelative(root, importer)}`);
  const realRoot = fs.realpathSync(root);
  const realResolved = fs.realpathSync(resolved);
  if (!isInside(realRoot, realResolved)) throw new Error(`Runtime dependency escapes function root: ${normalizeRelative(root, importer)} -> ${specifier}`);
  return realResolved;
}

function readDependencySpecifiers(source) {
  const result = [];
  for (const regex of [REQUIRE_RE, IMPORT_RE]) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(source)) !== null) result.push(match[2]);
  }
  return [...new Set(result)];
}

function collectRuntimeDependencies(root) {
  const entry = path.join(root, 'index.js');
  if (!fs.existsSync(entry)) throw new Error(`Required runtime entry is missing: ${entry}`);
  const visited = new Set();
  const stack = [fs.realpathSync(entry)];
  while (stack.length > 0) {
    const current = stack.pop();
    if (visited.has(current)) continue;
    visited.add(current);
    if (path.extname(current) === '.json') continue;
    const source = fs.readFileSync(current, 'utf8');
    for (const specifier of readDependencySpecifiers(source)) {
      if (BUILTINS.has(specifier) || specifier.startsWith('node:')) continue;
      const dependency = resolveLocalDependency(specifier, current, root);
      if (dependency) stack.push(dependency);
    }
  }
  return [...visited].sort((a, b) => a.localeCompare(b));
}

function collectPackageFiles(root) {
  const files = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) files.push(fs.realpathSync(absolute));
    }
  };
  walk(root);
  return files.sort((a, b) => a.localeCompare(b));
}

function analyzePackage(root = DEFAULT_ROOT) {
  const resolvedRoot = fs.realpathSync(path.resolve(root));
  const runtimeFiles = collectRuntimeDependencies(resolvedRoot);
  const packageFiles = new Set(collectPackageFiles(resolvedRoot));
  const missingRuntimeFiles = runtimeFiles.filter((file) => !packageFiles.has(file));
  const relativeRuntimeFiles = runtimeFiles.map((file) => normalizeRelative(resolvedRoot, file));
  const relativePackageFiles = [...packageFiles].map((file) => normalizeRelative(resolvedRoot, file));
  const requiredDirectories = {
    index: relativePackageFiles.includes('index.js'),
    services: relativePackageFiles.some((file) => file.startsWith('services/')),
    shared: relativePackageFiles.some((file) => file.startsWith('shared/')),
  };
  return {
    root: resolvedRoot,
    packageFileCount: relativePackageFiles.length,
    packageBytes: relativePackageFiles.reduce((sum, file) => sum + fs.statSync(path.join(resolvedRoot, file)).size, 0),
    runtimeDependencyCount: relativeRuntimeFiles.length,
    runtimeDependencies: relativeRuntimeFiles,
    requiredDirectories,
    missingRuntimeFiles: missingRuntimeFiles.map((file) => normalizeRelative(resolvedRoot, file)),
    passed: Object.values(requiredDirectories).every(Boolean) && missingRuntimeFiles.length === 0,
  };
}

function assertPackageIntegrity(root = DEFAULT_ROOT) {
  const report = analyzePackage(root);
  if (!report.passed) {
    const missing = report.missingRuntimeFiles.length > 0 ? ` missing runtime files: ${report.missingRuntimeFiles.join(',')}` : '';
    throw new Error(`generateOutfit package integrity failed.${missing}`);
  }
  return report;
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    const requestedRoot = args.find((arg) => !arg.startsWith('-')) || DEFAULT_ROOT;
    const report = assertPackageIntegrity(requestedRoot);
    console.log(`[generateOutfit-package-integrity] PASS files=${report.packageFileCount} bytes=${report.packageBytes} runtimeDependencies=${report.runtimeDependencyCount} services=${report.requiredDirectories.services} shared=${report.requiredDirectories.shared}`);
    if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(`[generateOutfit-package-integrity] FAIL ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { DEFAULT_ROOT, analyzePackage, assertPackageIntegrity, collectRuntimeDependencies, readDependencySpecifiers };
