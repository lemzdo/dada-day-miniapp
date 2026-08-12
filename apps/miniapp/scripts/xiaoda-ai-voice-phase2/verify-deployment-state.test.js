'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { verifyDeploymentState } = require('./verify-deployment-state');
const { cleanupLocalStaging } = require('./cleanup-local-staging');

function tree(content = 'module.exports = {};') { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p2-audit-')); fs.writeFileSync(path.join(dir, 'index.js'), content); return dir; }
test('deployment audit verifies unchanged production index and redacts token', () => {
  const pre = tree(); const post = tree(); const artifact = fs.mkdtempSync(path.join(os.tmpdir(), 'p2-art-'));
  const audit = verifyDeploymentState({ preDownloadDir: pre, postDownloadDir: post, artifactDir: artifact, stagingAudit: { localStagingStatus: 'REMOVED', token: 'secret' }, cloudEvidence: { target: 'generateOutfit', status: 'Active' } });
  assert.equal(audit.pass, true); assert.equal(audit.postDownload.indexMatchesPre, true); assert.equal(JSON.stringify(audit).includes('secret'), false); assert.ok(fs.existsSync(path.join(artifact, 'deployment-audit.json')));
});
test('deployment audit rejects phase2 dispatch in post index', () => { const pre = tree(); const post = tree('xiaodaVoicePhase2Benchmark'); assert.equal(verifyDeploymentState({ preDownloadDir: pre, postDownloadDir: post }).pass, false); });
test('cleanup only removes exact phase2 staging allowlist', () => {
  const artifact = fs.mkdtempSync(path.join(os.tmpdir(), 'p2-clean-')); fs.mkdirSync(path.join(artifact, '.phase2-helper-stage')); fs.writeFileSync(path.join(artifact, '.phase2-benchmark-token'), 'secret');
  const result = cleanupLocalStaging(artifact); assert.deepEqual(result.removed.sort(), ['.phase2-benchmark-token', '.phase2-helper-stage']); assert.throws(() => cleanupLocalStaging(artifact, ['other']), /NOT_ALLOWED/);
});
