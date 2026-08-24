'use strict';

const { buildRendererInput } = require('./core');
const { buildGoldPlans } = require('./gold-plans');
const { callLabEvent } = require('./invoke-latency-lab-once');

function buildCases() { return buildGoldPlans().map((plan) => ({ caseId: plan.caseId, input: buildRendererInput(plan) })); }

async function invokePriorityLane({ deps = {}, call = callLabEvent } = {}) {
  const cases = buildCases();
  const [first, rest] = await Promise.all([
    call({ ...cases[0], model: 'max', promptVariant: 'compressed-v2', stream: true, sequencing: true, execute: true }, { timeoutMs: 120000, deps }),
    call({ batch: true, model: 'max', promptVariant: 'compressed-v2', cases: cases.slice(1), execute: true }, { timeoutMs: 120000, deps }),
  ]);
  const quality = [first, rest];
  return {
    first, rest, providerCalls: 2,
    priorityFirstValidatedMs: first.FIRST_ITEM_VALIDATED_MS,
    rest7CompleteMs: rest.e2eLatencyMs,
    all8ReadyMs: Math.max(Number(first.FIRST_ITEM_VALIDATED_MS), Number(rest.e2eLatencyMs)),
    quality: { parser: quality.every((item) => item.parserPass), contract: quality.every((item) => item.contractPass), validator: quality.every((item) => item.validatorPass), factualFailures: quality.reduce((sum, item) => sum + (item.factualFailures || (item.factualViolation ? 1 : 0)), 0), personaFailures: quality.reduce((sum, item) => sum + (item.personaFailures || (item.personaNaturalness === false ? 1 : 0)), 0), metaLanguageFailures: quality.reduce((sum, item) => sum + (item.metaLanguageFailures || 0), 0) },
  };
}

async function runThree(options = {}) {
  const runs = [];
  for (let index = 0; index < 3; index += 1) runs.push(await invokePriorityLane(options));
  return { runs, firstValidated: summarize(runs.map((run) => Number(run.priorityFirstValidatedMs))), rest7: summarize(runs.map((run) => Number(run.rest7CompleteMs))), all8: summarize(runs.map((run) => Number(run.all8ReadyMs))) };
}

function summarize(values) { const sorted = values.slice().sort((a, b) => a - b); return { values, median: sorted[Math.floor(sorted.length / 2)], range: [Math.min(...values), Math.max(...values)] }; }

if (require.main === module) runThree().then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)).catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });

module.exports = { buildCases, invokePriorityLane, runThree, summarize };
