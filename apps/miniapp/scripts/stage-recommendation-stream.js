'use strict';

// Build-only staging helper. The generated directory is disposable and must
// never be committed: it places the single generateOutfit source beside the
// HTTP wrapper so CloudBase does not resolve a sibling workspace dependency.
const fs = require('node:fs');
const path = require('node:path');
const { stageRecommendationStream } = require('./stage-recommendation-artifacts');

const root = path.resolve(__dirname, '..');
const destination = path.resolve(process.argv[2] || path.join(root, '.staging', 'recommendationStream'));
const environmentFile = process.argv[3] ? path.resolve(process.argv[3]) : null;
const environmentId = String(process.argv[4] || process.env.CLOUDBASE_ENV_ID || '').trim();

function parseEnvironmentFile(file) {
  const variables = {};
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    variables[key] = value;
  }
  return variables;
}

let cloudbaseConfig = null;
if (environmentFile) {
  const envVariables = parseEnvironmentFile(environmentFile);
  if (!environmentId) {
    throw new Error('CloudBase environment id is required for deployment staging');
  }
  if (!envVariables.BAILIAN_API_KEY) {
    throw new Error('BAILIAN_API_KEY is required for the direct recommendation renderer');
  }
  cloudbaseConfig = {
    envId: environmentId,
    functions: [{
      name: 'recommendationStream',
      runtime: 'Nodejs20.19',
      memorySize: 1024,
      timeout: 10,
      handler: 'index.main',
      envVariables,
    }],
  };
}
stageRecommendationStream(destination, { cloudbaseConfig });
console.log(`[recommendationStream-stage] ${destination}`);
