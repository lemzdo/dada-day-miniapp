'use strict';

const {
  consumeProductionRendererStream,
  buildProductionRequest,
  PRODUCTION_MODEL,
  PRODUCTION_PROMPT_VERSION,
  validateProductionCopy,
} = require('./recommendationVoiceRendererProductionV2');
const { loadDeployPackage } = require('./deployPackageResolver');
const { createFailureEnvelope, describeFailure, providerMetadata, emitAudit } = require('./firstCardObservability');

function defaultXiaodaAI(failureContext) {
  // Keep the dependency lazy so local parser/validator tests can continue to
  // inject fetch without requiring a deploy-time package installation.
  try {
    const core = loadAiCore();
    const registry = core.registry || core;
    // Bind the frozen production prompt/validator once. The renderer remains
    // the source of truth for streaming validation; these bindings make the
    // task registry metadata executable without changing that behavior.
    if (!registry.getPrompt?.('recommendation_reason')) {
      registry.registerPrompt?.('recommendation_reason', (input) => buildProductionRequest([{ input }]), {
        promptVariant: 'compressed-v2',
        promptVersion: PRODUCTION_PROMPT_VERSION,
        model: PRODUCTION_MODEL,
      });
    }
    if (!registry.getValidator?.('recommendation_production')) {
      registry.registerValidator?.('recommendation_production', (result, input) => {
        const copies = Array.isArray(result?.copies) ? result.copies : [];
        if (!copies.length) return true;
        return copies.every((copy) => validateProductionCopy(copy, input, [{ input }]).pass);
      });
    }
    if (registry.getTask?.('recommendation_reason') && !registry.getTask('recommendation_reason').validator) {
      registry.mapValidator?.('recommendation_reason', 'recommendation_production');
    }
    return core.xiaodaAI;
  } catch (error) {
    const wrapped = new Error(`AI_CORE_UNAVAILABLE:${error?.message || error}`);
    wrapped.cause = error;
    createFailureEnvelope(wrapped, failureContext || {}, { stage: 'ai_core', code: 'AI_CORE_UNAVAILABLE', providerIssue: 'no', businessRejected: 'no', deadline: { causedFailure: 'no', source: null } });
    throw wrapped;
  }
}

function loadAiCore() {
  // CloudBase may materialize file: dependencies as non-loadable link
  // placeholders. The deployment staging always carries this vendor copy.
  return loadDeployPackage('@d1d/ai-core', ['..', 'vendor', 'ai-core']);
}

function responseFromCoreResult(result) {
  const response = result?.response || result;
  if (response?.body && (response.status === undefined || response.status < 400)) {
    if (typeof response.__cancelDeadline !== 'function') return response;
    const body = response.body;
    return {
      ...response,
      __failureProvider: providerMetadata(response),
      body: (async function* stream() {
        try {
          for await (const chunk of body) yield chunk;
        } finally {
          response.__cancelDeadline();
        }
      }()),
    };
  }
  const text = typeof response?.text === 'string' ? response.text : '';
  return {
    status: 200,
    __failureProvider: providerMetadata(response),
    body: (async function* stream() {
      try {
        yield `data: ${JSON.stringify({ choices: [{ delta: { content: text } }], usage: response?.usage || null })}\n`;
        yield 'data: [DONE]\n';
      } finally {
        if (typeof response?.__cancelDeadline === 'function') response.__cancelDeadline();
      }
    }()),
  };
}

async function invokeRecommendationReason({ entry, rendererConfig, request, signal }) {
  const xiaodaAI = rendererConfig.xiaodaAI || defaultXiaodaAI(rendererConfig.failureContext);
  emitAudit(rendererConfig.onAuditStage, 'PROVIDER_START', 'started', { attemptId: rendererConfig.failureContext?.attemptId });
  const options = {
    ...rendererConfig.aiOptions,
    request,
    signal,
    model: request.model,
    promptVariant: 'compressed-v2',
    promptVersion: PRODUCTION_PROMPT_VERSION,
    rawResponse: true,
    timeoutMs: Number(rendererConfig.timeoutMs || 25000),
    failureContext: rendererConfig.failureContext || {},
  };
  try {
    const result = await xiaodaAI.execute('recommendation_reason', entry.preparedEntry.input, options);
    emitAudit(rendererConfig.onAuditStage, 'RESPONSE_HEADERS', 'received');
    emitAudit(rendererConfig.onAuditStage, 'PROVIDER_HEADERS', 'received');
    return responseFromCoreResult(result);
  } catch (error) {
    const failure = describeFailure(error, rendererConfig.failureContext || {}, { stage: 'request', provider: { name: 'dashscope', model: request.model } });
    emitAudit(rendererConfig.onAuditStage, 'PROVIDER_COMPLETE', 'failed', { failure });
    throw error;
  }
}

function now() {
  return typeof globalThis.performance?.now === 'function' ? globalThis.performance.now() : Date.now();
}

function metadataFrom(summary) {
  const stream = summary?.stream && typeof summary.stream === 'object' ? {
    chunkCount: Number(summary.stream.chunkCount || 0),
    firstChunkBytes: Number(summary.stream.firstChunkBytes || 0),
    lastChunkBytes: Number(summary.stream.lastChunkBytes || 0),
    rawLength: Number(summary.stream.rawLength || 0),
    finishReason: typeof summary.stream.finishReason === 'string' ? summary.stream.finishReason : null,
    doneReceived: summary.stream.doneReceived === true,
    parseErrorCount: Number(summary.stream.parseErrorCount || 0),
    errorEventCount: Number(summary.stream.errorEventCount || 0),
  } : null;
  return {
    rendererVersion: summary?.version,
    promptVariant: summary?.promptVariant,
    providerCalls: Number(summary?.providerCalls || 0),
    requestCount: Number(summary?.requestCount || 0),
    planCount: Number(summary?.planCount || 0),
    validatedCount: Number(summary?.validatedCount || 0),
    invalidCount: Number(summary?.invalidCount || 0),
    ...(stream ? { stream } : {}),
  };
}

function failureCodeFrom(summary, fallback) {
  return typeof summary?.failureCode === 'string' && summary.failureCode
    ? summary.failureCode
    : fallback;
}

/**
 * Render exactly one prepared card-0 entry through the production renderer.
 * This adapter deliberately owns no persistence, event dispatch, fallback, or
 * response timing. Those decisions remain with the interactive orchestrator.
 */
async function renderFirstCardCanonical({ entry, rendererConfig = {} } = {}) {
  const startedAt = now();
  const timing = () => {
    const completedAt = now();
    return { startedAt, completedAt, durationMs: Math.max(0, completedAt - startedAt) };
  };

  if (!entry || !entry.preparedEntry) {
    const result = {
      status: 'failure',
      failureType: 'PROVIDER_FAIL',
      failureCode: 'FIRST_CARD_INPUT_INVALID',
      metadata: { providerCalls: 0, requestCount: 0, planCount: 0, validatedCount: 0, invalidCount: 0 },
      timing: timing(),
    };
    result.failure = createFailureEnvelope(new Error(result.failureCode), rendererConfig.failureContext || {}, { stage: 'admission', code: 'ADMISSION_FAILED', retryability: 'not_retryable', providerIssue: 'no', businessRejected: 'no', deadline: { causedFailure: 'no', source: null } });
    emitAudit(rendererConfig.onAuditStage, 'EXECUTION_COMPLETE', 'failed', { failure: result.failure });
    return result;
  }

  let summary;
  try {
    const useCore = rendererConfig.xiaodaAI || !rendererConfig.fetchImpl;
    summary = await consumeProductionRendererStream({
      ...rendererConfig,
      preparedEntries: [entry.preparedEntry],
      ...(useCore ? {
        // The core owns transport/provider policy; this tiny adapter retains
        // the production renderer's existing stream parser and validator.
        invoke: (options) => invokeRecommendationReason({
          entry,
          rendererConfig,
          request: buildProductionRequest([entry.preparedEntry], { model: rendererConfig.model }),
          signal: options.signal,
        }),
      } : {}),
      // Keep this primitive pure: callbacks supplied by callers must not be
      // allowed to persist or dispatch while the interactive render is live.
      onValidated: async () => {},
      onInvalid: async () => {},
      stopAfterAllValidated: true,
      failureContext: rendererConfig.failureContext || {},
    });
  } catch (error) {
    const result = {
      status: 'failure',
      failureType: 'PROVIDER_FAIL',
      failureCode: String(error?.message || error || 'FIRST_CARD_PROVIDER_ERROR'),
      metadata: { providerCalls: 1, requestCount: 1, planCount: 1, validatedCount: 0, invalidCount: 0 },
      timing: timing(),
    };
    result.failure = describeFailure(error, rendererConfig.failureContext || {}, { stage: 'request' });
    emitAudit(rendererConfig.onAuditStage, 'EXECUTION_COMPLETE', 'failed', { failure: result.failure });
    return result;
  }

  const metadata = metadataFrom(summary);
  const copy = Array.isArray(summary?.validated) ? summary.validated[0] : undefined;
  if (summary?.status === 'completed' && summary?.validatedCount === 1 && copy) {
    emitAudit(rendererConfig.onAuditStage, 'VALIDATOR_COMPLETE', 'accepted');
    emitAudit(rendererConfig.onAuditStage, 'EXECUTION_COMPLETE', 'succeeded');
    return {
      status: 'success',
      validatedCopy: copy,
      copy,
      usage: summary.usage || null,
      metadata,
      timing: timing(),
    };
  }

  const validatorFailure = Number(summary?.invalidCount || 0) > 0;
  if (validatorFailure) {
    emitAudit(rendererConfig.onAuditStage, 'VALIDATOR_COMPLETE', 'rejected', { failure: summary.failure });
  }
  const result = {
    status: 'failure',
    failureType: validatorFailure ? 'VALIDATOR_FAIL' : 'PROVIDER_FAIL',
    failureCode: failureCodeFrom(summary, validatorFailure ? 'FIRST_CARD_VALIDATOR_FAIL' : 'FIRST_CARD_PROVIDER_FAIL'),
    usage: summary?.usage || null,
    metadata,
    timing: timing(),
    ...(validatorFailure ? { validatorFailures: summary.invalid } : {}),
  };
  result.failure = summary?.failure || createFailureEnvelope(new Error(result.failureCode), rendererConfig.failureContext || {}, {
    stage: validatorFailure ? 'validation' : 'output_parse',
    code: validatorFailure ? 'VALIDATION_REJECTED' : 'OUTPUT_INCOMPLETE',
    businessRejected: validatorFailure ? 'yes' : 'no',
  });
  emitAudit(rendererConfig.onAuditStage, 'EXECUTION_COMPLETE', 'failed', { failure: result.failure });
  return result;
}

module.exports = { loadAiCore, renderFirstCardCanonical };
