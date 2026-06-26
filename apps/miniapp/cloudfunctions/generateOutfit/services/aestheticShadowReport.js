const fs = require('node:fs');
const { AESTHETIC_SHADOW_LOG_PREFIX } = require('./aestheticShadowTelemetry');

/* eslint-disable no-console */

const FORBIDDEN_KEYS = [
  '_openid',
  'openid',
  'clothingIds',
  'itemIds',
  'outfitKey',
  'imageUrl',
  'fileID',
  'city',
  'latitude',
  'longitude',
  'userTitle',
  'nickname',
  'avatar',
  'prompt',
  'rawResult',
  'avoidTags',
];

function parseAestheticShadowLine(line) {
  const text = String(line || '').trim();
  if (!text) return null;
  const jsonText = text.startsWith(AESTHETIC_SHADOW_LOG_PREFIX)
    ? text.slice(AESTHETIC_SHADOW_LOG_PREFIX.length).trim()
    : text.startsWith('{')
      ? text
      : '';
  if (!jsonText) return null;
  try {
    const parsed = JSON.parse(jsonText);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function analyzeAestheticShadowLines(lines) {
  const allLines = Array.isArray(lines) ? lines.filter((line) => String(line || '').trim()) : [];
  const samples = [];
  let invalidLines = 0;
  for (const line of allLines) {
    const parsed = parseAestheticShadowLine(line);
    if (parsed) samples.push(parsed);
    else invalidLines += 1;
  }

  const candidates = samples.flatMap((sample) => readArray(sample.candidates));
  const aestheticScores = candidates.map((candidate) => readNumber(candidate.aestheticScore)).filter((value) => value !== null);
  const coverageValues = candidates.map((candidate) => readNumber(candidate.coverage)).filter((value) => value !== null);
  const deltas = candidates.map((candidate) => readNumber(candidate.aestheticDelta)).filter((value) => value !== null);
  const changedBatches = samples.filter((sample) => Number(sample?.rankChanges?.changedCount || 0) > 0);

  return {
    samples: {
      totalLines: allLines.length,
      validSamples: samples.length,
      invalidLines,
      schemaVersions: distribution(samples.map((sample) => String(sample.schemaVersion))),
      engineVersions: distribution(samples.map((sample) => sample.engineVersion || 'unknown')),
      fusionVersions: distribution(samples.map((sample) => sample.fusionVersion || 'unknown')),
      sceneDistribution: distribution(samples.map((sample) => sample.scene || 'unknown')),
    },
    scores: {
      nonNull: aestheticScores.length,
      null: candidates.length - aestheticScores.length,
      stats: stats(aestheticScores),
      coverageStats: stats(coverageValues),
    },
    ranking: {
      batchesWithChanges: changedBatches.length,
      changedRate: ratio(changedBatches.length, samples.length),
      topChangedCount: samples.filter((sample) => Boolean(sample?.rankChanges?.topChanged)).length,
      topChangedRate: ratio(samples.filter((sample) => Boolean(sample?.rankChanges?.topChanged)).length, samples.length),
      averageChangedCandidates: round2(mean(samples.map((sample) => Number(sample?.rankChanges?.changedCount || 0)))),
      maxMove: max(samples.map((sample) => Number(sample?.rankChanges?.maxMove || 0))),
      deltaStats: stats(deltas),
      deltaCounts: {
        positive: deltas.filter((value) => value > 0).length,
        negative: deltas.filter((value) => value < 0).length,
        zero: deltas.filter((value) => value === 0).length,
      },
    },
    safety: buildSafetyReport(samples, candidates),
    recommendation: buildRecommendation(samples),
  };
}

function buildSafetyReport(samples, candidates) {
  const sensitiveFieldHits = {};
  for (const key of FORBIDDEN_KEYS) sensitiveFieldHits[key] = 0;
  for (const sample of samples) {
    const hits = findForbiddenKeys(sample);
    for (const key of hits) sensitiveFieldHits[key] = (sensitiveFieldHits[key] || 0) + 1;
  }

  return {
    protectionViolations: samples.reduce((sum, sample) => sum + countProtectionViolations(readArray(sample.candidates)), 0),
    coverageGateViolations: candidates.filter((candidate) => Number(candidate.coverage) < 0.5 && Number(candidate.aestheticDelta) !== 0).length,
    deltaOutOfBounds: candidates.filter((candidate) => Math.abs(Number(candidate.aestheticDelta || 0)) > 6).length,
    scoreOutOfBounds: candidates.filter((candidate) => isOutOfBounds(candidate.aestheticScore, 0, 100)).length,
    coverageOutOfBounds: candidates.filter((candidate) => isOutOfBounds(candidate.coverage, 0, 1)).length,
    missingCandidateHash: candidates.filter((candidate) => !candidate.candidateHash).length,
    sensitiveFieldHits,
    wrongSchemaVersion: samples.filter((sample) => sample.schemaVersion !== 1).length,
  };
}

function countProtectionViolations(candidates) {
  let violations = 0;
  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const a = candidates[i];
      const b = candidates[j];
      const totalA = Number(a.existingTotal);
      const totalB = Number(b.existingTotal);
      if (!Number.isFinite(totalA) || !Number.isFinite(totalB) || Math.abs(totalA - totalB) <= 12) continue;
      const high = totalA > totalB ? a : b;
      const low = totalA > totalB ? b : a;
      if (Number(low.previewRank) < Number(high.previewRank)) violations += 1;
    }
  }
  return violations;
}

function findForbiddenKeys(value) {
  const hits = new Set();
  walkKeys(value, (key) => {
    if (FORBIDDEN_KEYS.includes(key)) hits.add(key);
  });
  return hits;
}

function walkKeys(value, visit) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) walkKeys(item, visit);
    return;
  }
  for (const key of Object.keys(value)) {
    visit(key);
    walkKeys(value[key], visit);
  }
}

function formatAestheticShadowText(report) {
  return [
    'Aesthetic Shadow Report',
    `samples: ${report.samples.validSamples}/${report.samples.totalLines} valid, ${report.samples.invalidLines} invalid`,
    `scenes: ${stableStringify(report.samples.sceneDistribution)}`,
    `score mean: ${report.scores.stats.mean}`,
    `changed batches: ${report.ranking.batchesWithChanges} (${report.ranking.changedRate})`,
    `top1 changes: ${report.ranking.topChangedCount} (${report.ranking.topChangedRate})`,
    `safety: protection=${report.safety.protectionViolations}, coverage=${report.safety.coverageGateViolations}, sensitive=${sumObject(report.safety.sensitiveFieldHits)}`,
    `recommendation: ${report.recommendation}`,
  ].join('\n');
}

function formatAestheticShadowMarkdown(report) {
  return [
    '# Aesthetic Shadow Report',
    '',
    '## Samples',
    `- Valid samples: ${report.samples.validSamples}`,
    `- Total lines: ${report.samples.totalLines}`,
    `- Invalid lines: ${report.samples.invalidLines}`,
    `- Scenes: \`${stableStringify(report.samples.sceneDistribution)}\``,
    '',
    '## Aesthetic Scores',
    `- Non-null/null: ${report.scores.nonNull}/${report.scores.null}`,
    `- Score stats: \`${stableStringify(report.scores.stats)}\``,
    `- Coverage stats: \`${stableStringify(report.scores.coverageStats)}\``,
    '',
    '## Ranking Impact',
    `- Changed batches: ${report.ranking.batchesWithChanges}`,
    `- Changed rate: ${report.ranking.changedRate}`,
    `- Top1 changes: ${report.ranking.topChangedCount}`,
    `- Max move: ${report.ranking.maxMove}`,
    `- Delta stats: \`${stableStringify(report.ranking.deltaStats)}\``,
    '',
    '## Safety Checks',
    `- 12 point protection violations: ${report.safety.protectionViolations}`,
    `- Coverage gate violations: ${report.safety.coverageGateViolations}`,
    `- Delta out of bounds: ${report.safety.deltaOutOfBounds}`,
    `- Candidate hash missing: ${report.safety.missingCandidateHash}`,
    `- Sensitive field hits: \`${stableStringify(report.safety.sensitiveFieldHits)}\``,
    '',
    '## Recommendation',
    report.recommendation,
  ].join('\n');
}

function buildRecommendation(samples) {
  if (samples.length < 50) {
    return 'Collect more shadow samples before deciding whether to enable ranking fusion.';
  }
  return 'Review safety checks, scene coverage, top1 change rate, and manual smoke results before enabling ranking fusion.';
}

function distribution(values) {
  const result = {};
  for (const value of values) {
    const key = String(value || 'unknown');
    result[key] = (result[key] || 0) + 1;
  }
  return sortObject(result);
}

function stats(values) {
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!sorted.length) {
    return { min: null, max: null, mean: null, median: null, p10: null, p25: null, p75: null, p90: null };
  }
  return {
    min: round2(sorted[0]),
    max: round2(sorted[sorted.length - 1]),
    mean: round2(mean(sorted)),
    median: percentile(sorted, 0.5),
    p10: percentile(sorted, 0.1),
    p25: percentile(sorted, 0.25),
    p75: percentile(sorted, 0.75),
    p90: percentile(sorted, 0.9),
  };
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return round2(sorted[index]);
}

function isOutOfBounds(value, min, maxValue) {
  if (value === null || value === undefined) return false;
  const number = Number(value);
  return !Number.isFinite(number) || number < min || number > maxValue;
}

function readNumber(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function readArray(value) {
  return Array.isArray(value) ? value : [];
}

function ratio(value, total) {
  return total > 0 ? round2(value / total) : 0;
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function max(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? Math.max(...finite) : 0;
}

function round2(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * 100) / 100;
}

function sortObject(value) {
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = value[key];
    return result;
  }, {});
}

function stableStringify(value) {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = sortDeep(value[key]);
    return result;
  }, {});
}

function sumObject(value) {
  return Object.values(value || {}).reduce((sum, item) => sum + Number(item || 0), 0);
}

function main(argv) {
  const filePath = argv[2];
  const mode = argv.includes('--json') ? 'json' : argv.includes('--markdown') ? 'markdown' : 'text';
  if (!filePath) {
    console.error('Usage: node aestheticShadowReport.js <jsonl-file> [--json|--markdown]');
    process.exitCode = 1;
    return;
  }
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  const report = analyzeAestheticShadowLines(lines);
  if (mode === 'json') {
    console.log(stableStringify(report));
    return;
  }
  if (mode === 'markdown') {
    console.log(formatAestheticShadowMarkdown(report));
    return;
  }
  console.log(formatAestheticShadowText(report));
}

if (require.main === module) {
  main(process.argv);
}

module.exports = {
  FORBIDDEN_KEYS,
  analyzeAestheticShadowLines,
  formatAestheticShadowMarkdown,
  formatAestheticShadowText,
  parseAestheticShadowLine,
};
