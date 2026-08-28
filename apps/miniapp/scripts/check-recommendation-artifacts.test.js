'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { checkArtifacts } = require('./check-recommendation-artifacts');
const { stageGenerateOutfit, stageRecommendationStream } = require('./stage-recommendation-artifacts');

function stageBoth() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'd1d-recommendation-artifacts-'));
  const generateOutfit = path.join(parent, 'generateOutfit');
  const recommendationStream = path.join(parent, 'recommendationStream');
  stageGenerateOutfit(generateOutfit);
  stageRecommendationStream(recommendationStream);
  return { parent, generateOutfit, recommendationStream };
}

test('both final artifacts contain the complete local runtime dependency closure and boot', (context) => {
  const artifacts = stageBoth();
  context.after(() => fs.rmSync(artifacts.parent, { recursive: true, force: true }));
  const report = checkArtifacts({
    generateOutfitArtifact: artifacts.generateOutfit,
    recommendationStreamArtifact: artifacts.recommendationStream,
  });
  assert.equal(report.passed, true);
  assert.equal(report.generateOutfit.sourceDependencyCount, 78);
  assert.equal(report.generateOutfit.stagedDependencyCount, 78);
  assert.deepEqual(report.generateOutfit.missingDependencies, []);
  assert.equal(report.recommendationStream.sourceDependencyCount, 79);
  assert.equal(report.recommendationStream.stagedDependencyCount, 79);
  assert.deepEqual(report.recommendationStream.missingDependencies, []);
});

test('artifact integrity gate fails when any recursive service dependency is removed', (context) => {
  const artifacts = stageBoth();
  context.after(() => fs.rmSync(artifacts.parent, { recursive: true, force: true }));
  fs.rmSync(path.join(artifacts.generateOutfit, 'services', 'aestheticCompatibility.js'));
  assert.throws(() => checkArtifacts({
    generateOutfitArtifact: artifacts.generateOutfit,
    recommendationStreamArtifact: artifacts.recommendationStream,
  }), /Missing local runtime dependency/);
});

test('HTTP artifact gate fails when its vendored recommendation dependency is removed', (context) => {
  const artifacts = stageBoth();
  context.after(() => fs.rmSync(artifacts.parent, { recursive: true, force: true }));
  fs.rmSync(path.join(artifacts.recommendationStream, 'generateOutfit', 'services', 'aestheticCompatibility.js'));
  assert.throws(() => checkArtifacts({
    generateOutfitArtifact: artifacts.generateOutfit,
    recommendationStreamArtifact: artifacts.recommendationStream,
  }), /Missing local runtime dependency/);
});
