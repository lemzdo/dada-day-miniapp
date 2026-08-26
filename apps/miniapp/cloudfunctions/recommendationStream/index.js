'use strict';

let runtimeRunner = null;

function loadGenerateOutfitModule() {
  try { return require('./generateOutfit'); } catch { return require('../generateOutfit'); }
}

function loadProductionRunner() {
  // Lazy loading avoids a second Runtime implementation and keeps the HTTP
  // function's module startup independent from transport-specific setup.
  return loadGenerateOutfitModule().runProductionRecommendationRuntime;
}

function loadProductionRenderer() {
  try {
    return require('./generateOutfit/services/recommendationVoiceRendererProductionV2').consumeProductionRendererStream;
  } catch {
    return require('../generateOutfit/services/recommendationVoiceRendererProductionV2').consumeProductionRendererStream;
  }
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

async function readBody(req) {
  if (!req || typeof req.on !== 'function') return undefined;
  let body = '';
  for await (const chunk of req) body += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
  if (!body.trim()) return undefined;
  try { return JSON.parse(body); } catch { return undefined; }
}

function createRecommendationStreamHandler({ runRuntime = null, resolveContext, consumeRenderer = null } = {}) {
  return async function recommendationStream(req, res) {
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
    const openid = readOpenId(req);
    if (!openid) {
      res.statusCode = 401;
      res.setHeader?.('Content-Type', 'application/json; charset=utf-8');
      res.end?.(JSON.stringify({ code: 1, message: 'x-wx-openid is required' }));
      return;
    }
    const body = req?.method === 'GET' ? undefined : await readBody(req);
    const input = parseInput(req, body);
    const streamGeneration = typeof input.streamGeneration === 'string' && input.streamGeneration.trim()
      ? input.streamGeneration.trim()
      : `http-${Date.now().toString(36)}`;
    const context = {
      ...(typeof resolveContext === 'function' ? (resolveContext({ req, openid }) || {}) : {}),
      userIdentity: { openid },
      interactive: true,
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
    const emit = (event, data) => { if (!disconnected) writeSse(res, event, data); };
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
      const runtime = await (runRuntime || runtimeRunner || loadProductionRunner())(input, context, {
        onNarrativePlansReady: async ({ entries, batchId, copyJobPromise, persistCanonicalCopy }) => {
          // Start the existing production Qwen renderer at C2. This promise is
          // intentionally detached from recommendation.ready.
          const copyJob = await copyJobPromise;
          const misses = Array.isArray(copyJob?.missEntries) ? copyJob.missEntries : [];
          if (misses.length === 0) return { status: 'ready_cache_hit', validatedCount: 0 };
          return (consumeRenderer || loadProductionRenderer())({
            preparedEntries: misses.map((entry) => entry.preparedEntry),
            onValidated: async (copy) => {
              const stored = await persistCanonicalCopy(copy);
              const entry = (entries || []).find((item) => item?.preparedEntry?.plan?.planId === copy?.planId);
              if (!stored || !entry) return;
              emitCanonicalCopy(batchId, {
                outfitKey: entry.outfitKey,
                cardIndex: entry.position,
                text: copy.text,
                source: 'ai_cache',
                availableAt: stored.availableAt,
                rendererVersion: stored.rendererVersion,
              });
            },
            onInvalid: () => undefined,
          });
        },
        onRecommendationReady: ({ batchId, response, countContract }) => {
          readyBatchId = response?.batch?.batchId || batchId;
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
      const reason = aiSummary?.status === 'window_expired'
        ? 'deadline'
        : aiSummary?.status === 'failed_open' ? 'failed_open' : 'completed';
      emit('complete', { type: 'complete', generation: streamGeneration, batchId, reason });
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
      }
    } finally {
      if (!res.writableEnded) res.end?.();
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
