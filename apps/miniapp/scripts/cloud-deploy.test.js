'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  CONTRACT_VERSION,
  adapters,
  assertArtifactRoot,
  buildDeployArgs,
  deployFunction,
} = require('./cloud-deploy');
const { generateOutfitSource, recommendationStreamSource } = require('./stage-recommendation-artifacts');

test('both functions use one formal deployment contract with assembler adapters', (context) => {
  assert.equal(CONTRACT_VERSION, 'cloudbase-artifact-root-v1');
  assert.notEqual(adapters.generateOutfit.assemble, adapters.recommendationStream.assemble);

  for (const name of ['generateOutfit', 'recommendationStream']) {
    const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), `d1d-contract-${name}-`));
    context.after(() => fs.rmSync(workRoot, { recursive: true, force: true }));
    let uploadedArtifactRoot = '';
    const calls = [];
    const runner = (_tcbCli, args, cwd) => {
      calls.push({ args, cwd });
      if (args[1] === 'deploy') {
        uploadedArtifactRoot = cwd;
      } else if (args[1] === 'code' && args[2] === 'download') {
        fs.cpSync(uploadedArtifactRoot, args[4], { recursive: true });
      }
    };
    const report = deployFunction(name, {
      environmentId: 'test-env',
      runner,
      tcbCli: 'mock-tcb',
      workRoot,
    });
    assert.equal(report.localGate.passed, true);
    assert.equal(report.remoteGate.passed, true);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].cwd, report.artifactRoot);
    assert.deepEqual(calls[0].args.slice(0, 3), ['fn', 'deploy', name]);
    assert.ok(calls[0].args.includes('--dir'));
    assert.equal(calls[0].args[calls[0].args.indexOf('--dir') + 1], '.');
  }
});

test('formal deploy refuses repository source directories', () => {
  assert.throws(() => assertArtifactRoot('generateOutfit', generateOutfitSource), /SOURCE_DIRECTORY_DEPLOY_FORBIDDEN/);
  assert.throws(() => assertArtifactRoot('recommendationStream', recommendationStreamSource), /SOURCE_DIRECTORY_DEPLOY_FORBIDDEN/);
  for (const name of ['generateOutfit', 'recommendationStream']) {
    const args = buildDeployArgs(name, 'test-env');
    assert.equal(args[args.indexOf('--dir') + 1], '.');
    assert.ok(!args.some((value) => path.resolve(value) === path.resolve(generateOutfitSource)));
    assert.ok(!args.some((value) => path.resolve(value) === path.resolve(recommendationStreamSource)));
  }
});
