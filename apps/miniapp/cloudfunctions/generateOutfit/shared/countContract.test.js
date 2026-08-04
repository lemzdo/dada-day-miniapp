const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assertRecommendationCountContract,
  assertReturnedCardCount,
  buildRecommendationCountContract,
} = require('./countContract');

for (const [name, before, returned, expected, tail, exhausted] of [
  ['normal 8', 20, 8, 8, false, false],
  ['tail 1', 1, 1, 1, true, true],
  ['tail 5', 5, 5, 5, true, true],
  ['tail 7', 7, 7, 7, true, true],
  ['empty exhausted', 0, 0, 0, false, true],
]) {
  test(`count contract accepts ${name}`, () => {
    const contract = buildRecommendationCountContract({
      requestedBatchSize: 8,
      returnedCardCount: returned,
      remainingUniqueBeforeConsume: before,
      executionMode: 'candidate_pool_hit',
      candidatePoolId: 'pool-test',
    });
    assert.equal(contract.expectedCardCount, expected);
    assert.equal(contract.tailBatchAuthorized, tail);
    assert.equal(contract.poolExhaustedAfterConsume, exhausted);
    assert.equal(contract.remainingUniqueAfterConsume, before - returned);
    assert.doesNotThrow(() => assertReturnedCardCount(contract, returned));
  });
}

test('count contract rejects a short normal batch instead of inferring a tail', () => {
  assert.throws(() => buildRecommendationCountContract({
    requestedBatchSize: 8,
    returnedCardCount: 7,
    remainingUniqueBeforeConsume: 8,
    executionMode: 'full_compute',
  }), /returnedCardCount .* expectedCardCount/);
});

test('count contract rejects evidence or snapshot card loss', () => {
  const contract = buildRecommendationCountContract({
    requestedBatchSize: 8,
    returnedCardCount: 5,
    remainingUniqueBeforeConsume: 5,
    executionMode: 'candidate_pool_hit',
  });
  assert.throws(() => assertReturnedCardCount(contract, 4), /card mismatch/);
});

test('count contract rejects contradictory metadata', () => {
  assert.throws(() => assertRecommendationCountContract({
    requestedBatchSize: 8,
    expectedCardCount: 5,
    returnedCardCount: 5,
    remainingUniqueBeforeConsume: 8,
    remainingUniqueAfterConsume: 3,
    tailBatchAuthorized: true,
    poolExhaustedAfterConsume: false,
    executionMode: 'candidate_pool_hit',
    candidatePoolId: 'pool-test',
  }), /expectedCardCount/);
});
