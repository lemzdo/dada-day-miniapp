'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { auditDeploymentContracts } = require('./deployment-contract-lite');
const { ALL_FUNCTIONS } = require('./cloud-artifact-contract');

test('legacy audit entry also covers every registered function', () => {
  const report = auditDeploymentContracts();
  assert.deepEqual(report.map((item) => item.functionName), ALL_FUNCTIONS);
  assert.ok(report.every((item) => item.artifactContract));
  assert.ok(report.every((item) => item.deploymentEntry === `pnpm cloud:deploy ${item.functionName}`));
  assert.equal(report.find((item) => item.functionName === 'recommendationStream').nestedCopyRisk, true);
  assert.equal(report.find((item) => item.functionName === 'processUploadImage').dynamicRequireRisk, true);
});
