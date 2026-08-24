'use strict';

const ACTION = 'voiceRendererLatencyLab';
const MODELS = Object.freeze({ max: 'qwen3.7-max', flash: 'qwen3.7-flash' });
const PROMPT_VARIANTS = Object.freeze(['current', 'compressed']);
const CASE_IDS = new Set([
  'primary-pattern-focus',
  'primary-silhouette-contrast',
  'primary-monochromatic',
  'scene-primary-work-structure',
  'weak-formality-only',
  'sparse-low-confidence-pattern',
  'sparse-basic-no-evidence',
  'competing-pattern-and-silhouette',
]);

exports.main = async function main(event = {}) {
  try {
    assertEvent(event);
    const credentialVariable = process.env.BAILIAN_API_KEY
      ? 'BAILIAN_API_KEY'
      : process.env.DASHSCOPE_API_KEY
        ? 'DASHSCOPE_API_KEY'
        : null;
    if (!credentialVariable) throw Object.assign(new Error('LAB_CREDENTIAL_MISSING'), { code: 'LAB_CREDENTIAL_MISSING' });
    return {
      benchmarkOnly: true,
      action: ACTION,
      status: 'credential_present_contract_only',
      caseId: event.caseId,
      model: MODELS[event.model],
      promptVariant: event.promptVariant,
      nonThinking: true,
      structuredOutput: event.promptVariant === 'compressed' ? 'json_object' : 'strict_json_array',
      credentialVariable,
      callsExecuted: 0,
      providerCall: 'disabled_by_safety_gate',
    };
  } catch (error) {
    return {
      benchmarkOnly: true,
      action: ACTION,
      status: 'failed',
      errorCode: safeErrorCode(error),
    };
  }
};

function assertEvent(event) {
  const allowed = new Set(['caseId', 'model', 'promptVariant', 'input', 'execute']);
  for (const key of Object.keys(event || {})) if (!allowed.has(key)) throw new Error(`EVENT_KEY_NOT_ALLOWED:${key}`);
  if (typeof event.caseId !== 'string' || !CASE_IDS.has(event.caseId)) throw new Error('CASE_ID_NOT_ALLOWED');
  if (!Object.hasOwn(MODELS, event.model)) throw new Error('MODEL_NOT_ALLOWED');
  if (!PROMPT_VARIANTS.includes(event.promptVariant)) throw new Error('PROMPT_VARIANT_NOT_ALLOWED');
  if (!event.input || typeof event.input !== 'object' || Array.isArray(event.input)) throw new Error('INPUT_OBJECT');
  if (event.execute !== undefined && event.execute !== false) throw new Error('REAL_CALLS_DISABLED');
}

function safeErrorCode(error) {
  const code = typeof error?.code === 'string' ? error.code : String(error?.message || 'LAB_FAILED');
  return code.replace(/[^A-Z0-9_.:-]/gi, '_').slice(0, 80);
}

exports.__test = { ACTION, MODELS, PROMPT_VARIANTS, CASE_IDS, assertEvent };
