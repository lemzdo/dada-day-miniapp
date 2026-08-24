'use strict';

const { buildRendererInput } = require('./core');
const { buildGoldPlans } = require('./gold-plans');
const { callLabEvent } = require('./invoke-latency-lab-once');

async function invokeStreamingBatch({ deps = {}, call = callLabEvent } = {}) {
  const cases = buildGoldPlans().map((plan) => ({ caseId: plan.caseId, input: buildRendererInput(plan) }));
  return call({ batch: true, model: 'max', promptVariant: 'compressed-v2', stream: true, sequencing: true, cases, execute: true }, { timeoutMs: 120000, deps });
}

async function runThree({ deps = {}, call = callLabEvent } = {}) {
  const runs = [];
  for (let index = 0; index < 3; index += 1) runs.push(await invokeStreamingBatch({ deps, call }));
  const values = runs.map((run) => Number(run.FIRST_ITEM_VALIDATED_MS));
  const full = runs.map((run) => Number(run.ALL_8_VALIDATED_MS));
  return { runs, firstValidated: summarize(values), fullBatch: summarize(full) };
}

function summarize(values) {
  const ordered = values.slice().sort((a, b) => a - b);
  return { values, median: ordered[Math.floor(ordered.length / 2)], range: [Math.min(...values), Math.max(...values)] };
}

if (require.main === module) runThree().then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)).catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });

module.exports = { invokeStreamingBatch, runThree, summarize };
