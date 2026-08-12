'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { stage } = require('./stage-helper');

const ENVIRONMENT = 'cloud1-d8gl3k1vkdf0b7f05';

function prepareHelperDeployment({ sourceDirectory, artifactDirectory }) {
  const artifact = path.resolve(artifactDirectory);
  const stageRoot = path.join(artifact, '.phase2-helper-stage');
  const target = path.join(stageRoot, 'generateOutfit');
  const tokenFile = path.join(artifact, '.phase2-benchmark-token');
  const auditFile = path.join(artifact, 'phase2-helper-staging.json');
  if (fs.existsSync(stageRoot) || fs.existsSync(tokenFile) || fs.existsSync(auditFile)) {
    throw new Error('phase2 helper staging already exists');
  }
  fs.mkdirSync(artifact, { recursive: true });
  const token = crypto.randomBytes(32).toString('base64url');
  let staged;
  try {
    staged = stage({ sourceDirectory, targetDirectory: target, token });
    fs.writeFileSync(tokenFile, token, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    fs.chmodSync(tokenFile, 0o600);
    const result = {
      source: staged.source,
      target: staged.target,
      originalIndexSha256: staged.originalIndexSha256,
      stagedIndexSha256: staged.stagedIndexSha256,
      tokenHash: staged.tokenHash,
      targetFunction: 'generateOutfit',
      environment: ENVIRONMENT,
      productionUnmodified: true,
      tokenFile,
      tokenLength: token.length,
    };
    fs.writeFileSync(auditFile, `${JSON.stringify(result, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    return result;
  } catch (error) {
    if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
    if (fs.existsSync(stageRoot) && fs.readdirSync(stageRoot).length === 0) fs.rmdirSync(stageRoot);
    if (fs.existsSync(tokenFile)) fs.rmSync(tokenFile, { force: true });
    throw error;
  }
}

if (require.main === module) {
  const result = prepareHelperDeployment({ sourceDirectory: process.argv[2], artifactDirectory: process.argv[3] });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

module.exports = { prepareHelperDeployment };
