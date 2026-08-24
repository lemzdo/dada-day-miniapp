'use strict';

const crypto = require('node:crypto');
const { ensureDevToolsDirectSession } = require('../devtools-direct-session');
const { buildRendererInput } = require('./core');
const { buildGoldPlans } = require('./gold-plans');

async function invokeOnce({ model, promptVariant, caseId, timeoutMs = 65000, deps = {} }) {
  if (!['max', 'flash'].includes(model)) throw new Error('MODEL_NOT_ALLOWED');
  if (!['current', 'compressed'].includes(promptVariant)) throw new Error('PROMPT_VARIANT_NOT_ALLOWED');
  const goldPlan = buildGoldPlans().find((plan) => plan.caseId === caseId);
  if (!goldPlan) throw new Error('CASE_ID_NOT_ALLOWED');
  const event = { model, promptVariant, caseId, input: buildRendererInput(goldPlan), execute: true };
  return callLabEvent(event, { timeoutMs, deps });
}

async function callLabEvent(event, { timeoutMs = 65000, deps = {} } = {}) {
  const session = deps.mini ? null : await ensureDevToolsDirectSession({ deps, preserveCurrentPage: true });
  const mini = deps.mini || session.mini;
  const requestId = crypto.randomUUID();
  try {
    await mini.evaluate((payload) => {
      const registry = globalThis.__voiceRendererLatencyLabCalls || (globalThis.__voiceRendererLatencyLabCalls = {});
      registry[payload.requestId] = { status: 'pending' };
      globalThis.wx.cloud.callFunction({ name: 'voiceRendererLatencyLab', data: payload.event })
        .then((envelope) => { registry[payload.requestId] = { status: 'resolved', result: envelope?.result }; })
        .catch((error) => { registry[payload.requestId] = { status: 'rejected', error: String(error?.message || error) }; });
    }, { requestId, event });
    const deadline = Date.now() + timeoutMs;
    let state;
    while (Date.now() < deadline) {
      state = await mini.evaluate((id) => globalThis.__voiceRendererLatencyLabCalls?.[id] || null, requestId);
      if (state?.status === 'resolved' || state?.status === 'rejected') break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!state || state.status === 'pending') throw new Error('LAB_INVOCATION_TIMEOUT');
    if (state.status === 'rejected') throw new Error(`LAB_INVOCATION_REJECTED:${state.error || 'unknown'}`);
    return state.result;
  } finally {
    try {
      await mini.evaluate((id) => {
        if (globalThis.__voiceRendererLatencyLabCalls) delete globalThis.__voiceRendererLatencyLabCalls[id];
      }, requestId);
    } catch {
      // Best-effort cleanup must not hide the benchmark result.
    }
    if (!deps.mini && mini?.disconnect) mini.disconnect();
  }
}

if (require.main === module) {
  const [model, promptVariant, caseId = 'primary-pattern-focus'] = process.argv.slice(2);
  invokeOnce({ model, promptVariant, caseId }).then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result?.status !== 'completed') process.exitCode = 1;
  }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { callLabEvent, invokeOnce };
