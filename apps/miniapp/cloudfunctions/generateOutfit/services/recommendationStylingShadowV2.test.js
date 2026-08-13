const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  buildRecommendationNarrativePlanV2,
  validateRecommendationNarrativePlanV2,
} = require('./recommendationNarrativePlanV2');
const {
  buildStylingInsightCandidatesV2,
} = require('./stylingInsightCandidateV2');
const {
  runRecommendationStylingShadowV2Safely,
} = require('./recommendationStylingShadowV2');
const { runRecommendationStylingShadowV2Harness } = require('./recommendationStylingShadowV2.harness');
const {
  materializeFixture,
  recommendationStylingShadowV2Fixtures,
} = require('./recommendationStylingShadowV2.fixtures');

test('Phase A.1 fixture matrix resolves without failures', () => {
  const report = runRecommendationStylingShadowV2Harness();
  assert.equal(report.fixtureCount, recommendationStylingShadowV2Fixtures.length);
  assert.equal(report.failedCount, 0, JSON.stringify(report.failures, null, 2));
  assert.ok(report.distribution.materiality.material > 0);
  assert.ok(report.distribution.materiality.weak > 0);
  assert.ok(report.distribution.materiality.none > 0);
  assert.ok(report.distribution.competition.competing > 0);
  assert.equal(report.summaries.length, report.fixtureCount);
  for (const result of report.results) {
    const commentary = result.plan.surfacePermission.outfitCommentaryInsightIds;
    for (const insight of result.plan.insights.unselected) {
      assert.ok(!commentary.includes(insight.insightId), `${result.fixtureId} leaked unselected commentary`);
    }
  }
});

test('three material candidates enforce one secondary and structured-only overflow', () => {
  const fixture = recommendationStylingShadowV2Fixtures.find((entry) => entry.id === 'three-material-only-one-secondary');
  const plan = buildRecommendationNarrativePlanV2(materializeFixture(fixture), { scene: fixture.scene });
  assert.ok(plan.resolution.decisionCodes.includes('SECONDARY_CAP_ENFORCED'));
  const color = plan.insights.unselected.find((insight) => insight.insightCode === 'COLOR_UNITY');
  assert.ok(color);
  assert.ok(!plan.surfacePermission.outfitCommentaryInsightIds.includes(color.insightId));
  assert.ok(plan.surfacePermission.structuredOnlyInsightIds.includes(color.insightId));
});

test('telemetry is versioned, aggregated, fail-open, and privacy-safe', () => {
  const shadow = require('./recommendationStylingShadowV2');
  const input = recommendationStylingShadowV2Fixtures.slice(0, 2).map(materializeFixture);
  const result = shadow.runRecommendationStylingShadowV2Safely({ recommendations: input, scene: 'home' });
  assert.equal(result.diagnostics.schemaVersion, shadow.RECOMMENDATION_STYLING_TELEMETRY_SCHEMA_VERSION);
  assert.ok(result.diagnostics.candidateVersion);
  assert.ok(result.diagnostics.resolverVersion);
  assert.ok(result.diagnostics.narrativePlanVersion);
  assert.ok(result.diagnostics.distribution.candidateInsightCodes);
  assert.equal(result.diagnostics.shadowFailureCount, 0);
  const failedOpen = shadow.runRecommendationStylingShadowV2Safely({ recommendations: [input[0], null] });
  assert.equal(failedOpen.diagnostics.status, 'partially_failed_open');
  assert.equal(failedOpen.diagnostics.shadowFailureCount, 1);
  assert.equal(shadow.isRecommendationStylingShadowEnabled({ shadowStylingIntelligence: true }, {}), true);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /rawImage|prompt|wardrobe|userProfile|bodyData/i);
});

test('telemetry v2 samples are anonymous coarse cases with conditional shape fields', () => {
  const shadow = require('./recommendationStylingShadowV2');
  const fixture = recommendationStylingShadowV2Fixtures.find((entry) => entry.id === 'primary-pattern-focus');
  const result = shadow.runRecommendationStylingShadowV2Safely({
    recommendations: [materializeFixture(fixture)], scene: fixture.scene, telemetrySampleRate: 1,
  });
  const sample = result.diagnostics.planSamples[0];
  assert.ok(sample.anonymousCaseId);
  assert.equal(sample.sceneCategory, fixture.scene);
  assert.ok(Array.isArray(sample.garments));
  assert.ok(Array.isArray(sample.candidateInsightCodes));
  assert.ok(Array.isArray(sample.unselectedInsightCodes));
  assert.ok(Array.isArray(sample.decisionCodes));
  assert.ok(Array.isArray(sample.relevantEvidenceTypes));
  assert.equal(sample.expressionMode, 'primary');
  assert.ok(sample.garments.every((garment) => !('fit' in garment) && !('silhouette' in garment)));
  assert.doesNotMatch(JSON.stringify(sample), /raw|image|https?:|openid|nickname|wardrobe|profile|prompt|itemId|#|colorPalette/i);
});

test('telemetry normalizes production Chinese scene and garment categories', () => {
  const shadow = require('./recommendationStylingShadowV2');
  const fixture = recommendationStylingShadowV2Fixtures.find((entry) => entry.id === 'primary-pattern-focus');
  const input = materializeFixture(fixture);
  input.items = [
    { ...input.items[0], category: '上衣' },
    { ...input.items[1], category: '下装' },
    { category: '鞋子', colorPalette: [{ name: 'gray', hex: '#888888' }] },
  ];
  const result = shadow.runRecommendationStylingShadowV2Safely({
    recommendations: [input], scene: '居家', telemetrySampleRate: 1,
  });
  const sample = result.diagnostics.planSamples[0];
  assert.equal(result.diagnostics.sceneCategory, 'home');
  assert.equal(sample.sceneCategory, 'home');
  assert.deepEqual(sample.garments.map((garment) => garment.category), ['top', 'bottom', 'shoes']);
  assert.doesNotMatch(JSON.stringify(sample), /raw|image|https?:|openid|nickname|wardrobe|profile|prompt|itemId|#|colorPalette/i);
});

test('Narrative Plan is deterministic across recommendation instance ids', () => {
  const fixture = recommendationStylingShadowV2Fixtures[0];
  const input = materializeFixture(fixture);
  const first = buildRecommendationNarrativePlanV2(input, {
    scene: fixture.scene,
    weather: fixture.weather,
    recommendationInstanceId: 'instance-a',
  });
  const second = buildRecommendationNarrativePlanV2(input, {
    scene: fixture.scene,
    weather: fixture.weather,
    recommendationInstanceId: 'instance-b',
  });
  assert.equal(first.planHash, second.planHash);
  assert.notEqual(first.identity.recommendationInstance.id, second.identity.recommendationInstance.id);
});

test('irrelevant scene and weather do not invalidate evidence or plan hashes', () => {
  const fixture = recommendationStylingShadowV2Fixtures.find((entry) => entry.id === 'primary-pattern-focus');
  const input = materializeFixture(fixture);
  const first = buildRecommendationNarrativePlanV2(input, {
    scene: 'date',
    weather: { mode: 'live', temp: 18 },
  });
  const second = buildRecommendationNarrativePlanV2(input, {
    scene: 'home',
    weather: { mode: 'live', temp: 31 },
  });
  assert.equal(first.identity.evidenceFingerprint, second.identity.evidenceFingerprint);
  assert.equal(first.identity.relevantContextFingerprint, second.identity.relevantContextFingerprint);
  assert.equal(first.planHash, second.planHash);
  assert.deepEqual(first.relevantContext, {});
});

test('scene-dependent evidence changes relevant context but not composition identity', () => {
  const fixture = recommendationStylingShadowV2Fixtures.find((entry) => entry.id === 'scene-primary-work-structure');
  const input = materializeFixture(fixture);
  const work = buildRecommendationNarrativePlanV2(input, { scene: 'work' });
  const home = buildRecommendationNarrativePlanV2(input, { scene: 'home' });
  assert.equal(work.identity.outfitComposition.key, home.identity.outfitComposition.key);
  assert.notEqual(work.identity.relevantContextFingerprint, home.identity.relevantContextFingerprint);
});

test('wearability limitations use only relevant weather context and never become an insight', () => {
  const fixture = recommendationStylingShadowV2Fixtures.find((entry) => entry.id === 'sparse-with-wearability-limitation');
  const input = materializeFixture(fixture);
  const cool = buildRecommendationNarrativePlanV2(input, { weather: { mode: 'live', temp: 18 } });
  const warm = buildRecommendationNarrativePlanV2(input, { weather: { mode: 'live', temp: 27 } });
  assert.equal(warm.insights.primary, null);
  assert.ok(warm.limitations.some((limitation) => limitation.sourceCode === 'WARM_WEATHER_HEAVY_COMBO'));
  assert.notEqual(cool.identity.relevantContextFingerprint, warm.identity.relevantContextFingerprint);
  assert.equal(cool.identity.evidenceFingerprint, warm.identity.evidenceFingerprint);
});

test('basic garments without relation evidence do not imply ease of matching', () => {
  const fixture = recommendationStylingShadowV2Fixtures.find((entry) => entry.id === 'sparse-basic-no-evidence');
  const plan = buildRecommendationNarrativePlanV2(materializeFixture(fixture), { scene: fixture.scene });
  assert.equal(plan.resolution.materiality, 'none');
  assert.equal(plan.insights.primary, null);
  assert.equal(plan.surfacePermission.canonicalRecommendationInsightIds.length, 0);
  assert.equal(plan.claimPermission.baselineCompositionClaim.allowsStylingConclusion, false);
  assert.ok(plan.claimPermission.blockedClaimFamilies.includes('unsupported_ease_of_matching'));
});

test('unconsumed body data cannot authorize body claims', () => {
  const fixture = recommendationStylingShadowV2Fixtures.find((entry) => entry.id === 'sparse-basic-no-evidence');
  const input = materializeFixture(fixture);
  const clean = buildRecommendationNarrativePlanV2(input, { scene: fixture.scene });
  const withBodyData = buildRecommendationNarrativePlanV2({
    ...input,
    bodyData: { height: 168, bodyShape: 'untrusted-input' },
  }, { scene: fixture.scene });
  assert.equal(withBodyData.planHash, clean.planHash);
  assert.ok(withBodyData.claimPermission.blockedClaimFamilies.includes('body_effect'));
  assert.ok(!withBodyData.claimPermission.authorizedClaims.some((permission) => permission.claimCode === 'body.effect'));
});

test('Competing stores one Primary and reserves Secondary outside canonical claims', () => {
  const fixture = recommendationStylingShadowV2Fixtures.find((entry) => entry.id === 'competing-pattern-and-silhouette');
  const plan = buildRecommendationNarrativePlanV2(materializeFixture(fixture), { scene: fixture.scene });
  assert.equal(plan.resolution.competition, 'competing');
  assert.equal(plan.claimPermission.authorizedClaims.length, 2);
  assert.equal(plan.surfacePermission.canonicalRecommendationInsightIds.length, 1);
  assert.equal(plan.surfacePermission.canonicalRecommendationInsightIds[0], plan.insights.primary.insightId);
  assert.deepEqual(plan.surfacePermission.outfitCommentaryInsightIds, [plan.insights.primary.insightId, plan.insights.selectedSecondary.insightId]);
  assert.ok(!plan.surfacePermission.canonicalRecommendationInsightIds.includes(plan.insights.selectedSecondary.insightId));
});

test('candidate builder ignores legacy Presentation conclusions and copy', () => {
  const fixture = recommendationStylingShadowV2Fixtures[0];
  const input = materializeFixture(fixture);
  const clean = buildStylingInsightCandidatesV2(input);
  const poisoned = buildStylingInsightCandidatesV2({
    ...input,
    reason: 'poison reason',
    reasoning: 'poison reasoning',
    presentationPlan: { primaryRelationCode: 'POISON', todayReason: 'poison' },
    copyContract: { todayReason: 'poison', detailExplanation: 'poison' },
    xiaodaStyleInsight: { primary: { insightCode: 'POISON' } },
    contentPlan: { primaryBenefit: 'poison' },
    primaryBenefit: 'poison',
    secondaryBenefit: 'poison',
  });
  assert.deepEqual(poisoned, clean);
});

test('deterministic validator rejects identity and permission corruption', () => {
  const fixture = recommendationStylingShadowV2Fixtures[0];
  const plan = buildRecommendationNarrativePlanV2(materializeFixture(fixture), { scene: fixture.scene });
  const corrupted = JSON.parse(JSON.stringify(plan));
  corrupted.claimPermission.authorizedClaims[0].evidenceRefs = ['missing:evidence'];
  const result = validateRecommendationNarrativePlanV2(corrupted);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes('PLAN_HASH_MISMATCH'));
  assert.ok(result.errors.includes('CLAIM_EVIDENCE_OUTSIDE_PLAN'));
});

test('Shadow fails open without changing the recommendation path', () => {
  const shadow = runRecommendationStylingShadowV2Safely({
    recommendations: [{ outfitKey: '', items: [] }],
  });
  assert.equal(shadow.diagnostics.status, 'failed_open');
  assert.equal(shadow.distribution.total, 0);
  assert.equal(shadow.plans.length, 0);
});

test('generateOutfit shadow branch is before and independent from Legacy Presentation', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  const shadowIndex = source.indexOf('runRecommendationStylingShadowV2Safely({');
  const legacyIndex = source.indexOf('compileRecommendationsForResponse({');
  assert.ok(shadowIndex > 0);
  assert.ok(legacyIndex > shadowIndex);
  assert.doesNotMatch(
    fs.readFileSync(path.join(__dirname, 'stylingInsightCandidateV2.js'), 'utf8'),
    /recommendationLanguageV3|recommendationPresentation|presentationFactModel|xiaodaStyleInsight|todayReason|detailExplanation/,
  );
});
