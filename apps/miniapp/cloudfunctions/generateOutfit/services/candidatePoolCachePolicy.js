'use strict';

// Candidate Pool is a performance cache. This module deliberately keeps the
// decision pure and the fill lazy: preparing a request must never start a DB
// write. The caller supplies measured budget inputs from the runtime.
function decideCandidatePoolCacheFill({
  homepageBudgetMs,
  elapsedMs = 0,
  measuredSaveP95Ms,
  clientReserveMs,
  safetyMarginMs = 0,
} = {}) {
  const budget = finitePositive(homepageBudgetMs);
  const elapsed = finiteNonNegative(elapsedMs);
  const saveP95 = finiteNonNegative(measuredSaveP95Ms);
  const reserve = finiteNonNegative(clientReserveMs);
  const margin = finiteNonNegative(safetyMarginMs);
  if (budget === null || saveP95 === null || reserve === null) {
    return { decision: 'skip', reason: 'budget_inputs_missing', remainingBudgetMs: null };
  }
  const remainingBudgetMs = Math.max(0, budget - elapsed - reserve);
  const requiredBudgetMs = saveP95 + margin;
  if (remainingBudgetMs < requiredBudgetMs) {
    return { decision: 'skip', reason: 'budget_insufficient', remainingBudgetMs, requiredBudgetMs };
  }
  return { decision: 'await', reason: 'within_foreground_budget', remainingBudgetMs, requiredBudgetMs };
}

function createCandidatePoolCacheFillPlan({ execute, decision } = {}) {
  let started = false;
  let promise = null;
  return {
    decision: decision || { decision: 'skip', reason: 'not_started' },
    get started() { return started; },
    start() {
      if (started) return promise;
      started = true;
      if (this.decision.decision !== 'await' || typeof execute !== 'function') {
        promise = Promise.resolve({ status: 'not_started', candidatePoolId: null, reason: this.decision.reason });
        return promise;
      }
      const timeoutMs = finitePositive(this.decision.remainingBudgetMs);
      let timer;
      const timeout = timeoutMs === null ? null : new Promise((resolve) => {
        timer = setTimeout(() => resolve({
          status: 'write_timeout',
          candidatePoolId: null,
          reason: 'foreground_cache_budget_exhausted',
        }), timeoutMs);
      });
      const execution = Promise.resolve().then(() => execute());
      promise = (timeout ? Promise.race([execution, timeout]) : execution)
        .then((result) => (result && result.status === 'saved'
          ? result
          : { ...(result || {}), status: result?.status || 'failed_open', candidatePoolId: null }))
        .catch((error) => ({ status: 'failed_open', candidatePoolId: null, reason: error?.message || 'cache_fill_failed' }))
        .finally(() => { if (timer) clearTimeout(timer); });
      return promise;
    },
  };
}

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

module.exports = { createCandidatePoolCacheFillPlan, decideCandidatePoolCacheFill };
