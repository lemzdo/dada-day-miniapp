'use strict';

const fs = require('node:fs');
const Module = require('node:module');
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
  result.passed = result.generateOutfit.missingDependencies.length === 0
    && result.recommendationStream.missingDependencies.length === 0
    && result.generateOutfit.boot
    && result.recommendationStream.boot;
  return result;
}

function main() {
  const [generateOutfitArtifact, recommendationStreamArtifact] = process.argv.slice(2);
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
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error(`[recommendation-artifact-integrity] FAIL ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { bootArtifact, checkArtifacts, compareDependencyClosure };
