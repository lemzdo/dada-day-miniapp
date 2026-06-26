const assert = require('node:assert/strict');
const test = require('node:test');

const { evaluateAestheticCompatibility } = require('./aestheticCompatibility');
const {
  FIXTURE_VERSION,
  aestheticCompatibilityFixtures,
} = require('./aestheticCompatibility.fixtures');
const {
  KNOWN_EVIDENCE_CODES,
  buildJsonReport,
  buildMarkdownReport,
  buildTextSummary,
  runCalibration,
} = require('./aestheticCompatibility.calibration');

const GROUP_MINIMUMS = {
  positive: 18,
  neutral: 14,
  conflict: 14,
  sparse: 10,
  boundary: 4,
};

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function nonNullScores(group) {
  return aestheticCompatibilityFixtures
    .filter((fixture) => fixture.group === group)
    .map((fixture) => evaluateAestheticCompatibility(fixture.items).score)
    .filter((score) => score !== null);
}

test('fixture ids are unique', () => {
  const ids = aestheticCompatibilityFixtures.map((fixture) => fixture.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('fixture count and group minimums match calibration requirements', () => {
  assert.ok(aestheticCompatibilityFixtures.length >= 60);
  for (const [group, minimum] of Object.entries(GROUP_MINIMUMS)) {
    assert.ok(aestheticCompatibilityFixtures.filter((fixture) => fixture.group === group).length >= minimum);
  }
});

test('all fixtures are JSON serializable and use a fixed fixture version', () => {
  assert.equal(FIXTURE_VERSION, 'aesthetic-compat-fixtures-v1');
  const parsed = JSON.parse(JSON.stringify(aestheticCompatibilityFixtures));
  assert.equal(parsed.length, aestheticCompatibilityFixtures.length);
});

test('all fixtures run without throwing', () => {
  for (const fixture of aestheticCompatibilityFixtures) {
    assert.doesNotThrow(() => evaluateAestheticCompatibility(fixture.items));
  }
});

test('all fixture score bands are satisfied', () => {
  for (const fixture of aestheticCompatibilityFixtures) {
    const result = evaluateAestheticCompatibility(fixture.items);
    const [min, max] = fixture.expectations.scoreBand;
    if (result.score === null) {
      assert.equal(min, null, `${fixture.id} returned null outside null band`);
      assert.equal(max, null, `${fixture.id} returned null outside null band`);
    } else {
      if (min !== null) assert.ok(result.score >= min, `${fixture.id} score ${result.score} < ${min}`);
      if (max !== null) assert.ok(result.score <= max, `${fixture.id} score ${result.score} > ${max}`);
    }
  }
});

test('all fixture coverage minimums and maximums are satisfied', () => {
  for (const fixture of aestheticCompatibilityFixtures) {
    const result = evaluateAestheticCompatibility(fixture.items);
    assert.ok(result.coverage >= fixture.expectations.minCoverage, `${fixture.id} coverage below minimum`);
    if (fixture.expectations.maxCoverage !== undefined) {
      assert.ok(result.coverage <= fixture.expectations.maxCoverage, `${fixture.id} coverage above maximum`);
    }
  }
});

test('all fixture evidence expectations are satisfied', () => {
  const report = runCalibration();
  assert.deepEqual(report.anomalies.expectationFailures, []);
});

test('positive median is higher than neutral median', () => {
  assert.ok(median(nonNullScores('positive')) > median(nonNullScores('neutral')));
});

test('neutral median is higher than conflict median', () => {
  assert.ok(median(nonNullScores('neutral')) > median(nonNullScores('conflict')));
});

test('positive and conflict medians differ by at least twelve points', () => {
  assert.ok(median(nonNullScores('positive')) - median(nonNullScores('conflict')) >= 12);
});

test('sparse fixtures are not judged as low score because data is missing', () => {
  const sparseScores = nonNullScores('sparse');
  assert.ok(sparseScores.every((score) => score >= 68));
  assert.ok(aestheticCompatibilityFixtures.some((fixture) => {
    return fixture.group === 'sparse' && evaluateAestheticCompatibility(fixture.items).score === null;
  }));
});

test('coverage threshold keeps score null below 0.25', () => {
  const report = runCalibration();
  assert.equal(report.anomalies.coverageThresholdViolations.length, 0);
});

test('all scores and coverage values are in range', () => {
  const report = runCalibration();
  assert.equal(report.anomalies.scoreRangeViolations.length, 0);
  assert.equal(report.anomalies.coverageRangeViolations.length, 0);
});

test('all evidence codes are known', () => {
  const report = runCalibration();
  assert.equal(report.anomalies.unknownEvidenceCodes.length, 0);
  for (const code of Object.keys(report.evidence.byCode)) {
    assert.ok(KNOWN_EVIDENCE_CODES.includes(code));
  }
});

test('evidence codes are deduplicated within each result', () => {
  const report = runCalibration();
  assert.equal(report.anomalies.duplicateEvidenceCodes.length, 0);
});

test('evidence item ids are sorted', () => {
  const report = runCalibration();
  assert.equal(report.anomalies.unsortedEvidenceItemIds.length, 0);
});

test('fixture item order does not affect results', () => {
  const report = runCalibration();
  assert.equal(report.anomalies.orderSensitivity.length, 0);
});

test('fixture inputs are not mutated', () => {
  const report = runCalibration();
  assert.equal(report.anomalies.mutatedInputs.length, 0);
});

test('report generation is deterministic', () => {
  const first = runCalibration();
  const second = runCalibration();
  assert.deepEqual(first, second);
  assert.equal(buildTextSummary(first), buildTextSummary(second));
  assert.equal(buildJsonReport(first), buildJsonReport(second));
  assert.equal(buildMarkdownReport(first), buildMarkdownReport(second));
});

test('JSON output is parseable', () => {
  const report = JSON.parse(buildJsonReport(runCalibration()));
  assert.equal(report.engineVersion, 'aesthetic-compat-v1');
  assert.equal(report.fixtureVersion, FIXTURE_VERSION);
});

test('Markdown output contains required report sections', () => {
  const markdown = buildMarkdownReport(runCalibration());
  for (const heading of [
    '# Aesthetic Compatibility Calibration V1',
    '## Summary',
    '## Score Distribution',
    '## Coverage Distribution',
    '## Dimension Distribution',
    '## Evidence Frequency',
    '## Findings',
    '## Ranking Fusion Proposal',
  ]) {
    assert.ok(markdown.includes(heading), `missing ${heading}`);
  }
});
