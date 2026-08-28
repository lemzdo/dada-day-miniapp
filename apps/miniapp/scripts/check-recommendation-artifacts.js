'use strict';

const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { collectRuntimeDependencies } = require('./check-generate-outfit-package');
const { generateOutfitSource, recommendationStreamSource } = require('./stage-recommendation-artifacts');

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
  checkArtifacts,
  compareDependencyClosure,
  scanArtifactLocalDependencies,
  checkIsolatedRecommendationStreamArtifact,
};
