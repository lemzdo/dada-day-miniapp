'use strict';
const { withDeadline } = require('./policy');
const { attachFailure, getFailure, NETWORK_CODES } = require('./failure');

function responseRequestId(response) {
  try {
    const header = (name) => response?.headers?.get?.(name) || response?.headers?.[name];
    return header('x-request-id') || header('request-id') || header('x-requestid') || null;
  } catch { return null; }
}
function structuredFields(bodyText) {
  try {
    const value = JSON.parse(bodyText);
    const error = value?.error || value;
    const code = error?.code ?? error?.error_code;
    return {
      requestId: value?.requestId || value?.request_id || value?.requestID || error?.requestId || error?.request_id || null,
      errorCode: typeof code === 'number' && Number.isFinite(code) ? String(code) : code,
    };
  } catch { return {}; }
}
function providerFields(response, context, fields = {}) {
  return {
    name: 'dashscope', model: context.provider?.model || context.model,
    httpStatus: response?.status ?? null, requestId: responseRequestId(response), errorCode: null,
    ...fields,
  };
}
function normalizeProviderError(error, response, bodyText, context = {}) {
  const e = error instanceof Error ? error : new Error(String(error || 'provider error'));
  if (getFailure(e)) return e;
  const status = [response?.status, e.status, e.statusCode, e.response?.status].find(Number.isInteger);
  const fields = structuredFields(bodyText);
  const originalCode = e.code;
  const networkCode = [originalCode, e.cause?.code].find((code) => NETWORK_CODES.has(code));
  fields.errorCode = fields.errorCode || e.errorCode || (status && typeof originalCode === 'string' && !/^PROVIDER_(HTTP_|ERROR|TIMEOUT)/.test(originalCode) ? originalCode : null);
  // Keep the legacy Error code/message/name contract. The envelope uses actual
  // evidence, not the legacy message heuristic, to distinguish timeout/abort.
  const legacyTimeout = e.name === 'AbortError' || /deadline|timeout/i.test(e.message);
  try { e.code = legacyTimeout ? 'PROVIDER_TIMEOUT' : status ? `PROVIDER_HTTP_${status}` : 'PROVIDER_ERROR'; e.status = status; } catch { /* Preserve frozen errors. */ }
  const aborted = e.name === 'AbortError' || originalCode === 'ABORT_ERR';
  const deadlineHit = context.deadline?.causedFailure === 'yes';
  const temporaryLimit = status === 429 && /throttl|rate[_.-]?limit/i.test(fields.errorCode || '')
    && !/quotaexhaust|insufficient|balance/i.test(fields.errorCode || '');
  const transient = [500, 502, 503, 504].includes(status) || temporaryLimit;
  const code = status ? 'PROVIDER_HTTP_ERROR' : deadlineHit ? 'PROVIDER_TIMEOUT' : aborted ? 'REQUEST_ABORTED' : networkCode ? 'NETWORK_ERROR' : 'UNKNOWN_FAILURE';
  const knownNonDeadline = Boolean(status || networkCode);
  return attachFailure(e, context, {
    stage: status ? 'http_response' : 'request', code,
    retryability: transient || deadlineHit || networkCode ? 'retryable' : status === 401 ? 'not_retryable' : 'unknown',
    providerIssue: transient ? 'yes' : status === 401 ? 'no' : 'unknown',
    businessRejected: code === 'UNKNOWN_FAILURE' ? 'unknown' : 'no',
    deadline: status ? { causedFailure: 'no', source: null } : context.deadline || { causedFailure: knownNonDeadline ? 'no' : 'unknown', source: aborted ? 'unknown' : null },
    provider: providerFields(response, context, { httpStatus: status ?? null, requestId: fields.requestId || responseRequestId(response) || e.requestId || e.request_id || null, errorCode: fields.errorCode || null }),
    networkCode,
  });
}
function authValue(auth) { return typeof auth === 'function' ? auth() : auth; }
async function requestDashScope(input, options = {}) {
  const fetchImpl = options.fetch || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw attachFailure(new Error('fetch is required'), options.failureContext, { stage: 'request', code: 'REQUEST_FAILED', providerIssue: 'no', businessRejected: 'no', deadline: { causedFailure: 'no', source: null } });
  const endpoint = (typeof options.endpoint === 'function' ? options.endpoint(input) : options.endpoint) || process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  const key = await authValue(options.authLookup || options.apiKey || process.env.DASHSCOPE_API_KEY);
  if (!key) throw attachFailure(new Error('provider auth unavailable'), options.failureContext, { stage: 'credentials', code: 'CREDENTIALS_UNAVAILABLE', retryability: 'not_retryable', providerIssue: 'no', businessRejected: 'no', deadline: { causedFailure: 'no', source: null } });
  const deadline = withDeadline(options.signal, options.timeoutMs || 25000);
  const normalizedEndpoint = String(endpoint).replace(/\/$/, '');
  const url = normalizedEndpoint.endsWith('/chat/completions') ? normalizedEndpoint : `${normalizedEndpoint}/chat/completions`;
  const context = { ...(options.failureContext || {}), provider: { name: 'dashscope', model: input.body?.model || input.model } };
  try {
    const response = await fetchImpl(url, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(options.headers || {}) }, body: JSON.stringify(input.body || input), signal: deadline.signal });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      deadline.cancel();
      throw normalizeProviderError(new Error(text.slice(0, 500) || `HTTP ${response.status}`), response, text, context);
    }
    response.__cancelDeadline = deadline.cancel;
    return response;
  } catch (error) {
    deadline.cancel();
    const deadlineHit = deadline.signal.aborted && !options.signal?.aborted
      && (error === deadline.signal.reason || error?.name === 'AbortError' || error?.code === 'ABORT_ERR');
    throw normalizeProviderError(error, undefined, undefined, { ...context, ...(deadlineHit ? { deadline: { causedFailure: 'yes', source: 'provider_timeout' } } : {}) });
  }
}
function attachResponseFailure(error, response, options, input, stage) {
  const networkCode = [error?.code, error?.cause?.code].find((code) => NETWORK_CODES.has(code));
  const parse = stage === 'output_parse' && error instanceof SyntaxError;
  const aborted = error?.name === 'AbortError';
  attachFailure(error, options.failureContext, {
    stage: networkCode || aborted ? 'stream_read' : stage,
    code: networkCode ? 'NETWORK_ERROR' : aborted ? 'REQUEST_ABORTED' : parse ? 'OUTPUT_PARSE_FAILED' : 'STREAM_READ_FAILED',
    retryability: networkCode ? 'retryable' : 'unknown', providerIssue: 'unknown', businessRejected: networkCode || aborted || parse ? 'no' : 'unknown',
    deadline: { causedFailure: networkCode || parse ? 'no' : 'unknown', source: aborted ? 'unknown' : null },
    provider: providerFields(response, { model: input.body?.model || input.model }), networkCode,
  });
}
async function executeDashScope(input, options = {}) {
  const response = await requestDashScope(input, options);
  try {
    const data = await response.json();
    const choice = data?.choices?.[0];
    return { text: choice?.message?.content || choice?.text || '', raw: data, usage: data?.usage || null, model: data?.model || input.body?.model || input.model };
  } catch (error) { attachResponseFailure(error, response, options, input, 'output_parse'); throw error; }
  finally { response.__cancelDeadline?.(); }
}
async function streamDashScope(input, options = {}) {
  const response = await requestDashScope(input, options);
  try {
    if (!response.body || typeof response.body.getReader !== 'function') return { text: (await executeJson(response)).text, usage: null, model: input.body?.model || input.model };
    const reader = response.body.getReader(); const decoder = new TextDecoder();
    let buffer = '', text = '', usage = null;
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      buffer += decoder.decode(part.value, { stream: true });
      const lines = buffer.split(/\r?\n/); buffer = lines.pop() || '';
      for (const line of lines) {
        const value = line.replace(/^data:\s*/, '').trim();
        if (!value || value === '[DONE]') continue;
        try {
          const data = JSON.parse(value);
          text += data?.choices?.[0]?.delta?.content || data?.choices?.[0]?.message?.content || '';
          if (data.usage) usage = data.usage;
        } catch { /* Preserve the existing tolerant stream parser. */ }
      }
    }
    return { text, usage, model: input.body?.model || input.model };
  } catch (error) { attachResponseFailure(error, response, options, input, error instanceof SyntaxError ? 'output_parse' : 'stream_read'); throw error; }
  finally { response.__cancelDeadline?.(); }
}
async function executeJson(response) { const data = await response.json(); return { text: data?.choices?.[0]?.message?.content || '', raw: data, usage: data?.usage || null }; }
module.exports = { requestDashScope, executeDashScope, streamDashScope, normalizeProviderError };
