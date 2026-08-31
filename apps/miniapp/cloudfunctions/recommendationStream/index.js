'use strict';

let runtimeRunner = null;

function loadGenerateOutfitModule() {
  return require('./generateOutfit');
}

function loadProductionRunner() {
  // Lazy loading avoids a second Runtime implementation and keeps the HTTP
  // function's module startup independent from transport-specific setup.
  return loadGenerateOutfitModule().runProductionRecommendationRuntime;
}

function loadProductionDiagnostics() {
  const module = loadGenerateOutfitModule();
  return {
    createDiagnostics: module.createRecommendationDiagnostics,
    recordStage: module.recordRecommendationStage,
  };
}

function setRecommendationRuntimeRunner(runner) {
  if (typeof runner !== 'function') throw new TypeError('RUNTIME_RUNNER_REQUIRED');
  runtimeRunner = runner;
}

function readOpenId(req) {
  const headers = req?.headers || {};
  // HTTP interactive transport trusts only this explicit CloudBase header.
  const value = headers['x-wx-openid'] ?? headers['X-WX-OpenID'];
  return typeof value === 'string' ? value.trim() : '';
}

function parseInput(req, body) {
  if (body && typeof body === 'object') return body;
  const url = new URL(req?.url || '/', 'http://localhost');
  const raw = url.searchParams.get('input');
  if (raw) { try { return JSON.parse(raw); } catch { return {}; } }
  return Object.fromEntries(url.searchParams.entries());
}

function writeSse(res, event, data) {
  if (!res || res.destroyed || res.writableEnded) return false;
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data ?? null)}\n\n`);
    return true;
  } catch { return false; }
}

async function readBody(req, monotonicOriginAt = process.hrtime.bigint()) {
  if (!req || typeof req.on !== 'function') {
    return { value: undefined, bytes: 0, bodyDoneMs: 0, jsonDoneMs: 0 };
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8');
    chunks.push(buffer);
    bytes += buffer.byteLength;
  }
  const bodyDoneMs = Number(process.hrtime.bigint() - monotonicOriginAt) / 1e6;
  const body = Buffer.concat(chunks, bytes).toString('utf8');
  if (!body.trim()) return { value: undefined, bytes, bodyDoneMs, jsonDoneMs: bodyDoneMs };
  try {
    const value = JSON.parse(body);
    return {
      value,
      bytes,
      bodyDoneMs,
      jsonDoneMs: Number(process.hrtime.bigint() - monotonicOriginAt) / 1e6,
    };
  } catch {
    return {
      value: undefined,
      bytes,
      bodyDoneMs,
      jsonDoneMs: Number(process.hrtime.bigint() - monotonicOriginAt) / 1e6,
    };
  }
}

function createRecommendationStreamHandler({
  runRuntime = null,
  resolveContext,
  createDiagnostics = null,
  recordStage = null,
  readBody: readBodyFn = readBody,
  loadDiagnostics: loadDiagnosticsFn = loadProductionDiagnostics,
} = {}) {
  const recommendationStream = async function recommendationStream(req, res) {
    const handlerStartedAt = Date.now();
    const requestOrigin = process.hrtime.bigint();
    const url = new URL(req?.url || '/', 'http://localhost');
    if (url.pathname !== '/recommendations' && url.pathname !== '/recommendations/') {
      res.statusCode = 404;
      res.end?.('NOT_FOUND');
      return;
    }
    if (req?.method !== 'POST') {
      res.statusCode = 405;
      res.end?.('METHOD_NOT_ALLOWED');
      return;
    }
    const authStartedMs = Number(process.hrtime.bigint() - requestOrigin) / 1e6;
    const openid = readOpenId(req);
    const authDoneMs = Number(process.hrtime.bigint() - requestOrigin) / 1e6;
    if (!openid) {
      res.statusCode = 401;
      res.setHeader?.('Content-Type', 'application/json; charset=utf-8');
      res.end?.(JSON.stringify({ code: 1, message: 'x-wx-openid is required' }));
      return;
    }
    const bodyResult = req?.method === 'GET'
      ? { value: undefined, bytes: 0, bodyDoneMs: 0, jsonDoneMs: 0 }
      : await readBodyFn(req, requestOrigin);
    const input = parseInput(req, bodyResult.value);
    const handlerReadyMs = Number(process.hrtime.bigint() - requestOrigin) / 1e6;
    const productionDiagnostics = !runRuntime && (!createDiagnostics || !recordStage)
      ? loadDiagnosticsFn()
      : null;
    const diagnosticsFactory = createDiagnostics || productionDiagnostics?.createDiagnostics;
    const stageRecorder = recordStage || productionDiagnostics?.recordStage;
    const diagnostics = typeof diagnosticsFactory === 'function'
      ? diagnosticsFactory(input, handlerStartedAt, requestOrigin)
      : null;
    if (diagnostics) diagnostics.requestBodyBytes = bodyResult.bytes;
    if (diagnostics?.workCounts) diagnostics.workCounts.inputRead += 1;
    const stage = (name, options = {}) => {
      if (typeof stageRecorder !== 'function') return;
      try { stageRecorder(diagnostics, name, options); } catch { /* Diagnostics are fail-open. */ }
    };
    stage('request:received', { elapsedMs: 0, fields: { requestBodyBytes: bodyResult.bytes } });
    stage('body:done', { elapsedMs: bodyResult.bodyDoneMs, fields: { requestBodyBytes: bodyResult.bytes } });
    stage('json:done', { elapsedMs: bodyResult.jsonDoneMs, fields: { requestBodyBytes: bodyResult.bytes } });
    stage('handler:start', { elapsedMs: handlerReadyMs, fields: { requestBodyBytes: bodyResult.bytes } });
    stage('auth:start', { elapsedMs: authStartedMs });
    stage('auth:done', { elapsedMs: authDoneMs });
    const streamGeneration = typeof input.streamGeneration === 'string' && input.streamGeneration.trim()
      ? input.streamGeneration.trim()
      : `http-${Date.now().toString(36)}`;
    const context = {
      ...(typeof resolveContext === 'function' ? (resolveContext({ req, openid }) || {}) : {}),
      userIdentity: { openid },
      interactive: true,
      ...(diagnostics ? { diagnostics } : {}),
      onTelemetry: ({ key, value }) => {
        if (key === 'AI_LATE_DISCARDED' && value === true) {
          stage('firstCardAiLateDiscarded', { fields: { AI_LATE_DISCARDED: true } });
          return;
        }
        if (!['requestStart', 'coreResultReady', 'firstCardAiStart', 'firstCardAiValidated',
          'firstCardCanonicalPersisted', 'deadlineReached', 'responseReady'].includes(key)) return;
        stage(key, {
          elapsedMs: typeof value === 'number' ? value : undefined,
          batchId: readyBatchId || undefined,
          fields: key === 'responseReady' ? {
            FIRST_CARD_AI_RESULT: diagnostics?.FIRST_CARD_AI_RESULT,
            FIRST_CARD_AI_MS: diagnostics?.FIRST_CARD_AI_MS,
            REQUEST_TO_RESPONSE_READY_MS: diagnostics?.REQUEST_TO_RESPONSE_READY_MS,
            AI_LATE_DISCARDED: diagnostics?.AI_LATE_DISCARDED === true,
          } : undefined,
        });
      },
    };
    res.statusCode = 200;
    res.setHeader?.('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader?.('Cache-Control', 'no-cache, no-transform');
    res.setHeader?.('Connection', 'keep-alive');
    res.flushHeaders?.();
    let disconnected = false;
    let readyBatchId = '';
    const pendingCanonicalCopies = [];
    req?.on?.('aborted', () => { disconnected = true; });
    res?.on?.('close', () => { if (!res.writableEnded) disconnected = true; });
    let firstWriteRecorded = false;
    const emit = (event, data) => {
      if (disconnected) return false;
      const wrote = writeSse(res, event, data);
      if (wrote && !firstWriteRecorded) {
        firstWriteRecorded = true;
        stage('firstWrite', { batchId: data?.batchId });
      }
      return wrote;
    };
    const emitCanonicalCopy = (batchId, copy) => {
      const payload = {
        type: 'canonical.copy',
        generation: streamGeneration,
        batchId,
        copy,
      };
      if (!readyBatchId) pendingCanonicalCopies.push(payload);
      else if (readyBatchId === batchId) emit('canonical.copy', payload);
    };
    try {
      const handlerOrigin = process.hrtime.bigint();
      context.handlerOrigin = handlerOrigin;
      stage('runtime:start');
      const runtime = await (runRuntime || runtimeRunner || loadProductionRunner())(input, context, {
        onNarrativePlansReady: ({ batchId }) => stage('narrativePlansReady', { batchId }),
        onInputNormalized: () => stage('normalization:done'),
        onRecommendationReady: ({ batchId, response, countContract }) => {
          readyBatchId = response?.batch?.batchId || batchId;
          stage('recommendationReady', {
            batchId: readyBatchId,
            fields: diagnostics?.workCounts ? { workCounts: { ...diagnostics.workCounts } } : undefined,
          });
          emit('recommendation.ready', {
            type: 'recommendation.ready',
            generation: streamGeneration,
            batchId: readyBatchId,
            response,
            countContract,
            identity: { userIdentityVerified: true },
          });
          pendingCanonicalCopies.splice(0).forEach((payload) => {
            if (payload.batchId === readyBatchId) emit('canonical.copy', payload);
          });
        },
        onCanonicalCopy: ({ batchId, copy }) => emitCanonicalCopy(batchId, copy),
        onAiFailure: ({ batchId }) => emit('diagnostic', {
          type: 'diagnostic',
          generation: streamGeneration,
          batchId,
          stage: 'ai_failed_open',
          fields: { failurePolicy: 'fail_open' },
        }),
      });
      const aiSummary = runtime?.aiDone && typeof runtime.aiDone.then === 'function'
        ? await runtime.aiDone
        : { status: 'completed' };
      const batchId = runtime?.response?.batch?.batchId || runtime?.batchId || readyBatchId;
      const reason = aiSummary?.status === 'TIMEOUT' || aiSummary?.status === 'window_expired'
        ? 'deadline'
        : aiSummary?.status === 'FAIL' || aiSummary?.status === 'failed_open' ? 'failed_open' : 'completed';
      emit('complete', { type: 'complete', generation: streamGeneration, batchId, reason });
      stage('complete', { batchId });
      // The user-visible stream closes at the bounded response barrier. The
      // same invocation then remains alive only to settle durable tail work;
      // no later canonical frame can reach this response.
      if (!res.writableEnded) res.end?.();
      const tailTasks = [runtime?.tailDone, runtime?.backgroundDone]
        .filter((task) => task && typeof task.then === 'function');
      if (tailTasks.length > 0) await Promise.allSettled(tailTasks);
    } catch (error) {
      // Recommendation failures remain a normal HTTP error; provider failures
      // are swallowed by the runtime and still produce recommendation.ready.
      if (!disconnected && !res.writableEnded) {
        res.statusCode = error?.statusCode || 500;
        emit('complete', {
          type: 'complete',
          generation: streamGeneration,
          batchId: readyBatchId || undefined,
          reason: 'failed_open',
          errorCode: error?.code || 'RECOMMENDATION_FAILED',
        });
        stage('complete', { batchId: readyBatchId || undefined });
      }
    } finally {
      if (!res.writableEnded) res.end?.();
    }
  };

  return async function guardedRecommendationStream(req, res) {
    try {
      await recommendationStream(req, res);
    } catch (error) {
      const contentType = typeof res?.getHeader === 'function'
        ? res.getHeader('Content-Type')
        : res?.headers?.['Content-Type'];
      const sseStarted = res?.headersSent === true
        || (typeof contentType === 'string' && contentType.toLowerCase().startsWith('text/event-stream'));
      if (sseStarted) {
        if (!res?.writableEnded) {
          try {
            writeSse(res, 'complete', {
              type: 'complete',
              reason: 'failed_open',
              errorCode: error?.code || 'RECOMMENDATION_FAILED',
            });
          } catch { /* Response cleanup is fail-safe. */ }
          try { res.end?.(); } catch { /* Response cleanup is fail-safe. */ }
        }
        return;
      }
      if (!res?.writableEnded) {
        try {
          res.statusCode = error?.statusCode || 500;
          res.setHeader?.('Content-Type', 'application/json; charset=utf-8');
          res.end?.(JSON.stringify({
            code: error?.code || 'RECOMMENDATION_BOOTSTRAP_FAILED',
            message: error?.message || 'Recommendation stream bootstrap failed',
          }));
        } catch {
          try { res.end?.(); } catch { /* Response cleanup is fail-safe. */ }
        }
      }
    }
  };
}

const handler = createRecommendationStreamHandler();
handler.createRecommendationStreamHandler = createRecommendationStreamHandler;
handler.setRecommendationRuntimeRunner = setRecommendationRuntimeRunner;
handler.readOpenId = readOpenId;
handler.writeSse = writeSse;
module.exports = handler;

if (require.main === module) {
  const http = require('node:http');
  const port = Number(process.env.PORT) || 9000;
  http.createServer(handler).listen(port, '0.0.0.0', () => console.log(`recommendationStream listening on 0.0.0.0:${port}`));
}
