const { ENGINE_VERSION, evaluateAestheticCompatibility } = require('./aestheticCompatibility');
const { FIXTURE_VERSION, aestheticCompatibilityFixtures } = require('./aestheticCompatibility.fixtures');

const KNOWN_EVIDENCE_CODES = [
  'SILHOUETTE_BALANCED_CONTRAST',
  'SILHOUETTE_BALANCED_CONTINUITY',
  'SILHOUETTE_EXTREME_VOLUME_STACK',
  'PROPORTION_CLEAR_LAYERING',
  'PROPORTION_BALANCED_LENGTH',
  'PROPORTION_EXTREME_LENGTH_STACK',
  'COLOR_MONOCHROMATIC',
  'COLOR_ANALOGOUS',
  'COLOR_NEUTRAL_ACCENT',
  'COLOR_CONTROLLED_CONTRAST',
  'COLOR_TOO_MANY_DOMINANT_HUES',
  'PATTERN_SINGLE_FOCUS',
  'PATTERN_COHERENT_REPEAT',
  'PATTERN_COMPETING_FOCUS',
  'FORMALITY_ALIGNED',
  'FORMALITY_INTENTIONAL_MIX',
  'FORMALITY_LARGE_GAP',
  'DETAIL_SINGLE_FOCUS',
  'DETAIL_BALANCED_DISTRIBUTION',
  'DETAIL_COMPETING_FOCUS',
];

const DIMENSION_KEYS = [
  'silhouetteBalance',
  'proportionBalance',
  'colorHarmony',
  'patternBalance',
  'formalityConsistency',
  'detailBalance',
];

const GROUP_KEYS = ['positive', 'neutral', 'conflict', 'sparse', 'boundary'];

function runCalibration(fixtures = aestheticCompatibilityFixtures) {
  const results = fixtures.map((fixture) => evaluateFixture(fixture));
  const groups = {};
  const dimensions = {};

  for (const group of GROUP_KEYS) {
    groups[group] = summarizeGroup(results.filter((entry) => entry.group === group));
  }

  for (const dimension of DIMENSION_KEYS) {
    dimensions[dimension] = summarizeDimension(results, dimension);
  }

  const evidence = summarizeEvidence(results);
  const anomalies = detectAnomalies(results);
  const scoreStats = summarizeNumbers(results.map((entry) => entry.score).filter((score) => score !== null));
  const coverageStats = summarizeNumbers(results.map((entry) => entry.coverage));

  return {
    engineVersion: ENGINE_VERSION,
    fixtureVersion: FIXTURE_VERSION,
    sampleCount: results.length,
    groupCounts: countBy(results, 'group', GROUP_KEYS),
    scores: {
      nonNullCount: results.filter((entry) => entry.score !== null).length,
      nullCount: results.filter((entry) => entry.score === null).length,
      ...scoreStats,
    },
    coverage: {
      ...coverageStats,
      buckets: countCoverageBuckets(results.map((entry) => entry.coverage)),
    },
    groups,
    dimensions,
    evidence,
    anomalies,
    results: results.map((entry) => ({
      id: entry.id,
      group: entry.group,
      score: entry.score,
      coverage: entry.coverage,
      evidenceCodes: entry.evidenceCodes,
    })),
  };
}

function evaluateFixture(fixture) {
  const before = stableStringify(fixture.items);
  const result = evaluateAestheticCompatibility(fixture.items);
  const after = stableStringify(fixture.items);
  const reversedResult = evaluateAestheticCompatibility((fixture.items || []).slice().reverse());

  return {
    id: fixture.id,
    group: fixture.group,
    description: fixture.description,
    expectations: fixture.expectations || {},
    score: result.score,
    coverage: result.coverage,
    dimensions: result.dimensions,
    evidence: result.evidence,
    evidenceCodes: result.evidence.map((entry) => entry.code),
    orderInvariant: stableStringify(result) === stableStringify(reversedResult),
    inputMutated: before !== after,
  };
}

function summarizeGroup(entries) {
  const scores = entries.map((entry) => entry.score).filter((score) => score !== null);
  const coverages = entries.map((entry) => entry.coverage);
  const scoreStats = summarizeNumbers(scores);

  return {
    count: entries.length,
    nullRatio: ratio(entries.filter((entry) => entry.score === null).length, entries.length),
    scoreMedian: scoreStats.median,
    scoreRange: [scoreStats.min, scoreStats.max],
    coverageMedian: summarizeNumbers(coverages).median,
  };
}

function summarizeDimension(results, dimension) {
  const entries = results.map((entry) => entry.dimensions[dimension]).filter(Boolean);
  const scores = entries.map((entry) => entry.score).filter((score) => score !== null);
  const coverages = entries.map((entry) => entry.coverage);
  const scoreStats = summarizeNumbers(scores);

  return {
    nonNullCount: scores.length,
    nullRatio: ratio(entries.length - scores.length, entries.length),
    scoreMean: scoreStats.mean,
    scoreMedian: scoreStats.median,
    coverageMean: summarizeNumbers(coverages).mean,
    min: scoreStats.min,
    max: scoreStats.max,
  };
}

function summarizeEvidence(results) {
  const byCode = {};
  const byPolarity = { positive: 0, negative: 0, neutral: 0 };
  const byStrength = { 1: 0, 2: 0, 3: 0 };

  for (const entry of results) {
    for (const evidence of entry.evidence) {
      byCode[evidence.code] = (byCode[evidence.code] || 0) + 1;
      byPolarity[evidence.polarity] = (byPolarity[evidence.polarity] || 0) + 1;
      byStrength[evidence.strength] = (byStrength[evidence.strength] || 0) + 1;
    }
  }

  return {
    byCode: sortObject(byCode),
    byPolarity,
    byStrength,
  };
}

function detectAnomalies(results) {
  const positiveMedian = summarizeGroup(results.filter((entry) => entry.group === 'positive')).scoreMedian;
  const neutralMedian = summarizeGroup(results.filter((entry) => entry.group === 'neutral')).scoreMedian;
  const conflictMedian = summarizeGroup(results.filter((entry) => entry.group === 'conflict')).scoreMedian;
  const scoreCounts = countByValue(results.map((entry) => entry.score).filter((score) => score !== null));
  const topScoreCount = Object.values(scoreCounts).reduce((max, count) => Math.max(max, count), 0);

  return {
    scoreRangeViolations: results.filter((entry) => entry.score !== null && (entry.score < 0 || entry.score > 100)).map((entry) => entry.id),
    coverageRangeViolations: results.filter((entry) => entry.coverage < 0 || entry.coverage > 1).map((entry) => entry.id),
    distributionInversions: [
      ...(positiveMedian !== null && neutralMedian !== null && positiveMedian <= neutralMedian ? ['positive_not_above_neutral'] : []),
      ...(neutralMedian !== null && conflictMedian !== null && neutralMedian <= conflictMedian ? ['neutral_not_above_conflict'] : []),
      ...(positiveMedian !== null && conflictMedian !== null && positiveMedian - conflictMedian < 12 ? ['positive_conflict_gap_below_12'] : []),
    ],
    scoreConcentration: topScoreCount > Math.ceil(results.length * 0.35) ? ['single_score_value_over_35_percent'] : [],
    coverageHighScoreNull: results.filter((entry) => entry.coverage >= 0.25 && entry.score === null).map((entry) => entry.id),
    coverageThresholdViolations: results.filter((entry) => (entry.coverage < 0.25 && entry.score !== null) || (entry.coverage >= 0.25 && entry.score === null)).map((entry) => entry.id),
    unknownEvidenceCodes: uniqueStrings(results.flatMap((entry) => entry.evidenceCodes.filter((code) => !KNOWN_EVIDENCE_CODES.includes(code)))).sort(),
    duplicateEvidenceCodes: results.filter((entry) => new Set(entry.evidenceCodes).size !== entry.evidenceCodes.length).map((entry) => entry.id),
    unsortedEvidenceItemIds: results.filter((entry) => entry.evidence.some((evidence) => stableStringify(evidence.itemIds) !== stableStringify(evidence.itemIds.slice().sort()))).map((entry) => entry.id),
    orderSensitivity: results.filter((entry) => !entry.orderInvariant).map((entry) => entry.id),
    mutatedInputs: results.filter((entry) => entry.inputMutated).map((entry) => entry.id),
    expectationFailures: detectExpectationFailures(results),
  };
}

function detectExpectationFailures(results) {
  const failures = [];
  for (const entry of results) {
    const expectations = entry.expectations || {};
    const [minScore, maxScore] = expectations.scoreBand || [null, null];
    if (entry.score === null && (minScore !== null || maxScore !== null)) failures.push(`${entry.id}:score_null`);
    if (entry.score !== null && minScore !== null && entry.score < minScore) failures.push(`${entry.id}:score_low`);
    if (entry.score !== null && maxScore !== null && entry.score > maxScore) failures.push(`${entry.id}:score_high`);
    if (entry.coverage < Number(expectations.minCoverage || 0)) failures.push(`${entry.id}:coverage_low`);
    if (expectations.maxCoverage !== undefined && entry.coverage > expectations.maxCoverage) failures.push(`${entry.id}:coverage_high`);
    for (const code of expectations.evidenceAny || []) {
      if (!entry.evidenceCodes.includes(code)) failures.push(`${entry.id}:missing_${code}`);
    }
    for (const code of expectations.evidenceNone || []) {
      if (entry.evidenceCodes.includes(code)) failures.push(`${entry.id}:unexpected_${code}`);
    }
  }
  return failures.sort();
}

function buildTextSummary(report) {
  return [
    `Aesthetic Compatibility Calibration V1`,
    `engine=${report.engineVersion}`,
    `fixtures=${report.fixtureVersion}`,
    `samples=${report.sampleCount}`,
    `score_non_null=${report.scores.nonNullCount}`,
    `score_null=${report.scores.nullCount}`,
    `score_median=${formatValue(report.scores.median)}`,
    `coverage_median=${formatValue(report.coverage.median)}`,
    `positive_median=${formatValue(report.groups.positive.scoreMedian)}`,
    `neutral_median=${formatValue(report.groups.neutral.scoreMedian)}`,
    `conflict_median=${formatValue(report.groups.conflict.scoreMedian)}`,
    `expectation_failures=${report.anomalies.expectationFailures.length}`,
  ].join('\n');
}

function buildJsonReport(report) {
  return `${JSON.stringify(report, null, 2)}\n`;
}

function buildMarkdownReport(report) {
  return [
    '# Aesthetic Compatibility Calibration V1',
    '',
    '## Summary',
    '',
    `- Engine version: \`${report.engineVersion}\``,
    `- Fixture version: \`${report.fixtureVersion}\``,
    `- Sample count: ${report.sampleCount}`,
    `- Groups: ${GROUP_KEYS.map((group) => `${group} ${report.groupCounts[group] || 0}`).join(', ')}`,
    `- Production engine adjusted this round: no`,
    `- Ranking remains shadow-only: yes`,
    '',
    '## Score Distribution',
    '',
    markdownTable(
      ['metric', 'value'],
      [
        ['non-null', report.scores.nonNullCount],
        ['null', report.scores.nullCount],
        ['min', formatValue(report.scores.min)],
        ['max', formatValue(report.scores.max)],
        ['mean', formatValue(report.scores.mean)],
        ['median', formatValue(report.scores.median)],
        ['p10', formatValue(report.scores.p10)],
        ['p25', formatValue(report.scores.p25)],
        ['p75', formatValue(report.scores.p75)],
        ['p90', formatValue(report.scores.p90)],
      ],
    ),
    '',
    '## Coverage Distribution',
    '',
    markdownTable(
      ['metric', 'value'],
      [
        ['min', formatValue(report.coverage.min)],
        ['max', formatValue(report.coverage.max)],
        ['mean', formatValue(report.coverage.mean)],
        ['median', formatValue(report.coverage.median)],
        ['<0.25', report.coverage.buckets.lt025],
        ['0.25-0.49', report.coverage.buckets.b025to049],
        ['0.5-0.74', report.coverage.buckets.b05to074],
        ['>=0.75', report.coverage.buckets.gte075],
      ],
    ),
    '',
    '## Group Distribution',
    '',
    markdownTable(
      ['group', 'count', 'null ratio', 'score median', 'score range', 'coverage median'],
      GROUP_KEYS.map((group) => {
        const item = report.groups[group];
        return [group, item.count, formatValue(item.nullRatio), formatValue(item.scoreMedian), `${formatValue(item.scoreRange[0])}-${formatValue(item.scoreRange[1])}`, formatValue(item.coverageMedian)];
      }),
    ),
    '',
    '## Dimension Distribution',
    '',
    markdownTable(
      ['dimension', 'non-null', 'null ratio', 'mean', 'median', 'coverage mean', 'range'],
      DIMENSION_KEYS.map((dimension) => {
        const item = report.dimensions[dimension];
        return [dimension, item.nonNullCount, formatValue(item.nullRatio), formatValue(item.scoreMean), formatValue(item.scoreMedian), formatValue(item.coverageMean), `${formatValue(item.min)}-${formatValue(item.max)}`];
      }),
    ),
    '',
    '## Evidence Frequency',
    '',
    markdownTable(
      ['code', 'count'],
      Object.entries(report.evidence.byCode),
    ),
    '',
    `- Polarity: positive ${report.evidence.byPolarity.positive}, neutral ${report.evidence.byPolarity.neutral}, negative ${report.evidence.byPolarity.negative}`,
    `- Strength: 1=${report.evidence.byStrength[1]}, 2=${report.evidence.byStrength[2]}, 3=${report.evidence.byStrength[3]}`,
    '',
    '## Findings',
    '',
    `- Distribution inversions: ${formatList(report.anomalies.distributionInversions)}`,
    `- Score concentration: ${formatList(report.anomalies.scoreConcentration)}`,
    `- Expectation failures: ${formatList(report.anomalies.expectationFailures)}`,
    `- Unknown evidence codes: ${formatList(report.anomalies.unknownEvidenceCodes)}`,
    `- Order sensitivity: ${formatList(report.anomalies.orderSensitivity)}`,
    `- Mutated inputs: ${formatList(report.anomalies.mutatedInputs)}`,
    '',
    '## Ranking Fusion Proposal',
    '',
    '- Keep existing hard candidate eligibility rules ahead of aesthetic scoring.',
    '- Only allow ranking influence when `aestheticEvaluation.score != null` and `coverage >= 0.50`.',
    '- Use `centeredScore = clamp((score - 70) / 25, -1, 1)`.',
    '- Use `reliability = clamp((coverage - 0.50) / 0.30, 0, 1)`.',
    '- Use `aestheticDelta = centeredScore * reliability * 6`, range `-6..+6`.',
    '- Future ranking recommendation: `rankingScore = existingTotal + aestheticDelta` without writing the delta into `scores.total`.',
    '- Do not enable formal ranking until real shadow samples, Stage 1 deployment smoke tests, and manual color-protection checks pass.',
    '',
    '## Current Limitations',
    '',
    '- Fixtures are synthetic and contain no real user data.',
    '- This report validates offline score shape, not real wardrobe distribution.',
    '- The production function still returns `aestheticEvaluation` in shadow mode only.',
    '',
  ].join('\n');
}

function summarizeNumbers(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).slice().sort((a, b) => a - b);
  if (sorted.length === 0) {
    return { min: null, max: null, mean: null, median: null, p10: null, p25: null, p75: null, p90: null };
  }
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: round2(sorted.reduce((sum, value) => sum + value, 0) / sorted.length),
    median: percentile(sorted, 50),
    p10: percentile(sorted, 10),
    p25: percentile(sorted, 25),
    p75: percentile(sorted, 75),
    p90: percentile(sorted, 90),
  };
}

function percentile(sortedValues, percentileValue) {
  if (sortedValues.length === 0) return null;
  const index = (percentileValue / 100) * (sortedValues.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower];
  const weight = index - lower;
  return round2(sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight);
}

function countCoverageBuckets(values) {
  return {
    lt025: values.filter((value) => value < 0.25).length,
    b025to049: values.filter((value) => value >= 0.25 && value < 0.5).length,
    b05to074: values.filter((value) => value >= 0.5 && value < 0.75).length,
    gte075: values.filter((value) => value >= 0.75).length,
  };
}

function countBy(entries, key, knownKeys) {
  const counts = Object.fromEntries(knownKeys.map((item) => [item, 0]));
  for (const entry of entries) {
    counts[entry[key]] = (counts[entry[key]] || 0) + 1;
  }
  return counts;
}

function countByValue(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] || 0) + 1;
  return counts;
}

function ratio(count, total) {
  return total > 0 ? round2(count / total) : 0;
}

function round2(value) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}

function stableStringify(value) {
  return JSON.stringify(value, replacer);
}

function replacer(_key, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = value[key];
    return result;
  }, {});
}

function uniqueStrings(values) {
  return values.filter((value, index, array) => typeof value === 'string' && array.indexOf(value) === index);
}

function sortObject(value) {
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = value[key];
    return result;
  }, {});
}

function markdownTable(headers, rows) {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(formatValue).join(' | ')} |`),
  ].join('\n');
}

function formatList(values) {
  return values.length ? values.join(', ') : 'none';
}

function formatValue(value) {
  return value === null || value === undefined ? 'null' : String(value);
}

function main() {
  const report = runCalibration();
  if (process.argv.includes('--json')) {
    process.stdout.write(buildJsonReport(report));
  } else if (process.argv.includes('--markdown')) {
    process.stdout.write(buildMarkdownReport(report));
  } else {
    process.stdout.write(`${buildTextSummary(report)}\n`);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  KNOWN_EVIDENCE_CODES,
  buildJsonReport,
  buildMarkdownReport,
  buildTextSummary,
  runCalibration,
};
