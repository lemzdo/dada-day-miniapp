'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { auditDeploymentContracts } = require('./deployment-contract-lite');

test('deployment contract lite covers the three stabilization targets', () => {
  const report = auditDeploymentContracts();
  assert.deepEqual(report.map((item) => item.functionName), [
    'generateOutfit',
    'recommendationStream',
    'processUploadImage',
  ]);
  assert.ok(report.every((item) => item.artifactContract));
  assert.ok(report.every((item) => item.deploymentEntry === `pnpm cloud:deploy ${item.functionName}`));
  assert.equal(report.find((item) => item.functionName === 'recommendationStream').nestedCopyRisk, true);
  assert.equal(report.find((item) => item.functionName === 'processUploadImage').dynamicRequireRisk, true);
});
