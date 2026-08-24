'use strict';

const { buildRendererInput } = require('./core');
const { buildGoldPlans } = require('./gold-plans');
const { callLabEvent } = require('./invoke-latency-lab-once');

async function invokeBatch({ deps = {}, call = callLabEvent } = {}) {
  const cases = buildGoldPlans().map((plan) => ({ caseId: plan.caseId, input: buildRendererInput(plan) }));
  return call({ batch: true, model: 'max', promptVariant: 'compressed', cases, execute: true }, { timeoutMs: 65000, deps });
}

if (require.main === module) {
  invokeBatch().then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result?.status !== 'completed') process.exitCode = 1;
  }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { invokeBatch };
