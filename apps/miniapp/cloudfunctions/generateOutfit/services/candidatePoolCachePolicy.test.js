'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createCandidatePoolCacheFillPlan,
  decideCandidatePoolCacheFill,
} = require('./candidatePoolCachePolicy');

test('missing budget measurements skip without starting a write', async () => {
  let calls = 0;
  const decision = decideCandidatePoolCacheFill({ homepageBudgetMs: 500, clientReserveMs: 100 });
  assert.equal(decision.decision, 'skip');
  const plan = createCandidatePoolCacheFillPlan({ decision, execute: () => { calls += 1; } });
  const result = await plan.start();
  assert.equal(result.status, 'not_started');
  assert.equal(calls, 0);
  assert.equal(plan.started, true);
});

test('insufficient budget does not start candidate pool persistence', async () => {
  let calls = 0;
  const decision = decideCandidatePoolCacheFill({
    homepageBudgetMs: 500,
    elapsedMs: 300,
    measuredSaveP95Ms: 250,
    clientReserveMs: 100,
  });
  assert.equal(decision.reason, 'budget_insufficient');
  const plan = createCandidatePoolCacheFillPlan({ decision, execute: () => { calls += 1; } });
  await plan.start();
  assert.equal(calls, 0);
});

test('sufficient budget starts exactly one explicit foreground fill', async () => {
  let calls = 0;
  const decision = decideCandidatePoolCacheFill({
    homepageBudgetMs: 1000,
    elapsedMs: 200,
    measuredSaveP95Ms: 300,
    clientReserveMs: 100,
  });
  assert.equal(decision.decision, 'await');
  const plan = createCandidatePoolCacheFillPlan({
    decision,
    execute: async () => { calls += 1; return { status: 'saved', candidatePoolId: 'pool-1' }; },
  });
  assert.equal(calls, 0);
  const first = plan.start();
  assert.equal(calls, 0, 'execute must not run until the explicit microtask starts');
  const second = plan.start();
  assert.equal(await first, await second);
  assert.equal(calls, 1);
  assert.equal((await first).candidatePoolId, 'pool-1');
});

test('save failure and timeout fail open without exposing pool id', async () => {
  const decision = { decision: 'await', reason: 'within_foreground_budget' };
  for (const execute of [
    async () => ({ status: 'write_failed', candidatePoolId: 'pool-should-not-leak' }),
    async () => { throw new Error('database_timeout'); },
  ]) {
    const plan = createCandidatePoolCacheFillPlan({ decision, execute });
    const result = await plan.start();
    assert.notEqual(result.status, 'saved');
    assert.equal(result.candidatePoolId, null);
  }
});

test('foreground budget timeout returns without waiting for a slow cache write', async () => {
  let release;
  const slowWrite = new Promise((resolve) => { release = resolve; });
  const plan = createCandidatePoolCacheFillPlan({
    decision: { decision: 'await', reason: 'within_foreground_budget', remainingBudgetMs: 5 },
    execute: () => slowWrite,
  });
  const result = await plan.start();
  assert.equal(result.status, 'write_timeout');
  assert.equal(result.candidatePoolId, null);
  release({ status: 'saved', candidatePoolId: 'late-pool' });
});
