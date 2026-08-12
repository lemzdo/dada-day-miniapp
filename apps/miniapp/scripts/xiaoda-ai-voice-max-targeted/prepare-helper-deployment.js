'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { stage } = require('./stage-helper');

const ENVIRONMENT = 'cloud1-d8gl3k1vkdf0b7f05';

function prepareHelperDeployment({ sourceDirectory, artifactDirectory }) {
  const artifact = path.resolve(artifactDirectory);
  const stageRoot = path.join(artifact, '.max-targeted-helper-stage');
  const target = path.join(stageRoot, 'generateOutfit');
  const tokenFile = path.join(artifact, '.max-targeted-benchmark-token');
  const auditFile = path.join(artifact, 'max-targeted-helper-staging.json');
  if ([stageRoot, tokenFile, auditFile].some(fs.existsSync)) throw new Error('STAGING_ALREADY_EXISTS');
  fs.mkdirSync(artifact, { recursive: true });
  const token = crypto.randomBytes(32).toString('base64url');
  try {
    const staged = stage({ sourceDirectory, targetDirectory: target, token });
    fs.writeFileSync(tokenFile, token, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    const audit = { ...staged, token: 'REDACTED', tokenFile, tokenLength: token.length, targetFunction: 'generateOutfit', environment: ENVIRONMENT };
    fs.writeFileSync(auditFile, `${JSON.stringify(audit, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    return audit;
  } catch (error) {
    fs.rmSync(stageRoot, { recursive: true, force: true });
    fs.rmSync(tokenFile, { force: true });
    throw error;
  }
}

if (require.main === module) process.stdout.write(`${JSON.stringify(prepareHelperDeployment({ sourceDirectory: process.argv[2], artifactDirectory: process.argv[3] }), null, 2)}\n`);
module.exports = { ENVIRONMENT, prepareHelperDeployment };
