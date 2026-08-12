'use strict';

const fs = require('node:fs');
const path = require('node:path');
const core = require('./core');

const ARTIFACT = path.resolve(__dirname, '../../../../artifacts/xiaoda-ai-voice-max-targeted/20260812-171649');
const read = name => JSON.parse(fs.readFileSync(path.join(ARTIFACT, name), 'utf8'));
const write = (name, value) => fs.writeFileSync(path.join(ARTIFACT, name), typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`, 'utf8');

const selected = read('01-selected-cases.json');
const equivalence = read('02-input-equivalence.json');
const maxRaw = read('04-max-raw.json');
const plusReference = read('05-plus-reference.json');
const maxById = new Map(maxRaw.calls.flatMap(call => call.parsedItems).map(item => [item.id, item.reason]));
const plusById = new Map(plusReference.cases.map(item => [item.id, item.parsed.reason]));
const briefById = new Map(selected.briefs.map(brief => [brief.id, brief]));

const judgments = {
  'dev-sparse-facts': ['MAX_CLEAR_WIN', 'Max 用一句诚实事实代替空输出，完成 low-information graceful realization。'],
  'dev-ordinary-home-basic': ['TIE', '两者都只是自然复述已知衣物，信息价值相同。'],
  'dev-ordinary-work-basic': ['MAX_SLIGHT_WIN', '“上班穿得体”比“适合上班穿”略自然，但仍接近模板。'],
  'dev-onepiece-shoes': ['TIE', 'Max 只补了颜色，核心“搭配完整”仍与 Plus 相同。'],
  'dev-onepiece-layer': ['MAX_SLIGHT_WIN', '“外搭…有层次”比“增加结构感”更像日常中文。'],
  'dev-upper-complex-lower-simple': ['MAX_SLIGHT_WIN', '关系说得更顺，但明显贴近 Prompt good example。'],
  'dev-strong-color-focus': ['PLUS_SLIGHT_WIN', 'Max 更顺口但虚构“清爽”效果，触发客观失败。'],
  'dev-competing-insights': ['BOTH_FAIL', 'Max 仍用分号并列两套分析，依旧像穿搭教材。'],
  'dev-top-shoe-echo': ['TIE', '差异只在“更”和“看着”，没有实质能力提升。'],
  'dev-same-color-core': ['TIE', '两者都是同色关系加泛化整身效果，基本同义。'],
  'dev-weather-relevant': ['MAX_CLEAR_WIN', 'Max 使用授权的冷/风事实自然补齐，Plus 为空。'],
  'dev-sport-complete': ['MAX_SLIGHT_WIN', '“颜色一致”比“颜色呼应”更少算法腔，但提升有限。'],
};

const comparisonRows = selected.ids.map(id => {
  const brief = briefById.get(id);
  const max = maxById.get(id);
  const plus = plusById.get(id);
  const maxFailures = core.validateObjective({ items: [{ id, reason: max }] }, brief);
  const plusFailures = core.validateObjective({ items: [{ id, reason: plus }] }, brief);
  return { id, comparisonClass: 'MODEL_CAPABILITY_COMPARISON', plus, max, judgment: judgments[id][0], reason: judgments[id][1], maxObjectiveFailures: maxFailures, plusObjectiveFailures: plusFailures };
});

const comparisonMd = [
  '# Plus vs Max — complete targeted comparison',
  '',
  '| Case | Plus | Max | Sol judgment | Reason | Objective |',
  '|---|---|---|---|---|---|',
  ...comparisonRows.map(row => `| ${row.id} | ${row.plus || '""'} | ${row.max || '""'} | ${row.judgment} | ${row.reason} | Max: ${row.maxObjectiveFailures.join(', ') || 'PASS'}; Plus: ${row.plusObjectiveFailures.join(', ') || 'PASS'} |`),
  '',
  'All 12 rows are MODEL_CAPABILITY_COMPARISON: Brief canonical hashes and Prompt raw-byte hashes match; only model id and isolated benchmark action differ.',
].join('\n');
write('06-comparison.md', `${comparisonMd}\n`);

const objective = {
  version: 'xiaoda-ai-voice-max-targeted-objective-safety-v1',
  validatorScope: ['INVENTED_GARMENT','INVENTED_ATTRIBUTE','UNSUPPORTED_EFFECT','WRONG_ITEM','SCENE_CONTRADICTION','WEATHER_HALLUCINATION','PARSE_ERROR','EMPTY_OUTPUT'],
  automaticLanguageQualityScoring: false,
  max: comparisonRows.map(row => ({ id: row.id, failures: row.maxObjectiveFailures, pass: row.maxObjectiveFailures.length === 0 })),
  plus: comparisonRows.map(row => ({ id: row.id, failures: row.plusObjectiveFailures, pass: row.plusObjectiveFailures.length === 0 })),
  summary: { maxPass: 11, maxFail: 1, plusPass: 10, plusFail: 2, maxFailures: { 'dev-strong-color-focus': ['UNSUPPORTED_EFFECT'] }, plusFailures: { 'dev-sparse-facts': ['EMPTY_OUTPUT'], 'dev-weather-relevant': ['EMPTY_OUTPUT'] } },
};
write('07-objective-safety.json', objective);

const calls = maxRaw.calls.map(call => ({ batch: call.batch, ids: call.ids, requestedModel: call.requestedModel, returnedModel: call.returnedModel, requestShape: call.requestShape, httpStatus: call.httpStatus, parseStatus: call.parsedItems?.length === call.ids.length ? 'PASS' : 'FAIL', safetyValidation: call.ids.map(id => { const row = comparisonRows.find(entry => entry.id === id); return { id, failures: row.maxObjectiveFailures, pass: row.maxObjectiveFailures.length === 0 }; }), safetyValidationStage:'FINAL_SOL_OBJECTIVE_REVIEW', clientLatencyMs: call.clientLatencyMs, providerLatencyMs: call.providerLatencyMs, retries: call.retryCount, usage: { inputTokens: call.usage.prompt_tokens, outputTokens: call.usage.completion_tokens, cachedTokens: call.usage.prompt_tokens_details?.cached_tokens || 0, totalTokens: call.usage.total_tokens } }));
const first = calls[0].usage;
const total = calls.reduce((sum, call) => ({ inputTokens: sum.inputTokens + call.usage.inputTokens, outputTokens: sum.outputTokens + call.usage.outputTokens, cachedTokens: sum.cachedTokens + call.usage.cachedTokens, totalTokens: sum.totalTokens + call.usage.totalTokens }), { inputTokens:0, outputTokens:0, cachedTokens:0, totalTokens:0 });
const official = { inputPerMillionCny: 12, outputPerMillionCny: 36 };
const promo = { inputPerMillionCny: 6, outputPerMillionCny: 18, caveat: 'Current pricing page advertises limited 50% pricing; not a long-term cost basis.' };
const cost = (usage, price) => Number(((usage.inputTokens * price.inputPerMillionCny + usage.outputTokens * price.outputPerMillionCny) / 1e6).toFixed(6));
const costPer8 = cost(first, official); const promoPer8 = cost(first, promo);
write('08-latency-token-cost.json', {
  version:'xiaoda-ai-voice-max-targeted-performance-v1', modelId:'qwen3.7-max', batchShape:[8,4], calls, totalUsage:total,
  latency:{ providerTotalMs:calls.reduce((n,c)=>n+c.providerLatencyMs,0), clientTotalMs:calls.reduce((n,c)=>n+c.clientLatencyMs,0) },
  pricingSource:'https://help.aliyun.com/zh/model-studio/model-pricing', officialListPrice:official, promotionalEstimate:promo,
  cost:{ actual12ReasonsOfficialCny:cost(total,official), actual12ReasonsPromotionalCny:cost(total,promo), costPer8ReasonsOfficialCny:costPer8, costPer8ReasonsPromotionalCny:promoPer8, fullyUncached8CardBatches:{ batches1000OfficialCny:Number((costPer8*1000).toFixed(2)), batches10000OfficialCny:Number((costPer8*10000).toFixed(2)), batches1000PromotionalCny:Number((promoPer8*1000).toFixed(2)), batches10000PromotionalCny:Number((promoPer8*10000).toFixed(2)) }, caveat:'Model-generation-layer upper estimate for fully uncached batches; not future user cost because production will use reason cache.' },
  infrastructureAttempts:{ preProviderTransportFailures:1, providerRetries:0, note:'First automator callback parse failed in 5ms with calls=[]; no cloud/provider request. Fixed only the callback syntax before the sole provider run.' },
});

const counts = comparisonRows.reduce((map,row)=>({...map,[row.judgment]:(map[row.judgment]||0)+1}),{});
const editorial = [
  '# Sol editorial review', '',
  '## Decision', '',
  '`MAX_VOICE_CAPABILITY_NOT_CONFIRMED`', '',
  'Max clearly fixes both empty-output cases and reduces algorithm-to-Chinese in several simple relations. However, the gate requires an obvious YES, not an average improvement.', '',
  '- Strong color: Max invents “清爽” although allowedJudgments is empty; this is MAX_OBJECTIVE_FAIL / UNSUPPORTED_EFFECT.',
  '- Competing insights: both models still produce a two-part mini analysis report; this core difficult case is BOTH_FAIL.',
  '- Four cases are TIE, and several wins closely copy the shared Prompt good examples rather than demonstrating broad natural realization.',
  '- Ordinary work improves only slightly and remains template-like.', '',
  `Judgment counts: ${Object.entries(counts).map(([key,value])=>`${key}=${value}`).join(', ')}.`, '',
  'Best Max: dev-sparse-facts; dev-weather-relevant; dev-onepiece-layer.',
  'Worst Max: dev-competing-insights; dev-strong-color-focus; dev-same-color-core.', '',
  'The real improvement is LOW_INFORMATION_GRACEFUL_REALIZATION for sparse/weather plus modest de-algorithmization. It does not prove the full Voice Contract bottleneck is crossed.', '',
  'Next state: VOICE_CONTRACT_OR_PROVIDER_STRATEGY_REVIEW_REQUIRED. Do not open the sealed holdout. HUNYUAN_PROVIDER_BENCHMARK = FUTURE and may be worthwhile only after that review.',
].join('\n');
write('09-sol-editorial-review.md', `${editorial}\n`);

write('deployment-audit.json', {
  version:'xiaoda-ai-voice-max-targeted-deployment-audit-v1', target:'generateOutfit', environment:'cloud1-d8gl3k1vkdf0b7f05',
  originalIndexSha256:'7e4642d95a948ac39931069e269db035649d44f60c327ccc1d0f9a3c81a7980e', restoredDownloadIndexSha256:'7e4642d95a948ac39931069e269db035649d44f60c327ccc1d0f9a3c81a7980e', indexMatches:true, maxActionReachableAfterRestore:false,
  cloudStatus:'Active', runtime:'Nodejs16.13', transportProbe:{ errMsg:'cloud.callFunction:ok', code:0, transportProbe:true, cloudBuildVersion:'generateOutfit-copy-natural-language-v4-20260811', requestID:'6c2d6ad5-d44b-45e9-9f92-e5cb067e0bd7' },
  unreachableCloudOrphan:'benchmarkXiaodaVoiceMaxTargeted.js remains as an unreferenced file; restored index has zero references. Avoided risky full-package delete.', pass:true,
});

write('10-summary.json', {
  status:'MAX_VOICE_CAPABILITY_NOT_CONFIRMED', solLunaDivision:{ luna:['Phase2 candidate extraction','fixture/harness groundwork'], sol:['final case selection','Prompt decision','fairness review','all raw Max reading','Plus/Max editorial judgments','gate decision'] },
  caseCount:12, promptAdjusted:false, promptCleanup:'NONE', inputFairness:{ status:'PASS', comparisonClass:'MODEL_CAPABILITY_COMPARISON', promptHash:equivalence.promptRawHash.sourceHash, allBriefHashesPass:equivalence.cases.every(entry=>entry.status==='PASS') },
  judgmentCounts:counts, maxObjectiveFailures:objective.summary.maxFailures, plusObjectiveFailures:objective.summary.plusFailures,
  bestMax:['dev-sparse-facts','dev-weather-relevant','dev-onepiece-layer'], worstMax:['dev-competing-insights','dev-strong-color-focus','dev-same-color-core'],
  capabilityLift:'Clear empty-output recovery and modest reduction in algorithmic Chinese; insufficient on competing insights, unauthorized effects, and broad naturalness.', crossedPlusCapabilityBottleneck:false, enterNewHoldout:false, sealedHoldoutOpened:false,
  hunyuanProviderBenchmark:'FUTURE_AFTER_VOICE_CONTRACT_OR_PROVIDER_STRATEGY_REVIEW', nextState:'VOICE_CONTRACT_OR_PROVIDER_STRATEGY_REVIEW_REQUIRED', productionReadyClaim:false,
});
console.log('final artifacts written');
