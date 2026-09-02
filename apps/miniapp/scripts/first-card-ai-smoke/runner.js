/* global __dirname, __filename, console, module, process, require */
/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { buildFixture, createMemoryDatabase, installCloudStub } = require('./fixture');
const ROOT = path.resolve(__dirname, '../../../..');
const GENERATE = path.resolve(__dirname, '../../cloudfunctions/generateOutfit');
const CACHE = 'recommendation_canonical_copy_cache_v2';
const JOBS = 'recommendation_copy_jobs_v2';
const FIXED_INPUT = Object.freeze({
  scene: 'home',
  weatherMode: 'disabled',
  date: '2026-09-02',
  timeOfDay: 'all_day',
  maxResults: 1,
  streamGeneration: 'first-card-qa',
});
let running = false;

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sourceEvidence() {
  const files = [
    'apps/miniapp/cloudfunctions/recommendationStream/index.js',
    'apps/miniapp/cloudfunctions/generateOutfit/index.js',
    'apps/miniapp/cloudfunctions/generateOutfit/runtime/recommendationOrchestrator.js',
    'apps/miniapp/cloudfunctions/generateOutfit/services/recommendationFirstCardRenderer.js',
    'apps/miniapp/cloudfunctions/generateOutfit/services/recommendationVoiceRendererProductionV2.js',
    'apps/miniapp/cloudfunctions/generateOutfit/services/recommendationCopyProductionJobV2.js',
    'packages/ai-core/src/index.js',
    'packages/ai-core/src/provider.js',
  ];
  return {
    gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
    files: Object.fromEntries(
      files.map((file) => [file, hash(fs.readFileSync(path.join(ROOT, file)))]),
    ),
    runnerSha256: hash(fs.readFileSync(__filename)),
    fixtureSha256: hash(fs.readFileSync(path.join(__dirname, 'fixture.js'))),
  };
}

function parseEvents(response) {
  return response.chunks
    .join('')
    .split(/\r?\n\r?\n/)
    .flatMap((frame) => {
      const event = frame.match(/^event:\s*(.+)$/m)?.[1];
      const lines = frame.split(/\r?\n/).filter((line) => line.startsWith('data:'));
      if (!event || !lines.length) return [];
      return [{ event, data: JSON.parse(lines.map((line) => line.slice(5).trim()).join('\n')) }];
    });
}

function safeFailure(value) {
  const helpers = require(path.join(GENERATE, 'services/firstCardObservability'));
  return helpers.sanitizeFailure(value) || helpers.getFailure(value) || null;
}

function projectAudit(label, value) {
  if (!value || typeof value !== 'object') return null;
  if (label === '[RecommendationAudit]') {
    return {
      auditId: value.auditId,
      stage: value.stage,
      status: value.status,
      attemptId: value.attemptId || null,
      elapsedFromHandlerMs: value.elapsedFromHandlerMs,
      remainingDeadlineMs: value.remainingDeadlineMs,
      failure: safeFailure(value.failure),
    };
  }
  if (label === '[RecommendationAuditSummary]') {
    const names = [
      'auditId',
      'snapshot',
      'firstCardAiStarted',
      'providerCalled',
      'validated',
      'persisted',
      'backgroundDispatched',
      'elapsedBeforeAiStartMs',
      'providerDurationMs',
      'remainingAtAiStartMs',
      'deadlineReason',
      'responseDeadlineReached',
      'tailWaitExpired',
      'executionOutcome',
      'stageStatus',
    ];
    return {
      ...Object.fromEntries(names.map((name) => [name, value[name]])),
      failure: safeFailure(value.failure),
    };
  }
  return null;
}

function hasStage(invocation, stage, status) {
  return invocation.stages.some((item) => item.stage === stage && item.status === status);
}

function cacheEvidence(database) {
  return (database.snapshot()[CACHE] || []).map((copy) => ({
    id: copy._id,
    cacheId: copy.cacheId,
    owner: copy._openid,
    rendererVersion: copy.rendererVersion,
    renderInputFingerprint: copy.renderInputFingerprint,
    source: copy.source,
    textSha256: hash(copy.text || ''),
  }));
}

function networkRequest(port, input, owner) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/recommendations',
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-wx-openid': owner },
      },
      (response) => {
        const chunks = [];
        response.setEncoding('utf8');
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('error', reject);
        response.on('end', () => resolve({ chunks, statusCode: response.statusCode }));
      },
    );
    request.on('error', reject);
    request.end(JSON.stringify(input));
  });
}

// Offline tests control only the HTTP response. All production AI and cache
// components, including the original deadlines, run without overrides.
async function runSmoke({
  fixture = buildFixture(),
  providerMode = 'controlled',
  fetch: transport,
  credentials = 'synthetic',
} = {}) {
  if (running) throw new Error('QA_CONCURRENT_RUN_FORBIDDEN');
  if (!['controlled', 'live'].includes(providerMode)) throw new Error('QA_MODE_INVALID');
  if (providerMode === 'live' && transport) throw new Error('QA_LIVE_TRANSPORT_OVERRIDE_FORBIDDEN');
  if (providerMode === 'controlled' && typeof transport !== 'function')
    throw new Error('QA_CONTROLLED_TRANSPORT_REQUIRED');
  const database = createMemoryDatabase(
    {
      clothes: fixture.clothes,
      users: [...fixture.users, ...(fixture.sentinel ? [fixture.sentinel] : [])],
    },
    { owner: fixture.openid },
  );
  const initial = database.snapshot();
  const originalFetch = globalThis.fetch;
  const savedEnv = Object.fromEntries(
    ['BAILIAN_API_KEY', 'DASHSCOPE_API_KEY', 'BAILIAN_BASE_URL'].map((key) => [
      key,
      process.env[key],
    ]),
  );
  const savedConsole = Object.fromEntries(
    ['log', 'warn', 'error', 'info', 'debug'].map((name) => [name, console[name]]),
  );
  const report = {
    schemaVersion: 'first-card-ai-smoke/v1',
    providerMode,
    status: 'FAIL',
    startedAt: new Date().toISOString(),
    source: sourceEvidence(),
    scope: 'local-production-code-with-isolated-cloudbase-fixture',
    input: FIXED_INPUT,
    first: null,
    second: null,
    assertions: {},
    providerCalls: 0,
    blockedProviderRequests: 0,
    failure: null,
  };
  running = true;
  const restoreCloud = installCloudStub(database, fixture.openid);
  const handlerTasks = [];
  let current;
  let server;
  try {
    if (providerMode === 'controlled') {
      delete process.env.DASHSCOPE_API_KEY;
      if (credentials === 'missing') delete process.env.BAILIAN_API_KEY;
      else process.env.BAILIAN_API_KEY = 'qa-controlled-credential';
      process.env.BAILIAN_BASE_URL = 'https://controlled-provider.invalid/v1';
    }
    for (const name of Object.keys(savedConsole)) {
      console[name] = (label, value) => {
        if (!current) return;
        const projected = projectAudit(label, value);
        if (projected) {
          if (label === '[RecommendationAudit]') current.stages.push(projected);
          else current.summaries.push(projected);
        }
      };
    }
    globalThis.fetch = async (url, init) => {
      // A successful warm request must never spend a second provider call.
      // Fail the QA assertion at the transport boundary if it tries to do so.
      if (report.providerCalls >= 1) {
        report.blockedProviderRequests += 1;
        throw new Error('QA_UNEXPECTED_PROVIDER_REQUEST');
      }
      const record = {
        ordinal: ++report.providerCalls,
        method: init?.method || 'GET',
        model: JSON.parse(init?.body || '{}').model || null,
        httpStatus: null,
        requestId: null,
      };
      current?.network.push(record);
      // Forward the original URL, headers, body and AbortSignal unchanged.
      const response = await (providerMode === 'live' ? originalFetch : transport)(url, init);
      record.httpStatus = response.status;
      record.requestId =
        response.headers?.get?.('x-request-id') || response.headers?.get?.('request-id') || null;
      return response;
    };
    // This entry captures db at import time. Serial offline cases reload it;
    // each CLI invocation already has an independent process/module cache.
    delete require.cache[require.resolve(path.join(GENERATE, 'index.js'))];
    const generate = require(path.join(GENERATE, 'index.js'));
    const stream = require('../../cloudfunctions/recommendationStream/index.js');
    const handler = stream.createRecommendationStreamHandler({
      runRuntime: generate.runProductionRecommendationRuntime,
      createDiagnostics: generate.createRecommendationDiagnostics,
      recordStage: generate.recordRecommendationStage,
    });
    server = http.createServer((req, res) => {
      const task = handler(req, res);
      handlerTasks.push(task);
      task.catch(() => {
        if (!res.writableEnded) res.end();
      });
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    async function call(phase) {
      current = { phase, stages: [], summaries: [], network: [] };
      const invocation = current;
      const offset = handlerTasks.length;
      const response = await networkRequest(
        server.address().port,
        {
          ...FIXED_INPUT,
          auditId: 'first-card-qa-' + phase,
          v2BatchId: 'first-card-qa-' + phase,
        },
        fixture.openid,
      );
      // SSE may end before durable tail work. Wait for the actual handler.
      await Promise.all(handlerTasks.slice(offset));
      const events = parseEvents(response);
      const ready = events.find((event) => event.event === 'recommendation.ready')?.data;
      invocation.httpStatus = response.statusCode;
      invocation.events = events.map((event) => event.event);
      invocation.batchId = ready?.batchId || null;
      const firstCard = ready?.response?.light?.cards?.[0];
      invocation.firstCard = firstCard
        ? {
            outfitKey: firstCard.outfitKey,
            textSha256: hash(firstCard.todayReason || ''),
          }
        : null;
      invocation.auditId = invocation.stages[0]?.auditId || null;
      invocation.cache = cacheEvidence(database);
      invocation.jobEntries = (database.snapshot()[JOBS] || [])
        .filter((job) => job._openid === fixture.openid && job.batchId === invocation.batchId)
        .flatMap((job) =>
          job.entries.map((entry) => ({
            jobId: job.jobId,
            position: entry.position,
            outfitKey: entry.outfitKey,
            cacheId: entry.cacheId,
            renderInputFingerprint: entry.renderInputFingerprint,
          })),
        );
      invocation.finalSummary = invocation.summaries.at(-1) || null;
      invocation.failure =
        invocation.summaries.map((item) => item.failure).find(Boolean) ||
        invocation.stages.map((item) => item.failure).find(Boolean) ||
        null;
      invocation.handlerSettled = true;
      return invocation;
    }
    report.assertions.coldCacheEmpty = [CACHE, JOBS, 'outfits', 'recommendation_batches_v2'].every(
      (name) => !initial[name]?.length,
    );
    report.first = await call('miss');
    const first = report.first;
    const requiredOrder = [
      'CACHE_LOOKUP_DONE',
      'FIRST_CARD_AI_ADMITTED',
      'PROVIDER_START',
      'PROVIDER_COMPLETE',
      'VALIDATOR_COMPLETE',
      'CANONICAL_PERSISTED',
    ];
    const positions = requiredOrder.map((stage) =>
      first.stages.findIndex((item) => item.stage === stage),
    );
    Object.assign(report.assertions, {
      orderedStages: positions.every(
        (position, index) => position >= 0 && (index === 0 || position > positions[index - 1]),
      ),
      firstMiss: hasStage(first, 'CACHE_LOOKUP_DONE', 'miss'),
      admitted: hasStage(first, 'FIRST_CARD_AI_ADMITTED', 'admitted'),
      providerStarted: hasStage(first, 'PROVIDER_START', 'started'),
      providerCompleted: hasStage(first, 'PROVIDER_COMPLETE', 'completed'),
      actualRequest: first.network.length === 1 && first.network[0].httpStatus === 200,
      streamCompleted: hasStage(first, 'STREAM_COMPLETE', 'completed'),
      validatorAccepted: hasStage(first, 'VALIDATOR_COMPLETE', 'accepted'),
      canonicalPersisted: first.stages.some(
        (stage) =>
          stage.stage === 'CANONICAL_PERSISTED' && ['completed', 'tail'].includes(stage.status),
      ),
      executionSucceeded:
        first.finalSummary?.executionOutcome === 'succeeded' &&
        first.finalSummary.persisted === true &&
        first.finalSummary.validated === true &&
        first.finalSummary.failure === null &&
        first.failure === null &&
        first.finalSummary.tailWaitExpired === false,
      cacheOwnedAndBound:
        first.cache.length === 1 &&
        first.cache.every(
          (copy) =>
            copy.owner === fixture.openid &&
            copy.source === 'ai_cache' &&
            copy.id === copy.cacheId &&
            copy.cacheId ===
              'rcc-' +
                hash(
                  fixture.openid + '|' + copy.rendererVersion + '|' + copy.renderInputFingerprint,
                ),
        ),
      cacheBoundToFirstCard:
        first.cache.length === 1 &&
        first.jobEntries.some(
          (entry) =>
            entry.position === 0 &&
            entry.outfitKey === first.firstCard?.outfitKey &&
            entry.cacheId === first.cache[0].cacheId &&
            entry.renderInputFingerprint === first.cache[0].renderInputFingerprint,
        ),
      correlatedAttempt: first.stages
        .filter((stage) =>
          [
            'FIRST_CARD_AI_ADMITTED',
            'PROVIDER_START',
            'PROVIDER_COMPLETE',
            'VALIDATOR_COMPLETE',
            'EXECUTION_COMPLETE',
          ].includes(stage.stage),
        )
        .every(
          (stage) =>
            stage.auditId === first.auditId &&
            stage.attemptId &&
            stage.attemptId ===
              first.stages.find((item) => item.stage === 'PROVIDER_START')?.attemptId,
        ),
    });
    report.failure = first.failure;
    if (Object.values(report.assertions).every(Boolean)) {
      report.second = await call('hit');
      const second = report.second;
      Object.assign(report.assertions, {
        secondHit: hasStage(second, 'CACHE_LOOKUP_DONE', 'hit'),
        secondNoProvider:
          second.network.length === 0 &&
          report.blockedProviderRequests === 0 &&
          !second.stages.some((stage) => stage.stage === 'PROVIDER_START'),
        sameFingerprint:
          second.cache.length === 1 && second.cache[0].cacheId === first.cache[0].cacheId,
        secondReady: second.events.includes('recommendation.ready'),
        canonicalVisibleOnHit: second.firstCard?.textSha256 === first.cache[0].textSha256,
      });
      report.failure = second.failure || report.failure;
    }
    const after = database.snapshot();
    report.assertions.protectedDataUnchanged = [
      'clothes',
      'users',
      'outfit_history',
      'favorite_outfits',
    ].every((name) => JSON.stringify(initial[name] || []) === JSON.stringify(after[name] || []));
    report.writes = database.writes || [];
    report.isolation = {
      owner: fixture.openid,
      protectedDataUnchanged: report.assertions.protectedDataUnchanged,
    };
    report.status =
      Object.values(report.assertions).every(Boolean) && report.second ? 'PASS' : 'FAIL';
  } catch (error) {
    report.failure = safeFailure(error);
    report.qaError = 'QA_EXECUTION_FAILED';
    report.errorType = error instanceof Error ? error.name : 'UnknownError';
  } finally {
    await Promise.allSettled(handlerTasks);
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    globalThis.fetch = originalFetch;
    for (const [name, value] of Object.entries(savedConsole)) console[name] = value;
    for (const [name, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    restoreCloud();
    running = false;
  }
  report.finishedAt = new Date().toISOString();
  // Also redact exact keys if a provider echoes one in a permitted error code.
  let serialized = JSON.stringify(report);
  for (const key of [
    savedEnv.BAILIAN_API_KEY,
    savedEnv.DASHSCOPE_API_KEY,
    'qa-controlled-credential',
  ]) {
    if (key) serialized = serialized.split(key).join('[REDACTED]');
  }
  return JSON.parse(serialized);
}

if (require.main === module) {
  if (process.argv.length !== 3 || process.argv[2] !== '--live') {
    console.log('Usage: node apps/miniapp/scripts/first-card-ai-smoke/runner.js --live');
    process.exitCode = 2;
  } else {
    runSmoke({ providerMode: 'live' })
      .then((report) => {
        console.log(JSON.stringify(report, null, 2));
        process.exitCode = report.status === 'PASS' ? 0 : 1;
      })
      .catch(() => {
        console.log(JSON.stringify({ status: 'FAIL', qaError: 'QA_BOOTSTRAP_FAILED' }));
        process.exitCode = 1;
      });
  }
}

module.exports = { runSmoke, parseEvents, safeFailure, FIXED_INPUT };
