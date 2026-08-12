'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { stageBenchmarkHelper } = require('./stage-benchmark-helper');
const { markDeploymentFiles } = require('./mark-deployment-files');

function prepareHelperDeployment({ sourceDirectory, artifactDirectory }) {
  const artifact = path.resolve(artifactDirectory);
  const target = path.join(artifact, '.benchmark-helper-stage', 'generateOutfit');
  const tokenFile = path.join(artifact, '.benchmark-token');
  if (fs.existsSync(tokenFile) || fs.existsSync(path.dirname(target))) throw new Error('benchmark helper staging already exists');
  const token = crypto.randomBytes(32).toString('base64url');
  const staged = stageBenchmarkHelper({ sourceDirectory, targetDirectory: target, benchmarkToken: token });
  const deployment = markDeploymentFiles(target);
  fs.writeFileSync(tokenFile, token, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  const safeStaged = { ...staged };
  delete safeStaged.tokenHash;
  const result = { ...safeStaged, deployment, tokenFile, tokenLength: token.length };
  fs.writeFileSync(path.join(artifact, 'benchmark-helper-staging.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (require.main === module) {
  prepareHelperDeployment({ sourceDirectory: process.argv[2], artifactDirectory: process.argv[3] });
}

module.exports = { prepareHelperDeployment };
