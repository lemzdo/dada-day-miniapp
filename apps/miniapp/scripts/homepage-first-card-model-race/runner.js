'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const {
  materializeFixture,
  recommendationStylingShadowV2Fixtures,
} = require('../../cloudfunctions/generateOutfit/services/recommendationStylingShadowV2.fixtures');
const {
  buildRecommendationNarrativePlanV2,
} = require('../../cloudfunctions/generateOutfit/services/recommendationNarrativePlanV2');
const {
  buildProductionRendererEntry,
  renderRecommendationVoiceRendererProductionV2,
} = require('../../cloudfunctions/generateOutfit/services/recommendationVoiceRendererProductionV2');
const {
  VOICE_RENDERER_FLASH_MODEL,
  VOICE_RENDERER_MODEL,
} = require('../../cloudfunctions/generateOutfit/services/voiceRendererV2Contract');

const RACE_VERSION = 'homepage-first-card-model-race/v1';
const MODEL_ROUTES = Object.freeze({
  max: Object.freeze({
    model: VOICE_RENDERER_MODEL,
    modelRouteVersion: 'voice-renderer-model-route-v2-max-compressed-v2-stream',
  }),
  fast: Object.freeze({
    model: VOICE_RENDERER_FLASH_MODEL,
    modelRouteVersion: 'voice-renderer-model-route-v2-flash-compressed-v2-stream-race1',
  }),
});
const PRICING_REFERENCE = Object.freeze({
  checkedAt: '2026-09-12',
  source: 'https://help.aliyun.com/zh/model-studio/model-pricing',
  scope: 'global public list price; non-thinking; request input below first tier',
});
const DEFAULT_PRICING_BY_MODEL = Object.freeze({
  [VOICE_RENDERER_MODEL]: Object.freeze({ inputCnyPerMillionTokens: 12, outputCnyPerMillionTokens: 36 }),
  [VOICE_RENDERER_FLASH_MODEL]: Object.freeze({ inputCnyPerMillionTokens: 0.15, outputCnyPerMillionTokens: 1.5 }),
});

function buildRaceCases() {
  return recommendationStylingShadowV2Fixtures.slice(0, 8).map((fixture) => {
    const recommendation = materializeFixture(fixture);
    const plan = buildRecommendationNarrativePlanV2(recommendation, {
      scene: fixture.scene,
      weather: fixture.weather,
      recommendationInstanceId: `homepage-model-race:${fixture.id}`,
    });
    return Object.freeze({
      caseId: fixture.id,
      recommendation,
      plan,
    });
  });
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = values.slice().sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function sumUsage(calls) {
  return calls.reduce((sum, call) => ({
    promptTokens: sum.promptTokens + Number(call.usage?.prompt_tokens || 0),
    completionTokens: sum.completionTokens + Number(call.usage?.completion_tokens || 0),
    totalTokens: sum.totalTokens + Number(call.usage?.total_tokens || 0),
  }), { promptTokens: 0, completionTokens: 0, totalTokens: 0 });
}

function observedCostCny(usage, pricing) {
  if (!pricing) return null;
  return (usage.promptTokens * Number(pricing.inputCnyPerMillionTokens || 0)
    + usage.completionTokens * Number(pricing.outputCnyPerMillionTokens || 0)) / 1_000_000;
}

function summarize(calls, pricingByModel = {}) {
  return Object.fromEntries(Object.entries(MODEL_ROUTES).map(([alias, route]) => {
    const selected = calls.filter((call) => call.modelAlias === alias);
    const firstValidated = selected.map((call) => call.firstValidatedMs).filter(Number.isFinite);
    const usage = sumUsage(selected);
    const cost = observedCostCny(usage, pricingByModel[route.model]);
    return [alias, {
      model: route.model,
      calls: selected.length,
      validated: selected.filter((call) => call.status === 'completed' && call.validatedCount === 1).length,
      failed: selected.filter((call) => call.status !== 'completed' || call.validatedCount !== 1).length,
      firstValidatedP50Ms: percentile(firstValidated, 0.5),
      firstValidatedP95Ms: percentile(firstValidated, 0.95),
      responseHeadersP50Ms: percentile(selected.map((call) => call.responseHeadersMs).filter(Number.isFinite), 0.5),
      completeP50Ms: percentile(selected.map((call) => call.totalLatencyMs).filter(Number.isFinite), 0.5),
      completeP95Ms: percentile(selected.map((call) => call.totalLatencyMs).filter(Number.isFinite), 0.95),
      validatorPassRate: selected.length === 0 ? null : selected.filter((call) => call.status === 'completed' && call.validatedCount === 1).length / selected.length,
      providerErrorRate: selected.length === 0 ? null : selected.filter((call) => call.providerError === true).length / selected.length,
      usage,
      observedCostCny: cost,
      observedCostPerCallCny: cost === null || selected.length === 0 ? null : cost / selected.length,
      failureCounts: selected.flatMap((call) => call.failures).reduce((counts, failure) => {
        counts[failure] = (counts[failure] || 0) + 1;
        return counts;
      }, {}),
    }];
  }));
}

async function invokeProvider({ apiKey, baseUrl, request, signal }) {
  return fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal,
  });
}

async function run({
  repetitions = 1,
  cases = buildRaceCases(),
  apiKey = process.env.BAILIAN_API_KEY || process.env.DASHSCOPE_API_KEY,
  baseUrl = process.env.BAILIAN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  invoke = invokeProvider,
  pricingByModel = DEFAULT_PRICING_BY_MODEL,
  outputDir = path.resolve(__dirname, '../../../../artifacts/homepage-first-card-model-race'),
} = {}) {
  if (invoke === invokeProvider && !apiKey) throw new Error('PROVIDER_KEY_MISSING');
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 5) throw new Error('REPETITIONS_RANGE');
  const calls = [];
  for (const [modelAlias, route] of Object.entries(MODEL_ROUTES)) {
    for (let repetition = 1; repetition <= repetitions; repetition += 1) {
      for (const raceCase of cases) {
        const entry = buildProductionRendererEntry(
          raceCase.plan,
          raceCase.recommendation,
          0,
          raceCase.recommendation.outfitKey || raceCase.caseId,
          undefined,
          route,
        );
        const stages = [];
        const started = performance.now();
        let responseHeadersMs = null;
        const result = await renderRecommendationVoiceRendererProductionV2({
          preparedEntries: [entry.preparedEntry],
          model: route.model,
          modelRouteVersion: route.modelRouteVersion,
          timeoutMs: 120000,
          apiKey,
          baseUrl,
          invoke: async (options) => {
            const response = await invoke(options);
            responseHeadersMs = performance.now() - started;
            return response;
          },
          onAuditStage: (stage, status) => stages.push({
            stage,
            status,
            elapsedMs: performance.now() - started,
          }),
        });
        const firstValidated = stages.find((stage) => stage.stage === 'FIRST_VALIDATED' && stage.status === 'accepted');
        calls.push({
          caseId: raceCase.caseId,
          planId: raceCase.plan.planId,
          planHash: raceCase.plan.planHash,
          modelAlias,
          requestedModel: route.model,
          modelRouteVersion: route.modelRouteVersion,
          repetition,
          status: result.status,
          responseHeadersMs,
          firstValidatedMs: firstValidated?.elapsedMs ?? null,
          totalLatencyMs: performance.now() - started,
          validatedCount: result.validatedCount,
          invalidCount: result.invalidCount,
          failures: result.invalid?.flatMap((invalid) => invalid.failures || [invalid.error]).filter(Boolean) || [],
          providerError: result.status !== 'completed' && Number(result.invalidCount || 0) === 0,
          usage: result.usage || null,
          copy: result.validated?.[0]?.text || null,
          requestFingerprint: crypto.createHash('sha256').update(JSON.stringify({
            planHash: raceCase.plan.planHash,
            prompt: 'compressed-v2-production-1',
            model: 'controlled-variable',
          })).digest('hex'),
        });
      }
    }
  }
  const artifact = {
    schemaVersion: RACE_VERSION,
    generatedAt: new Date().toISOString(),
    status: 'complete',
    repetitions,
    caseCount: cases.length,
    models: MODEL_ROUTES,
    productionPrompt: 'voice-contract-v2.0-compressed-v2-production-1',
    productionValidator: 'validateProductionCopy',
    pricingReference: PRICING_REFERENCE,
    pricingByModel,
    calls,
    summary: summarize(calls, pricingByModel),
  };
  fs.mkdirSync(outputDir, { recursive: true });
  const target = path.join(outputDir, `race-${Date.now()}.json`);
  fs.writeFileSync(target, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  return { artifact, target };
}

if (require.main === module) {
  if (!process.argv.includes('--live')) {
    process.stderr.write('Usage: node apps/miniapp/scripts/homepage-first-card-model-race/runner.js --live\n');
    process.exitCode = 1;
  } else {
    run().then(({ artifact, target }) => {
      process.stdout.write(`${JSON.stringify({ target, summary: artifact.summary }, null, 2)}\n`);
    }).catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
  }
}

module.exports = {
  MODEL_ROUTES,
  DEFAULT_PRICING_BY_MODEL,
  PRICING_REFERENCE,
  RACE_VERSION,
  buildRaceCases,
  observedCostCny,
  percentile,
  run,
  summarize,
};
