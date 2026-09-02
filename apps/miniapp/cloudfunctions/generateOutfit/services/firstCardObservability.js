'use strict';

const { loadDeployPackage } = require('./deployPackageResolver');
const VERSION = 'first-card-runtime-observability/v1';
const remembered = new WeakMap();
const STAGES = new Set(['admission', 'ai_core', 'credentials', 'request', 'http_response', 'stream_read', 'output_parse', 'validation', 'persistence', 'runtime', 'unknown']);
const CODES = new Set(['ADMISSION_FAILED', 'AI_CORE_UNAVAILABLE', 'CREDENTIALS_UNAVAILABLE', 'REQUEST_FAILED', 'PROVIDER_HTTP_ERROR', 'PROVIDER_STREAM_ERROR', 'NETWORK_ERROR', 'PROVIDER_TIMEOUT', 'REQUEST_ABORTED', 'STREAM_READ_FAILED', 'OUTPUT_INCOMPLETE', 'OUTPUT_PARSE_FAILED', 'VALIDATION_REJECTED', 'PERSISTENCE_FAILED', 'RUNTIME_FAILED', 'UNKNOWN_FAILURE']);
const NETWORK_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'EAI_AGAIN', 'ENOTFOUND', 'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']);
const token = (value) => typeof value === 'string' && /^[\w.:/-]+$/.test(value) ? value.slice(0, 128) : null;
const answer = (value) => ['yes', 'no', 'unknown'].includes(value) ? value : 'unknown';
let sequence = 0;
function identifier() {
  sequence += 1;
  return `failure-${Date.now()}-${sequence}-${Math.random().toString(16).slice(2)}`;
}

function coreHelpers() {
  try { return loadDeployPackage('@d1d/ai-core', ['..', 'vendor', 'ai-core']); } catch { return null; }
}

// The local whitelist also works when AI Core itself cannot be loaded. It must
// never turn a diagnostic dependency failure into a recommendation failure.
function sanitizeFailure(value, context = {}) {
  try {
    if (!value || value.schemaVersion !== VERSION) return null;
    const provider = value.provider || {};
    const evidence = value.evidence || {};
    return {
      schemaVersion: VERSION,
      failureId: token(value.failureId) || identifier(),
      auditId: token(value.auditId) || token(context.auditId) || `audit-${token(value.failureId) || identifier()}`,
      attemptId: token(value.attemptId) || token(context.attemptId),
      batchId: token(value.batchId) || token(context.batchId),
      stage: STAGES.has(value.stage) ? value.stage : 'unknown',
      code: CODES.has(value.code) ? value.code : 'UNKNOWN_FAILURE',
      retryability: ['retryable', 'not_retryable', 'unknown'].includes(value.retryability) ? value.retryability : 'unknown',
      providerIssue: answer(value.providerIssue),
      businessRejected: answer(value.businessRejected),
      deadline: {
        causedFailure: answer(value.deadline?.causedFailure),
        source: ['provider_timeout', 'renderer_timeout', 'unknown'].includes(value.deadline?.source) ? value.deadline.source : null,
      },
      provider: {
        name: token(provider.name), model: token(provider.model),
        httpStatus: Number.isInteger(provider.httpStatus) && provider.httpStatus >= 100 && provider.httpStatus <= 599 ? provider.httpStatus : null,
        requestId: token(provider.requestId), errorCode: token(provider.errorCode),
      },
      evidence: {
        exceptionType: token(evidence.exceptionType),
        networkCode: NETWORK_CODES.has(evidence.networkCode) ? evidence.networkCode : null,
        validatorCodes: Array.isArray(evidence.validatorCodes) ? evidence.validatorCodes.map(token).filter(Boolean).slice(0, 16) : [],
      },
      elapsedFromHandlerMs: Number.isFinite(value.elapsedFromHandlerMs) ? Math.max(0, value.elapsedFromHandlerMs) : null,
    };
  } catch { return null; }
}

function getFailure(error) {
  if (!error || (typeof error !== 'object' && typeof error !== 'function')) return null;
  try {
    const value = remembered.get(error) || coreHelpers()?.getFailure?.(error) || error.failure;
    const failure = sanitizeFailure(value);
    if (failure) remembered.set(error, failure);
    return failure;
  } catch { return null; }
}

function createFailureEnvelope(error, context = {}, overrides = {}) {
  const previous = getFailure(error);
  if (previous) return sanitizeFailure(previous, context);
  let failure;
  try { failure = coreHelpers()?.createFailureEnvelope?.(error, context, overrides); } catch { /* local fallback */ }
  if (!failure) {
    failure = {
      schemaVersion: VERSION, failureId: context.failureId || identifier(),
      auditId: context.auditId, attemptId: context.attemptId, batchId: context.batchId,
      ...overrides, provider: overrides.provider || context.provider,
      evidence: { exceptionType: error?.name, networkCode: overrides.networkCode, validatorCodes: overrides.validatorCodes },
      elapsedFromHandlerMs: context.elapsedFromHandlerMs ?? (Number.isFinite(context.handlerStartedAt) ? Date.now() - context.handlerStartedAt : null),
    };
  }
  failure = sanitizeFailure(failure, context);
  if (failure && error && typeof error === 'object') remembered.set(error, failure);
  return failure;
}

function providerMetadata(response, extra = {}) {
  try {
    const headers = response?.headers;
    const read = (name) => headers?.get?.(name) || headers?.[name];
    return {
      name: 'dashscope', model: null,
      httpStatus: response?.status ?? null,
      requestId: read('x-request-id') || read('request-id') || read('x-requestid') || null,
      errorCode: null, ...(response?.__failureProvider || {}), ...extra,
    };
  } catch { return { name: 'dashscope', ...extra }; }
}

function describeFailure(error, context = {}, evidence = {}) {
  const existing = getFailure(error);
  const aborted = error?.name === 'AbortError' || error?.code === 'ABORT_ERR';
  // The consumer owns this controller and only its existing timer aborts it.
  const rendererTimeout = evidence.rendererTimedOut && (aborted || error === evidence.abortReason);
  if (existing) {
    const enriched = rendererTimeout && existing.deadline.causedFailure === 'unknown'
      ? { ...existing, code: 'PROVIDER_TIMEOUT', retryability: 'retryable', deadline: { causedFailure: 'yes', source: 'renderer_timeout' } }
      : existing;
    const failure = sanitizeFailure(enriched, context);
    if (error && typeof error === 'object') remembered.set(error, failure);
    return failure;
  }
  const provider = { ...(context.provider || {}), ...(evidence.provider || {}) };
  const status = provider.httpStatus;
  const networkCode = [error?.code, error?.cause?.code].find((code) => NETWORK_CODES.has(code));
  const details = {
    stage: evidence.stage || 'request', code: 'UNKNOWN_FAILURE',
    retryability: 'unknown', providerIssue: 'unknown', businessRejected: 'unknown',
    deadline: { causedFailure: 'unknown', source: null }, provider,
    ...(networkCode ? { networkCode } : {}),
  };
  if (Number.isInteger(status) && status >= 400) {
    const transient = [500, 502, 503, 504].includes(status)
      || (status === 429 && /throttl|rate[_.-]?limit/i.test(provider.errorCode || '') && !/quotaexhaust|insufficient|balance/i.test(provider.errorCode || ''));
    Object.assign(details, { stage: 'http_response', code: 'PROVIDER_HTTP_ERROR', retryability: transient ? 'retryable' : status === 401 ? 'not_retryable' : 'unknown', providerIssue: transient ? 'yes' : status === 401 ? 'no' : 'unknown', businessRejected: 'no', deadline: { causedFailure: 'no', source: null } });
  } else if (evidence.providerStreamError) {
    Object.assign(details, { stage: 'stream_read', code: 'PROVIDER_STREAM_ERROR', businessRejected: 'no', deadline: { causedFailure: 'no', source: null } });
  } else if (rendererTimeout) {
    Object.assign(details, { code: 'PROVIDER_TIMEOUT', retryability: 'retryable', businessRejected: 'no', deadline: { causedFailure: 'yes', source: 'renderer_timeout' } });
  } else if (aborted) {
    Object.assign(details, { code: 'REQUEST_ABORTED', businessRejected: 'no', deadline: { causedFailure: 'unknown', source: 'unknown' } });
  } else if (networkCode) {
    Object.assign(details, { code: 'NETWORK_ERROR', retryability: 'retryable', businessRejected: 'no', deadline: { causedFailure: 'no', source: null } });
  } else if (evidence.stage === 'stream_read') {
    details.code = 'STREAM_READ_FAILED';
  }
  return createFailureEnvelope(error, context, details);
}

function emitAudit(callback, stage, status, extra) {
  try {
    const returned = callback?.(stage, status, extra);
    if (returned && typeof returned.catch === 'function') returned.catch(() => {});
  } catch { /* Diagnostics never change business execution. */ }
}

module.exports = { createFailureEnvelope, getFailure, sanitizeFailure, describeFailure, providerMetadata, emitAudit };
