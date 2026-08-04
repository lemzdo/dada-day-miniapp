const DEFAULT_REQUESTED_BATCH_SIZE = 8;
const MAX_REQUESTED_BATCH_SIZE = 8;

function normalizeRequestedBatchSize(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_REQUESTED_BATCH_SIZE;
  return Math.min(Math.max(Math.floor(number), 1), MAX_REQUESTED_BATCH_SIZE);
}

function buildRecommendationCountContract({
  requestedBatchSize = DEFAULT_REQUESTED_BATCH_SIZE,
  returnedCardCount = 0,
  remainingUniqueBeforeConsume = returnedCardCount,
  executionMode = 'full_compute',
  candidatePoolId = null,
} = {}) {
  const requested = normalizeRequestedBatchSize(requestedBatchSize);
  const returned = normalizeCount(returnedCardCount);
  const before = normalizeCount(remainingUniqueBeforeConsume);
  if (returned > before) {
    throw new Error(`count contract returnedCardCount ${returned} exceeds remainingUniqueBeforeConsume ${before}`);
  }

  const expected = before === 0 ? 0 : Math.min(requested, before);
  const tailBatchAuthorized = before > 0 && before < requested && returned === before;
  const remainingAfter = before - returned;
  const poolExhaustedAfterConsume = remainingAfter === 0;
  const contract = {
    requestedBatchSize: requested,
    expectedCardCount: expected,
    returnedCardCount: returned,
    remainingUniqueBeforeConsume: before,
    remainingUniqueAfterConsume: remainingAfter,
    tailBatchAuthorized,
    poolExhaustedAfterConsume,
    executionMode: normalizeExecutionMode(executionMode),
    candidatePoolId: normalizePoolId(candidatePoolId),
  };
  assertRecommendationCountContract(contract);
  return contract;
}

function assertRecommendationCountContract(contract, { allowEmpty = true } = {}) {
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) {
    throw new Error('count contract must be an object');
  }
  const requiredNumbers = [
    'requestedBatchSize',
    'expectedCardCount',
    'returnedCardCount',
    'remainingUniqueBeforeConsume',
    'remainingUniqueAfterConsume',
  ];
  for (const field of requiredNumbers) {
    if (!Number.isInteger(contract[field]) || contract[field] < 0) {
      throw new Error(`count contract ${field} must be a non-negative integer`);
    }
  }
  if (contract.requestedBatchSize < 1 || contract.requestedBatchSize > MAX_REQUESTED_BATCH_SIZE) {
    throw new Error('count contract requestedBatchSize is outside the supported range');
  }
  for (const field of ['tailBatchAuthorized', 'poolExhaustedAfterConsume']) {
    if (typeof contract[field] !== 'boolean') throw new Error(`count contract ${field} must be boolean`);
  }
  if (!['full_compute', 'candidate_pool_hit', 'fallback_recompute'].includes(contract.executionMode)) {
    throw new Error('count contract executionMode is invalid');
  }
  if (!(contract.candidatePoolId === null || typeof contract.candidatePoolId === 'string')) {
    throw new Error('count contract candidatePoolId must be string or null');
  }
  if (contract.returnedCardCount > contract.remainingUniqueBeforeConsume) {
    throw new Error('count contract returnedCardCount exceeds remainingUniqueBeforeConsume');
  }
  if (contract.remainingUniqueAfterConsume
    !== contract.remainingUniqueBeforeConsume - contract.returnedCardCount) {
    throw new Error('count contract remainingUniqueAfterConsume is inconsistent');
  }
  const expected = contract.remainingUniqueBeforeConsume === 0
    ? 0
    : Math.min(contract.requestedBatchSize, contract.remainingUniqueBeforeConsume);
  if (contract.expectedCardCount !== expected) {
    throw new Error('count contract expectedCardCount is not derived from remainingUniqueBeforeConsume');
  }
  const isTail = contract.remainingUniqueBeforeConsume > 0
    && contract.remainingUniqueBeforeConsume < contract.requestedBatchSize;
  if (contract.tailBatchAuthorized !== isTail || (isTail && contract.returnedCardCount !== expected)) {
    throw new Error('count contract tail authorization is inconsistent');
  }
  if (contract.returnedCardCount !== expected) {
    throw new Error(`count contract returnedCardCount ${contract.returnedCardCount} does not equal expectedCardCount ${expected}`);
  }
  if (contract.poolExhaustedAfterConsume !== (contract.remainingUniqueAfterConsume === 0)) {
    throw new Error('count contract exhaustion state is inconsistent');
  }
  if (!allowEmpty && contract.expectedCardCount === 0) {
    throw new Error('empty recommendation batch is not allowed in this context');
  }
  return true;
}

function assertReturnedCardCount(contract, returnedCardCount) {
  assertRecommendationCountContract(contract);
  const actual = normalizeCount(returnedCardCount);
  if (actual !== contract.expectedCardCount || actual !== contract.returnedCardCount) {
    throw new Error(`count contract card mismatch: expected ${contract.expectedCardCount}, got ${actual}`);
  }
  return true;
}

function normalizeCount(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) return 0;
  return number;
}

function normalizeExecutionMode(value) {
  return ['full_compute', 'candidate_pool_hit', 'fallback_recompute'].includes(value)
    ? value
    : 'full_compute';
}

function normalizePoolId(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

module.exports = {
  DEFAULT_REQUESTED_BATCH_SIZE,
  MAX_REQUESTED_BATCH_SIZE,
  assertRecommendationCountContract,
  assertReturnedCardCount,
  buildRecommendationCountContract,
  normalizeRequestedBatchSize,
};
