process.env.NODE_ENV = 'test';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createCandidatePoolCacheFillPlan,
  decideCandidatePoolCacheFill,
} = require('./services/candidatePoolCachePolicy');
const { resolveCandidatePoolCachePolicyInput } = require('./index.js').__test;

test('candidate pool persistence is not started during prepare', async () => {
  let calls = 0;
  const decision = decideCandidatePoolCacheFill({
    homepageBudgetMs: 1200,
    elapsedMs: 100,
    measuredSaveP95Ms: 300,
    clientReserveMs: 200,
  });
  const plan = createCandidatePoolCacheFillPlan({
    decision,
    execute: async () => { calls += 1; return { status: 'saved', candidatePoolId: 'pool-1' }; },
  });
  assert.equal(plan.started, false);
  assert.equal(calls, 0);
  await plan.start();
  assert.equal(calls, 1);
});

test('pool save success does not define or replace recommendation batch identity', async () => {
  const plan = createCandidatePoolCacheFillPlan({
    decision: { decision: 'await', reason: 'within_foreground_budget' },
    execute: async () => ({ status: 'saved', candidatePoolId: 'pool-1' }),
  });
  const result = await plan.start();
  assert.equal(result.candidatePoolId, 'pool-1');
  assert.equal('recommendationBatchId' in result, false);
});

test('pool write failure and timeout are fail-open and never suppress response identity', async () => {
  for (const execute of [
    async () => ({ status: 'write_failed', candidatePoolId: null }),
    async () => { throw new Error('database_timeout'); },
  ]) {
    const plan = createCandidatePoolCacheFillPlan({
      decision: { decision: 'await', reason: 'within_foreground_budget' },
      execute,
    });
    const result = await plan.start();
    assert.notEqual(result.status, 'saved');
    assert.equal(result.candidatePoolId, null);
  }
});

test('over-budget pool fill remains explicitly not started', async () => {
  let calls = 0;
  const decision = decideCandidatePoolCacheFill({
    homepageBudgetMs: 500,
    elapsedMs: 350,
    measuredSaveP95Ms: 200,
    clientReserveMs: 100,
  });
  const plan = createCandidatePoolCacheFillPlan({
    decision,
    execute: () => { calls += 1; },
  });
  const result = await plan.start();
  assert.equal(result.status, 'not_started');
  assert.equal(calls, 0);
});

test('production requests require a measured save P95 while the existing smoke may collect it', () => {
  const key = 'RECOMMENDATION_CANDIDATE_POOL_SAVE_P95_MS';
  const previous = process.env[key];
  delete process.env[key];
  try {
    assert.equal(resolveCandidatePoolCachePolicyInput({}).measuredSaveP95Ms, undefined);
    assert.equal(resolveCandidatePoolCachePolicyInput({
      performanceDiagnostics: true,
      acceptanceRunId: 'production-smoke-test',
    }).measuredSaveP95Ms, 0);
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
});
