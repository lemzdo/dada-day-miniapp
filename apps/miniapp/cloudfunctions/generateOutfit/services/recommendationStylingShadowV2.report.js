const fs = require('node:fs');

function aggregateRecommendationStylingTelemetry(records = [], options = {}) {
  const entries = Array.isArray(records) ? records : [];
  const aggregate = {
    recommendationCount: 0,
    executionCount: 0,
    failureCount: 0,
    sampleCount: 0,
    materiality: { material: 0, weak: 0, none: 0 },
    competition: { competing: 0, single: 0, none: 0 },
    primaryInsightCodes: {},
    secondaryInsightCodes: {},
    sceneCategories: {},
    decisionCodes: {},
    evidenceTypes: {},
    candidateCount: {},
    materialCandidateCount: {},
    recommendationLevel: {},
    primarySecondaryCombinations: {},
  };
  const samples = [];
  for (const record of entries) {
    const diagnostics = record?.diagnostics || record || {};
    aggregate.recommendationCount += Number(diagnostics.recommendationCount || 0);
    aggregate.executionCount += Number(diagnostics.shadowExecutionCount || 0);
    aggregate.failureCount += Number(diagnostics.shadowFailureCount || 0);
    aggregate.sampleCount += Number(diagnostics.sampledPlanCount || 0);
    mergeKnown(aggregate.materiality, diagnostics.distribution?.materiality);
    mergeKnown(aggregate.competition, diagnostics.distribution?.competition);
    mergeCounts(aggregate.primaryInsightCodes, diagnostics.distribution?.primaryInsightCodes);
    mergeCounts(aggregate.secondaryInsightCodes, diagnostics.distribution?.secondaryInsightCodes);
    mergeCounts(aggregate.sceneCategories, diagnostics.sceneCategory
      ? { [diagnostics.sceneCategory]: Number(diagnostics.recommendationCount || 0) }
      : {});
    mergeCounts(aggregate.decisionCodes, diagnostics.distribution?.decisionCodes);
    mergeCounts(aggregate.evidenceTypes, diagnostics.distribution?.relevantEvidenceTypes);
    mergeCounts(aggregate.candidateCount, diagnostics.distribution?.candidateCountDistribution);
    mergeCounts(aggregate.materialCandidateCount, diagnostics.distribution?.materialCandidateCountDistribution);
    mergeCounts(aggregate.recommendationLevel, diagnostics.distribution?.recommendationLevel);
    mergeCounts(aggregate.primarySecondaryCombinations, diagnostics.distribution?.primarySecondaryCombinations);
    samples.push(...(Array.isArray(diagnostics.planSamples) ? diagnostics.planSamples : []));
  }
  return {
    recommendation: { count: aggregate.recommendationCount },
    execution: { count: aggregate.executionCount },
    failure: { count: aggregate.failureCount },
    sample: { count: aggregate.sampleCount },
    materiality: aggregate.materiality,
    competition: aggregate.competition,
    primary: aggregate.primaryInsightCodes,
    secondary: aggregate.secondaryInsightCodes,
    scene: aggregate.sceneCategories,
    decisionCodes: aggregate.decisionCodes,
    evidenceTypes: aggregate.evidenceTypes,
    candidateCount: aggregate.candidateCount,
    materialCandidateCount: aggregate.materialCandidateCount,
    recommendationLevel: aggregate.recommendationLevel,
    primarySecondaryCombinations: aggregate.primarySecondaryCombinations,
    reviewBuckets: buildReviewBuckets(samples, options),
  };
}

function buildReviewBuckets(samples = [], options = {}) {
  const limit = Number.isInteger(options.maxCasesPerBucket) ? options.maxCasesPerBucket : 10;
  const buckets = {
    Primary: { count: 0, cases: [] },
    'Weak Only': { count: 0, cases: [] },
    Sparse: { count: 0, cases: [] },
    Competing: { count: 0, cases: [] },
    highFrequencyInsights: {},
  };
  for (const sample of Array.isArray(samples) ? samples : []) {
    const add = (name) => { buckets[name].count += 1; if (buckets[name].cases.length < limit) buckets[name].cases.push(sample); };
    if (sample.primaryInsightCode) add('Primary');
    if (sample.materiality === 'weak') add('Weak Only');
    if (sample.materiality === 'none') add('Sparse');
    if (sample.competition === 'competing') add('Competing');
    const codes = new Set([sample.primaryInsightCode, sample.selectedSecondaryInsightCode, ...(sample.candidateInsightCodes || [])].filter(Boolean));
    for (const code of codes) {
      const entry = buckets.highFrequencyInsights[code] || { count: 0, cases: [] };
      entry.count += 1;
      if (entry.cases.length < limit) entry.cases.push(sample);
      buckets.highFrequencyInsights[code] = entry;
    }
  }
  return buckets;
}

function mergeKnown(target, source = {}) {
  for (const key of Object.keys(target)) target[key] += Number(source?.[key] || 0);
}
function mergeCounts(target, source = {}) {
  for (const [key, value] of Object.entries(source || {})) target[key] = (target[key] || 0) + Number(value || 0);
}

if (require.main === module) {
  const file = process.argv[2];
  const input = file ? fs.readFileSync(file, 'utf8') : fs.readFileSync(0, 'utf8');
  const records = input.trim() ? JSON.parse(`[${input.trim().split(/\r?\n/).join(',')}]`) : [];
  process.stdout.write(`${JSON.stringify(aggregateRecommendationStylingTelemetry(records), null, 2)}\n`);
}

module.exports = { aggregateRecommendationStylingTelemetry, buildReviewBuckets };
