'use strict';

const {
  consumeProductionRendererStream,
} = require('./recommendationVoiceRendererProductionV2');

function now() {
  return typeof globalThis.performance?.now === 'function' ? globalThis.performance.now() : Date.now();
}

function metadataFrom(summary) {
  return {
    rendererVersion: summary?.version,
    promptVariant: summary?.promptVariant,
    providerCalls: Number(summary?.providerCalls || 0),
    requestCount: Number(summary?.requestCount || 0),
    planCount: Number(summary?.planCount || 0),
    validatedCount: Number(summary?.validatedCount || 0),
    invalidCount: Number(summary?.invalidCount || 0),
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
    summary = await consumeProductionRendererStream({
      ...rendererConfig,
      preparedEntries: [entry.preparedEntry],
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

module.exports = { renderFirstCardCanonical };
