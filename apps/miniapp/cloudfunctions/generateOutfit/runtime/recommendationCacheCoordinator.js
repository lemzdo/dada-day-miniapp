'use strict';

async function resolveRecommendationCache(snapshot, { loadCandidatePoolForIdentity } = {}) {
  const candidatePoolId = snapshot?.requestedCandidatePoolId;
  if (!candidatePoolId) return { attempted: false, hit: false, reason: 'not_requested', pool: null, ageMs: 0 };
  if (typeof loadCandidatePoolForIdentity !== 'function') throw new Error('RECOMMENDATION_CACHE_ADAPTER_REQUIRED');
  const result = await loadCandidatePoolForIdentity({
    candidatePoolId,
    identity: snapshot.candidatePoolIdentity,
    now: Date.now(),
  });
  return { attempted: true, ...result };
}

module.exports = { resolveRecommendationCache };
