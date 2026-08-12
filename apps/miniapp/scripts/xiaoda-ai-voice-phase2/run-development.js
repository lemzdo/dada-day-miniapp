'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ensureDevToolsDirectSession } = require('../devtools-direct-session');
const { PROMPT_VERSION, BRIEF_SCHEMA_VERSION, MODEL_ALLOWLIST, buildPrompt, toModelBrief, validateModelBrief, validateGeneratedOutput } = require('./core');

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function atomicJson(file, value) {
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, file);
}
function parseProviderContent(result) {
  const response = result?.providerResponse || result?.data?.providerResponse || result?.data || result;
  return response?.choices?.[0]?.message?.content;
}
function usageFrom(result) {
  const usage = result?.providerResponse?.usage || result?.data?.providerResponse?.usage || result?.usage || {};
  return {
    inputTokens: Number(usage.prompt_tokens) || 0,
    outputTokens: Number(usage.completion_tokens) || 0,
    cachedInputTokens: Number(usage.prompt_tokens_details?.cached_tokens) || 0,
    totalTokens: Number(usage.total_tokens) || 0,
  };
}
function assertMetadata(metadata) {
  for (const key of ['changeHypothesis', 'changedLayer', 'before', 'after']) if (!metadata?.[key]) throw new Error(`METADATA_REQUIRED:${key}`);
  if (!['Insight', 'Brief', 'Prompt'].includes(metadata.changedLayer)) throw new Error('CHANGED_LAYER_INVALID');
  if (!['Insight', 'Brief', 'Prompt'].includes(metadata.expectedChangedLayer || metadata.changedLayer)) throw new Error('EXPECTED_CHANGED_LAYER_INVALID');
  if ((metadata.expectedChangedLayer || metadata.changedLayer) !== metadata.changedLayer) throw new Error('CHANGED_LAYER_MISMATCH');
}
function nextAttempt(dir) {
  const files = fs.readdirSync(dir).filter((name) => /^06-development-attempt-\d+\.json$/.test(name));
  return files.reduce((max, name) => Math.max(max, Number(name.match(/^06-development-attempt-(\d+)\.json$/)[1])), 0) + 1;
}
async function callDevelopment(mini, prompt, briefs, label) {
  const token = process.env.XIAODA_VOICE_BENCHMARK_TOKEN;
  if (!token) throw new Error('XIAODA_VOICE_BENCHMARK_TOKEN is required');
  const started = Date.now();
  const envelope = await mini.evaluate(async (payload) => globalThis.wx.cloud.callFunction({
    name: 'generateOutfit',
    data: {
      action: payload.action,
      benchmarkToken: payload.token,
      modelAlias: payload.modelAlias,
      promptVersion: payload.promptVersion,
      briefSchemaVersion: payload.briefSchemaVersion,
      systemPrompt: payload.prompt,
      briefs: payload.briefs,
    },
  }), { token, prompt, briefs, action: 'xiaodaVoicePhase2Benchmark', modelAlias: 'plus', promptVersion: PROMPT_VERSION, briefSchemaVersion: BRIEF_SCHEMA_VERSION });
  const result = envelope?.result?.data || envelope?.result || envelope;
  const ids = briefs.map((brief) => brief.id);
  const rawContent = parseProviderContent(result);
  let parsed;
  try { parsed = rawContent ? JSON.parse(String(rawContent).replace(/^```json\s*/i, '').replace(/\s*```$/i, '')) : null; } catch { parsed = null; }
  const validation = validateGeneratedOutput(parsed || { items: [] }, ids, briefs);
  return {
    label,
    ids,
    modelAlias: 'plus',
    action: 'xiaodaVoicePhase2Benchmark',
    clientLatencyMs: Date.now() - started,
    providerLatencyMs: result.wallLatencyMs || result.providerWallLatencyMs || null,
    requestedModel: result.requestedModel || null,
    returnedModel: result.returnedModel || result.providerResponse?.model || null,
    usage: usageFrom(result),
    httpStatus: result.httpStatus || null,
    parseStatus: rawContent && parsed ? 'PASS' : 'FAIL',
    parseError: rawContent && parsed ? null : 'OUTPUT_PARSE',
    validation,
    parsedItems: parsed?.items || [],
    rawResponse: result.providerResponse || null,
    rawBody: result.rawBody || null,
  };
}
async function runDevelopment(arg1, arg2, arg3 = {}) {
  const options = typeof arg1 === 'object' ? arg1 : { artifactDir: arg1, metadataPath: arg2, deps: arg3 };
  const artifactDir = path.resolve(options.artifactDir);
  const metadata = readJson(path.resolve(options.metadataPath));
  assertMetadata(metadata);
  const prompt = fs.readFileSync(path.join(artifactDir, '01-prompt.md'), 'utf8').trim();
  if (prompt !== buildPrompt()) throw new Error('PROMPT_ARTIFACT_MISMATCH');
  const development = readJson(path.join(artifactDir, '03-development.json'));
  if (development.count !== 20 || development.fixtures.length !== 20) throw new Error('DEVELOPMENT_COUNT_INVALID');
  if (development.fixtures.some((entry) => !/^dev-/.test(entry.id) || /holdout/i.test(entry.id))) throw new Error('DEVELOPMENT_ID_INVALID');
  const briefs = development.fixtures.map((entry) => {
    const brief = entry.modelBrief || toModelBrief(entry.internalBrief);
    if (!validateModelBrief(brief).pass) throw new Error(`MODEL_BRIEF_INVALID:${entry.id}`);
    return brief;
  });
  const attempt = nextAttempt(artifactDir);
  if (attempt > 4) throw new Error('DEVELOPMENT_ATTEMPT_LIMIT');
  const attemptFile = path.join(artifactDir, `06-development-attempt-${attempt}.json`);
  const progress = {
    attempt,
    status: 'IN_PROGRESS',
    startedAt: new Date().toISOString(),
    fixtureCount: 20,
    promptVersion: PROMPT_VERSION,
    briefSchemaVersion: BRIEF_SCHEMA_VERSION,
    calls: [],
    parsedItems: [],
    editorialReviewRequired: true,
    metadata,
  };
  atomicJson(attemptFile, progress);
  const mini = options.deps?.mini || (await ensureDevToolsDirectSession({ deps: options.deps })).mini;
  const calls = [];
  try {
    for (const [index, size] of [8, 8, 4].entries()) {
      const call = await callDevelopment(mini, prompt, briefs.slice(index * 8, index * 8 + size), `development-${index + 1}`);
      calls.push(call);
      atomicJson(attemptFile, { ...progress, status: 'IN_PROGRESS', calls, parsedItems: calls.flatMap((entry) => entry.parsedItems) });
    }
  } catch (error) {
    atomicJson(attemptFile, { ...progress, status: 'FAILED', completedAt: new Date().toISOString(), calls, parsedItems: calls.flatMap((entry) => entry.parsedItems), error: String(error.stack || error) });
    throw error;
  } finally {
    if (!options.deps?.mini && mini?.disconnect) mini.disconnect();
  }
  const result = { version: 'xiaoda-ai-voice-phase2-development-v1', completedAt: new Date().toISOString(), fixtureCount: 20, promptVersion: PROMPT_VERSION, briefSchemaVersion: BRIEF_SCHEMA_VERSION, calls, parsedItems: calls.flatMap((call) => call.parsedItems), objectiveChecksPass: calls.every((call) => call.parseStatus === 'PASS' && call.validation.pass && call.requestedModel === MODEL_ALLOWLIST.plus && call.returnedModel === MODEL_ALLOWLIST.plus), editorialReviewRequired: true, metadata };
  if (result.parsedItems.length !== 20) result.objectiveChecksPass = false;
  atomicJson(attemptFile, { attempt, status: 'COMPLETED', ...result });
  return { attempt, ...result };
}

function buildDevelopmentCalls(briefs) {
  if (!Array.isArray(briefs) || briefs.length !== 20) throw new Error('DEVELOPMENT_COUNT_INVALID');
  return [briefs.slice(0, 8), briefs.slice(8, 16), briefs.slice(16, 20)];
}

module.exports = { parseProviderContent, usageFrom, buildDevelopmentCalls, runDevelopment };
