'use strict';

const SCHEMA_VERSION = 'first-card-runtime-observability/v1';
const store = new WeakMap();
const STAGES = new Set(['admission', 'ai_core', 'credentials', 'request', 'http_response', 'stream_read', 'output_parse', 'validation', 'persistence', 'runtime', 'unknown']);
const CODES = new Set(['ADMISSION_FAILED', 'AI_CORE_UNAVAILABLE', 'CREDENTIALS_UNAVAILABLE', 'REQUEST_FAILED', 'PROVIDER_HTTP_ERROR', 'PROVIDER_STREAM_ERROR', 'NETWORK_ERROR', 'PROVIDER_TIMEOUT', 'REQUEST_ABORTED', 'STREAM_READ_FAILED', 'OUTPUT_INCOMPLETE', 'OUTPUT_PARSE_FAILED', 'VALIDATION_REJECTED', 'PERSISTENCE_FAILED', 'RUNTIME_FAILED', 'UNKNOWN_FAILURE']);
const NETWORK_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'EAI_AGAIN', 'ENOTFOUND', 'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']);
const EXCEPTION_TYPES = new Set(['Error', 'TypeError', 'SyntaxError', 'RangeError', 'ReferenceError', 'EvalError', 'URIError', 'AggregateError', 'DOMException', 'AbortError', 'TimeoutError', 'FetchError', 'SystemError']);
const answer = (value) => ['yes', 'no', 'unknown'].includes(value) ? value : 'unknown';
const token = (value, limit = 128) => typeof value === 'string' && /^[A-Za-z0-9_.:/-]+$/.test(value) ? value.slice(0, limit) : null;
let sequence = 0;
function makeId() {
  sequence += 1;
  try { return globalThis.crypto?.randomUUID?.() || `failure-${Date.now()}-${sequence}`; }
  catch { return `failure-${Date.now()}-${sequence}`; }
}
function objectLike(value) { return value !== null && (typeof value === 'object' || typeof value === 'function'); }

function sanitizeFailure(input, context = {}) {
  try {
    const provider = input?.provider || {};
    const evidence = input?.evidence || {};
    const failureId = token(input?.failureId) || makeId();
    return {
      schemaVersion: SCHEMA_VERSION,
      failureId,
      auditId: token(input?.auditId) || token(context.auditId) || `audit-${failureId}`,
      attemptId: token(input?.attemptId) || token(context.attemptId),
      batchId: token(input?.batchId) || token(context.batchId),
      stage: STAGES.has(input?.stage) ? input.stage : 'unknown',
      code: CODES.has(input?.code) ? input.code : 'UNKNOWN_FAILURE',
      retryability: ['retryable', 'not_retryable', 'unknown'].includes(input?.retryability) ? input.retryability : 'unknown',
      providerIssue: answer(input?.providerIssue),
      businessRejected: answer(input?.businessRejected),
      deadline: {
        causedFailure: answer(input?.deadline?.causedFailure),
        source: ['provider_timeout', 'renderer_timeout', 'unknown'].includes(input?.deadline?.source) ? input.deadline.source : null,
      },
      provider: {
        name: token(provider.name), model: token(provider.model),
        httpStatus: Number.isInteger(provider.httpStatus) && provider.httpStatus >= 100 && provider.httpStatus <= 599 ? provider.httpStatus : null,
        requestId: token(provider.requestId), errorCode: token(provider.errorCode, 96),
      },
      evidence: {
        exceptionType: EXCEPTION_TYPES.has(evidence.exceptionType) ? evidence.exceptionType : null,
        networkCode: NETWORK_CODES.has(evidence.networkCode) ? evidence.networkCode : null,
        validatorCodes: Array.isArray(evidence.validatorCodes) ? evidence.validatorCodes.map((value) => token(value, 96)).filter(Boolean).slice(0, 16) : [],
      },
      elapsedFromHandlerMs: Number.isFinite(input?.elapsedFromHandlerMs) ? Math.max(0, input.elapsedFromHandlerMs) : null,
    };
  } catch {
    // Hostile getters or malformed diagnostic values cannot replace an error.
    return sanitizeFailure({}, {});
  }
}

function getFailure(error) {
  if (!objectLike(error)) return null;
  const cached = store.get(error);
  if (cached) return cached;
  try {
    if (error.failure?.schemaVersion === SCHEMA_VERSION) {
      const clean = sanitizeFailure(error.failure);
      store.set(error, clean);
      return clean;
    }
  } catch { /* An error may be frozen or expose a throwing accessor. */ }
  return null;
}

function createFailureEnvelope(error, context = {}, overrides = {}) {
  const existing = getFailure(error);
  if (existing) return existing;
  let failure;
  try {
    failure = sanitizeFailure({
      schemaVersion: SCHEMA_VERSION,
      failureId: overrides.failureId || context.failureId,
      auditId: context.auditId, attemptId: context.attemptId, batchId: context.batchId,
      stage: overrides.stage, code: overrides.code, retryability: overrides.retryability,
      providerIssue: overrides.providerIssue, businessRejected: overrides.businessRejected,
      deadline: overrides.deadline || context.deadline,
      provider: overrides.provider || context.provider,
      evidence: { exceptionType: overrides.exceptionType || error?.name, networkCode: overrides.networkCode, validatorCodes: overrides.validatorCodes },
      elapsedFromHandlerMs: Number.isFinite(context.handlerStartedAt) ? Math.max(0, Date.now() - context.handlerStartedAt) : context.elapsedFromHandlerMs,
    }, context);
  } catch { failure = sanitizeFailure({}); }
  if (objectLike(error)) store.set(error, failure);
  return failure;
}

function attachFailure(error, context = {}, overrides = {}) {
  const failure = createFailureEnvelope(error, context, overrides);
  if (objectLike(error)) {
    try { Object.defineProperty(error, 'failure', { value: failure, enumerable: false, configurable: true }); } catch { /* WeakMap retains the evidence. */ }
  }
  return error;
}

module.exports = { SCHEMA_VERSION, NETWORK_CODES, sanitizeFailure, createFailureEnvelope, attachFailure, getFailure };
