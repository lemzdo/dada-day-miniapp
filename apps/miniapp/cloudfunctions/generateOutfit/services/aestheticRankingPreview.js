const MAX_AESTHETIC_DELTA = 6;
const PROTECTION_TOTAL_GAP = 12;

function calculateAestheticDelta(aestheticEvaluation) {
  if (!aestheticEvaluation || typeof aestheticEvaluation !== 'object') return 0;

  const score = Number(aestheticEvaluation.score);
  const coverage = Number(aestheticEvaluation.coverage);
  if (aestheticEvaluation.score === null || !Number.isFinite(score)) return 0;
  if (!Number.isFinite(coverage) || coverage < 0.5) return 0;

  const centeredScore = clamp((score - 70) / 25, -1, 1);
  const reliability = clamp((coverage - 0.5) / 0.3, 0, 1);
  return round2(clamp(centeredScore * reliability * MAX_AESTHETIC_DELTA, -MAX_AESTHETIC_DELTA, MAX_AESTHETIC_DELTA));
}

function buildAestheticRankingPreview(outfits) {
  if (!Array.isArray(outfits) || outfits.length === 0) return [];

  const entries = outfits.map((outfit, index) => {
    const existingTotal = readExistingTotal(outfit);
    const aestheticEvaluation = outfit && outfit.aestheticEvaluation;
    const aestheticDelta = calculateAestheticDelta(aestheticEvaluation);
    return {
      originalIndex: index,
      originalRank: index + 1,
      existingTotal,
      aestheticScore: readNullableNumber(aestheticEvaluation?.score),
      coverage: readNumber(aestheticEvaluation?.coverage, 0),
      aestheticDelta,
      rankingScore: round2(existingTotal + aestheticDelta),
    };
  });

  const sorted = entries.slice().sort(comparePreviewEntries);
  const previewRankByIndex = new Map();
  sorted.forEach((entry, index) => {
    previewRankByIndex.set(entry.originalIndex, index + 1);
  });

  return entries.map((entry) => {
    const previewRank = previewRankByIndex.get(entry.originalIndex) || entry.originalRank;
    return {
      originalRank: entry.originalRank,
      previewRank,
      existingTotal: entry.existingTotal,
      aestheticScore: entry.aestheticScore,
      coverage: round2(entry.coverage),
      aestheticDelta: entry.aestheticDelta,
      rankingScore: entry.rankingScore,
      movedBy: entry.originalRank - previewRank,
    };
  });
}

function comparePreviewEntries(a, b) {
  const originalGap = Math.abs(a.existingTotal - b.existingTotal);
  if (originalGap > PROTECTION_TOTAL_GAP && a.existingTotal !== b.existingTotal) {
    return b.existingTotal - a.existingTotal;
  }
  if (a.rankingScore !== b.rankingScore) return b.rankingScore - a.rankingScore;
  if (a.existingTotal !== b.existingTotal) return b.existingTotal - a.existingTotal;
  return a.originalIndex - b.originalIndex;
}

function readExistingTotal(outfit) {
  return readNumber(outfit?.scores?.total, 0);
}

function readNullableNumber(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? round2(number) : null;
}

function readNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? round2(number) : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round2(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

module.exports = {
  MAX_AESTHETIC_DELTA,
  PROTECTION_TOTAL_GAP,
  buildAestheticRankingPreview,
  calculateAestheticDelta,
};
