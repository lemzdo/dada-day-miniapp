const assert = require('node:assert/strict');
const test = require('node:test');
const { aggregateRecommendationStylingTelemetry } = require('./recommendationStylingShadowV2.report');

test('telemetry report aggregates v2 buckets into compact JSON-safe sections', () => {
  const report = aggregateRecommendationStylingTelemetry([{
    diagnostics: {
      recommendationCount: 3,
      shadowExecutionCount: 3,
      shadowFailureCount: 1,
      sampledPlanCount: 2,
      sceneCategory: 'date',
      distribution: {
        materiality: { material: 1, weak: 1, none: 1 },
        competition: { competing: 1, single: 1, none: 1 },
        primaryInsightCodes: { PATTERN_FOCUS: 1 },
        secondaryInsightCodes: { SILHOUETTE_CONTRAST: 1 },
        decisionCodes: { SECONDARY_CAP_ENFORCED: 1 },
        relevantEvidenceTypes: { silhouette_relation: 1 },
        candidateCountDistribution: { '3': 1 },
        materialCandidateCountDistribution: { '3': 1 },
        recommendationLevel: { primary: 1, competing: 1 },
        primarySecondaryCombinations: { 'PATTERN_FOCUS+SILHOUETTE_CONTRAST': 1 },
      },
      planSamples: [{
        materiality: 'material', competition: 'competing', primaryInsightCode: 'PATTERN_FOCUS',
        selectedSecondaryInsightCode: 'SILHOUETTE_CONTRAST', candidateInsightCodes: ['PATTERN_FOCUS', 'SILHOUETTE_CONTRAST'],
      }, { materiality: 'none', competition: 'none', candidateInsightCodes: [] }],
    },
  }]);
  assert.equal(report.recommendation.count, 3);
  assert.equal(report.failure.count, 1);
  assert.equal(report.materiality.material, 1);
  assert.equal(report.competition.competing, 1);
  assert.equal(report.scene.date, 3);
  assert.equal(report.reviewBuckets.Primary.count, 1);
  assert.equal(report.reviewBuckets.Sparse.count, 1);
  assert.equal(report.reviewBuckets.Competing.count, 1);
  assert.equal(report.recommendationLevel.primary, 1);
  assert.equal(report.primarySecondaryCombinations['PATTERN_FOCUS+SILHOUETTE_CONTRAST'], 1);
  assert.equal(report.reviewBuckets.highFrequencyInsights.PATTERN_FOCUS.count, 1);
  assert.equal(report.decisionCodes.SECONDARY_CAP_ENFORCED, 1);
  assert.doesNotMatch(JSON.stringify(report), /rawImage|imageUrl|openid|nickname|wardrobe|profile|prompt|itemId|#cc2222/i);
});
