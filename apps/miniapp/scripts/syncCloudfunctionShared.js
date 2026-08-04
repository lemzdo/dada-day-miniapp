'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CLOUD_FUNCTIONS_DIR = path.resolve(__dirname, '..', 'cloudfunctions');
const CANONICAL_SOURCE_PATH = path.join(
  CLOUD_FUNCTIONS_DIR,
  'shared',
  'sceneEligibilityFacts.js',
);
const DEPLOYMENT_TARGETS = Object.freeze([
  path.join(
    CLOUD_FUNCTIONS_DIR,
    'generateOutfit',
    'shared',
    'sceneEligibilityFacts.js',
  ),
  path.join(
    CLOUD_FUNCTIONS_DIR,
    'confirmClothesDrafts',
    'shared',
    'sceneEligibilityFacts.js',
  ),
]);

function readCanonicalSource() {
  if (!fs.existsSync(CANONICAL_SOURCE_PATH)) {
    throw new Error(`Canonical source is missing: ${CANONICAL_SOURCE_PATH}`);
  }

  return fs.readFileSync(CANONICAL_SOURCE_PATH);
}

function syncDeploymentCopies() {
  const source = readCanonicalSource();

  for (const target of DEPLOYMENT_TARGETS) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, source);
    console.log(`[sync-cloudfunction-shared] copied: ${target}`);
  }
}

function checkDeploymentCopies() {
  const source = readCanonicalSource();
  const problems = [];

  for (const target of DEPLOYMENT_TARGETS) {
    if (!fs.existsSync(target)) {
      problems.push(`missing: ${target}`);
      continue;
    }

    const copy = fs.readFileSync(target);
    if (!copy.equals(source)) {
      problems.push(`mismatch: ${target}`);
    }
  }

  return problems;
}

function main(argv) {
  const args = argv ?? process.argv.slice(2);
  const checkMode = args.length === 1 && args[0] === '--check';

  if (args.length > 0 && !checkMode) {
    console.error('Usage: node syncCloudfunctionShared.js [--check]');
    process.exitCode = 1;
    return;
  }

  if (!checkMode) {
    syncDeploymentCopies();
    return;
  }

  const problems = checkDeploymentCopies();
  if (problems.length > 0) {
    for (const problem of problems) {
      console.error(`[sync-cloudfunction-shared] ${problem}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log('[sync-cloudfunction-shared] all deployment copies match canonical source');
}

if (require.main === module) {
  main();
}

module.exports = {
  CANONICAL_SOURCE_PATH,
  CLOUD_FUNCTIONS_DIR,
  DEPLOYMENT_TARGETS,
  checkDeploymentCopies,
  syncDeploymentCopies,
};
