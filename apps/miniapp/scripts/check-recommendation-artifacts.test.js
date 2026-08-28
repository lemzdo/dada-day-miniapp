'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { checkArtifacts, checkIsolatedRecommendationStreamArtifact } = require('./check-recommendation-artifacts');
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
  assert.equal(report.recommendationStream.isolatedBoot, true);
  assert.deepEqual(report.recommendationStream.outsideArtifactLocalDependencies, []);
});

test('isolated artifact gate rejects legacy repo-sibling fallback even when staging parent has sibling', (context) => {
  const artifacts = stageBoth();
  context.after(() => fs.rmSync(artifacts.parent, { recursive: true, force: true }));
  fs.writeFileSync(path.join(artifacts.recommendationStream, 'index.js'), [
    "'use strict';",
    "function load() { try { return require('./generateOutfit'); } catch { return require('../generateOutfit'); } }",
    'module.exports = load();',
    '',
  ].join('\n'));
  const report = checkIsolatedRecommendationStreamArtifact(artifacts.recommendationStream);
  assert.equal(report.isolatedBoot, false);
  assert.ok(report.outsideArtifactLocalDependencies.some((dependency) => dependency.request === '../generateOutfit'));
});

test('single-artifact CLI runs the same isolated gate and emits machine-readable results', (context) => {
  const artifacts = stageBoth();
  context.after(() => fs.rmSync(artifacts.parent, { recursive: true, force: true }));
  const output = require('node:child_process').execFileSync(process.execPath, [
    path.join(__dirname, 'check-recommendation-artifacts.js'),
    '--recommendationStream',
    artifacts.recommendationStream,
  ], { encoding: 'utf8' });
  assert.match(output, /RECOMMENDATION_STREAM_ISOLATED_ARTIFACT_BOOT=PASS/);
  assert.match(output, /OUTSIDE_ARTIFACT_LOCAL_DEPENDENCIES=\[\]/);
});

test('isolated gate ignores unresolved relative dependencies inside downloaded third-party node_modules', (context) => {
  const artifacts = stageBoth();
  context.after(() => fs.rmSync(artifacts.parent, { recursive: true, force: true }));
  const thirdParty = path.join(artifacts.recommendationStream, 'node_modules', 'remote-package');
  fs.mkdirSync(thirdParty, { recursive: true });
  fs.writeFileSync(path.join(thirdParty, 'browser.js'), "require('./missing-browser-helper');\n");
  const report = checkIsolatedRecommendationStreamArtifact(artifacts.recommendationStream);
  assert.equal(report.isolatedBoot, true);
  assert.deepEqual(report.outsideArtifactLocalDependencies, []);
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
