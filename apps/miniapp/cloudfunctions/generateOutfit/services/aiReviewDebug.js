const crypto = require('crypto');

const LOG_PREFIX = '[xiaoda-review]';
const DEBUG_FIELDS = [
  'requestId',
  'action',
  'outfitKeyShort',
  'scene',
  'cacheDecision',
  'aiAttempted',
  'provider',
  'model',
  'providerConfigured',
  'providerRequestStarted',
  'providerRequestFinished',
  'providerStatus',
  'validatorResult',
  'validatorRejectReasons',
  'fallbackUsed',
  'fallbackReason',
  'saved',
  'errorCode',
];

function createAiReviewDebug({
  requestId,
  action,
  outfitKey,
  scene,
  provider,
  model,
} = {}) {
  return {
    requestId: limitText(requestId, 32) || createRequestId(),
    action: limitText(action, 32),
    outfitKeyShort: shortHash(outfitKey, 8),
    scene: limitText(scene, 24),
    cacheDecision: 'unknown',
    aiAttempted: false,
    provider: limitText(provider, 48),
    model: limitText(model, 64),
    providerConfigured: undefined,
    providerRequestStarted: false,
    providerRequestFinished: false,
    providerStatus: undefined,
    validatorResult: 'not_run',
    validatorRejectReasons: [],
    fallbackUsed: false,
    fallbackReason: '',
    saved: false,
    errorCode: '',
  };
}

function updateAiReviewDebug(debug, patch = {}) {
  if (!debug) return debug;
  for (const field of DEBUG_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(patch, field)) continue;
    debug[field] = sanitizeField(field, patch[field]);
  }
  return debug;
}

function toSafeAiReviewDebug(debug) {
  if (!debug || typeof debug !== 'object') return undefined;
  return DEBUG_FIELDS.reduce((safe, field) => {
    const value = sanitizeField(field, debug[field]);
    if (value !== undefined && value !== '') safe[field] = value;
    return safe;
  }, {});
}

// eslint-disable-next-line no-console
function logAiReviewDebug(event, debug, logger = console.log) {
  const safe = toSafeAiReviewDebug(debug);
  logger(LOG_PREFIX, event, safe);
}

function createRequestId() {
  return `xr_${crypto.randomBytes(6).toString('hex')}`;
}

function shortHash(value, length = 8) {
  if (!value) return '';
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, length);
}

function sanitizeField(field, value) {
  if (field === 'validatorRejectReasons') return sanitizeStringArray(value, 80);
  if (field === 'aiAttempted' || field === 'providerConfigured' || field === 'providerRequestStarted' || field === 'providerRequestFinished' || field === 'fallbackUsed' || field === 'saved') {
    return typeof value === 'boolean' ? value : undefined;
  }
  if (field === 'providerStatus') {
    const status = Number(value);
    return Number.isFinite(status) ? status : undefined;
  }
  if (field === 'outfitKeyShort') return limitText(value, 16);
  if (field === 'model') return limitText(value, 64);
  if (field === 'provider') return limitText(value, 48);
  return limitText(value, 80);
}

function sanitizeStringArray(value, maxLength) {
  return Array.isArray(value)
    ? value
        .filter((item) => typeof item === 'string' && item.trim())
        .map((item) => limitText(item, maxLength))
        .filter(Boolean)
        .slice(0, 8)
    : [];
}

function limitText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return Array.from(value.trim()).slice(0, maxLength).join('');
}

module.exports = {
  LOG_PREFIX,
  createAiReviewDebug,
  logAiReviewDebug,
  toSafeAiReviewDebug,
  updateAiReviewDebug,
};
