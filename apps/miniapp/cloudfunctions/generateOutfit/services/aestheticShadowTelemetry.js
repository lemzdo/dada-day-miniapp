const crypto = require('crypto');
const { buildAestheticRankingPreview } = require('./aestheticRankingPreview');

const AESTHETIC_SHADOW_LOG_PREFIX = '[AESTHETIC_SHADOW_V1]';
const FUSION_VERSION = 'aesthetic-rank-preview-v1';
const MAX_LOGGED_CANDIDATES = 8;
const MAX_EVIDENCE_CODES = 12;

function parseAestheticShadowSampleRate(value) {
  if (value === undefined || value === null || value === '') return 0;
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) return 0;
  return rate;
}

function isAestheticShadowSampled(seed, sampleRate) {
  const rate = parseAestheticShadowSampleRate(sampleRate);
  if (rate <= 0) return false;
  if (rate >= 1) return true;
  const hash = crypto.createHash('sha256').update(String(seed || 'missing-seed')).digest('hex');
  const bucket = parseInt(hash.slice(0, 13), 16) / 0xfffffffffffff;
  return bucket < rate;
}

function logAestheticShadowTelemetry({ sampleRate, seed, outfits, scene, logger = defaultLogger }) {
  try {
    if (!isAestheticShadowSampled(seed, sampleRate)) return;
    const sample = buildAestheticShadowSample({
      seed,
      scene,
      outfits,
      preview: buildAestheticRankingPreview(outfits),
    });
    logger(`${AESTHETIC_SHADOW_LOG_PREFIX} ${JSON.stringify(sample)}`);
  } catch {
    // Shadow telemetry must never affect recommendation success.
  }
}

function defaultLogger(line) {
  // eslint-disable-next-line no-console
  console.log(line);
}

function buildAestheticShadowSample({ seed, scene, outfits, preview }) {
  const entries = Array.isArray(outfits) ? outfits : [];
  const previewEntries = Array.isArray(preview) ? preview : buildAestheticRankingPreview(entries);
  const candidates = entries.slice(0, MAX_LOGGED_CANDIDATES).map((outfit, index) => {
    const item = previewEntries[index] || {};
    return {
      candidateHash: buildCandidateHash(outfit, index),
      originalRank: item.originalRank,
      previewRank: item.previewRank,
      existingTotal: round2(item.existingTotal),
      aestheticScore: item.aestheticScore === null ? null : round2(item.aestheticScore),
      coverage: round2(item.coverage),
      aestheticDelta: round2(item.aestheticDelta),
      rankingScore: round2(item.rankingScore),
      evidenceCodes: readEvidenceCodes(outfit),
    };
  });

  return {
    schemaVersion: 1,
    engineVersion: readEngineVersion(entries),
    fusionVersion: FUSION_VERSION,
    sampleId: shortHash(seed || 'missing-seed'),
    scene: typeof scene === 'string' && scene ? scene : 'unknown',
    candidateCount: entries.length,
    scoreStats: buildScoreStats(previewEntries),
    rankChanges: buildRankChanges(previewEntries),
    candidates,
  };
}

function buildCandidateHash(outfit, index) {
  const source = typeof outfit?.outfitKey === 'string' && outfit.outfitKey
    ? outfit.outfitKey
    : Array.isArray(outfit?.clothingIds)
      ? outfit.clothingIds.slice().sort().join('|')
      : `candidate-${index}`;
  return shortHash(source);
}

function buildScoreStats(previewEntries) {
  const totals = previewEntries.map((entry) => entry.existingTotal).filter(Number.isFinite);
  const scored = previewEntries.filter((entry) => entry.aestheticScore !== null && entry.aestheticScore !== undefined);
  const coverages = scored.map((entry) => entry.coverage).filter(Number.isFinite);
  return {
    existingMin: totals.length ? round2(Math.min(...totals)) : null,
    existingMax: totals.length ? round2(Math.max(...totals)) : null,
    aestheticNonNull: scored.length,
    aestheticCoverageMean: coverages.length ? round2(mean(coverages)) : 0,
  };
}

function buildRankChanges(previewEntries) {
  const moved = previewEntries.filter((entry) => entry.previewRank !== entry.originalRank);
  return {
    changedCount: moved.length,
    maxMove: moved.length ? Math.max(...moved.map((entry) => Math.abs(entry.movedBy))) : 0,
    topChanged: previewEntries.some((entry) => entry.originalRank === 1 && entry.previewRank !== 1),
  };
}

function readEngineVersion(outfits) {
  const version = outfits
    .map((outfit) => outfit?.aestheticEvaluation?.engineVersion)
    .find((value) => typeof value === 'string' && value);
  return version || 'aesthetic-compat-v1';
}

function readEvidenceCodes(outfit) {
  const evaluation = outfit?.aestheticEvaluation || {};
  const evidenceCodes = [
    ...readArray(evaluation.evidence).map((entry) => entry && entry.code),
    ...Object.values(evaluation.dimensions || {}).flatMap((dimension) => readArray(dimension?.evidenceCodes)),
  ];
  return uniqueStrings(evidenceCodes)
    .filter((code) => /^[A-Z0-9_:-]+$/.test(code))
    .slice(0, MAX_EVIDENCE_CODES);
}

function shortHash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 12);
}

function uniqueStrings(values) {
  return values
    .filter((value) => typeof value === 'string' && value.trim())
    .map((value) => value.trim())
    .filter((value, index, array) => array.indexOf(value) === index);
}

function readArray(value) {
  return Array.isArray(value) ? value : [];
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

function round2(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * 100) / 100;
}

module.exports = {
  AESTHETIC_SHADOW_LOG_PREFIX,
  FUSION_VERSION,
  MAX_EVIDENCE_CODES,
  MAX_LOGGED_CANDIDATES,
  buildAestheticShadowSample,
  buildCandidateHash,
  isAestheticShadowSampled,
  logAestheticShadowTelemetry,
  parseAestheticShadowSampleRate,
};
