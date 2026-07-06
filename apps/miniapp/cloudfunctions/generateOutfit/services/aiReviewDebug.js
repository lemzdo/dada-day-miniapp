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
  'validatorTrace',
  'aiRawSummary',
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
    validatorTrace: [],
    aiRawSummary: undefined,
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
  if (field === 'validatorTrace') return sanitizeValidatorTrace(value);
  if (field === 'aiRawSummary') return sanitizeAiRawSummary(value);
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

function createAiRawSummary({
  providerReturned,
  statusCode,
  rawText,
  parsedJson,
  parseErrorCode,
  parsedValue,
} = {}) {
  const overallComment = typeof parsedValue?.overallComment === 'string' ? parsedValue.overallComment : '';
  const advice = typeof parsedValue?.advice === 'string' ? parsedValue.advice : '';
  return sanitizeAiRawSummary({
    providerReturned: Boolean(providerReturned),
    statusCode,
    rawTextPreview: sanitizePreview(rawText, 200),
    parsedJson: Boolean(parsedJson),
    parseErrorCode,
    fields: {
      hasOverallComment: Boolean(overallComment.trim()),
      hasAdvice: Boolean(advice.trim()),
      overallCommentLength: Array.from(overallComment.trim()).length,
      adviceLength: Array.from(advice.trim()).length,
    },
    overallCommentPreview: sanitizePreview(overallComment, 120),
    advicePreview: sanitizePreview(advice, 120),
  });
}

function sanitizeAiRawSummary(value) {
  if (!value || typeof value !== 'object') return undefined;
  const fields = value.fields && typeof value.fields === 'object' ? value.fields : {};
  const statusCode = Number(value.statusCode);
  return {
    providerReturned: typeof value.providerReturned === 'boolean' ? value.providerReturned : undefined,
    statusCode: Number.isFinite(statusCode) ? statusCode : undefined,
    rawTextPreview: sanitizePreview(value.rawTextPreview, 200),
    parsedJson: typeof value.parsedJson === 'boolean' ? value.parsedJson : undefined,
    parseErrorCode: limitText(value.parseErrorCode, 48),
    fields: {
      hasOverallComment: Boolean(fields.hasOverallComment),
      hasAdvice: Boolean(fields.hasAdvice),
      overallCommentLength: toSafeCount(fields.overallCommentLength),
      adviceLength: toSafeCount(fields.adviceLength),
    },
    overallCommentPreview: sanitizePreview(value.overallCommentPreview, 120),
    advicePreview: sanitizePreview(value.advicePreview, 120),
  };
}

function sanitizeValidatorTrace(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      return {
        check: limitText(entry.check, 48),
        pass: typeof entry.pass === 'boolean' ? entry.pass : false,
        code: limitText(entry.code, 64),
        detail: sanitizePreview(entry.detail, 120),
      };
    })
    .filter((entry) => entry && entry.check)
    .slice(0, 20);
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

function sanitizePreview(value, maxLength) {
  if (typeof value !== 'string') return '';
  return limitText(redactSensitiveText(value).replace(/\s+/g, ' '), maxLength);
}

function redactSensitiveText(value) {
  return String(value)
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[redacted-key]')
    .replace(/\b(?:cloud|wxfile):\/\/[^\s"'，,。)）]+/gi, '[redacted-url]')
    .replace(/\bhttps?:\/\/[^\s"'，,。)）]+/gi, '[redacted-url]')
    .replace(/\b(?:OPENID|openid|openId|fileID|fileId|imageUrl|image_url|apiKey|api_key|prompt)\s*[:=]\s*["']?[^"',\s}]+["']?/g, '$1=[redacted]')
    .replace(/"?(?:OPENID|openid|openId|fileID|fileId|imageUrl|image_url|apiKey|api_key|prompt)"?\s*:\s*"[^"]*"/g, '"redacted":"[redacted]"');
}

function toSafeCount(value) {
  const count = Number(value);
  if (!Number.isFinite(count)) return 0;
  return Math.max(0, Math.min(1000, Math.round(count)));
}

function limitText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return Array.from(value.trim()).slice(0, maxLength).join('');
}

module.exports = {
  LOG_PREFIX,
  createAiRawSummary,
  createAiReviewDebug,
  logAiReviewDebug,
  toSafeAiReviewDebug,
  updateAiReviewDebug,
};
