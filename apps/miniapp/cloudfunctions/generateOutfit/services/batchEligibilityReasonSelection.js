const MAX_SEARCH_STATES = 100000;

function selectBatchEligibilityReasons(outfitsWithCandidates = []) {
  const entries = (Array.isArray(outfitsWithCandidates) ? outfitsWithCandidates : []).map((entry, index) => {
    const candidates = readCandidates(entry);
    const bestTier = candidates.reduce(
      (minimum, candidate) => Math.min(minimum, Number(candidate?.qualityTier) || 99),
      99,
    );
    const best = candidates
      .filter((candidate) => Number(candidate?.qualityTier) === bestTier)
      .slice()
      .sort(compareCandidate);
    return { entry, index, candidates, bestTier, best };
  });

  if (entries.some((entry) => entry.best.length === 0)) {
    throw new Error('eligibility reason candidates are required for every outfit');
  }

  // Most production batches already have one highest-quality reason per card.
  // Avoid entering the bounded combinatorial search when there is no choice to
  // optimize; the selected result is identical to the recursive path.
  const choiceIndexes = entries.every((entry) => entry.best.length === 1)
    ? entries.map(() => 0)
    : searchBestCombination(entries);
  const selected = choiceIndexes.map((choiceIndex, index) => entries[index].best[choiceIndex]);
  const codeCounts = countBy(selected, (candidate) => candidate.code);

  return entries.map(({ entry, candidates, best }, index) => {
    const selectedReason = cloneCandidate(selected[index]);
    const sameQualityAlternativeCodes = uniqueStrings(best
      .filter((candidate) => candidate.code !== selectedReason.code)
      .map((candidate) => candidate.code));
    return {
      ...entry,
      selectedReason,
      selectionDebug: {
        reasonCandidates: candidates.map((candidate) => ({
          code: candidate.code,
          family: candidate.family,
          qualityTier: candidate.qualityTier,
          matched: true,
          text: candidate.text,
        })),
        selectedReasonCode: selectedReason.code,
        selectedReasonFamily: selectedReason.family,
        selectedReasonQualityTier: selectedReason.qualityTier,
        selectionBasis: sameQualityAlternativeCodes.length > 0
          ? 'same-quality-batch-diversity'
          : 'only-highest-quality-candidate',
        sameQualityAlternativeCodes,
        batchRepeatCount: codeCounts.get(selectedReason.code) || 1,
      },
    };
  });
}

function searchBestCombination(entries) {
  let visited = 0;
  let bestScore = null;
  let bestChoice = null;
  const chosen = [];
  const codeCounts = new Map();
  const textCounts = new Map();
  const familyCounts = new Map();

  function visit(index, score) {
    if (visited >= MAX_SEARCH_STATES) return;
    visited += 1;
    if (bestScore !== null && score > bestScore) return;
    if (index === entries.length) {
      if (bestScore === null || score < bestScore || (score === bestScore && compareChoices(chosen, bestChoice) < 0)) {
        bestScore = score;
        bestChoice = chosen.slice();
      }
      return;
    }

    for (let candidateIndex = 0; candidateIndex < entries[index].best.length; candidateIndex += 1) {
      const candidate = entries[index].best[candidateIndex];
      const increment = (codeCounts.get(candidate.code) || 0) * 10000
        + (textCounts.get(candidate.text) || 0) * 1000
        + (familyCounts.get(candidate.family) || 0);
      chosen.push(candidateIndex);
      incrementCount(codeCounts, candidate.code, 1);
      incrementCount(textCounts, candidate.text, 1);
      incrementCount(familyCounts, candidate.family, 1);
      visit(index + 1, score + increment);
      incrementCount(codeCounts, candidate.code, -1);
      incrementCount(textCounts, candidate.text, -1);
      incrementCount(familyCounts, candidate.family, -1);
      chosen.pop();
    }
  }

  visit(0, 0);
  return bestChoice || entries.map(() => 0);
}

function readCandidates(entry) {
  const candidates = Array.isArray(entry?.reasonCandidates)
    ? entry.reasonCandidates
    : Array.isArray(entry?.candidates)
      ? entry.candidates
      : [];
  return candidates.filter((candidate) => candidate && typeof candidate === 'object');
}

function compareCandidate(left, right) {
  return (Number(left.catalogOrder) || 0) - (Number(right.catalogOrder) || 0)
    || String(left.code || '').localeCompare(String(right.code || ''));
}

function compareChoices(left, right) {
  if (!right) return -1;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function incrementCount(map, key, delta) {
  const next = (map.get(key) || 0) + delta;
  if (next > 0) map.set(key, next);
  else map.delete(key);
}

function countBy(values, readKey) {
  const result = new Map();
  for (const value of values) incrementCount(result, readKey(value), 1);
  return result;
}

function cloneCandidate(candidate) {
  return {
    ...candidate,
    subjectItemIds: Array.isArray(candidate.subjectItemIds) ? candidate.subjectItemIds.slice() : [],
    supportingFactIds: Array.isArray(candidate.supportingFactIds) ? candidate.supportingFactIds.slice() : [],
    relationFactIds: Array.isArray(candidate.relationFactIds) ? candidate.relationFactIds.slice() : [],
    sourceRuleReasons: Array.isArray(candidate.sourceRuleReasons) ? candidate.sourceRuleReasons.slice() : [],
    evidence: Array.isArray(candidate.evidence) ? candidate.evidence.map((record) => ({ ...record })) : [],
  };
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === 'string' && value))];
}

module.exports = {
  selectBatchEligibilityReasons,
};
