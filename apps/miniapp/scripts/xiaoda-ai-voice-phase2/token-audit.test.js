'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DEVELOPMENT_FIXTURES } = require('../xiaoda-ai-voice-spike/development-fixtures');
const { buildStylingBrief } = require('../xiaoda-ai-voice-spike/core');
const { buildStylingBriefV2, toModelBrief } = require('./core');
const { audit, comparePayloads } = require('./token-audit');

test('token audit marks estimates and all payload sections', () => {
  const x = audit({
    systemPersona: 'x',
    rules: 'r',
    forbiddenLanguage: 'f',
    goodExamples: 'g',
    badExamples: 'b',
    schema: 's',
    repeatedInstructions: 'i',
    briefs: [{ scene: 'home', garments: [{ alias: 'g1' }] }],
  });
  assert.equal(x.estimated, true);
  assert.ok(x.total.bytes > 0);
  for (const section of [
    'systemPersona', 'rules', 'forbiddenLanguage', 'goodExamples', 'badExamples',
    'schema', 'repeatedInstructions', 'stylingBriefPayload',
    'perItemRepeatedContent', 'batchSharedContent',
  ]) {
    assert.ok(x.sections[section], `missing section: ${section}`);
  }
});

test('v2 payload materially reduces bytes on first eight development fixtures', () => {
  const fixtures = DEVELOPMENT_FIXTURES.slice(0, 8);
  const v1Briefs = fixtures.map((fixture) => buildStylingBrief(fixture.outfit, {
    benchmarkId: fixture.id,
    modelAlias: 'plus',
  }));
  const v2Briefs = fixtures.map((fixture) => {
    const source = fixture.outfit;
    const factModel = source.presentationPlan.factModel;
    return toModelBrief(buildStylingBriefV2({
      id: fixture.id,
      scene: source.scene,
      items: factModel.items,
      stylingRelations: factModel.relations,
      xiaodaStyleInsight: source.xiaodaStyleInsight,
      weatherDependency: source.weatherDependency,
    }, { benchmarkId: fixture.id, modelAlias: 'plus' }));
  });
  assert.equal(v1Briefs.length, 8);
  assert.equal(v2Briefs.length, 8);
  const result = comparePayloads(v1Briefs, v2Briefs);
  assert.ok(result.baselineBytes > 0);
  assert.ok(result.v2Bytes > 0);
  assert.ok(result.v2Bytes <= result.baselineBytes * 0.4);
  console.log(`TOKEN_REDUCTION ${JSON.stringify(result)}`);
});
