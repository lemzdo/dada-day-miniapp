'use strict';

const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { collectRuntimeDependencies } = require('./check-generate-outfit-package');
const {
  generateOutfitSource,
  processUploadImageSource,
  recommendationStreamSource,
} = require('./stage-recommendation-artifacts');

const RECOMMENDATION_STREAM_CANONICAL_FILES = Object.freeze([
  'services/recommendationFirstCardRenderer.js',
  'services/recommendationVoiceRendererProductionV2.js',
]);

const REQUIRED_FILES = Object.freeze({
  generateOutfit: [
    'index.js',
    'package.json',
    'runtime/recommendationCore.js',
    'services/aestheticCompatibility.js',
    'vendor/ai-core/package.json',
    'vendor/garment-assets/package.json',
  ],
  recommendationStream: [
    'index.js',
    'package.json',
    'scf_bootstrap',
    'generateOutfit/index.js',
    'generateOutfit/runtime/recommendationCore.js',
    'generateOutfit/services/aestheticCompatibility.js',
    'generateOutfit/vendor/ai-core/package.json',
    'generateOutfit/vendor/garment-assets/package.json',
  ],
  processUploadImage: [
    'index.js',
    'package.json',
    'services/wardrobeAssetPipeline.js',
    'services/aestheticFeatures.js',
    'services/thumbnail.js',
    'shared/segmentationIntegrity.js',
    'shared/thumbnail.js',
    'vendor/garment-assets/package.json',
    'vendor/garment-assets/src/index.js',
  ],
});

function removeDeploymentMarker(source) {
  return source.replace(/^\/\/ canonical-deploy-[^\r\n]+\r?\n/, '');
}

function findRecommendationStreamRuntimeDrift(artifactRoot) {
  return RECOMMENDATION_STREAM_CANONICAL_FILES.filter((relative) => {
    const canonical = path.join(generateOutfitSource, relative);
    const embedded = path.join(artifactRoot, 'generateOutfit', relative);
    if (!fs.existsSync(canonical) || !fs.existsSync(embedded)) return true;
    return removeDeploymentMarker(fs.readFileSync(embedded, 'utf8')) !== fs.readFileSync(canonical, 'utf8');
  });
}

function sha256File(file) {
  return require('node:crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function findLinks(root) {
  const links = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const metadata = fs.lstatSync(absolute);
      if (metadata.isSymbolicLink()) {
        links.push(path.relative(root, absolute).split(path.sep).join('/'));
      } else if (metadata.isDirectory()) {
        walk(absolute);
      }
    }
  };
  walk(root);
  return links;
}

function verifyManifestIntegrity(name, artifactRoot, expectedManifestSha256 = '') {
  const manifestPath = path.join(artifactRoot, 'artifact-manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error(`${name} artifact manifest is missing`);
  const manifestSha256 = sha256File(manifestPath);
  if (expectedManifestSha256 && manifestSha256 !== expectedManifestSha256) {
    throw new Error(`${name} remote artifact manifest does not match the staged artifact`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.name !== name || !Array.isArray(manifest.files) || !Array.isArray(manifest.runtimeDependencies)) {
    throw new Error(`${name} artifact manifest is invalid`);
  }
  if (manifest.runtimeDependencyCount !== manifest.runtimeDependencies.length) {
    throw new Error(`${name} artifact manifest dependency count is invalid`);
  }
  const failures = [];
  for (const record of manifest.files) {
    const file = path.resolve(artifactRoot, record.path);
    const relative = path.relative(path.resolve(artifactRoot), file);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      failures.push({ path: record.path, reason: 'OUTSIDE_ARTIFACT_ROOT' });
    } else if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      failures.push({ path: record.path, reason: 'MISSING' });
    } else if (fs.statSync(file).size !== record.bytes) {
      failures.push({ path: record.path, reason: 'SIZE_MISMATCH' });
    } else if (sha256File(file) !== record.sha256) {
      failures.push({ path: record.path, reason: 'HASH_MISMATCH' });
    }
  }
  if (failures.length > 0) throw new Error(`${name} artifact manifest integrity failed: ${JSON.stringify(failures)}`);
  return { manifest, manifestSha256 };
}

function relativeFiles(root, files) {
  return files.map((file) => path.relative(root, file).split(path.sep).join('/'));
}

function compareDependencyClosure(sourceRoot, stagedRoot) {
  const sourceDependencies = relativeFiles(sourceRoot, collectRuntimeDependencies(sourceRoot));
  const stagedDependencies = relativeFiles(stagedRoot, collectRuntimeDependencies(stagedRoot));
  const stagedSet = new Set(stagedDependencies);
  return {
    sourceDependencyCount: sourceDependencies.length,
    stagedDependencyCount: stagedDependencies.length,
    sourceDependencies,
    stagedDependencies,
    missingDependencies: sourceDependencies.filter((file) => !stagedSet.has(file)),
  };
}

function withExternalRuntimeStubs(callback) {
  const originalLoad = Module._load;
  Module._load = function loadArtifactDependency(request, parent, isMain) {
    if (request === 'wx-server-sdk') {
      return {
        DYNAMIC_CURRENT_ENV: 'artifact-probe',
        init() {},
        database() { return {}; },
        getWXContext() { return { OPENID: 'artifact-probe' }; },
      };
    }
    if (request === 'node-fetch') return async () => ({ ok: false, status: 503, json: async () => ({}) });
    return originalLoad.call(this, request, parent, isMain);
  };
  try { return callback(); } finally { Module._load = originalLoad; }
}

function bootArtifact(name, artifactRoot) {
  const entry = path.join(artifactRoot, 'index.js');
  const nestedEntry = name === 'recommendationStream' ? path.join(artifactRoot, 'generateOutfit', 'index.js') : entry;
  return withExternalRuntimeStubs(() => {
    delete require.cache[require.resolve(nestedEntry)];
    const runtime = require(nestedEntry);
    if (!runtime || typeof runtime !== 'object') throw new Error(`${name} runtime module did not load`);
    if (name === 'recommendationStream') {
      delete require.cache[require.resolve(entry)];
      const handler = require(entry);
      if (typeof handler !== 'function') throw new Error('recommendationStream handler did not load');
    }
    return true;
  });
}

function artifactJavaScriptFiles(root) {
  const files = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory() && entry.name !== 'node_modules') walk(absolute);
      else if (entry.isFile() && path.extname(entry.name) === '.js') files.push(absolute);
    }
  };
  walk(root);
  return files;
}

function resolveArtifactLocalRequest(request, importer) {
  if (!request.startsWith('.')) return null;
  const base = path.resolve(path.dirname(importer), request);
  const candidates = [base, `${base}.js`, `${base}.json`, `${base}.node`];
  if (fs.existsSync(base) && fs.statSync(base).isDirectory()) {
    const packagePath = path.join(base, 'package.json');
    if (fs.existsSync(packagePath)) {
      try {
        const packageMain = JSON.parse(fs.readFileSync(packagePath, 'utf8')).main;
        if (typeof packageMain === 'string' && packageMain) {
          const main = path.resolve(base, packageMain);
          candidates.push(main, `${main}.js`, `${main}.json`, `${main}.node`);
        }
      } catch { /* Invalid package metadata is treated as unresolved below. */ }
    }
    candidates.push(path.join(base, 'index.js'), path.join(base, 'index.json'));
  }
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) || null;
}

function scanArtifactLocalDependencies(root) {
  const resolvedRoot = fs.realpathSync(root);
  const outsideArtifactLocalDependencies = [];
  const patterns = [
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\b(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g,
  ];
  for (const importer of artifactJavaScriptFiles(resolvedRoot)) {
    const source = fs.readFileSync(importer, 'utf8');
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(source))) {
        const request = match[1];
        if (!request.startsWith('.')) continue;
        const candidate = resolveArtifactLocalRequest(request, importer);
        const resolved = candidate ? fs.realpathSync(candidate) : path.resolve(path.dirname(importer), request);
        const relative = path.relative(resolvedRoot, resolved);
        if (!candidate || relative.startsWith('..') || path.isAbsolute(relative)) {
          outsideArtifactLocalDependencies.push({
            importer: path.relative(resolvedRoot, importer).split(path.sep).join('/'),
            request,
            resolved: path.relative(resolvedRoot, resolved).split(path.sep).join('/'),
            reason: candidate ? 'OUTSIDE_ARTIFACT_ROOT' : 'MISSING_LOCAL_DEPENDENCY',
          });
        }
      }
    }
  }
  return outsideArtifactLocalDependencies;
}

function checkIsolatedRecommendationStreamArtifact(artifactRoot) {
  const tempParent = fs.mkdtempSync(path.join(os.tmpdir(), 'd1d-recommendation-stream-isolated-'));
  const isolatedRoot = path.join(tempParent, 'artifact');
  try {
    fs.cpSync(path.resolve(artifactRoot), isolatedRoot, { recursive: true, errorOnExist: true });
    const outsideArtifactLocalDependencies = scanArtifactLocalDependencies(isolatedRoot);
    const isolatedBoot = outsideArtifactLocalDependencies.length === 0
      && bootArtifact('recommendationStream', isolatedRoot);
    return { isolatedBoot, outsideArtifactLocalDependencies };
  } finally {
    fs.rmSync(tempParent, { recursive: true, force: true });
  }
}

function checkIsolatedArtifact(name, artifactRoot) {
  const tempParent = fs.mkdtempSync(path.join(os.tmpdir(), `d1d-${name}-isolated-`));
  const isolatedRoot = path.join(tempParent, 'artifact');
  try {
    fs.cpSync(path.resolve(artifactRoot), isolatedRoot, { recursive: true, errorOnExist: true });
    const outsideArtifactLocalDependencies = scanArtifactLocalDependencies(isolatedRoot);
    const isolatedBoot = outsideArtifactLocalDependencies.length === 0 && bootArtifact(name, isolatedRoot);
    return { isolatedBoot, outsideArtifactLocalDependencies };
  } finally {
    fs.rmSync(tempParent, { recursive: true, force: true });
  }
}

function checkArtifactContract(name, artifactRoot, options = {}) {
  if (!Object.hasOwn(REQUIRED_FILES, name)) throw new Error(`Unsupported artifact: ${name}`);
  const resolvedRoot = path.resolve(artifactRoot);
  const links = findLinks(resolvedRoot);
  if (links.length > 0) throw new Error(`${name} artifact contains symlink or junction: ${JSON.stringify(links)}`);
  const embeddedRuntimeDrift = name === 'recommendationStream'
    ? findRecommendationStreamRuntimeDrift(resolvedRoot)
    : [];
  if (embeddedRuntimeDrift.length > 0) {
    throw new Error(`${name} embedded runtime drift: ${JSON.stringify(embeddedRuntimeDrift)}`);
  }
  const manifestIntegrity = verifyManifestIntegrity(name, resolvedRoot, options.expectedManifestSha256);
  const requiredFilesMissing = REQUIRED_FILES[name].filter((file) => !fs.existsSync(path.join(resolvedRoot, file)));
  if (requiredFilesMissing.length > 0) {
    throw new Error(`${name} required files are missing: ${JSON.stringify(requiredFilesMissing)}`);
  }

  let closure;
  if (name === 'generateOutfit') {
    closure = compareDependencyClosure(generateOutfitSource, resolvedRoot);
  } else if (name === 'recommendationStream') {
    const nested = compareDependencyClosure(generateOutfitSource, path.join(resolvedRoot, 'generateOutfit'));
    const wrapper = fs.readFileSync(path.join(resolvedRoot, 'index.js'), 'utf8');
    closure = {
      sourceDependencyCount: nested.sourceDependencyCount + 1,
      stagedDependencyCount: nested.stagedDependencyCount + 1,
      missingDependencies: [
        ...nested.missingDependencies.map((file) => `generateOutfit/${file}`),
        ...(!wrapper.includes("require('./generateOutfit')") ? ['index.js'] : []),
      ],
    };
  } else {
    closure = compareDependencyClosure(processUploadImageSource, resolvedRoot);
  }
  const isolated = checkIsolatedArtifact(name, resolvedRoot);
  const passed = closure.missingDependencies.length === 0
    && isolated.isolatedBoot
    && isolated.outsideArtifactLocalDependencies.length === 0;
  return {
    name,
    passed,
    missingDependencies: closure.missingDependencies,
    sourceDependencyCount: closure.sourceDependencyCount,
    artifactDependencyCount: closure.stagedDependencyCount,
    isolatedBoot: isolated.isolatedBoot,
    embeddedRuntimeDrift,
    outsideArtifactLocalDependencies: isolated.outsideArtifactLocalDependencies,
    requiredFilesMissing,
    manifestSha256: manifestIntegrity.manifestSha256,
    manifestIntegrity: true,
    links,
  };
}

function checkArtifacts({ generateOutfitArtifact, recommendationStreamArtifact }) {
  const generate = compareDependencyClosure(generateOutfitSource, generateOutfitArtifact);
  const nestedStreamRoot = path.join(recommendationStreamArtifact, 'generateOutfit');
  const streamRuntime = compareDependencyClosure(generateOutfitSource, nestedStreamRoot);
  const wrapperSource = path.join(recommendationStreamSource, 'index.js');
  const wrapperArtifact = path.join(recommendationStreamArtifact, 'index.js');
  const wrapperPresent = fs.existsSync(wrapperArtifact);
  const wrapperMatches = wrapperPresent && fs.readFileSync(wrapperArtifact, 'utf8').includes("require('./generateOutfit')");
  const recommendation = {
    sourceDependencyCount: streamRuntime.sourceDependencyCount + 1,
    stagedDependencyCount: streamRuntime.stagedDependencyCount + (wrapperPresent ? 1 : 0),
    missingDependencies: [
      ...streamRuntime.missingDependencies.map((file) => `generateOutfit/${file}`),
      ...(!wrapperPresent || !wrapperMatches ? ['index.js'] : []),
    ],
    wrapperSource,
  };
  const result = {
    generateOutfit: {
      ...generate,
      boot: generate.missingDependencies.length === 0 && bootArtifact('generateOutfit', generateOutfitArtifact),
    },
    recommendationStream: {
      ...recommendation,
      boot: recommendation.missingDependencies.length === 0 && bootArtifact('recommendationStream', recommendationStreamArtifact),
    },
  };
  const isolated = checkIsolatedRecommendationStreamArtifact(recommendationStreamArtifact);
  result.recommendationStream.isolatedBoot = isolated.isolatedBoot;
  result.recommendationStream.outsideArtifactLocalDependencies = isolated.outsideArtifactLocalDependencies;
  result.passed = result.generateOutfit.missingDependencies.length === 0
    && result.recommendationStream.missingDependencies.length === 0
    && result.generateOutfit.boot
    && result.recommendationStream.boot
    && result.recommendationStream.isolatedBoot
    && result.recommendationStream.outsideArtifactLocalDependencies.length === 0;
  return result;
}

function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--recommendationStream' || args[0] === '--recommendation-stream') {
    if (!args[1] || args.length > 2) {
      throw new Error('Usage: node check-recommendation-artifacts.js --recommendationStream <artifactRoot>');
    }
    const result = checkIsolatedRecommendationStreamArtifact(path.resolve(args[1]));
    console.log(`RECOMMENDATION_STREAM_ISOLATED_ARTIFACT_BOOT=${result.isolatedBoot ? 'PASS' : 'FAIL'}`);
    console.log(`OUTSIDE_ARTIFACT_LOCAL_DEPENDENCIES=${JSON.stringify(result.outsideArtifactLocalDependencies)}`);
    if (!result.isolatedBoot || result.outsideArtifactLocalDependencies.length > 0) {
      throw new Error(JSON.stringify(result));
    }
    return;
  }
  const [generateOutfitArtifact, recommendationStreamArtifact] = args;
  if (!generateOutfitArtifact || !recommendationStreamArtifact) {
    throw new Error('Usage: node check-recommendation-artifacts.js <generateOutfitArtifact> <recommendationStreamArtifact>');
  }
  const result = checkArtifacts({
    generateOutfitArtifact: path.resolve(generateOutfitArtifact),
    recommendationStreamArtifact: path.resolve(recommendationStreamArtifact),
  });
  if (!result.passed) throw new Error(JSON.stringify(result));
  console.log(`GENERATE_OUTFIT_SOURCE_DEP_COUNT=${result.generateOutfit.sourceDependencyCount}`);
  console.log(`GENERATE_OUTFIT_STAGED_DEP_COUNT=${result.generateOutfit.stagedDependencyCount}`);
  console.log(`GENERATE_OUTFIT_MISSING_DEPS=${JSON.stringify(result.generateOutfit.missingDependencies)}`);
  console.log(`RECOMMENDATION_STREAM_SOURCE_DEP_COUNT=${result.recommendationStream.sourceDependencyCount}`);
  console.log(`RECOMMENDATION_STREAM_STAGED_DEP_COUNT=${result.recommendationStream.stagedDependencyCount}`);
  console.log(`RECOMMENDATION_STREAM_MISSING_DEPS=${JSON.stringify(result.recommendationStream.missingDependencies)}`);
  console.log('GENERATE_OUTFIT_ARTIFACT_BOOT=PASS');
  console.log('RECOMMENDATION_STREAM_ARTIFACT_BOOT=PASS');
  console.log(`RECOMMENDATION_STREAM_ISOLATED_ARTIFACT_BOOT=${result.recommendationStream.isolatedBoot ? 'PASS' : 'FAIL'}`);
  console.log(`OUTSIDE_ARTIFACT_LOCAL_DEPENDENCIES=${JSON.stringify(result.recommendationStream.outsideArtifactLocalDependencies)}`);
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error(`[recommendation-artifact-integrity] FAIL ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  bootArtifact,
  checkArtifactContract,
  checkArtifacts,
  checkIsolatedArtifact,
  compareDependencyClosure,
  findRecommendationStreamRuntimeDrift,
  findLinks,
  scanArtifactLocalDependencies,
  checkIsolatedRecommendationStreamArtifact,
  verifyManifestIntegrity,
};
