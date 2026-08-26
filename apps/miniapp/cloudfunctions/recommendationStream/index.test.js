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

test('C2 starts renderer before ready and emits the first persisted copy incrementally', async () => {
  let releaseRenderer;
  const rendererGate = new Promise((resolve) => { releaseRenderer = resolve; });
  let rendererStarted = false;
  const handler = stream.createRecommendationStreamHandler({
    consumeRenderer: async ({ onValidated }) => {
      rendererStarted = true;
      await rendererGate;
      await onValidated({ planId: 'plan-1', text: '针织衫和长裤接得很自然。' });
      return { status: 'completed', validatedCount: 1 };
    },
    runRuntime: async (_input, _context, hooks) => {
      const aiDone = hooks.onNarrativePlansReady({
        batchId: 'batch-1',
        entries: [{ position: 0, outfitKey: 'look-1', preparedEntry: { plan: { planId: 'plan-1' } } }],
        copyJobPromise: Promise.resolve({ missEntries: [{ preparedEntry: { plan: { planId: 'plan-1' } } }] }),
        persistCanonicalCopy: async () => ({ availableAt: '2026-08-26T00:00:00.000Z', rendererVersion: 'recommendation-voice-renderer-production-v2.1' }),
      });
      await hooks.onRecommendationReady({ batchId: 'batch-1', response: { batch: { batchId: 'batch-1' } } });
      return { batchId: 'batch-1', response: { batch: { batchId: 'batch-1' } }, aiDone };
    },
  });
  const res = response();
  const running = handler(request({ streamGeneration: 'generation-1' }), res);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(rendererStarted, true);
  assert.deepEqual(events(res).map((event) => event.name), ['recommendation.ready']);
  releaseRenderer();
  await running;
  const output = events(res);
  assert.deepEqual(output.map((event) => event.name), ['recommendation.ready', 'canonical.copy', 'complete']);
  assert.deepEqual(output[1].data.copy, {
    outfitKey: 'look-1', cardIndex: 0, text: '针织衫和长裤接得很自然。', source: 'ai_cache',
    availableAt: '2026-08-26T00:00:00.000Z', rendererVersion: 'recommendation-voice-renderer-production-v2.1',
  });
});

test('Qwen or validator failure completes fail-open after recommendation.ready', async () => {
  const handler = stream.createRecommendationStreamHandler({
    consumeRenderer: async () => ({ status: 'failed_open', validatedCount: 0 }),
    runRuntime: async (_input, _context, hooks) => {
      const aiDone = hooks.onNarrativePlansReady({
        batchId: 'batch-fail',
        entries: [{ position: 0, outfitKey: 'look-1', preparedEntry: { plan: { planId: 'plan-1' } } }],
        copyJobPromise: Promise.resolve({ missEntries: [{ preparedEntry: { plan: { planId: 'plan-1' } } }] }),
        persistCanonicalCopy: async () => { throw new Error('must not write'); },
      });
      await hooks.onRecommendationReady({ batchId: 'batch-fail', response: { batch: { batchId: 'batch-fail' } } });
      return { batchId: 'batch-fail', response: { batch: { batchId: 'batch-fail' } }, aiDone };
    },
  });
  const res = response();
  await handler(request({ streamGeneration: 'generation-fail' }), res);
  const output = events(res);
  assert.deepEqual(output.map((event) => event.name), ['recommendation.ready', 'complete']);
  assert.equal(output[1].data.reason, 'failed_open');
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

test('SSE disconnect after ready stops client writes while canonical persistence finishes fail-open', async () => {
  let releaseRenderer;
  const rendererGate = new Promise((resolve) => { releaseRenderer = resolve; });
  let persisted = false;
  const handler = stream.createRecommendationStreamHandler({
    consumeRenderer: async ({ onValidated }) => {
      await rendererGate;
      await onValidated({ planId: 'plan-1', text: '断连后仍完成共享缓存写入。' });
      return { status: 'completed', validatedCount: 1 };
    },
    runRuntime: async (_input, _context, hooks) => {
      const aiDone = hooks.onNarrativePlansReady({
        batchId: 'batch-disconnect',
        entries: [{ position: 0, outfitKey: 'look-1', preparedEntry: { plan: { planId: 'plan-1' } } }],
        copyJobPromise: Promise.resolve({ missEntries: [{ preparedEntry: { plan: { planId: 'plan-1' } } }] }),
        persistCanonicalCopy: async () => {
          persisted = true;
          return {
            availableAt: '2026-08-26T00:00:00.000Z',
            rendererVersion: 'recommendation-voice-renderer-production-v2.1',
          };
        },
      });
      await hooks.onRecommendationReady({
        batchId: 'batch-disconnect',
        response: { batch: { batchId: 'batch-disconnect' } },
      });
      return {
        batchId: 'batch-disconnect',
        response: { batch: { batchId: 'batch-disconnect' } },
        aiDone,
      };
    },
  });
  const res = response();
  const running = handler(request({ streamGeneration: 'generation-disconnect' }), res);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events(res).map((event) => event.name), ['recommendation.ready']);
  res.emit('close');
  releaseRenderer();
  await running;
  assert.equal(persisted, true);
  assert.deepEqual(events(res).map((event) => event.name), ['recommendation.ready']);
});
