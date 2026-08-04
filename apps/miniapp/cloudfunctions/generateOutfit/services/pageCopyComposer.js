function buildRecommendationCopyInput({
  facts,
  insights,
  scene,
  weather,
  narrativePlan,
  batchConstraints,
  seed,
  diagnostics,
} = {}) {
  const structuralInput = {
    facts,
    insights,
    scene,
    weather,
    plan: narrativePlan,
    batchConstraints,
    seed,
    diagnostics,
  };
  return containsCopyOwnedKey(structuralInput) ? null : structuralInput;
}

const COPY_OWNED_KEYS = new Set([
  'todayReason',
  'detailExplanation',
  'aiExtraDefault',
  'reason',
  'reasoning',
  'defaultTodayReason',
  'defaultText',
  'overallComment',
  'advice',
]);

function containsCopyOwnedKey(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  for (const [key, nestedValue] of Object.entries(value)) {
    if (COPY_OWNED_KEYS.has(key) || containsCopyOwnedKey(nestedValue, seen)) return true;
  }
  return false;
}

module.exports = {
  buildRecommendationCopyInput,
};
