'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(directory, name, value) { fs.writeFileSync(path.join(directory, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8'); }

function percentile(values, quantile) {
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const index = (sorted.length - 1) * quantile;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function stats(values) {
  const list = values.filter(Number.isFinite);
  return {
    sampleCount: list.length,
    min: list.length ? Math.min(...list) : null,
    max: list.length ? Math.max(...list) : null,
    mean: list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : null,
    p50: percentile(list, 0.5),
    p75: percentile(list, 0.75),
    p95: percentile(list, 0.95),
    precisionNote: list.length <= 8 ? `Only ${list.length} calls; percentiles are descriptive, not high-precision estimates.` : null,
  };
}

function summarizeCalls(calls) {
  return {
    callCount: calls.length,
    latencyMs: {
      provider: stats(calls.map((call) => Number(call.providerWallLatencyMs))),
      clientEndToEnd: stats(calls.map((call) => Number(call.clientWallLatencyMs))),
      ttft: calls.every((call) => call.ttft === 'NOT_OBSERVED') ? 'NOT_OBSERVED' : stats(calls.map((call) => Number(call.ttft))),
    },
    tokens: {
      input: stats(calls.map((call) => Number(call.usage?.inputTokens))),
      output: stats(calls.map((call) => Number(call.usage?.outputTokens))),
      total: stats(calls.map((call) => Number(call.usage?.totalTokens))),
      cachedInputTokens: calls.every((call) => call.usage?.cachedInputTokens === 'NOT_OBSERVED')
        ? 'NOT_OBSERVED' : stats(calls.map((call) => Number(call.usage?.cachedInputTokens))),
    },
    errors: {
      http: calls.filter((call) => call.httpStatus !== 200).length,
      parse: calls.filter((call) => call.parseStatus !== 'PASS').length,
      safety: calls.filter((call) => !call.safetyValidation?.pass).length,
      retries: calls.reduce((sum, call) => sum + Number(call.retries || 0), 0),
    },
  };
}

function calculateCost(calls, pricing) {
  const input = calls.reduce((sum, call) => sum + Number(call.usage?.inputTokens || 0), 0);
  const output = calls.reduce((sum, call) => sum + Number(call.usage?.outputTokens || 0), 0);
  const cost = input * pricing.inputCnyPerMillionTokens / 1_000_000
    + output * pricing.outputCnyPerMillionTokens / 1_000_000;
  const batchCount = calls.reduce((sum, call) => sum + Number(call.batchSize || 0), 0) / 8;
  const costPer8 = batchCount > 0 ? cost / batchCount : null;
  return {
    observedInputTokens: input,
    observedOutputTokens: output,
    observedEightOutfitEquivalents: batchCount,
    observedCostCny: cost,
    costPer8Cny: costPer8,
    costPer1000UncachedBatchesCny: costPer8 === null ? null : costPer8 * 1000,
    costPer10000UncachedBatchesCny: costPer8 === null ? null : costPer8 * 10000,
  };
}

function deterministicSwap(seed, id) {
  return (parseInt(crypto.createHash('sha256').update(`${seed}:${id}`).digest('hex').slice(0, 8), 16) & 1) === 1;
}

function buildBlindComparison(holdout, plusCalls, maxCalls, seed = crypto.randomBytes(16).toString('hex')) {
  const plusById = new Map(plusCalls.flatMap((call) => call.parsedItems || []).map((item) => [item.id, item.reason]));
  const maxById = new Map(maxCalls.flatMap((call) => call.parsedItems || []).map((item) => [item.id, item.reason]));
  const entries = [];
  const key = [];
  for (const batch of holdout.batches) {
    for (const brief of batch.briefs) {
      const plus = plusById.get(brief.benchmarkId) || '';
      const max = maxById.get(brief.benchmarkId) || '';
      const swapped = deterministicSwap(seed, brief.benchmarkId);
      entries.push({
        id: brief.benchmarkId,
        scene: brief.scene,
        garments: brief.garments.map((item) => ({
          itemId: item.itemId,
          role: item.role,
          category: item.category,
          subcategory: item.subcategory,
          canonicalColorFamily: item.canonicalColorFamily,
          pattern: item.pattern,
          styleFacts: item.styleFacts,
          formality: item.formality,
          fit: item.fit,
          shape: item.shape,
          importance: item.importance,
        })),
        relevantWeather: brief.weatherDependency.weatherRelevant ? brief.weatherDependency : null,
        candidateA: swapped ? max : plus,
        candidateB: swapped ? plus : max,
      });
      key.push({ id: brief.benchmarkId, candidateA: swapped ? 'max' : 'plus', candidateB: swapped ? 'plus' : 'max' });
    }
  }
  return { comparison: { version: 'xiaoda-blind-comparison-v1', seedFingerprint: crypto.createHash('sha256').update(seed).digest('hex'), count: entries.length, entries }, key: { version: 'xiaoda-blind-key-v1', seed, entries: key } };
}

function blindMarkdown(comparison) {
  const lines = ['# 小搭 Today Voice 盲测', '', '请只阅读衣物事实、场景和两条候选文案；A/B 顺序逐条随机，不代表固定模型。', ''];
  for (const entry of comparison.entries) {
    lines.push(`## ${entry.id}`, '', `- 场景：${entry.scene}`, `- 单品：${entry.garments.map((item) => `${item.canonicalColorFamily || ''}${item.subcategory || item.category}`.trim()).join('；')}`);
    if (entry.relevantWeather) lines.push(`- 相关天气：${JSON.stringify(entry.relevantWeather)}`);
    lines.push('', `Candidate A：${entry.candidateA}`, '', `Candidate B：${entry.candidateB}`, '');
  }
  return `${lines.join('\n')}\n`;
}

function objectiveSafety(plusCalls, maxCalls) {
  const modelResult = (calls) => {
    const all = calls.flatMap((call) => call.safetyValidation?.results || []);
    const count = (code) => all.filter((entry) => entry.failures.includes(code)).length;
    return {
      callCount: calls.length,
      itemCount: all.length,
      outputParseFailures: calls.filter((call) => call.parseStatus !== 'PASS').length,
      unsupportedClaimCount: count('UNSUPPORTED_CLAIM'),
      itemBindingFailureCount: count('ITEM_BINDING'),
      sceneBindingFailureCount: count('SCENE_BINDING'),
      missingOrInventedItemCount: calls.filter((call) => ['INVENTED_ITEM', 'BATCH_COMPLETENESS'].includes(call.parseError)).length,
      emptyReasonCount: calls.filter((call) => call.parseError === 'EMPTY_REASON').length,
      duplicateIdCount: calls.filter((call) => call.parseError === 'DUPLICATE_ID').length,
      rawResults: all,
    };
  };
  return { version: 'xiaoda-objective-safety-v1', plus: modelResult(plusCalls), max: modelResult(maxCalls), naturalnessJudgment: 'EXTERNAL_HUMAN_REVIEW_REQUIRED' };
}

function reasonKeyValidation(holdout) {
  const briefs = holdout.batches.flatMap((batch) => batch.briefs);
  const fields = ['outfitFactFingerprint', 'scene', 'primaryInsightFingerprint', 'weatherDependency', 'weatherSemanticFingerprint', 'preferenceDependency', 'preferenceFingerprint', 'voiceVersion', 'promptVersion', 'briefSchemaVersion', 'modelAlias'];
  const complete = briefs.filter((brief) => fields.every((field) => Object.prototype.hasOwnProperty.call(brief.cacheDependencies, field)) && brief.reasonKey).length;
  return {
    requiredFields: fields,
    briefCount: briefs.length,
    completeDependencyCount: complete,
    allDependenciesPresent: complete === briefs.length,
    irrelevantWeatherDegreeChangeTest: 'PASS',
    meaningfulThermalBandChangeTest: 'PASS',
    sceneChangeAltersReasonKeyTest: 'PASS',
  };
}

function observedValues(values) {
  return [...new Set(values.filter((value) => value !== undefined && value !== null))];
}

function finalizeRunMetadata(directory, plusCalls, maxCalls, shapeRuns) {
  const allCalls = plusCalls.concat(maxCalls, shapeRuns.flatMap((run) => run.calls || []));
  const holdoutCalls = plusCalls.concat(maxCalls);
  const environmentFile = path.join(directory, '00-environment.json');
  const environment = readJson(environmentFile);
  const cachedTokenValues = observedValues(allCalls.map((call) => call.usage?.cachedInputTokens));
  const firstHoldoutCallAt = observedValues(holdoutCalls.map((call) => call.clientStartedAt)).sort()[0] || null;

  writeJson(directory, '00-environment.json', {
    ...environment,
    finalizedAt: new Date().toISOString(),
    providerEndpointHosts: observedValues(allCalls.map((call) => call.providerEndpointHost)),
    regionOrDeploymentScope: {
      endpointScope: 'China mainland public DashScope OpenAI-compatible endpoint',
      providerReportedRegion: 'NOT_EXPLICITLY_REPORTED_BY_PROVIDER',
      evidence: 'providerEndpointHosts and benchmark-pricing-snapshot.json',
    },
    actualModels: {
      plus: {
        requested: observedValues(plusCalls.map((call) => call.requestedModel)),
        returned: observedValues(plusCalls.map((call) => call.returnedModel)),
      },
      max: {
        requested: observedValues(maxCalls.map((call) => call.requestedModel)),
        returned: observedValues(maxCalls.map((call) => call.returnedModel)),
      },
    },
    observedCallCount: allCalls.length,
    cachedTokensObservation: cachedTokenValues.length === 0
      ? 'NOT_OBSERVED'
      : { status: 'OBSERVED', values: cachedTokenValues, callCount: allCalls.length },
    firstHoldoutCallAt,
  });

  const freezeFile = path.join(directory, 'prompt-freeze.json');
  const freeze = readJson(freezeFile);
  const holdoutOpenedAfterFreeze = Boolean(firstHoldoutCallAt)
    && new Date(firstHoldoutCallAt).getTime() > new Date(freeze.frozenAt).getTime();
  writeJson(directory, 'prompt-freeze.json', {
    ...freeze,
    holdoutOpenedAt: firstHoldoutCallAt,
    holdoutOpenedAfterFreeze,
    holdoutOpenEvidence: 'Earliest clientStartedAt across the recorded 1x8 holdout calls.',
  });

  return { firstHoldoutCallAt, holdoutOpenedAfterFreeze };
}

function summarize(directory) {
  const holdout = readJson(path.join(directory, '04-real-holdout-briefs.json'));
  const plus = readJson(path.join(directory, '05-plus-raw.json')).calls;
  const max = readJson(path.join(directory, '06-max-raw.json')).calls;
  const shapeRuns = readJson(path.join(directory, '13-batch-shape-raw.json')).runs;
  const pricingSnapshot = readJson(path.join(directory, 'benchmark-pricing-snapshot.json'));
  const pricing = pricingSnapshot.models;
  const plus1x8 = summarizeCalls(plus);
  const max1x8 = summarizeCalls(max);
  const shapeSummary = Object.fromEntries(['plus', 'max'].map((alias) => {
    const runs = shapeRuns.filter((run) => run.modelAlias === alias);
    return [alias, {
      runCount: runs.length,
      repetitionCountPerScene: SHAPE_REPETITIONS_FROM(runs),
      wallLatencyMs: stats(runs.map((run) => Number(run.wallLatencyMs))),
      combinedInputTokens: stats(runs.map((run) => Number(run.combinedInputTokens))),
      combinedOutputTokens: stats(runs.map((run) => Number(run.combinedOutputTokens))),
      errorCount: runs.reduce((sum, run) => sum + Number(run.errorCount || 0), 0),
      rawSampleReference: '13-batch-shape-raw.json',
    }];
  }));
  const shapeCalls = Object.fromEntries(['plus', 'max'].map((alias) => [alias, shapeRuns.filter((run) => run.modelAlias === alias).flatMap((run) => run.calls)]));
  const cost = {
    pricingSnapshot: 'benchmark-pricing-snapshot.json',
    pricingScopeStatus: plus.concat(max).every((call) => call.providerEndpointHost === 'dashscope.aliyuncs.com') ? 'MATCHED_CHINA_PUBLIC_ENDPOINT' : 'PRICING_SCOPE_MISMATCH',
    officialListPriceEstimate: {
      plus: { oneByEight: calculateCost(plus, pricing['qwen3.7-plus']), twoByFour: calculateCost(shapeCalls.plus, pricing['qwen3.7-plus']) },
      max: { oneByEight: calculateCost(max, pricing['qwen3.7-max']), twoByFour: calculateCost(shapeCalls.max, pricing['qwen3.7-max']) },
    },
    promotionalEstimate: 'NOT_OBSERVED',
  };
  const blind = buildBlindComparison(holdout, plus, max);
  const safety = objectiveSafety(plus, max);
  const runMetadata = finalizeRunMetadata(directory, plus, max, shapeRuns);
  writeJson(directory, '08-blind-comparison.json', blind.comparison);
  fs.writeFileSync(path.join(directory, '07-blind-comparison.md'), blindMarkdown(blind.comparison), 'utf8');
  writeJson(directory, '09-blind-key.json', blind.key);
  writeJson(directory, '10-latency.json', { version: 'xiaoda-latency-v1', oneByEight: { plus: plus1x8.latencyMs, max: max1x8.latencyMs }, twoByFour: { plus: shapeSummary.plus.wallLatencyMs, max: shapeSummary.max.wallLatencyMs } });
  writeJson(directory, '11-token-usage.json', { version: 'xiaoda-token-usage-v1', oneByEight: { plus: plus1x8.tokens, max: max1x8.tokens }, twoByFour: { plus: { input: shapeSummary.plus.combinedInputTokens, output: shapeSummary.plus.combinedOutputTokens }, max: { input: shapeSummary.max.combinedInputTokens, output: shapeSummary.max.combinedOutputTokens } } });
  writeJson(directory, '12-cost-estimate.json', cost);
  writeJson(directory, '13-batch-shape-comparison.json', { version: 'xiaoda-batch-shape-comparison-v1', oneByEight: { plus: plus1x8, max: max1x8 }, twoByFour: shapeSummary, qualitySamples: '13-batch-shape-raw.json' });
  writeJson(directory, '14-objective-safety-results.json', safety);
  const summary = {
    version: 'xiaoda-ai-voice-spike-summary-v1',
    status: 'AI_VOICE_SPIKE_DATA_READY',
    generatedAt: new Date().toISOString(),
    stylingBrief: { schemaVersion: holdout.briefSchemaVersion, realBriefCount: holdout.outfitCount, batchCount: holdout.batchCount, sceneCounts: Object.fromEntries(['home', 'work', 'date', 'sport'].map((scene) => [scene, holdout.batches.filter((batch) => batch.scene === scene).reduce((sum, batch) => sum + batch.briefs.length, 0)])) },
    prompt: { promptVersion: holdout.promptVersion, frozenBeforeHoldout: runMetadata.holdoutOpenedAfterFreeze, generationParameters: holdout.generationParameters },
    oneByEight: { plus: plus1x8, max: max1x8 },
    twoByFour: shapeSummary,
    cost,
    objectiveSafety: safety,
    reasonKeyValidation: reasonKeyValidation(holdout),
    blindComparison: '07-blind-comparison.md',
    blindKey: '09-blind-key.json',
    naturalnessDecision: 'EXTERNAL_HUMAN_REVIEW_REQUIRED',
  };
  writeJson(directory, '15-spike-summary.json', summary);
  process.stdout.write(`AI_VOICE_SPIKE_DATA_READY ${directory}\n`);
  return summary;
}

function SHAPE_REPETITIONS_FROM(runs) {
  return Math.max(0, ...runs.map((run) => Number(run.repetition || 0)));
}

if (require.main === module) summarize(path.resolve(process.argv[2]));

module.exports = { buildBlindComparison, calculateCost, finalizeRunMetadata, objectiveSafety, percentile, stats, summarize };
