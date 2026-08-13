const {
  buildRecommendationNarrativePlanV2,
  validateRecommendationNarrativePlanV2,
} = require('./recommendationNarrativePlanV2');
const { buildShadowDistribution } = require('./recommendationStylingShadowV2');
const {
  materializeFixture,
  recommendationStylingShadowV2Fixtures,
} = require('./recommendationStylingShadowV2.fixtures');

function runRecommendationStylingShadowV2Harness(fixtures = recommendationStylingShadowV2Fixtures) {
  const results = fixtures.map((fixture, index) => {
    const input = materializeFixture(fixture);
    const plan = buildRecommendationNarrativePlanV2(input, {
      scene: fixture.scene,
      weather: fixture.weather,
      recommendationInstanceId: `fixture:${fixture.id}:${index}`,
    });
    const validation = validateRecommendationNarrativePlanV2(plan);
    const actual = {
      materiality: plan.resolution.materiality,
      competition: plan.resolution.competition,
      primary: plan.insights.primary?.insightCode || null,
      secondary: plan.insights.selectedSecondary ? [plan.insights.selectedSecondary.insightCode] : [],
      unselected: (plan.insights.unselected || []).map((insight) => insight.insightCode),
      decisionCodes: plan.resolution.decisionCodes || [],
      relevantEvidence: plan.participatingEvidenceRefs || [],
      expressionMode: plan.expressionStrategy?.mode || null,
      candidateCodes: [
        plan.insights.primary,
        plan.insights.selectedSecondary,
        ...(plan.insights.unselected || []),
      ].filter(Boolean).map((insight) => ({ code: insight.insightCode, materiality: insight.materiality })),
    };
    const failures = compareExpected(fixture.expected, actual);
    return {
      fixtureId: fixture.id,
      passed: validation.valid && failures.length === 0,
      failures: [...validation.errors, ...failures],
      expected: fixture.expected,
      actual,
      summary: {
        fixtureId: fixture.id,
        candidates: actual.candidateCodes,
        materiality: actual.materiality,
        primary: actual.primary,
        secondary: actual.secondary,
        unselected: actual.unselected,
        decisionCodes: actual.decisionCodes,
        relevantEvidence: actual.relevantEvidence,
        expressionMode: actual.expressionMode,
      },
      plan,
    };
  });
  return {
    fixtureCount: results.length,
    passedCount: results.filter((result) => result.passed).length,
    failedCount: results.filter((result) => !result.passed).length,
    distribution: buildShadowDistribution(results.map((result) => result.plan)),
    failures: results.filter((result) => !result.passed).map((result) => ({
      fixtureId: result.fixtureId,
      failures: result.failures,
      expected: result.expected,
      actual: result.actual,
    })),
    summaries: results.map((result) => result.summary),
    results,
  };
}

function compareExpected(expected, actual) {
  const failures = [];
  for (const key of ['materiality', 'competition', 'primary']) {
    if (expected[key] !== actual[key]) failures.push(`${key}:${expected[key]}!=${actual[key]}`);
  }
  if (Array.isArray(expected.secondary)) {
    const expectedSecondary = expected.secondary.slice().sort();
    const actualSecondary = actual.secondary.slice().sort();
    if (JSON.stringify(expectedSecondary) !== JSON.stringify(actualSecondary)) {
      failures.push(`secondary:${JSON.stringify(expectedSecondary)}!=${JSON.stringify(actualSecondary)}`);
    }
  }
  if (Array.isArray(expected.unselected)) {
    const expectedUnselected = expected.unselected.slice().sort();
    const actualUnselected = (actual.unselected || []).slice().sort();
    if (JSON.stringify(expectedUnselected) !== JSON.stringify(actualUnselected)) {
      failures.push(`unselected:${JSON.stringify(expectedUnselected)}!=${JSON.stringify(actualUnselected)}`);
    }
  }
  return failures;
}

if (require.main === module) {
  const report = runRecommendationStylingShadowV2Harness();
  process.stdout.write(`${JSON.stringify({
    fixtureCount: report.fixtureCount,
    passedCount: report.passedCount,
    failedCount: report.failedCount,
    distribution: report.distribution,
    failures: report.failures,
    summaries: report.summaries,
  }, null, 2)}\n`);
  process.exitCode = report.failedCount === 0 ? 0 : 1;
}

module.exports = {
  runRecommendationStylingShadowV2Harness,
};
