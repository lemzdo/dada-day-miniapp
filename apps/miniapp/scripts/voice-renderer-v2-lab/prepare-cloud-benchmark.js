'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { stageCloudBenchmark } = require('./stage-cloud-benchmark');

const ENVIRONMENT = 'cloud1-d8gl3k1vkdf0b7f05';

function prepareCloudBenchmark({
  sourceDirectory = path.resolve(__dirname, '../../cloudfunctions/generateOutfit'),
  artifactDirectory = path.resolve(__dirname, '../../../../artifacts/voice-renderer-v2-lab'),
} = {}) {
  const artifact = path.resolve(artifactDirectory);
  const stageRoot = path.join(artifact, '.cloud-benchmark-stage');
  const target = path.join(stageRoot, 'generateOutfit');
  const tokenFile = path.join(artifact, '.cloud-benchmark-token');
  const auditFile = path.join(artifact, 'cloud-benchmark-staging.json');
  if (fs.existsSync(stageRoot) || fs.existsSync(tokenFile) || fs.existsSync(auditFile)) throw new Error('CLOUD_STAGE_EXISTS');
  fs.mkdirSync(artifact, { recursive: true });
  const token = crypto.randomBytes(32).toString('base64url');
  try {
    const staged = stageCloudBenchmark({ sourceDirectory, targetDirectory: target, token });
    fs.writeFileSync(tokenFile, token, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    fs.chmodSync(tokenFile, 0o600);
    const audit = {
      version: 'voice-renderer-v2-cloud-staging-v1',
      source: staged.source,
      target: staged.target,
      action: staged.action,
      tokenHash: staged.tokenHash,
      originalIndexSha256: staged.originalIndexSha256,
      stagedIndexSha256: staged.stagedIndexSha256,
      helperSha256: staged.helperSha256,
      promptSha256: staged.promptSha256,
      productionSourceUnmodified: staged.productionSourceUnmodified,
      targetFunction: 'generateOutfit',
      environment: ENVIRONMENT,
      tokenFile,
      tokenLength: token.length,
    };
    fs.writeFileSync(auditFile, `${JSON.stringify(audit, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    return audit;
  } catch (error) {
    if (fs.existsSync(stageRoot)) fs.rmSync(stageRoot, { recursive: true, force: true });
    if (fs.existsSync(tokenFile)) fs.rmSync(tokenFile, { force: true });
    throw error;
  }
}

if (require.main === module) {
  process.stdout.write(`${JSON.stringify(prepareCloudBenchmark(), null, 2)}\n`);
}

module.exports = { ENVIRONMENT, prepareCloudBenchmark };
