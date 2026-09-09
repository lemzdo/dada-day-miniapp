'use strict';

const { createSseParser } = require('../../src/lib/recommendationSseCore');
const { buildRecommendationStreamTransportInput } = require('../../src/lib/recommendationStreamTransportCore');

async function readContext(mini, envId) {
  return mini.evaluate((expectedEnv) => {
    const openid = wx.getStorageSync('openid');
    if (typeof openid !== 'string' || !openid) throw new Error('WECHAT_LOGIN_REQUIRED');
    const keys = wx.getStorageInfoSync().keys;
    const scope = ':cloud:' + expectedEnv + ':user:' + openid + ':';
    if (!keys.some((key) => key.includes(scope))) throw new Error('WECHAT_ENVIRONMENT_MISMATCH');
    if (typeof wx.cloud?.callHTTPFunction !== 'function') throw new Error('WECHAT_HTTP_FUNCTION_UNAVAILABLE');
    const bridge = globalThis.__d1dTodayDiagnostics;
    if (bridge && !bridge.ready) throw new Error('TODAY_BUSY');
    return { openid, envId: expectedEnv, appId: wx.getAccountInfoSync().miniProgram.appId };
  }, envId);
}

function requestInput(date, auditId) {
  return { ...buildRecommendationStreamTransportInput({
    date, scene: '居家', timeOfDay: 'all_day', weatherMode: 'disabled',
    v2BatchId: auditId, performanceDiagnostics: true, trigger: 'retry', requestKind: 'initial',
  }, auditId, 'today-runtime-v2'), auditId };
}

async function requestFirstCard(mini, context, input) {
  // Use the existing WeChat gateway and its authenticated identity. No synthetic
  // openid header, server-side force flag, client cache reset or fallback call.
  const result = await mini.evaluate((args) => new Promise((resolve, reject) => {
    if (wx.getStorageSync('openid') !== args.openid) return reject(new Error('WECHAT_USER_CHANGED'));
    const chunks = [];
    let statusCode = null;
    let settled = false;
    let task;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      task?.abort?.();
      reject(new Error('WECHAT_SMOKE_REQUEST_TIMEOUT'));
    }, 45000);
    const fail = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error('WECHAT_SMOKE_REQUEST_FAILED'));
    };
    try {
      task = wx.cloud.callHTTPFunction({
        config: { env: args.envId }, name: 'recommendationStream', path: '/recommendations',
        method: 'POST', data: args.input, enableChunked: true,
        onHeadersReceived: (response) => { statusCode = response.statusCode ?? null; },
        onChunkedReceived: (response) => {
          chunks.push(typeof response.data === 'string' ? response.data : Array.from(new Uint8Array(response.data)));
        },
        success: (response) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({ chunks, statusCode: response?.statusCode ?? statusCode });
        },
        fail,
      });
    } catch { fail(); }
  }), { ...context, input });
  const events = [];
  const malformed = [];
  const parser = createSseParser({
    onEvent: (frame) => events.push(frame),
    onMalformed: (frame) => malformed.push(frame),
  });
  for (const chunk of result.chunks) parser.push(typeof chunk === 'string' ? chunk : Uint8Array.from(chunk));
  parser.finish();
  const ready = events.find((frame) => frame.event === 'recommendation.ready')?.data;
  const complete = events.find((frame) => frame.event === 'complete')?.data;
  if (!ready?.identity?.userIdentityVerified || !ready.response?.light?.cards?.[0] || !complete) {
    throw Object.assign(new Error('WECHAT_SMOKE_SSE_INCOMPLETE'), { smokeEvidence: {
      httpStatus: result.statusCode,
      chunkCount: result.chunks.length,
      chunkByteLengths: result.chunks.map((chunk) => typeof chunk === 'string'
        ? Buffer.byteLength(chunk, 'utf8')
        : chunk.length),
      eventTypes: events.map((frame) => frame.event),
      malformedFrameCount: malformed.length,
      readyObserved: Boolean(ready),
      readyIdentityVerified: ready?.identity?.userIdentityVerified === true,
      readyFirstCardObserved: Boolean(ready?.response?.light?.cards?.[0]),
      completeObserved: Boolean(complete),
      completeReason: typeof complete?.reason === 'string' ? complete.reason : null,
      completeErrorCode: typeof complete?.errorCode === 'string' ? complete.errorCode : null,
    } });
  }
  if (result.statusCode !== null && result.statusCode !== 200) throw new Error('WECHAT_SMOKE_HTTP_STATUS');
  if (ready.batchId !== input.v2BatchId || complete.batchId !== input.v2BatchId) throw new Error('WECHAT_SMOKE_BATCH_MISMATCH');
  return { statusCode: result.statusCode, events: events.map((frame) => frame.event),
    completeReason: complete.reason, batchId: ready.batchId, firstCard: ready.response.light.cards[0] };
}

module.exports = { readContext, requestInput, requestFirstCard };
