'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');
const test = require('node:test');
const stream = require('./index');

function request(body = {}, headers = { 'x-wx-openid': 'openid-1' }) {
  const req = Readable.from([JSON.stringify(body)]);
  req.method = 'POST';
  req.url = '/recommendations';
  req.headers = headers;
  return req;
}

function response() {
  const res = new EventEmitter();
  Object.assign(res, {
    headers: {}, chunks: [], writableEnded: false,
    setHeader(key, value) { this.headers[key] = value; },
    write(value) { this.chunks.push(value); },
    end(value) { if (value) this.chunks.push(value); this.writableEnded = true; },
  });
  return res;
}

function events(res) {
  return res.chunks.flatMap((chunk) => {
    const name = chunk.match(/^event: ([^\n]+)/m)?.[1];
    const data = chunk.match(/^data: (.+)$/m)?.[1];
    return name && data ? [{ name, data: JSON.parse(data) }] : [];
  });
}

test('HTTP auth and client generation map to the existing user and batch identity', async () => {
  const handler = stream.createRecommendationStreamHandler({ runRuntime: async (_input, context, hooks) => {
    assert.equal(context.userIdentity.openid, 'openid-1');
    await hooks.onRecommendationReady({ batchId: 'batch-1', response: { batch: { batchId: 'batch-1' } }, countContract: {} });
    await hooks.onCanonicalCopy({ batchId: 'batch-1', copy: { outfitKey: 'look-1', cardIndex: 0, text: 'x' } });
    return { batchId: 'batch-1', response: { batch: { batchId: 'batch-1' } }, aiDone: Promise.resolve({ status: 'completed' }) };
  } });
  const res = response();
  await handler(request({ streamGeneration: 'generation-7' }), res);
  const output = events(res);
  assert.deepEqual(output.map((event) => event.name), ['recommendation.ready', 'canonical.copy', 'complete']);
  assert.ok(output.every((event) => event.data.generation === 'generation-7'));
  assert.ok(output.every((event) => event.data.batchId === 'batch-1'));
  assert.deepEqual(output[0].data.identity, { userIdentityVerified: true });
});

test('HTTP adapter forwards the orchestrator authoritative first-card response without owning rendering', async () => {
  const handler = stream.createRecommendationStreamHandler({
    runRuntime: async (_input, _context, hooks) => {
      const responseValue = {
        batch: { batchId: 'batch-1' },
        light: { cards: [{ outfitKey: 'look-1', todayReason: '针织衫和长裤接得很自然。', copySource: 'ai_cache' }] },
      };
      await hooks.onRecommendationReady({ batchId: 'batch-1', response: responseValue });
      return { batchId: 'batch-1', response: responseValue, aiDone: Promise.resolve({ status: 'SUCCESS' }) };
    },
  });
  const res = response();
  await handler(request({ streamGeneration: 'generation-1' }), res);
  const output = events(res);
  assert.deepEqual(output.map((event) => event.name), ['recommendation.ready', 'complete']);
  assert.equal(output[0].data.response.light.cards[0].copySource, 'ai_cache');
  assert.equal(output[0].data.response.light.cards[0].todayReason, '针织衫和长裤接得很自然。');
});

test('orchestrator provider or validator failure completes fail-open after recommendation.ready', async () => {
  const handler = stream.createRecommendationStreamHandler({
    runRuntime: async (_input, _context, hooks) => {
      await hooks.onRecommendationReady({ batchId: 'batch-fail', response: { batch: { batchId: 'batch-fail' } } });
      return { batchId: 'batch-fail', response: { batch: { batchId: 'batch-fail' } }, aiDone: Promise.resolve({ status: 'FAIL', reason: 'VALIDATOR_FAIL' }) };
    },
  });
  const res = response();
  await handler(request({ streamGeneration: 'generation-fail' }), res);
  const output = events(res);
  assert.deepEqual(output.map((event) => event.name), ['recommendation.ready', 'complete']);
  assert.equal(output[1].data.reason, 'failed_open');
});

test('orchestrator cache hit is authoritative in recommendation.ready without a second UI event', async () => {
  const handler = stream.createRecommendationStreamHandler({
    runRuntime: async (_input, _context, hooks) => {
      const responseValue = {
        batch: { batchId: 'batch-cache' },
        light: { cards: [{ outfitKey: 'look-cache', todayReason: '缓存文案。', copySource: 'ai_cache' }] },
      };
      await hooks.onRecommendationReady({
        batchId: 'batch-cache',
        response: responseValue,
      });
      return { batchId: 'batch-cache', response: responseValue, aiDone: Promise.resolve({ status: 'CACHE_HIT' }) };
    },
  });
  const res = response();
  await handler(request({ streamGeneration: 'generation-cache' }), res);
  const output = events(res);
  assert.deepEqual(output.map((event) => event.name), ['recommendation.ready', 'complete']);
  assert.equal(output[0].data.response.light.cards[0].todayReason, '缓存文案。');
});

test('partial 1/3/7 and exhausted 0 keep their exact recommendation counts', async () => {
  for (const count of [1, 3, 7, 0]) {
    let rendererCalls = 0;
    const handler = stream.createRecommendationStreamHandler({
      consumeRenderer: async () => { rendererCalls += 1; return { status: 'completed' }; },
      runRuntime: async (_input, _context, hooks) => {
        const responseValue = {
          batch: { batchId: `batch-${count}`, countContract: { returnedCardCount: count, exhausted: count < 8 } },
          light: { cards: Array.from({ length: count }, (_, position) => ({ position })) },
        };
        await hooks.onRecommendationReady({ batchId: `batch-${count}`, response: responseValue });
        return { batchId: `batch-${count}`, response: responseValue, aiDone: Promise.resolve({ status: 'completed' }) };
      },
    });
    const res = response();
    await handler(request({ streamGeneration: `generation-${count}` }), res);
    const ready = events(res).find((event) => event.name === 'recommendation.ready');
    assert.equal(ready.data.response.light.cards.length, count);
    assert.equal(rendererCalls, 0);
  }
});

test('HTTP adapter rejects missing identity and unsupported route', async () => {
  const unauthorized = response();
  await stream(request({ streamGeneration: 'g' }, {}), unauthorized);
  assert.equal(unauthorized.statusCode, 401);
  const missing = request({ streamGeneration: 'g' });
  missing.url = '/';
  const notFound = response();
  await stream(missing, notFound);
  assert.equal(notFound.statusCode, 404);
});

test('SSE disconnect after ready stops transport writes while orchestrator background settles', async () => {
  let releaseBackground;
  const backgroundDone = new Promise((resolve) => { releaseBackground = resolve; });
  const handler = stream.createRecommendationStreamHandler({
    runRuntime: async (_input, _context, hooks) => {
      await hooks.onRecommendationReady({
        batchId: 'batch-disconnect',
        response: { batch: { batchId: 'batch-disconnect' } },
      });
      return {
        batchId: 'batch-disconnect',
        response: { batch: { batchId: 'batch-disconnect' } },
        aiDone: Promise.resolve({ status: 'SUCCESS' }),
        backgroundDone,
      };
    },
  });
  const res = response();
  const running = handler(request({ streamGeneration: 'generation-disconnect' }), res);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events(res).map((event) => event.name), ['recommendation.ready', 'complete']);
  assert.equal(res.writableEnded, true);
  res.emit('close');
  releaseBackground();
  await running;
  assert.deepEqual(events(res).map((event) => event.name), ['recommendation.ready', 'complete']);
});

test('stage diagnostics preserve SSE behavior and use one invocation identity', async () => {
  const stageEntries = [];
  const diagnostics = {
    auditId: 'audit-stage-1',
    batchId: null,
    executionMode: 'full_compute',
    workCounts: { inputRead: 0 },
  };
  const handler = stream.createRecommendationStreamHandler({
    createDiagnostics: (_input, handlerStartedAt, monotonicOriginAt) => {
      assert.equal(typeof handlerStartedAt, 'number');
      assert.equal(typeof monotonicOriginAt, 'bigint');
      return diagnostics;
    },
    recordStage: (shared, stage, options = {}) => {
      assert.equal(shared, diagnostics);
      stageEntries.push({
        stage,
        elapsedMs: options.elapsedMs ?? stageEntries.length,
        auditId: shared.auditId,
        batchId: options.batchId || shared.batchId,
        executionState: shared.executionMode,
      });
    },
    runRuntime: async (_input, context, hooks) => {
      assert.equal(context.diagnostics, diagnostics);
      await hooks.onInputNormalized?.();
      await hooks.onRecommendationReady({
        batchId: 'batch-stage-1',
        response: { batch: { batchId: 'batch-stage-1' } },
        countContract: {},
      });
      return {
        batchId: 'batch-stage-1',
        response: { batch: { batchId: 'batch-stage-1' } },
        aiDone: Promise.resolve({ status: 'completed' }),
      };
    },
  });
  const res = response();
  await handler(request({ auditId: 'audit-stage-1', streamGeneration: 'generation-stage' }), res);
  assert.deepEqual(events(res).map((event) => event.name), ['recommendation.ready', 'complete']);
  assert.deepEqual(stageEntries.map((entry) => entry.stage), [
    'request:received',
    'body:done',
    'json:done',
    'handler:start',
    'auth:start',
    'auth:done',
    'runtime:start',
    'normalization:done',
    'recommendationReady',
    'firstWrite',
    'complete',
  ]);
  assert.ok(stageEntries.every((entry) => entry.auditId === 'audit-stage-1'));
  assert.ok(stageEntries.every((entry) => typeof entry.elapsedMs === 'number'));
});

test('request entry, body completion, and handler start share one monotonic origin and record UTF-8 bytes', async () => {
  const body = { scene: '约会', streamGeneration: 'generation-body' };
  const serialized = JSON.stringify(body);
  const req = Readable.from((async function* delayedBody() {
    yield Buffer.from(serialized.slice(0, 8), 'utf8');
    await new Promise((resolve) => setTimeout(resolve, 15));
    yield Buffer.from(serialized.slice(8), 'utf8');
  }()));
  req.method = 'POST';
  req.url = '/recommendations';
  req.headers = { 'x-wx-openid': 'openid-body' };
  const stages = [];
  const diagnostics = { auditId: 'audit-body', workCounts: { inputRead: 0 } };
  const handler = stream.createRecommendationStreamHandler({
    createDiagnostics: () => diagnostics,
    recordStage: (_shared, stage, options) => stages.push({ stage, ...options }),
    runRuntime: async (_input, _context, hooks) => {
      await hooks.onRecommendationReady({ batchId: 'batch-body', response: { batch: { batchId: 'batch-body' } } });
      return { batchId: 'batch-body', aiDone: Promise.resolve({ status: 'completed' }) };
    },
  });
  const res = response();
  await handler(req, res);

  const requestReceived = stages.find((entry) => entry.stage === 'request:received');
  const bodyDone = stages.find((entry) => entry.stage === 'body:done');
  const handlerStart = stages.find((entry) => entry.stage === 'handler:start');
  assert.equal(requestReceived.elapsedMs, 0);
  assert.ok(bodyDone.elapsedMs >= 10);
  assert.ok(handlerStart.elapsedMs >= bodyDone.elapsedMs);
  assert.equal(bodyDone.fields.requestBodyBytes, Buffer.byteLength(serialized));
  assert.equal(diagnostics.requestBodyBytes, Buffer.byteLength(serialized));
});

test('a synthetic 2500ms pre-handler delay does not consume the interactive handler budget', async () => {
  let diagnosticsOrigin;
  const diagnostics = { auditId: 'audit-pre-handler-delay', workCounts: { inputRead: 0 } };
  const handler = stream.createRecommendationStreamHandler({
    readBody: async (req, requestOrigin) => {
      diagnosticsOrigin = requestOrigin - 2500n * 1000000n;
      return {
        value: { streamGeneration: 'generation-pre-handler-delay' },
        bytes: 48,
        bodyDoneMs: 2500,
        jsonDoneMs: 2500,
      };
    },
    createDiagnostics: () => {
      diagnostics.monotonicOriginAt = diagnosticsOrigin;
      return diagnostics;
    },
    recordStage: () => {},
    runRuntime: async (_input, context, hooks) => {
      const enteredAt = process.hrtime.bigint();
      const preHandlerMs = Number(context.handlerOrigin - diagnostics.monotonicOriginAt) / 1e6;
      const elapsedAtRuntimeMs = Number(enteredAt - context.handlerOrigin) / 1e6;
      const remainingAtRuntimeMs = 2300 - elapsedAtRuntimeMs;
      assert.ok(preHandlerMs >= 2500);
      assert.ok(elapsedAtRuntimeMs >= 0 && elapsedAtRuntimeMs < 50);
      assert.ok(remainingAtRuntimeMs > 2250);
      await hooks.onRecommendationReady({
        batchId: 'batch-pre-handler-delay',
        response: { batch: { batchId: 'batch-pre-handler-delay' } },
      });
      return {
        batchId: 'batch-pre-handler-delay',
        response: { batch: { batchId: 'batch-pre-handler-delay' } },
        aiDone: Promise.resolve({ status: 'completed' }),
      };
    },
  });
  const res = response();
  await handler(request({ streamGeneration: 'generation-pre-handler-delay' }), res);
  assert.deepEqual(events(res).map((event) => event.name), ['recommendation.ready', 'complete']);
});

test('ready and complete end the response before noncritical post-C2 settlement', async () => {
  let releaseBackground;
  const backgroundDone = new Promise((resolve) => { releaseBackground = resolve; });
  const handler = stream.createRecommendationStreamHandler({
    runRuntime: async (_input, _context, hooks) => {
      await hooks.onRecommendationReady({
        batchId: 'batch-background',
        response: { batch: { batchId: 'batch-background' } },
      });
      return {
        batchId: 'batch-background',
        aiDone: Promise.resolve({ status: 'completed' }),
        backgroundDone,
      };
    },
  });
  const res = response();
  const running = handler(request({ streamGeneration: 'generation-background' }), res);
  let handlerSettled = false;
  void running.then(() => { handlerSettled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events(res).map((event) => event.name), ['recommendation.ready', 'complete']);
  assert.equal(res.writableEnded, true);
  assert.equal(handlerSettled, false);
  releaseBackground();
  await running;
  assert.deepEqual(events(res).map((event) => event.name), ['recommendation.ready', 'complete']);
});

test('response ends before first-card tail settles and tail cannot write a second canonical event', async () => {
  let releaseTail;
  const tailDone = new Promise((resolve) => { releaseTail = resolve; });
  const handler = stream.createRecommendationStreamHandler({
    runRuntime: async (_input, _context, hooks) => {
      await hooks.onRecommendationReady({
        batchId: 'batch-tail',
        response: { batch: { batchId: 'batch-tail' }, light: { cards: [{ todayReason: 'safe' }] } },
      });
      return {
        batchId: 'batch-tail',
        response: { batch: { batchId: 'batch-tail' } },
        aiDone: Promise.resolve({ status: 'TIMEOUT' }),
        tailDone,
      };
    },
  });
  const res = response();
  const running = handler(request({ streamGeneration: 'generation-tail' }), res);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(res.writableEnded, true);
  assert.deepEqual(events(res).map((event) => event.name), ['recommendation.ready', 'complete']);
  releaseTail({ status: 'SUCCESS_TAIL' });
  await running;
  assert.deepEqual(events(res).map((event) => event.name), ['recommendation.ready', 'complete']);
});

test('bootstrap readBody failure returns an HTTP error without rejecting the handler', async () => {
  const handler = stream.createRecommendationStreamHandler({
    readBody: async () => { throw Object.assign(new Error('BODY_READ_FAILED'), { code: 'BODY_READ_FAILED' }); },
    runRuntime: async () => { throw new Error('runtime should not start'); },
  });
  const res = response();
  await assert.doesNotReject(() => handler(request(), res));
  assert.equal(res.statusCode, 500);
  assert.equal(res.writableEnded, true);
  assert.deepEqual(JSON.parse(res.chunks[0]), {
    code: 'BODY_READ_FAILED',
    message: 'BODY_READ_FAILED',
  });
});

test('bootstrap diagnostics and context failures return HTTP errors without rejecting the handler', async () => {
  const diagnosticsRes = response();
  const diagnosticsHandler = stream.createRecommendationStreamHandler({
    loadDiagnostics: () => { throw Object.assign(new Error('DIAGNOSTICS_FAILED'), { statusCode: 503 }); },
  });
  await assert.doesNotReject(() => diagnosticsHandler(request(), diagnosticsRes));
  assert.equal(diagnosticsRes.statusCode, 503);
  assert.equal(diagnosticsRes.writableEnded, true);

  const contextRes = response();
  const contextHandler = stream.createRecommendationStreamHandler({
    resolveContext: () => { throw Object.assign(new Error('CONTEXT_FAILED'), { code: 'CONTEXT_FAILED' }); },
  });
  await assert.doesNotReject(() => contextHandler(request(), contextRes));
  assert.equal(contextRes.statusCode, 500);
  assert.equal(contextRes.writableEnded, true);
});

test('failure after SSE headers emits a safe complete event and ends the response', async () => {
  const req = request();
  const res = response();
  const originalOn = res.on.bind(res);
  res.on = (event, listener) => {
    if (event === 'close') throw Object.assign(new Error('SSE_BOOTSTRAP_FAILED'), { code: 'SSE_BOOTSTRAP_FAILED' });
    return originalOn(event, listener);
  };
  const handler = stream.createRecommendationStreamHandler({ runRuntime: async () => ({}) });
  await assert.doesNotReject(() => handler(req, res));
  assert.equal(res.statusCode, 200);
  assert.equal(res.writableEnded, true);
  assert.deepEqual(events(res).map((event) => event.name), ['complete']);
  assert.equal(events(res)[0].data.errorCode, 'SSE_BOOTSTRAP_FAILED');
});
