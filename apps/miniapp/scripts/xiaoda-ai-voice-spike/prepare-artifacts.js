'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildPresentationFactModel } = require('../../cloudfunctions/generateOutfit/services/presentationFactModel');
const { DEVELOPMENT_FIXTURES } = require('./development-fixtures');
const {
  BRIEF_SCHEMA_VERSION,
  GENERATION_PARAMETERS,
  MODEL_ALLOWLIST,
  PROMPT_VERSION,
  VOICE_VERSION,
  buildPrompt,
  buildStylingBrief,
  sha256,
} = require('./core');

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(directory, name, value) { fs.writeFileSync(path.join(directory, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8'); }

function briefSchema() {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'XiaodaStylingBrief',
    version: BRIEF_SCHEMA_VERSION,
    type: 'object',
    required: ['benchmarkId', 'briefSchemaVersion', 'scene', 'garments', 'weatherDependency', 'stylingRelations', 'candidateInsights', 'primaryStylingPoint', 'cacheDependencies', 'reasonKey'],
    properties: {
      benchmarkId: { type: 'string', minLength: 1 },
      briefSchemaVersion: { const: BRIEF_SCHEMA_VERSION },
      scene: { enum: ['home', 'work', 'date', 'sport'] },
      garments: { type: 'array', minItems: 1 },
      weatherDependency: { type: 'object', required: ['weatherRelevant'] },
      stylingRelations: { type: 'array' },
      candidateInsights: { type: 'array', minItems: 1 },
      primaryStylingPoint: { type: 'object' },
      cacheDependencies: { type: 'object' },
      reasonKey: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    },
  };
}

function prepare(captureFile) {
  const capture = readJson(captureFile);
  if (capture.status !== 'complete' || capture.batchCount !== 8 || capture.outfitCount !== 64) throw new Error('holdout capture is incomplete');
  const directory = path.dirname(captureFile);
  const development = DEVELOPMENT_FIXTURES.map((fixture) => ({
    id: fixture.id,
    coverage: fixture.coverage,
    brief: buildStylingBrief(fixture.outfit, { benchmarkId: `dev-${fixture.id}`, modelAlias: 'plus' }),
  }));
  const holdoutBatches = capture.batches.map((batch, batchIndex) => ({
    batchId: `${batch.scene}-b${batchIndex % 2 + 1}`,
    scene: batch.scene,
    kind: batch.kind,
    productionBuilderVerified: batch.productionBuilderVerified,
    refreshFailure: batch.refreshFailure || null,
    sourceRequestFingerprint: sha256(batch.requestValidation.businessRequest),
    briefs: batch.response.result.data.outfits.map((outfit, outfitIndex) => buildStylingBrief(outfit, {
      benchmarkId: `${batch.scene}-b${batchIndex % 2 + 1}-${String(outfitIndex + 1).padStart(2, '0')}`,
      buildPresentationFactModel,
      modelAlias: '',
    })),
  }));
  const holdout = {
    version: 'xiaoda-real-holdout-v1',
    frozenAt: new Date().toISOString(),
    promptVersion: PROMPT_VERSION,
    briefSchemaVersion: BRIEF_SCHEMA_VERSION,
    generationParameters: GENERATION_PARAMETERS,
    source: capture.source,
    batchCount: holdoutBatches.length,
    outfitCount: holdoutBatches.reduce((sum, batch) => sum + batch.briefs.length, 0),
    batches: holdoutBatches,
  };
  writeJson(directory, '00-environment.json', {
    capturedAt: new Date().toISOString(),
    repositoryHead: require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path.resolve(__dirname, '..', '..', '..', '..'), encoding: 'utf8' }).trim(),
    provider: 'Alibaba Cloud Model Studio / DashScope OpenAI-compatible API',
    regionOrDeploymentScope: 'to be observed by benchmark helper',
    modelAllowlist: MODEL_ALLOWLIST,
    promptVersion: PROMPT_VERSION,
    briefSchemaVersion: BRIEF_SCHEMA_VERSION,
    voiceVersion: VOICE_VERSION,
    generationParameters: GENERATION_PARAMETERS,
    cachedTokensObservation: 'NOT_OBSERVED until provider response',
  });
  fs.writeFileSync(path.join(directory, '01-prompt.md'), `${buildPrompt()}\n`, 'utf8');
  writeJson(directory, '02-brief-schema.json', briefSchema());
  writeJson(directory, '03-prompt-development-fixtures.json', { version: 'xiaoda-prompt-development-v1', promptTuningOnly: true, count: development.length, fixtures: development });
  writeJson(directory, '04-real-holdout-briefs.json', holdout);
  writeJson(directory, 'benchmark-pricing-snapshot.json', {
    pricingCapturedAt: '2026-08-12',
    regionOrDeploymentScope: 'China mainland public list-price reference supplied by task; verify helper deployment scope before cost conclusion',
    currency: 'CNY',
    sourceNote: 'Task-provided official list-price reference; promotional discounts excluded.',
    models: {
      'qwen3.7-max': { inputCnyPerMillionTokens: 12, outputCnyPerMillionTokens: 36 },
      'qwen3.7-plus': { inputCnyPerMillionTokens: 2, outputCnyPerMillionTokens: 8, inputLimitNote: '<=256K tokens per request' },
    },
  });
  process.stdout.write(`ARTIFACT_INPUTS_READY ${directory}\n`);
  return { directory, development, holdout };
}

if (require.main === module) prepare(process.argv[2]);

module.exports = { briefSchema, prepare };
