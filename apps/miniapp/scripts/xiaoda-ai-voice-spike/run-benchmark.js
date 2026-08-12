'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  ensureDevToolsDirectSession,
} = require('../devtools-direct-session');
const {
  BRIEF_SCHEMA_VERSION,
  GENERATION_PARAMETERS,
  PROMPT_VERSION,
  buildPrompt,
  parseBatchResponse,
  validateGeneratedItems,
  sha256,
} = require('./core');

const SHAPE_REPETITIONS = 3;

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(directory, name, value) { fs.writeFileSync(path.join(directory, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8'); }
function appendJsonArray(directory, name, value) {
  const file = path.join(directory, name);
  const entries = fs.existsSync(file) ? readJson(file) : [];
  entries.push(value);
  writeJson(directory, name, entries);
}
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function extractProviderContent(call) {
  return call?.providerResponse?.choices?.[0]?.message?.content;
}

function usageFrom(call) {
  const usage = call?.providerResponse?.usage || {};
  return {
    inputTokens: Number(usage.prompt_tokens) || 0,
    outputTokens: Number(usage.completion_tokens) || 0,
    totalTokens: Number(usage.total_tokens) || 0,
    cachedInputTokens: usage.prompt_tokens_details?.cached_tokens ?? 'NOT_OBSERVED',
  };
}

async function callBenchmark(mini, { modelAlias, briefs, systemPrompt, label }) {
  const benchmarkToken = process.env.XIAODA_VOICE_BENCHMARK_TOKEN;
  if (!benchmarkToken) throw new Error('XIAODA_VOICE_BENCHMARK_TOKEN is required');
  const clientStartedAt = new Date().toISOString();
  const clientStartMs = Date.now();
  let envelope;
  try {
    envelope = await mini.evaluate(async (payload) => globalThis.wx.cloud.callFunction({
      name: 'generateOutfit',
      data: {
        action: 'xiaodaVoiceBenchmark',
        benchmarkToken: payload.token,
        modelAlias: payload.modelAlias,
        promptVersion: payload.promptVersion,
        briefSchemaVersion: payload.briefSchemaVersion,
        systemPrompt: payload.systemPrompt,
        briefs: payload.briefs,
      },
    }), {
      token: benchmarkToken,
      modelAlias,
      promptVersion: PROMPT_VERSION,
      briefSchemaVersion: BRIEF_SCHEMA_VERSION,
      systemPrompt,
      briefs,
    });
  } catch (error) {
    throw Object.assign(new Error(`benchmark transport failed: ${error.message || error}`), {
      failureRecord: {
        label, modelAlias, batchSize: briefs.length, benchmarkIds: briefs.map((brief) => brief.benchmarkId),
        clientStartedAt, clientEndedAt: new Date().toISOString(), clientWallLatencyMs: Date.now() - clientStartMs,
        stage: 'transport', error: String(error.stack || error),
      },
    });
  }
  const clientEndedAt = new Date().toISOString();
  const result = envelope?.result;
  if (!result || result.code !== 0) throw Object.assign(new Error(`benchmark helper failed: ${result?.message || 'missing response'}`), {
    envelope,
    failureRecord: {
      label, modelAlias, batchSize: briefs.length, benchmarkIds: briefs.map((brief) => brief.benchmarkId),
      clientStartedAt, clientEndedAt, clientWallLatencyMs: Date.now() - clientStartMs,
      stage: 'helper', envelope,
    },
  });
  const call = result.data;
  const expectedIds = briefs.map((brief) => brief.benchmarkId);
  let parsedItems = [];
  let parseStatus = 'PASS';
  let parseError = null;
  try { parsedItems = parseBatchResponse(extractProviderContent(call), expectedIds); }
  catch (error) { parseStatus = 'FAIL'; parseError = String(error.message || error); }
  const safety = parseStatus === 'PASS' ? validateGeneratedItems(parsedItems, briefs) : { pass: false, results: [] };
  return {
    label,
    modelAlias,
    requestedModel: call.requestedModel,
    returnedModel: call.returnedModel,
    promptVersion: call.promptVersion,
    briefSchemaVersion: call.briefSchemaVersion,
    generationParameters: call.generationParameters,
    batchSize: briefs.length,
    benchmarkIds: expectedIds,
    clientStartedAt,
    clientEndedAt,
    clientWallLatencyMs: Date.now() - clientStartMs,
    providerRequestStartedAt: call.requestStartedAt,
    providerRequestEndedAt: call.requestEndedAt,
    providerWallLatencyMs: call.wallLatencyMs,
    ttft: call.ttft,
    httpStatus: call.httpStatus,
    providerEndpointHost: call.providerEndpointHost,
    retries: 0,
    usage: usageFrom(call),
    parseStatus,
    parseError,
    safetyValidation: safety,
    parsedItems,
    rawProviderResponse: call.providerResponse,
    rawBody: call.rawBody,
  };
}

async function runDevelopment(mini, directory, systemPrompt) {
  const fixtures = readJson(path.join(directory, '03-prompt-development-fixtures.json')).fixtures;
  const calls = [];
  for (let index = 0; index < fixtures.length; index += 8) {
    const briefs = fixtures.slice(index, index + 8).map((entry) => entry.brief);
    const call = await callBenchmark(mini, { modelAlias: 'plus', briefs, systemPrompt, label: `development-${index / 8 + 1}` });
    calls.push(call);
    process.stdout.write(`DEVELOPMENT_CALL ${calls.length} parse=${call.parseStatus} safety=${call.safetyValidation.pass}\n`);
  }
  const result = {
    version: 'xiaoda-prompt-development-run-v1',
    completedAt: new Date().toISOString(),
    fixtureCount: fixtures.length,
    promptVersion: PROMPT_VERSION,
    briefSchemaVersion: BRIEF_SCHEMA_VERSION,
    generationParameters: GENERATION_PARAMETERS,
    calls,
    objectiveChecksPass: calls.every((call) => call.parseStatus === 'PASS' && call.safetyValidation.pass),
  };
  writeJson(directory, 'prompt-development-model-check.json', result);
  appendJsonArray(directory, 'prompt-development-attempts.json', {
    attempt: fs.existsSync(path.join(directory, 'prompt-development-attempts.json'))
      ? readJson(path.join(directory, 'prompt-development-attempts.json')).length + 1
      : 1,
    promptSha256: sha256(systemPrompt),
    ...result,
  });
  if (!result.objectiveChecksPass) throw Object.assign(new Error('PROMPT_DEVELOPMENT_OBJECTIVE_CHECK_FAILED'), { result });
  return result;
}

async function runHoldout(mini, directory, systemPrompt) {
  const holdout = readJson(path.join(directory, '04-real-holdout-briefs.json'));
  const rawByModel = { plus: [], max: [] };
  for (const modelAlias of ['plus', 'max']) {
    for (const batch of holdout.batches) {
      const call = await callBenchmark(mini, {
        modelAlias,
        briefs: batch.briefs,
        systemPrompt,
        label: `1x8-${batch.batchId}`,
      });
      rawByModel[modelAlias].push(call);
      writeJson(directory, modelAlias === 'plus' ? '05-plus-raw.json' : '06-max-raw.json', {
        version: 'xiaoda-model-raw-v1',
        modelAlias,
        shape: '1x8',
        calls: rawByModel[modelAlias],
      });
      process.stdout.write(`HOLDOUT ${modelAlias} ${batch.batchId} latency=${call.providerWallLatencyMs} parse=${call.parseStatus} safety=${call.safetyValidation.pass}\n`);
    }
  }
  return rawByModel;
}

async function runShapeComparison(mini, directory, systemPrompt) {
  const holdout = readJson(path.join(directory, '04-real-holdout-briefs.json'));
  const selected = ['home', 'work', 'date', 'sport'].map((scene) => holdout.batches.find((batch) => batch.scene === scene));
  const runs = [];
  for (const modelAlias of ['plus', 'max']) {
    for (const batch of selected) {
      for (let repetition = 1; repetition <= SHAPE_REPETITIONS; repetition += 1) {
        const startedAt = new Date().toISOString();
        const startMs = Date.now();
        const halves = [batch.briefs.slice(0, 4), batch.briefs.slice(4, 8)];
        const calls = await Promise.all(halves.map((briefs, halfIndex) => callBenchmark(mini, {
          modelAlias,
          briefs,
          systemPrompt,
          label: `2x4-${batch.batchId}-r${repetition}-h${halfIndex + 1}`,
        })));
        const run = {
          modelAlias,
          scene: batch.scene,
          sourceBatchId: batch.batchId,
          repetition,
          shape: '2x4-concurrent',
          startedAt,
          endedAt: new Date().toISOString(),
          wallLatencyMs: Date.now() - startMs,
          requestCount: calls.length,
          combinedInputTokens: calls.reduce((sum, call) => sum + call.usage.inputTokens, 0),
          combinedOutputTokens: calls.reduce((sum, call) => sum + call.usage.outputTokens, 0),
          combinedTotalTokens: calls.reduce((sum, call) => sum + call.usage.totalTokens, 0),
          errorCount: calls.filter((call) => call.httpStatus !== 200 || call.parseStatus !== 'PASS' || !call.safetyValidation.pass).length,
          calls,
        };
        runs.push(run);
        writeJson(directory, '13-batch-shape-raw.json', { version: 'xiaoda-batch-shape-raw-v1', repetitions: SHAPE_REPETITIONS, runs });
        process.stdout.write(`SHAPE ${modelAlias} ${batch.scene} r${repetition} latency=${run.wallLatencyMs} errors=${run.errorCount}\n`);
        await sleep(250);
      }
    }
  }
  return runs;
}

function assertPromptFreeze(directory, systemPrompt) {
  const freezeFile = path.join(directory, 'prompt-freeze.json');
  if (!fs.existsSync(freezeFile)) throw new Error('prompt-freeze.json is required before opening holdout');
  const freeze = readJson(freezeFile);
  const schema = readJson(path.join(directory, '02-brief-schema.json'));
  if (freeze.promptVersion !== PROMPT_VERSION || freeze.briefSchemaVersion !== BRIEF_SCHEMA_VERSION) throw new Error('prompt freeze version mismatch');
  if (freeze.promptSha256 !== sha256(systemPrompt) || freeze.briefSchemaSha256 !== sha256(schema)) throw new Error('frozen prompt or brief schema changed after freeze');
  if (JSON.stringify(freeze.generationParameters) !== JSON.stringify(GENERATION_PARAMETERS)) throw new Error('frozen generation parameters changed');
  return freeze;
}

async function run(directory, phase) {
  const systemPrompt = fs.readFileSync(path.join(directory, '01-prompt.md'), 'utf8').trim();
  if (systemPrompt !== buildPrompt()) throw new Error('frozen prompt artifact does not match code');
  if (!['development', 'holdout', 'shape'].includes(phase)) throw new Error('phase must be development, holdout, or shape');
  if (phase !== 'development') assertPromptFreeze(directory, systemPrompt);
  if (phase === 'holdout') {
    const freezeFile = path.join(directory, 'prompt-freeze.json');
    const freeze = readJson(freezeFile);
    writeJson(directory, 'prompt-freeze.json', {
      ...freeze,
      holdoutOpenedAt: new Date().toISOString(),
      holdoutOpenedAfterFreeze: true,
      holdoutOpenEvidence: 'Recorded immediately before the holdout artifact was opened by the benchmark runner.',
    });
  }
  let session;
  try {
    session = await ensureDevToolsDirectSession();
    try {
      if (phase === 'development') await runDevelopment(session.mini, directory, systemPrompt);
      if (phase === 'holdout') await runHoldout(session.mini, directory, systemPrompt);
      if (phase === 'shape') await runShapeComparison(session.mini, directory, systemPrompt);
    } catch (error) {
      appendJsonArray(directory, 'benchmark-failures.json', {
        phase,
        recordedAt: new Date().toISOString(),
        promptSha256: sha256(systemPrompt),
        ...(error.failureRecord || { stage: 'runner', error: String(error.stack || error) }),
      });
      throw error;
    }
    process.stdout.write(`MODEL_BENCHMARK_PHASE_READY ${phase} ${directory}\n`);
  } finally {
    if (session?.mini) try { session.mini.disconnect(); } catch {}
  }
}

if (require.main === module) {
  run(path.resolve(process.argv[2]), process.argv[3]).catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    if (error.envelope) process.stderr.write(`${JSON.stringify(error.envelope, null, 2)}\n`);
    process.exitCode = 1;
  });
}

module.exports = { assertPromptFreeze, extractProviderContent, run, usageFrom };
