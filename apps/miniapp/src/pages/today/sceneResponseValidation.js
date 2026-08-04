/**
 * Pure scene response validation logic, extracted from Today page for testability.
 *
 * A response is valid only when ALL three conditions hold:
 * 1. requestSeq === currentRequestSeq  (not a stale request)
 * 2. currentSceneKey === requestContext.sceneKey  (user hasn't switched scenes)
 * 3. data.sceneKey === requestContext.sceneKey  (response matches request)
 *
 * If any condition fails, the response must be completely discarded.
 * Top-level sceneKey is required and must match requestContext.sceneKey exactly.
 */

const DEFAULT_SCENES = [
  { key: 'home', label: '居家' },
  { key: 'work', label: '上班' },
  { key: 'date', label: '约会' },
  { key: 'sport', label: '运动' },
];

function normalizeScene(scene, scenes) {
  if (!scene) return null;
  const list = scenes || DEFAULT_SCENES;
  const found = list.find((item) => item.label === scene || item.key === scene);
  return found ? found.key : null;
}

/**
 * @param {object} requestContext - { requestSeq, sceneKey, sceneLabel, weatherMode, requestedAt }
 * @param {object} data - response payload with sceneKey at top level
 * @param {number} currentRequestSeq - latest request sequence number
 * @param {string} currentSceneKey - currently active scene key
 * @param {Array<{key:string,label:string}>} [scenes] - scene list for normalization
 * @returns {import('./sceneResponseValidation').SceneContractValidation}
 */
function validateSceneContract(requestContext, data, currentRequestSeq, currentSceneKey) {
  const responseSceneKey = data?.sceneKey;
  const responseScene = data?.scene;
  const context = {
    requestSeq: requestContext.requestSeq,
    currentSeq: currentRequestSeq,
    requestSceneKey: requestContext.sceneKey,
    currentSceneKey,
    responseSceneKey,
    responseScene,
  };

  if (requestContext.requestSeq !== currentRequestSeq) {
    return { ok: false, reason: 'STALE_REQUEST_SEQ', ...context };
  }
  if (currentSceneKey !== requestContext.sceneKey) {
    return { ok: false, reason: 'ACTIVE_SCENE_CHANGED', ...context };
  }

  if (responseSceneKey === undefined || responseSceneKey === null || responseSceneKey === '') {
    return { ok: false, reason: 'MISSING_RESPONSE_SCENE_KEY', ...context };
  }
  if (typeof responseSceneKey !== 'string' || !DEFAULT_SCENES.some((scene) => scene.key === responseSceneKey)) {
    return { ok: false, reason: 'UNKNOWN_RESPONSE_SCENE_KEY', ...context };
  }
  if (responseSceneKey !== requestContext.sceneKey) {
    return { ok: false, reason: 'RESPONSE_SCENE_MISMATCH', ...context };
  }

  return { ok: true };
}

function validateRecommendationCountContract(data) {
  const contract = data?.countContract;
  const returnedCardCount = Array.isArray(data?.outfits) ? data.outfits.length : -1;
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) {
    return { ok: false, reason: 'MISSING_COUNT_CONTRACT', contract, returnedCardCount };
  }
  const numbers = ['requestedBatchSize', 'expectedCardCount', 'returnedCardCount', 'remainingUniqueBeforeConsume', 'remainingUniqueAfterConsume'];
  if (numbers.some((field) => !Number.isInteger(contract[field]) || contract[field] < 0)) {
    return { ok: false, reason: 'INVALID_COUNT_CONTRACT', contract, returnedCardCount };
  }
  if (contract.requestedBatchSize < 1 || contract.requestedBatchSize > 8
    || typeof contract.tailBatchAuthorized !== 'boolean'
    || typeof contract.poolExhaustedAfterConsume !== 'boolean'
    || !['full_compute', 'candidate_pool_hit', 'fallback_recompute'].includes(contract.executionMode)
    || !(contract.candidatePoolId === null || typeof contract.candidatePoolId === 'string')) {
    return { ok: false, reason: 'INVALID_COUNT_CONTRACT', contract, returnedCardCount };
  }
  const expectedCardCount = contract.remainingUniqueBeforeConsume === 0
    ? 0
    : Math.min(contract.requestedBatchSize, contract.remainingUniqueBeforeConsume);
  const isTail = contract.remainingUniqueBeforeConsume > 0
    && contract.remainingUniqueBeforeConsume < contract.requestedBatchSize;
  const consistent = contract.expectedCardCount === expectedCardCount
    && contract.returnedCardCount === returnedCardCount
    && returnedCardCount === expectedCardCount
    && contract.remainingUniqueAfterConsume
      === contract.remainingUniqueBeforeConsume - returnedCardCount
    && contract.tailBatchAuthorized === isTail
    && contract.poolExhaustedAfterConsume === (contract.remainingUniqueAfterConsume === 0);
  return consistent
    ? { ok: true }
    : { ok: false, reason: 'COUNT_CONTRACT_MISMATCH', contract, returnedCardCount };
}

module.exports = {
  DEFAULT_SCENES,
  normalizeScene,
  validateRecommendationCountContract,
  validateSceneContract,
};
