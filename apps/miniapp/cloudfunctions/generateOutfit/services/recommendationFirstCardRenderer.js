'use strict';

const {
  consumeProductionRendererStream,
  buildProductionRequest,
  validateProductionCopy,
} = require('./recommendationVoiceRendererProductionV2');
const { loadDeployPackage } = require('./deployPackageResolver');

function defaultXiaodaAI() {
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
        promptVersion: 'voice-contract-v2.0-compressed-v2-production-1',
        model: 'qwen3.7-max',
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
  const xiaodaAI = rendererConfig.xiaodaAI || defaultXiaodaAI();
  try { rendererConfig.onAuditStage?.('PROVIDER_START', 'started'); } catch { /* audit is fail-open */ }
  const options = {
    ...rendererConfig.aiOptions,
    request,
    signal,
    model: 'qwen3.7-max',
    promptVariant: 'compressed-v2',
    promptVersion: 'voice-contract-v2.0-compressed-v2-production-1',
    rawResponse: true,
    timeoutMs: Number(rendererConfig.timeoutMs || 25000),
  };
  try {
    const result = await xiaodaAI.execute('recommendation_reason', entry.preparedEntry.input, options);
    try { rendererConfig.onAuditStage?.('PROVIDER_COMPLETE', 'completed'); } catch { /* audit is fail-open */ }
    return responseFromCoreResult(result);
  } catch (error) {
    try { rendererConfig.onAuditStage?.('PROVIDER_COMPLETE', 'failed'); } catch { /* audit is fail-open */ }
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
    return {
      status: 'failure',
      failureType: 'PROVIDER_FAIL',
      failureCode: 'FIRST_CARD_INPUT_INVALID',
      metadata: { providerCalls: 0, requestCount: 0, planCount: 0, validatedCount: 0, invalidCount: 0 },
      timing: timing(),
    };
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
          request: buildProductionRequest([entry.preparedEntry]),
          signal: options.signal,
        }),
      } : {}),
      // Keep this primitive pure: callbacks supplied by callers must not be
      // allowed to persist or dispatch while the interactive render is live.
      onValidated: async () => {},
      onInvalid: async () => {},
    });
  } catch (error) {
    return {
      status: 'failure',
      failureType: 'PROVIDER_FAIL',
      failureCode: String(error?.message || error || 'FIRST_CARD_PROVIDER_ERROR'),
      metadata: { providerCalls: 1, requestCount: 1, planCount: 1, validatedCount: 0, invalidCount: 0 },
      timing: timing(),
    };
  }

  const metadata = metadataFrom(summary);
  const copy = Array.isArray(summary?.validated) ? summary.validated[0] : undefined;
  if (summary?.status === 'completed' && summary?.validatedCount === 1 && copy) {
    try { rendererConfig.onAuditStage?.('VALIDATOR_COMPLETE', 'accepted'); } catch { /* audit is fail-open */ }
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
    try { rendererConfig.onAuditStage?.('VALIDATOR_COMPLETE', 'rejected'); } catch { /* audit is fail-open */ }
  }
  return {
    status: 'failure',
    failureType: validatorFailure ? 'VALIDATOR_FAIL' : 'PROVIDER_FAIL',
    failureCode: failureCodeFrom(summary, validatorFailure ? 'FIRST_CARD_VALIDATOR_FAIL' : 'FIRST_CARD_PROVIDER_FAIL'),
    usage: summary?.usage || null,
    metadata,
    timing: timing(),
    ...(validatorFailure ? { validatorFailures: summary.invalid } : {}),
  };
}

module.exports = { loadAiCore, renderFirstCardCanonical };
