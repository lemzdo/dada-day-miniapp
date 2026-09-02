'use strict';

const path = require('node:path');
const { ESLint } = require('eslint');

async function main() {
  const eslint = new ESLint({ cwd: path.resolve(__dirname, '../../..') });
  const results = await eslint.lintFiles([
    'eslint.config.mjs',
    'apps/miniapp/scripts/cloud-artifact-*.js',
    'apps/miniapp/scripts/cloud-dependency-audit.js',
    'apps/miniapp/scripts/cloud-deploy*.js',
    'apps/miniapp/scripts/deployment-contract-lite*.js',
    'apps/miniapp/scripts/stage-recommendation-artifacts.js',
  ]);
  const formatter = await eslint.loadFormatter('stylish');
  const output = formatter.format(results);
  if (output) console.log(output);
  const errors = results.reduce((sum, result) => sum + result.errorCount, 0);
  console.log(`DEPLOYMENT_CONTRACT_LINT=${errors ? 'FAIL' : 'PASS'} files=${results.length}`);
  if (errors) process.exitCode = 1;
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
