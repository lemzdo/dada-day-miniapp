'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { adapters, SUPPORTED_FUNCTIONS } = require('./cloud-deploy');
const { collectDeployableFiles } = require('./check-generate-outfit-package');

const cloudfunctionsRoot = path.resolve(__dirname, '..', 'cloudfunctions');
const AUDITED_FUNCTIONS = Object.freeze([
  Object.freeze({ name: 'generateOutfit', nestedCopyRisk: false }),
  Object.freeze({ name: 'recommendationStream', nestedCopyRisk: true }),
  Object.freeze({ name: 'processUploadImage', nestedCopyRisk: false }),
]);
const DYNAMIC_REQUIRE_RE = /\brequire\s*\(\s*(?!['"])([^)\r\n]+)\)/g;

function findDynamicRequireLocations(sourceRoot) {
  const locations = [];
  for (const file of collectDeployableFiles(sourceRoot)) {
    if (path.extname(file) !== '.js') continue;
    const source = fs.readFileSync(file, 'utf8');
    const lines = source.split(/\r?\n/);
    lines.forEach((line, index) => {
      DYNAMIC_REQUIRE_RE.lastIndex = 0;
      if (DYNAMIC_REQUIRE_RE.test(line)) {
        locations.push(`${path.relative(sourceRoot, file).split(path.sep).join('/')}:${index + 1}`);
      }
    });
  }
  return locations;
}

function auditDeploymentContracts() {
  return AUDITED_FUNCTIONS.map(({ name, nestedCopyRisk }) => {
    const sourceRoot = path.join(cloudfunctionsRoot, name);
    const dynamicRequireLocations = findDynamicRequireLocations(sourceRoot);
    return {
      functionName: name,
      deploymentEntry: `pnpm cloud:deploy ${name}`,
      runtimeEntry: `apps/miniapp/cloudfunctions/${name}/index.js`,
      artifactContract: SUPPORTED_FUNCTIONS.includes(name) && typeof adapters[name]?.assemble === 'function',
      dynamicRequireRisk: dynamicRequireLocations.length > 0,
      dynamicRequireLocations,
      nestedCopyRisk,
    };
  });
}

function main() {
  const report = auditDeploymentContracts();
  for (const item of report) {
    console.log([
      `DEPLOYMENT_AUDIT_FUNCTION=${item.functionName}`,
      `ENTRY=${item.deploymentEntry}`,
      `ARTIFACT_CONTRACT=${item.artifactContract ? 'YES' : 'NO'}`,
      `DYNAMIC_REQUIRE_RISK=${item.dynamicRequireRisk ? 'YES' : 'NO'}`,
      `NESTED_COPY_RISK=${item.nestedCopyRisk ? 'YES' : 'NO'}`,
    ].join(' '));
  }
  console.log(`DEPLOYMENT_CONTRACT_LITE=${JSON.stringify(report)}`);
  if (report.some((item) => !item.artifactContract)) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { AUDITED_FUNCTIONS, auditDeploymentContracts, findDynamicRequireLocations };
