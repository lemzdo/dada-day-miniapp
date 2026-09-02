'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { collectRuntimeDependencies } = require('./check-generate-outfit-package');

const miniappRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(miniappRoot, '..', '..');
const cloudfunctionsRoot = path.join(miniappRoot, 'cloudfunctions');
const generateOutfitSource = path.join(cloudfunctionsRoot, 'generateOutfit');
const recommendationStreamSource = path.join(cloudfunctionsRoot, 'recommendationStream');
const processUploadImageSource = path.join(cloudfunctionsRoot, 'processUploadImage');

function assertSafeDisposableDirectory(directory) {
  const resolved = path.resolve(directory);
  const parsed = path.parse(resolved);
  const forbidden = new Set([
    path.resolve(parsed.root),
    path.resolve(os.homedir()),
    path.resolve(repoRoot),
    path.resolve(miniappRoot),
    path.resolve(cloudfunctionsRoot),
    path.resolve(generateOutfitSource),
    path.resolve(recommendationStreamSource),
    path.resolve(processUploadImageSource),
  ]);
  if (forbidden.has(resolved)) throw new Error(`Refusing to replace unsafe staging directory: ${resolved}`);
}

function copyFile(source, destination, deploymentMarker = '') {
  const metadata = fs.lstatSync(source);
  if (metadata.isSymbolicLink()) throw new Error(`Deployment source cannot be a symlink or junction: ${source}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (deploymentMarker && path.extname(source) === '.js') {
    fs.writeFileSync(destination, `// ${deploymentMarker}\n${fs.readFileSync(source, 'utf8')}`, 'utf8');
  } else {
    fs.copyFileSync(source, destination);
  }
}

function copyDirectory(source, destination, filter = () => true) {
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const from = path.join(directory, entry.name);
      if (!filter(from, entry)) continue;
      if (entry.isSymbolicLink()) throw new Error(`Deployment source cannot be a symlink or junction: ${from}`);
      const relative = path.relative(source, from);
      const to = path.join(destination, relative);
      if (entry.isDirectory()) {
        fs.mkdirSync(to, { recursive: true });
        walk(from);
      } else if (entry.isFile()) copyFile(from, to);
    }
  };
  fs.mkdirSync(destination, { recursive: true });
  walk(source);
}

function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function writeManifest({ name, destination, runtimeDependencies, refreshRoots }) {
  const files = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile() && entry.name !== 'artifact-manifest.json') {
        files.push({
          path: path.relative(destination, absolute).split(path.sep).join('/'),
          bytes: fs.statSync(absolute).size,
          sha256: hashFile(absolute),
        });
      }
    }
  };
  walk(destination);
  files.sort((left, right) => left.path.localeCompare(right.path));
  const manifest = {
    version: 'recommendation-cloudfunction-artifact-v1',
    name,
    runtimeDependencies,
    runtimeDependencyCount: runtimeDependencies.length,
    refreshRoots: [...new Set(refreshRoots)].sort(),
    files,
  };
  fs.writeFileSync(path.join(destination, 'artifact-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}

function stageVendorPackages(destination) {
  const aiCoreSource = path.join(repoRoot, 'packages', 'ai-core');
  if (!fs.existsSync(path.join(aiCoreSource, 'package.json'))) throw new Error(`Shared AI core package is missing: ${aiCoreSource}`);
  const aiCoreDestination = path.join(destination, 'vendor', 'ai-core');
  copyFile(path.join(aiCoreSource, 'package.json'), path.join(aiCoreDestination, 'package.json'));
  copyDirectory(path.join(aiCoreSource, 'src'), path.join(aiCoreDestination, 'src'), (sourcePath) => !sourcePath.endsWith('.test.js'));
  stageGarmentAssetsPackage(destination);
}

function stageGarmentAssetsPackage(destination) {
  const garmentAssetsSource = path.join(repoRoot, 'packages', 'garment-assets');
  if (!fs.existsSync(path.join(garmentAssetsSource, 'package.json'))) throw new Error(`Shared garment assets package is missing: ${garmentAssetsSource}`);
  const vendorDestination = path.join(destination, 'vendor', 'garment-assets');
  copyFile(path.join(garmentAssetsSource, 'package.json'), path.join(vendorDestination, 'package.json'));
  copyDirectory(path.join(garmentAssetsSource, 'src'), path.join(vendorDestination, 'src'), (sourcePath) => !sourcePath.endsWith('.test.js'));
}

function stageGenerateOutfit(destination, { deploymentMarker = '', reset = true } = {}) {
  const resolvedDestination = path.resolve(destination);
  assertSafeDisposableDirectory(resolvedDestination);
  if (reset) fs.rmSync(resolvedDestination, { recursive: true, force: true });
  fs.mkdirSync(resolvedDestination, { recursive: true });
  const runtimeFiles = collectRuntimeDependencies(generateOutfitSource);
  const runtimeDependencies = runtimeFiles.map((sourceFile) => {
    const relative = path.relative(generateOutfitSource, sourceFile);
    copyFile(sourceFile, path.join(resolvedDestination, relative), deploymentMarker);
    return relative.split(path.sep).join('/');
  });
  const packageJson = JSON.parse(fs.readFileSync(path.join(generateOutfitSource, 'package.json'), 'utf8'));
  packageJson.dependencies['@d1d/ai-core'] = 'file:vendor/ai-core';
  packageJson.dependencies['@d1d/garment-assets'] = 'file:vendor/garment-assets';
  fs.writeFileSync(path.join(resolvedDestination, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
  stageVendorPackages(resolvedDestination);
  const refreshRoots = runtimeDependencies
    .filter((file) => file.includes('/'))
    .map((file) => file.split('/')[0]);
  refreshRoots.push('vendor');
  return writeManifest({ name: 'generateOutfit', destination: resolvedDestination, runtimeDependencies, refreshRoots });
}

function stageRecommendationStream(destination, options = {}) {
  const resolvedDestination = path.resolve(destination);
  assertSafeDisposableDirectory(resolvedDestination);
  fs.rmSync(resolvedDestination, { recursive: true, force: true });
  fs.mkdirSync(resolvedDestination, { recursive: true });
  const nestedDestination = path.join(resolvedDestination, 'generateOutfit');
  const nestedManifest = stageGenerateOutfit(nestedDestination, { deploymentMarker: options.deploymentMarker, reset: false });
  for (const name of ['index.js', 'package.json', 'scf_bootstrap']) {
    copyFile(path.join(recommendationStreamSource, name), path.join(resolvedDestination, name), options.deploymentMarker);
  }
  if (options.cloudbaseConfig) {
    fs.writeFileSync(path.join(resolvedDestination, 'cloudbaserc.json'), `${JSON.stringify(options.cloudbaseConfig, null, 2)}\n`, { mode: 0o600 });
  }
  const runtimeDependencies = ['index.js', ...nestedManifest.runtimeDependencies.map((file) => `generateOutfit/${file}`)];
  const refreshRoots = nestedManifest.refreshRoots.map((root) => `generateOutfit/${root}`);
  return writeManifest({ name: 'recommendationStream', destination: resolvedDestination, runtimeDependencies, refreshRoots });
}

function stageProcessUploadImage(destination, { deploymentMarker = '' } = {}) {
  const resolvedDestination = path.resolve(destination);
  assertSafeDisposableDirectory(resolvedDestination);
  fs.rmSync(resolvedDestination, { recursive: true, force: true });
  fs.mkdirSync(resolvedDestination, { recursive: true });
  const runtimeFiles = collectRuntimeDependencies(processUploadImageSource);
  const runtimeDependencies = runtimeFiles.map((sourceFile) => {
    const relative = path.relative(processUploadImageSource, sourceFile);
    copyFile(sourceFile, path.join(resolvedDestination, relative), deploymentMarker);
    return relative.split(path.sep).join('/');
  });
  const packageJson = JSON.parse(fs.readFileSync(path.join(processUploadImageSource, 'package.json'), 'utf8'));
  packageJson.dependencies['@d1d/garment-assets'] = 'file:vendor/garment-assets';
  fs.writeFileSync(path.join(resolvedDestination, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
  stageGarmentAssetsPackage(resolvedDestination);
  const refreshRoots = runtimeDependencies
    .filter((file) => file.includes('/'))
    .map((file) => file.split('/')[0]);
  refreshRoots.push('vendor');
  return writeManifest({ name: 'processUploadImage', destination: resolvedDestination, runtimeDependencies, refreshRoots });
}

function main() {
  const [name, destination, deploymentMarker = ''] = process.argv.slice(2);
  if (!['generateOutfit', 'recommendationStream', 'processUploadImage'].includes(name) || !destination) {
    throw new Error('Usage: node stage-recommendation-artifacts.js <generateOutfit|recommendationStream|processUploadImage> <destination> [deploymentMarker]');
  }
  const manifest = name === 'generateOutfit'
    ? stageGenerateOutfit(destination, { deploymentMarker })
    : name === 'recommendationStream'
      ? stageRecommendationStream(destination, { deploymentMarker })
      : stageProcessUploadImage(destination, { deploymentMarker });
  console.log(`[recommendation-artifact-stage] name=${name} dependencies=${manifest.runtimeDependencyCount} files=${manifest.files.length}`);
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error(`[recommendation-artifact-stage] FAIL ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  generateOutfitSource,
  processUploadImageSource,
  recommendationStreamSource,
  stageGenerateOutfit,
  stageProcessUploadImage,
  stageRecommendationStream,
};
