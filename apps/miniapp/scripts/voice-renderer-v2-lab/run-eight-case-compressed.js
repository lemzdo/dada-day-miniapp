'use strict';

const { ensureDevToolsDirectSession } = require('../devtools-direct-session');
const { buildGoldPlans } = require('./gold-plans');
const { invokeOnce } = require('./invoke-latency-lab-once');

async function runEightCaseCompressed({ deps = {}, invoke = invokeOnce, now = Date.now } = {}) {
  const session = deps.mini ? null : await ensureDevToolsDirectSession({ deps, preserveCurrentPage: true });
  const mini = deps.mini || session.mini;
  const started = now();
  const calls = [];
  try {
    for (const plan of buildGoldPlans()) {
      const result = await invoke({
        model: 'max',
        promptVariant: 'compressed',
        caseId: plan.caseId,
        deps: { mini },
      });
      if (result?.status !== 'completed') throw new Error(`CASE_FAILED:${plan.caseId}:${result?.errorCode || result?.status || 'unknown'}`);
      calls.push(result);
    }
  } finally {
    if (!deps.mini && mini?.disconnect) mini.disconnect();
  }
  return {
    model: 'qwen3.7-max',
    promptVariant: 'compressed',
    execution: '8 independent CloudBase invocations, sequential runner, one provider call per invocation',
    totalWallClockMs: now() - started,
    sumProviderLatencyMs: calls.reduce((sum, call) => sum + Number(call.providerLatencyMs || 0), 0),
    retries: calls.reduce((sum, call) => sum + Number(call.retryCount || 0), 0),
    calls,
  };
}

if (require.main === module) {
  runEightCaseCompressed().then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { runEightCaseCompressed };
