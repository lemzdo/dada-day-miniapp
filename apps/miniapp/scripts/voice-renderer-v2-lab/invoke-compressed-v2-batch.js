'use strict';

const { buildRendererInput } = require('./core');
const { buildGoldPlans } = require('./gold-plans');
const { callLabEvent } = require('./invoke-latency-lab-once');

const FAILURE_CASE_IDS = Object.freeze([
  'weak-formality-only',
  'sparse-low-confidence-pattern',
  'sparse-basic-no-evidence',
]);

async function invokeCompressedV2Batch({ caseIds, deps = {}, call = callLabEvent } = {}) {
  const selectedIds = caseIds || FAILURE_CASE_IDS;
  const byId = new Map(buildGoldPlans().map((plan) => [plan.caseId, plan]));
  const cases = selectedIds.map((caseId) => {
    const plan = byId.get(caseId);
    if (!plan) throw new Error(`CASE_ID_NOT_ALLOWED:${caseId}`);
    return { caseId, input: buildRendererInput(plan) };
  });
  if (new Set(selectedIds).size !== selectedIds.length) throw new Error('DUPLICATE_CASE_ID');
  return call({ batch: true, model: 'max', promptVariant: 'compressed-v2', cases, execute: true }, { timeoutMs: 65000, deps });
}

if (require.main === module) {
  const phase = process.argv[2] || 'failure';
  const caseIds = phase === 'failure' ? FAILURE_CASE_IDS : phase === 'full' ? buildGoldPlans().map((plan) => plan.caseId) : null;
  if (!caseIds) throw new Error('PHASE_MUST_BE_FAILURE_OR_FULL');
  invokeCompressedV2Batch({ caseIds }).then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result?.status !== 'completed') process.exitCode = 1;
  }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { FAILURE_CASE_IDS, invokeCompressedV2Batch };
