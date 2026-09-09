'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { resolveRecommendationCache } = require('./recommendationCacheCoordinator');

test('cache coordinator does not touch storage without a confirmed pool id', async () => {
  let calls = 0;
  const result = await resolveRecommendationCache({ candidatePoolIdentity: { identityHash: 'hash' } }, {
    loadCandidatePoolForIdentity: async () => { calls += 1; },
  });
  assert.equal(result.attempted, false);
  assert.equal(calls, 0);
});

test('cache coordinator owns exactly one pool read and forwards identity', async () => {
  const calls = [];
  const identity = { identityHash: 'hash' };
  const result = await resolveRecommendationCache({ requestedCandidatePoolId: 'pool-1', candidatePoolIdentity: identity }, {
    loadCandidatePoolForIdentity: async (request) => {
      calls.push(request);
      return { hit: true, pool: { candidatePoolId: 'pool-1' }, ageMs: 12 };
    },
  });
  assert.equal(result.attempted, true);
  assert.equal(result.hit, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].candidatePoolId, 'pool-1');
  assert.equal(calls[0].identity, identity);
});
