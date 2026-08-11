'use strict';

// Selector-driven Recommendation V6 evidence runner. Every captured card is
// addressed by its active 1 / N counter and is stable before a Windows native
// screenshot of the complete DevTools window is taken.

const fs = require('fs');
const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const path = require('path');
const {
  resolveRunnerConfig,
  RunnerConfigError,
  AUTOMATOR_WS_ENDPOINT,
} = require('./runner-preflight-resolver.cjs');
const directSessionTools = require('./devtools-direct-session');
const ensureDevToolsDirectSession = directSessionTools.ensureDevToolsDirectSession;
const summarizeCloudResponse = directSessionTools.summarizeCloudResponse || ((response) => {
  const data = response?.data && typeof response.data === 'object' ? response.data : null;
  return {
    rawResponseBytes: Buffer.byteLength(JSON.stringify(response ?? null), 'utf8'),
    businessDataBytes: Buffer.byteLength(JSON.stringify(data ?? null), 'utf8'),
    responseTopLevelKeys: Object.keys(response || {}),
    dataTopLevelKeys: Object.keys(data || {}),
    auditId: data?.debug?.auditId || data?.meta?.auditId || null,
    performanceLedger: data?.diagnostics?.performance || null,
  };
});
const extractPerformanceLedger = directSessionTools.extractPerformanceLedger || ((response) => {
  const data = response?.data && typeof response.data === 'object' ? response.data : null;
  if (!data?.diagnostics?.performance) {
    const error = new Error('response does not contain data.diagnostics.performance');
    error.code = 'PERFORMANCE_LEDGER_MISSING';
    error.details = { responseTopLevelKeys: Object.keys(response || {}), dataTopLevelKeys: Object.keys(data || {}) };
    throw error;
  }
  return data.diagnostics.performance;
});
const unicodeInputPreflight = directSessionTools.unicodeInputPreflight || (async () => ({ status: 'UNICODE_INPUT_PREFLIGHT_PASS' }));
const {
  assertRecommendationCountContract,
  assertReturnedCardCount,
} = require('../cloudfunctions/generateOutfit/shared/countContract');

let EVIDENCE_DIR = process.env.EVIDENCE_DIR;
let AUTOMATOR_MODULE_PATH = process.env.MINIPROGRAM_AUTOMATOR_PATH;
const WINDOWS_CAPTURE_HELPER = path.join(__dirname, 'windows-devtools-capture.ps1');
const EXPECTED_CLOUD_BUILD = 'generateOutfit-copy-natural-language-v4-20260811';
const EXPECTED_QA_VERSION = 'qa-batch-audit-v6-1-semantic-presentation';
const PRESENTATION_EVIDENCE_MODE = 'sanitized_v1';
const PRESENTATION_EVIDENCE_VERSION = 'presentation-evidence-v3';
const PRESENTATION_EVIDENCE_MAX_BYTES = 24 * 1024;
const PRESENTATION_EVIDENCE_FILE = 'production-presentation-evidence.json';
const PRESENTATION_EVIDENCE_FILES = Object.freeze({
  initial: 'production-presentation-evidence-initial.json',
  refresh: 'production-presentation-evidence-refresh.json',
});
const SCRIPT_VERSION = 'recommendation-v6-e2e-windows-native-v1.0.0';
const SCREENSHOT_PROVIDER = 'windows-native-primary-screen';
const MIN_SCREENSHOT_WIDTH = 200;
const MIN_SCREENSHOT_HEIGHT = 300;
const CARD_VISUAL_STABILITY_SAMPLE_INTERVAL_MS = 200;
const CARD_VISUAL_STABILITY_MIN_INTERVAL_MS = 500;
const CARD_VISUAL_STABILITY_RENDER_BUFFER_MS = 400;
const CARD_VISUAL_STABILITY_TIMEOUT_MS = 30000;
const TODAY_PAGE_PATH = 'pages/today/index';
const TODAY_RELAUNCH_URL = '/pages/today/index';
const PRECONDITION_NOT_CLEAN = 'PRECONDITION_NOT_CLEAN';
const PRECONDITION_HOOK_NOT_FRESH = 'PRECONDITION_HOOK_NOT_FRESH';
const RESET_BLOCKER_REGISTRY = '__recommendationV61RunnerResetBlocker';
const RESET_SETTLE_MS = 1000;
const USER_STORAGE_PREFIX = 'd1d:userStorage:v1';
const TODAY_RESTORE_SNAPSHOT_BUSINESS_KEY = 'today:outfitReturnSnapshot:recommendation-copy-contract-v7';
const TODAY_SCENE_SNAPSHOT_BUSINESS_PREFIX = 'today:sceneSnapshot:recommendation-copy-contract-v7';
const FULL_COMPUTE_SAVE_STATUSES = new Set(['saved', 'skipped_oversize', 'write_failed', 'write_timeout']);
const GENERATION_TIMING_KEYS = ['compositionMs', 'canonicalizeMs', 'eligibilityMs', 'scoringMs'];
const QA_OBSERVATION_STATUSES = new Set(['authoritative', 'partial', 'not_observed']);
const QA_AUTHORITATIVE_FIELDS = Object.freeze([
  'version', 'counts', 'qaGatePassed', 'gateStatus', 'qaBlockReasons', 'duplicateCause',
  'syntheticSuffixCount', 'unsupportedClaimCount',
  'finalCardCount', 'alternativeCandidateCount',
  'placeholderTitleCount', 'availableDifferentiatorCount', 'titleDuplicateWarningCount',
  'tagSceneMismatchCount', 'cardConsistencyFailures', 'qaTruncated',
]);
const QA_GATE_COUNT_KEYS = Object.freeze(['candidate', 'generated', 'accepted', 'rejected', 'selected']);
const ELIGIBILITY_AUDIT_KEYS = new Set([
  'version', 'generatedCount', 'guardEnteredCount', 'guardAcceptedCount', 'guardRejectedCount',
  'rejectionStageHistogram', 'rejectionReasonHistogram', 'rejectionReasonCombinationHistogram',
  'categoryDistribution', 'samples', 'truncated', 'serializedBytes',
]);
const ELIGIBILITY_SAMPLE_KEYS = new Set([
  'sampleIndex', 'rejectionStage', 'rejectionCodes', 'top', 'bottom', 'shoes', 'roleCompleteness', 'weather',
]);
const ELIGIBILITY_FACT_KEYS = new Set([
  'isTshirtLike', 'isShorts', 'isSportShoe', 'isCleanSneaker', 'isHomeShoe', 'isSlipperLike', 'isCrocsLike',
  'isSportDress', 'isNormalDress', 'isSkirtLike', 'sportApparelEvidence', 'sportCompatibleTop',
  'sportBottomEvidence', 'invalidSportShoe', 'hasSportSignal', 'hasSportVisibleFact', 'suitableSportShoe',
]);
const LIFECYCLE_PRIMITIVE_KEYS = new Set([
  'auditId', 'seq', 'sceneKey', 'scene', 'trigger', 'slot', 'cloudBuild', 'version', 'presentationEvidenceVersion', 'executionMode', 'cacheHit',
  'cacheMissReason', 'candidatePoolSaveStatus', 'candidatePoolSaveReason', 'candidatePoolIdentityHash',
  'candidatePoolAgeMs', 'candidatePoolSerializedBytes', 'candidatePoolChunkCount', 'candidatePoolManifestBytes',
  'candidatePoolChunksBytes', 'recommendationBatchIdPresent', 'recommendationBatchIdLength',
  'candidatePoolCleanupAttempted', 'candidatePoolCleanupDeletedCount', 'candidatePoolCleanupFailedCount',
  'requestedCandidatePoolIdPresent', 'requestedCandidatePoolIdLength', 'exclusionsAppliedCount',
  'requestedExcludedCount', 'actualExcludedCandidateCount', 'remainingCandidateCount', 'fallbackReasonCount',
  'finalCardCount', 'alternativeCandidateCount', 'placeholderTitleCount', 'syntheticSuffixCount',
  'availableDifferentiatorCount', 'titleDuplicateWarningCount', 'unsupportedClaimCount',
  'qaGatePassed', 'gateStatus', 'duplicateCause', 'tagSceneMismatchCount', 'cardConsistencyFailures',
  'presentationFactSignatureHash', 'primaryRelationCode', 'reasonSemanticSkeleton', 'titleSemanticSkeleton',
  'semanticEquivalentGroupCount', 'qaEnabled', 'qaTruncated', 'outfitCount', 'imageTimeout', 'cloudRoundTripMs',
  'code', 'errorCode', 'errorMessage', 'message', 'reason', 'rejectCode', 'rejectReason',
  'clientApplyMs', 'imageReadyMs', 'requestedImageCount', 'resolvedImageCount',
]);
const LIFECYCLE_MAP_KEYS = new Set(['counts', 'timings', 'responseBytes', 'clientTimings']);
const LIFECYCLE_HISTOGRAM_KEYS = new Set(['rejectionReasonHistogram', 'archetypeHistogram']);
const LIFECYCLE_ARRAY_KEYS = new Set([
  'exactTitleDuplicateGroups', 'normalizedTitleDuplicateGroups',
  'exactReasonDuplicateGroups', 'normalizedReasonDuplicateGroups', 'titleTokenDuplicateGroups',
  'qaBlockReasons', 'reuseExplanations',
]);
const COUNT_CONTRACT_KEYS = Object.freeze([
  'requestedBatchSize',
  'expectedCardCount',
  'returnedCardCount',
  'remainingUniqueBeforeConsume',
  'remainingUniqueAfterConsume',
  'tailBatchAuthorized',
  'poolExhaustedAfterConsume',
  'executionMode',
  'candidatePoolId',
]);

function buildRunnerConfig(env = process.env) {
  return {
    evidenceOnly: env.EVIDENCE_ONLY === 'true' || env.PRESENTATION_EVIDENCE_ONLY === 'true',
    capturePresentationEvidence: env.CAPTURE_PRESENTATION_EVIDENCE === 'true',
    preconditionOnly: env.PRECONDITION_ONLY === 'true',
    preflightOnly: (process.argv?.slice?.(2) || []).includes('--preflight-only') || env.PRECONDITION_ONLY === 'true',
    windowHandle: env.D1D_DEVTOOLS_HWND || env.D1D_WINDOW_HANDLE || env.WINDOW_HANDLE || null,
    screenshotProvider: env.SCREENSHOT_PROVIDER || SCREENSHOT_PROVIDER,
    automatorWsEndpoint: env.AUTOMATOR_WS_ENDPOINT || AUTOMATOR_WS_ENDPOINT,
  };
}

let RUNNER_CONFIG = buildRunnerConfig();
let RESOLVED_RUNNER_CONFIG = null;
let automator = null;
function createPresentationCaptureDiagnostics(overrides = {}) {
  return {
    captureHookInstalled: false,
    captureHookTarget: null,
    captureGeneration: null,
    previousCaptureGeneration: null,
    generationFresh: false,
    requestBufferCount: 0,
    targetDiagnostics: [],
    availableTargets: [],
    installedTargets: [],
    unavailableTargets: [],
    failedTargets: [],
    installedTargetCount: 0,
    handshakeStatus: 'not_started',
    requestIntercepted: false,
    actualInterceptedTarget: null,
    slot: null,
    responseIntercepted: false,
    responseSettled: false,
    responseRejected: false,
    rejectionCode: null,
    rejectionMessage: null,
    injectedPresentationEvidenceMode: null,
    capturedResponseAuditId: null,
    ...overrides,
  };
}
const state = {
  startedAt: new Date().toISOString(),
  failed: false,
  lifecycle: [],
  sanitizedLifecycle: [],
  cards: [],
  errors: [],
  matrix: [],
  manual: [],
  todayDetail: null,
  screenshotSequence: 0,
  mini: null,
  windowsCaptureExecFileSync: null,
  versionMismatchAudits: new Set(),
  presentationEvidence: null,
  presentationEvidenceArtifacts: { initial: null, refresh: null },
  qaArtifacts: { initial: null, refresh: null },
  requestCaptures: [],
  runtimeCaptures: new Map(),
  presentationCaptureInstalled: false,
  presentationCaptureDiagnostics: createPresentationCaptureDiagnostics(),
  requestSlots: new Map(),
  refreshClickCount: 0,
  hasRealRequest: false,
  unicodeInputPreflight: null,
  preflightReady: null,
  runnerBlocked: null,
  visualStabilityTimeoutMs: CARD_VISUAL_STABILITY_TIMEOUT_MS,
  visualStabilitySampleIntervalMs: CARD_VISUAL_STABILITY_SAMPLE_INTERVAL_MS,
  visualStabilityMinIntervalMs: CARD_VISUAL_STABILITY_MIN_INTERVAL_MS,
  visualStabilityRenderBufferMs: CARD_VISUAL_STABILITY_RENDER_BUFFER_MS,
  responseArtifacts: { initial: null, refresh: null },
  sportPrecondition: {
    status: 'not_observed',
    before: null,
    reset: null,
    after: null,
    hookReadyAfterReset: null,
  },
  acceptanceBaseline: null,
  recommendationCacheReset: null,
  sportAction: {
    status: 'not_observed',
    startedAt: null,
    lifecycleStartIndex: null,
    before: null,
    after: null,
    tapResult: 'NOT_OBSERVED',
    tapError: null,
    waitStartedAt: null,
    waitEndedAt: null,
  },
};

function applyResolvedRunnerConfig(config) {
  RESOLVED_RUNNER_CONFIG = config;
  EVIDENCE_DIR = config.evidenceDir;
  AUTOMATOR_MODULE_PATH = config.automatorModulePath;
  RUNNER_CONFIG = {
    ...buildRunnerConfig(),
    evidenceOnly: config.evidenceOnly,
    capturePresentationEvidence: config.capturePresentationEvidence,
    preconditionOnly: config.preflightOnly,
    preflightOnly: config.preflightOnly,
    windowHandle: config.windowHandle,
    screenshotProvider: config.screenshotProvider,
    automatorWsEndpoint: config.automatorWsEndpoint,
  };
}

function configFailureDetails(caught) {
  return {
    issues: Array.isArray(caught?.issues) ? caught.issues : [],
    resolvedConfigHash: RESOLVED_RUNNER_CONFIG?.configHash || null,
  };
}

function now() { return new Date().toISOString(); }
function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function relative(file) { return path.relative(EVIDENCE_DIR, file).replace(/\\/g, '/'); }
function writeJson(file, value) { fs.writeFileSync(path.join(EVIDENCE_DIR, file), JSON.stringify(value, null, 2) + '\n', 'utf8'); }
function writeJsonl(file, rows) { fs.writeFileSync(path.join(EVIDENCE_DIR, file), rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8'); }
function writeText(file, value) { fs.writeFileSync(path.join(EVIDENCE_DIR, file), value, 'utf8'); }

function responsePayloadByteBreakdown(value, limit = 20) {
  const rows = [];
  const visit = (current, prefix) => {
    if (!current || typeof current !== 'object') return;
    for (const [key, child] of Object.entries(current)) {
      const childPath = `${prefix}.${key}`;
      rows.push({ path: childPath, bytes: Buffer.byteLength(JSON.stringify(child ?? null), 'utf8') });
      if (child && typeof child === 'object' && !Array.isArray(child)) visit(child, childPath);
      if (Array.isArray(child)) child.forEach((item, index) => {
        const itemPath = `${childPath}[${index + 1}]`;
        rows.push({ path: itemPath, bytes: Buffer.byteLength(JSON.stringify(item ?? null), 'utf8') });
        if (item && typeof item === 'object' && !Array.isArray(item)) visit(item, itemPath);
      });
    }
  };
  visit(value, 'response');
  return rows.sort((left, right) => right.bytes - left.bytes || left.path.localeCompare(right.path)).slice(0, limit);
}

function runnerInvocationEvidence() {
  return {
    node: {
      argv: process.argv.slice(2),
      cwd: process.cwd(),
      execPath: process.execPath,
      pid: process.pid,
    },
    environment: {
      EVIDENCE_DIR: process.env.EVIDENCE_DIR || null,
      D1D_DEVTOOLS_HWND: process.env.D1D_DEVTOOLS_HWND || null,
      SCREENSHOT_PROVIDER: process.env.SCREENSHOT_PROVIDER || null,
      CAPTURE_PRESENTATION_EVIDENCE: process.env.CAPTURE_PRESENTATION_EVIDENCE || null,
      EVIDENCE_ONLY: process.env.EVIDENCE_ONLY || null,
      PRESENTATION_EVIDENCE_ONLY: process.env.PRESENTATION_EVIDENCE_ONLY || null,
      PRECONDITION_ONLY: process.env.PRECONDITION_ONLY || null,
      D1D_WINDOW_HANDLE: process.env.D1D_WINDOW_HANDLE || null,
      WINDOW_HANDLE: process.env.WINDOW_HANDLE || null,
      AUTOMATOR_WS_ENDPOINT: process.env.AUTOMATOR_WS_ENDPOINT || null,
      MINIPROGRAM_AUTOMATOR_PATH: process.env.MINIPROGRAM_AUTOMATOR_PATH || null,
      D1D_RUNNER_RESOLVED_CONFIG_JSON_SHA256: process.env.D1D_RUNNER_RESOLVED_CONFIG_JSON
        ? crypto.createHash('sha256').update(process.env.D1D_RUNNER_RESOLVED_CONFIG_JSON, 'utf8').digest('hex')
        : null,
    },
  };
}

function assertRunnerArgv(argv) {
  const invalid = argv.filter((argument) => typeof argument !== 'string' || argument.length === 0);
  if (invalid.length > 0) {
    throw new RunnerConfigError([{
      field: 'argv',
      code: 'RUNNER_ARGV_INVALID',
      message: 'Node process.argv must not contain null, undefined, or empty-string arguments',
      details: { invalidCount: invalid.length },
    }]);
  }
}

function readPngDimensions(file) {
  const bytes = fs.readFileSync(file);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature)) {
    throw gateError('SCREENSHOT_INVALID', 'Windows native screenshot is not a PNG');
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width < MIN_SCREENSHOT_WIDTH || height < MIN_SCREENSHOT_HEIGHT) {
    throw gateError('SCREENSHOT_INVALID', `unexpected primary screen screenshot dimensions ${width}x${height}`);
  }
  return { width, height };
}

function parseWindowsCaptureJson(value) {
  const lines = String(value || '').trim().split(/\r?\n/).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try { return JSON.parse(lines[index]); } catch {}
  }
  return null;
}

function captureWindowsDevToolsScreenshot(file, metadata = {}) {
  if (fs.existsSync(file)) throw gateError('SCREENSHOT_OVERWRITE_REFUSED', `refusing to overwrite screenshot ${file}`);
  if (!fs.existsSync(WINDOWS_CAPTURE_HELPER)) {
    throw gateError('SCREENSHOT_HELPER_MISSING', `Windows capture helper is missing: ${WINDOWS_CAPTURE_HELPER}`);
  }

  const execute = state.windowsCaptureExecFileSync || childProcess.execFileSync;
  let stdout = '';
  const helperArgs = [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    WINDOWS_CAPTURE_HELPER,
    '-OutputPath',
    file,
  ];
  if (RUNNER_CONFIG.windowHandle) {
    helperArgs.push('-WindowHandle', String(RUNNER_CONFIG.windowHandle));
  }
  try {
    stdout = execute('powershell.exe', helperArgs, { encoding: 'utf8', timeout: 45000, windowsHide: true });
  } catch (caught) {
    const helperResult = parseWindowsCaptureJson(caught?.stdout);
    const code = helperResult?.errorCode || 'SCREENSHOT_FAILED';
    const failure = gateError(code, helperResult?.errorMessage || caught?.message || `${metadata.label || 'screenshot'} Windows capture failed`);
    failure.details = {
      ...(helperResult || {}),
      stderr: String(caught?.stderr || '').slice(0, 1000),
    };
    throw failure;
  }

  const helperResult = parseWindowsCaptureJson(stdout);
  if (!helperResult || helperResult.ok !== true) {
    const code = helperResult?.errorCode || 'SCREENSHOT_FAILED';
    throw gateError(code, helperResult?.errorMessage || `${metadata.label || 'screenshot'} Windows capture returned no success result`, helperResult || undefined);
  }
  if (helperResult.screenshotProvider !== RUNNER_CONFIG.screenshotProvider) {
    throw gateError('SCREENSHOT_PROVIDER_MISMATCH', `unexpected screenshot provider: ${helperResult.screenshotProvider || 'missing'}`, helperResult);
  }
  if (helperResult.restoredOriginalForeground !== true) {
    throw gateError('FOREGROUND_RESTORE_FAILED', 'original foreground window was not restored', helperResult);
  }
  if (!fs.existsSync(file)) throw gateError('SCREENSHOT_INVALID', `${metadata.label || 'screenshot'} screenshot did not land on disk`);
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size <= 0) throw gateError('SCREENSHOT_INVALID', `${metadata.label || 'screenshot'} screenshot is empty`);
  const dimensions = readPngDimensions(file);
  const screenBounds = helperResult.primaryScreenBounds || helperResult.screenBounds || null;
  const screenWidth = Number(screenBounds?.width ?? helperResult.width);
  const screenHeight = Number(screenBounds?.height ?? helperResult.height);
  if (!Number.isFinite(screenWidth) || !Number.isFinite(screenHeight)
    || dimensions.width !== screenWidth || dimensions.height !== screenHeight) {
    const failure = gateError('SCREENSHOT_DIMENSIONS_MISMATCH', `${metadata.label || 'screenshot'} PNG dimensions do not match the primary screen bounds`);
    failure.details = { dimensions, screenBounds };
    throw failure;
  }
  if (helperResult.bytes !== undefined && Number(helperResult.bytes) !== stat.size) {
    throw gateError('SCREENSHOT_SIZE_MISMATCH', `${metadata.label || 'screenshot'} PNG size differs from helper result`);
  }
  return {
    screenshotProvider: SCREENSHOT_PROVIDER,
    file: relative(file),
    bytes: stat.size,
    windowHandle: helperResult.windowHandle ?? null,
    processId: helperResult.processId ?? null,
    processName: helperResult.processName ?? null,
    windowTitle: helperResult.windowTitle ?? null,
    screenBounds,
    primaryScreenBounds: screenBounds,
    dpi: helperResult.dpi || null,
    capturedAt: helperResult.capturedAt || now(),
    cardIndex: metadata.cardIndex ?? null,
    batch: metadata.batch ?? null,
    outfitIdentity: metadata.outfitIdentity ?? null,
    outfitIdentityHash: metadata.outfitIdentity ? outfitIdentityHash(metadata.outfitIdentity) : null,
    cardTitle: metadata.cardTitle ?? null,
    ...dimensions,
  };
}

function buildRecommendationRequestData(data = {}, config = RUNNER_CONFIG) {
  const next = data && typeof data === 'object' ? { ...data } : {};
  return config.capturePresentationEvidence === true || config.evidenceOnly === true
    ? { ...next, presentationEvidenceMode: PRESENTATION_EVIDENCE_MODE }
    : next;
}

function presentationEvidenceFileFor(slot) {
  return PRESENTATION_EVIDENCE_FILES[slot] || null;
}

function truncatedSha256(value, domain = 'outfit-key-v1') {
  return crypto.createHash('sha256').update(`${domain}|${String(value)}`, 'utf8').digest('hex').slice(0, 16);
}

function scanPresentationEvidencePii(value, sensitiveValues = []) {
  const forbiddenKeys = /^(?:openid|userId|clothingId|clothingIds|itemId|itemIds|ownerHash|candidatePoolId|recommendationBatchId|requestedCandidatePoolId)$/i;
  const sensitive = sensitiveValues.filter(Boolean).map(String);
  const issues = [];
  const visit = (current, key = '') => {
    if (forbiddenKeys.test(key) && !(key === 'candidatePoolId' && current === null)) {
      issues.push(`forbidden key: ${key}`);
    }
    if (typeof current === 'string') {
      if (/https?:\/\/|file:\/\/|cloud:\/\/|[A-Za-z]:\\|^(?:[\\/]|\.\.?[\\/])|^(?:uploads?|tmp|var|home|Users|workspace)[\\/]/i.test(current)) issues.push('URL or path');
      if (/(?:openid|userId|clothingId|itemId|ownerHash|candidatePoolId|recommendationBatchId)/i.test(current)) issues.push('forbidden identity text');
      if (sensitive.some((raw) => raw && current.includes(raw))) issues.push('raw identity');
      return;
    }
    if (Array.isArray(current)) {
      current.forEach((entry) => visit(entry));
      return;
    }
    if (current && typeof current === 'object') {
      Object.entries(current).forEach(([childKey, childValue]) => visit(childValue, childKey));
    }
  };
  visit(value);
  return [...new Set(issues)];
}

function assertPresentationEvidenceEmptyFields(evidence) {
  if (!evidence || !Array.isArray(evidence.cards)) throw new Error('PRESENTATION_EVIDENCE_INVALID: cards missing');
  if (!evidence.shared || typeof evidence.shared !== 'object' || Array.isArray(evidence.shared)) {
    throw new Error('PRESENTATION_EVIDENCE_INVALID: shared missing');
  }
  evidence.cards.forEach((card) => {
    if (!Array.isArray(card.itemRoles) || !Array.isArray(card.finalTags)
      || !Array.isArray(card.availableDifferentiators)
      || !card.binding || typeof card.binding !== 'object'
      || !card.contentPlanSummary || typeof card.contentPlanSummary !== 'object'
      || !card.copyContractSummary || typeof card.copyContractSummary !== 'object') {
      throw new Error('PRESENTATION_EVIDENCE_INVALID: array field missing');
    }
    for (const item of card.itemRoles) {
      for (const key of ['role', 'canonicalName', 'canonicalSubtype', 'normalizedColor']) {
        if (!(item[key] === null || typeof item[key] === 'string')) {
          throw new Error(`PRESENTATION_EVIDENCE_INVALID: ${key} must be string or null`);
        }
      }
    }
    if (!(card.selectedDifferentiator === null || typeof card.selectedDifferentiator === 'object')) {
      throw new Error('PRESENTATION_EVIDENCE_INVALID: selectedDifferentiator must be null or object');
    }
    for (const key of ['factSignaturesEqual', 'relationCodesEqual', 'titleMatchesPlan', 'reasonMatchesPlan']) {
      if (typeof card.binding[key] !== 'boolean') {
        throw new Error(`PRESENTATION_EVIDENCE_INVALID: binding.${key} must be boolean`);
      }
    }
  });
}

function validatePresentationEvidenceCapture({ evidence, cards, expectedCount }) {
  if (!evidence || evidence.version !== PRESENTATION_EVIDENCE_VERSION) {
    throw new Error('PRESENTATION_EVIDENCE_INVALID: version');
  }
  try {
    assertRecommendationCountContract(evidence.countContract);
  } catch (error) {
    throw new Error(`PRESENTATION_EVIDENCE_COUNT_CONTRACT: ${error.message}`);
  }
  const resolvedExpectedCount = evidence.countContract.expectedCardCount;
  if (expectedCount !== undefined && expectedCount !== resolvedExpectedCount) {
    throw new Error(`PRESENTATION_EVIDENCE_COUNT_CONTRACT: expectedCount ${expectedCount} conflicts with contract ${resolvedExpectedCount}`);
  }
  if (!Array.isArray(evidence.cards) || evidence.cards.length !== resolvedExpectedCount) {
    throw new Error(`PRESENTATION_EVIDENCE_CARD_COUNT: expected ${resolvedExpectedCount}`);
  }
  if (!Array.isArray(cards) || cards.length !== resolvedExpectedCount) {
    throw new Error(`PRESENTATION_RESPONSE_CARD_COUNT: expected ${resolvedExpectedCount}`);
  }
  assertReturnedCardCount(evidence.countContract, evidence.cards.length);
  const aliases = evidence.cards.map((card, index) => card.cardAlias === `C${String(index + 1).padStart(2, '0')}`);
  if (aliases.some((valid) => !valid)) throw new Error('PRESENTATION_EVIDENCE_ALIAS_ORDER');
  assertPresentationEvidenceEmptyFields(evidence);
  const sensitiveValues = cards.flatMap((card) => [card.outfitKey, ...(card.itemIds || [])]);
  const piiIssues = scanPresentationEvidencePii(evidence, sensitiveValues);
  if (piiIssues.length) throw new Error(`PRESENTATION_EVIDENCE_PII: ${piiIssues.join(', ')}`);
  const bytes = Buffer.byteLength(JSON.stringify(evidence), 'utf8');
  if (bytes >= PRESENTATION_EVIDENCE_MAX_BYTES) throw new Error(`PRESENTATION_EVIDENCE_SIZE: ${bytes}`);
  evidence.cards.forEach((evidenceCard, index) => {
    const responseCard = cards[index];
    if (truncatedSha256(responseCard.outfitKey) !== evidenceCard.outfitKeyHash) {
      throw new Error(`PRESENTATION_EVIDENCE_CARD_MISMATCH: ${index + 1}`);
    }
    if (evidenceCard.finalTitle !== responseCard.title
      || evidenceCard.finalReason !== responseCard.todayReason
      || JSON.stringify(evidenceCard.finalTags) !== JSON.stringify(responseCard.tags)) {
      throw new Error(`PRESENTATION_EVIDENCE_FINAL_CARD_MISMATCH: ${index + 1}`);
    }
  });
  return { bytes, piiIssues: [] };
}

function presentationEvidenceTables(evidence) {
  const rows = evidence.cards.map((card) => ({
    cardAlias: card.cardAlias,
    authorizedFacts: JSON.stringify(card.itemRoles),
    availableDifferentiators: JSON.stringify(card.availableDifferentiators),
    selectedDifferentiator: JSON.stringify(card.selectedDifferentiator),
    contentPlanSummary: JSON.stringify(card.contentPlanSummary),
    copyContractSummary: JSON.stringify(card.copyContractSummary),
    binding: JSON.stringify(card.binding),
    finalTitle: card.finalTitle ?? '',
    finalReason: card.finalReason ?? '',
  }));
  const columns = Object.keys(rows[0] || {
    cardAlias: '', authorizedFacts: '', availableDifferentiators: '', selectedDifferentiator: '',
    contentPlanSummary: '', copyContractSummary: '', binding: '', finalTitle: '', finalReason: '',
  });
  return columns.map((column) => [
    `## ${column}`,
    '',
    '| cardAlias | value |',
    '| --- | --- |',
    ...rows.map((row) => `| ${escapeTable(row.cardAlias)} | ${escapeTable(row[column])} |`),
    '',
  ].join('\n')).join('\n');
}

function escapeTable(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

function presentationCardsFromData(data) {
  const expectedCount = Number.isInteger(data?.countContract?.expectedCardCount)
    ? data.countContract.expectedCardCount
    : data?.outfits?.length || 0;
  return Array.isArray(data?.outfits) ? data.outfits.slice(0, expectedCount).map((card) => ({
    outfitKey: typeof card.outfitKey === 'string' ? card.outfitKey : null,
    itemIds: Array.isArray(card.clothingIds) ? card.clothingIds.map(String) : [],
    title: typeof (card.displayTitle || card.title) === 'string' ? (card.displayTitle || card.title) : null,
    todayReason: typeof card.copyContract?.todayReason === 'string' ? card.copyContract.todayReason : null,
    tags: Array.isArray(card.styleTags) ? card.styleTags : [],
  })) : [];
}

function authoritativeResponseData(response) {
  return response?.data && typeof response.data === 'object' && !Array.isArray(response.data)
    ? response.data
    : null;
}

function authoritativeResponseCountContract(response) {
  const data = authoritativeResponseData(response);
  return data && Object.prototype.hasOwnProperty.call(data, 'countContract')
    ? data.countContract
    : undefined;
}

function sanitizeRecommendationCountContract(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const sanitized = {};
  for (const key of COUNT_CONTRACT_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    sanitized[key] = key === 'candidatePoolId' ? null : value[key];
  }
  return sanitized;
}

function sanitizeResponseForEvidence(response) {
  const data = authoritativeResponseData(response) || {};
  const debug = data.debug && typeof data.debug === 'object' ? data.debug : {};
  const qaBatchAudit = data.qaBatchAudit && typeof data.qaBatchAudit === 'object' ? data.qaBatchAudit : null;
  const sanitizedQaBatchAudit = qaBatchAudit ? compact(qaBatchAudit, 6) : null;
  if (sanitizedQaBatchAudit && qaBatchAudit.qaGateSummary
    && typeof qaBatchAudit.qaGateSummary === 'object' && !Array.isArray(qaBatchAudit.qaGateSummary)) {
    sanitizedQaBatchAudit.qaGateSummary = compact(qaBatchAudit.qaGateSummary, 3);
  }
  return {
    code: Object.prototype.hasOwnProperty.call(response || {}, 'code') ? response.code : null,
    message: typeof response?.message === 'string' ? response.message.slice(0, 512) : null,
    data: {
      cloudBuild: typeof data.cloudBuild === 'string' ? data.cloudBuild : null,
      executionMode: typeof debug.executionMode === 'string' ? debug.executionMode : null,
      cacheHit: nullableBoolean(debug, 'cacheHit'),
      requestedCandidatePoolIdPresent: nullableBoolean(debug, 'requestedCandidatePoolIdPresent'),
      candidatePoolSaveStatus: debug.candidatePoolSaveStatus ?? null,
      candidatePoolChunkCount: number(debug.candidatePoolChunkCount),
      countContract: sanitizeRecommendationCountContract(authoritativeResponseCountContract(response)),
      qaBatchAudit: sanitizedQaBatchAudit,
      debug: compact(debug, 6),
      outfits: presentationCardsFromData(data).map((card) => ({
        outfitKeyHash: card.outfitKey ? truncatedSha256(card.outfitKey) : null,
        itemCount: card.itemIds.length,
        title: card.title,
        todayReason: card.todayReason,
        tags: card.tags,
      })),
    },
  };
}

function persistResponseArtifacts(capture, slot) {
  if (!EVIDENCE_DIR || !capture?.rawResponse || !Object.prototype.hasOwnProperty.call(state.responseArtifacts, slot)) return null;
  ensureDir(EVIDENCE_DIR);
  const responseFile = `response-${slot}.json`;
  const rawResponseFile = `raw-response-${slot}.json`;
  const breakdownFile = `business-payload-breakdown-${slot}.json`;
  const debugFile = `debug-${slot}.json`;
  const qaFile = `qa-${slot}-raw.json`;
  const sanitized = sanitizeResponseForEvidence(capture.rawResponse);
  writeJson(responseFile, sanitized);
  writeJson(rawResponseFile, capture.rawResponse);
  writeJson(breakdownFile, {
    rawResponseBytes: summarizeCloudResponse(capture.rawResponse).rawResponseBytes,
    businessDataBytes: summarizeCloudResponse(capture.rawResponse).businessDataBytes,
    topPaths: responsePayloadByteBreakdown(authoritativeResponseData(capture.rawResponse)),
  });
  writeJson(debugFile, sanitized.data.debug);
  writeJson(qaFile, sanitized.data.qaBatchAudit);
  const artifact = {
    response: responseFile,
    rawResponse: rawResponseFile,
    businessPayloadBreakdown: breakdownFile,
    debug: debugFile,
    qaRaw: qaFile,
    status: 'captured',
    responseBytes: summarizeCloudResponse(capture.rawResponse),
    performanceLedger: (() => {
      try { return extractPerformanceLedger(capture.rawResponse); }
      catch (error) { return { errorCode: error.code || 'PERFORMANCE_LEDGER_MISSING', errorMessage: String(error.message || error) }; }
    })(),
  };
  state.responseArtifacts[slot] = artifact;
  return artifact;
}

function normalizeCloudCallCapture(call, metadata = {}) {
  const response = call?.status === 'fulfilled' ? (call.result?.result || call.result || {}) : {};
  const data = response?.data && typeof response.data === 'object' ? response.data : null;
  const debug = data?.debug && typeof data.debug === 'object' ? data.debug : {};
  const qa = data?.qaBatchAudit && typeof data.qaBatchAudit === 'object' ? data.qaBatchAudit : null;
  const evidence = debug.presentationEvidence && typeof debug.presentationEvidence === 'object'
    ? debug.presentationEvidence
    : null;
  const presentationEvidenceStatus = debug.presentationEvidenceStatus
    && typeof debug.presentationEvidenceStatus === 'object'
    ? debug.presentationEvidenceStatus
    : null;
  const responseSummary = call?.status === 'fulfilled' ? summarizeCloudResponse(response) : null;
  let performanceLedger = null;
  let performanceLedgerError = null;
  if (call?.status === 'fulfilled') {
    try { performanceLedger = extractPerformanceLedger(response); }
    catch (error) {
      performanceLedgerError = {
        code: error.code || 'PERFORMANCE_LEDGER_MISSING',
        message: String(error.message || error),
        responseTopLevelKeys: error.details?.responseTopLevelKeys || Object.keys(response || {}),
        dataTopLevelKeys: error.details?.dataTopLevelKeys || Object.keys(data || {}),
      };
    }
  }
  const auditId = metadata.auditId
    || debug.auditId
    || data?.meta?.auditId
    || qa?.auditId
    || null;
  return {
    auditId: typeof auditId === 'string' ? auditId : null,
    responseAuditId: typeof (debug.auditId || data?.meta?.auditId || qa?.auditId) === 'string'
      ? (debug.auditId || data?.meta?.auditId || qa?.auditId)
      : null,
    trigger: metadata.trigger || debug.trigger || null,
    slot: metadata.slot === 'refresh' || metadata.slot === 'initial' ? metadata.slot : null,
    status: call?.status || 'unknown',
    responseCode: Object.prototype.hasOwnProperty.call(response, 'code') ? response.code : null,
    responseMessage: typeof response.message === 'string' ? response.message.slice(0, 512) : null,
    errorCode: call?.error?.code ?? null,
    errorMessage: typeof call?.error?.message === 'string' ? call.error.message.slice(0, 512) : null,
    hasResponse: call?.status === 'fulfilled' && Boolean(data),
    cloudBuild: debug.cloudBuildVersion ?? data?.meta?.cloudBuildVersion ?? null,
    qaVersion: qa?.version ?? null,
    presentationEvidenceVersion: evidence?.version ?? null,
    presentationEvidenceStatus,
    executionMode: debug.executionMode ?? null,
    cacheHit: nullableBoolean(debug, 'cacheHit'),
    cacheMissReason: debug.cacheMissReason ?? null,
    requestedCandidatePoolIdPresent: nullableBoolean(debug, 'requestedCandidatePoolIdPresent'),
    candidatePoolSaveStatus: debug.candidatePoolSaveStatus ?? null,
    candidatePoolSaveReason: debug.candidatePoolSaveReason ?? null,
    responseBytes: responseSummary,
    performanceLedger,
    performanceLedgerError,
    countContract: sanitizeRecommendationCountContract(authoritativeResponseCountContract(response)),
    returnedCardCount: Array.isArray(data?.outfits) ? data.outfits.length : null,
    candidatePoolDiagnostics: compact({
      candidatePoolSerializedBytes: debug.candidatePoolSerializedBytes,
      candidatePoolChunkCount: debug.candidatePoolChunkCount,
      candidatePoolManifestBytes: debug.candidatePoolManifestBytes,
      candidatePoolChunksBytes: debug.candidatePoolChunksBytes,
      candidatePoolCleanupAttempted: debug.candidatePoolCleanupAttempted,
      candidatePoolCleanupDeletedCount: debug.candidatePoolCleanupDeletedCount,
      candidatePoolCleanupFailedCount: debug.candidatePoolCleanupFailedCount,
      timings: debug.timings,
      responseBytes: debug.responseBytes,
    }),
    qa: qa ? compact(qa, 5) : null,
    debug: compact(debug, 5),
    presentationCapture: evidence ? { evidence, cards: presentationCardsFromData(data) } : null,
    // Keep the complete response only in the runner's in-memory capture map.
    // It is intentionally not copied to requestCaptures or written to console/files.
    rawResponse: response,
  };
}

function recordRuntimeResponseCapture(call, metadata = {}) {
  const capture = normalizeCloudCallCapture(call, metadata);
  state.hasRealRequest = true;
  state.requestCaptures.push({
    auditId: capture.auditId,
    trigger: capture.trigger,
    slot: metadata.slot || null,
    status: capture.status,
    responseCode: capture.responseCode,
    responseMessage: capture.responseMessage,
    presentationEvidenceMode: RUNNER_CONFIG.capturePresentationEvidence ? PRESENTATION_EVIDENCE_MODE : null,
    errorCode: capture.errorCode,
    errorMessage: capture.errorMessage,
    hasResponse: capture.hasResponse,
    cloudBuild: capture.cloudBuild,
    qaVersion: capture.qaVersion,
    presentationEvidenceVersion: capture.presentationEvidenceVersion,
    presentationEvidenceStatus: capture.presentationEvidenceStatus,
    executionMode: capture.executionMode,
    cacheHit: capture.cacheHit,
    cacheMissReason: capture.cacheMissReason,
    requestedCandidatePoolIdPresent: capture.requestedCandidatePoolIdPresent,
    candidatePoolSaveStatus: capture.candidatePoolSaveStatus,
    candidatePoolSaveReason: capture.candidatePoolSaveReason,
    countContract: capture.countContract,
    returnedCardCount: capture.returnedCardCount,
    candidatePoolDiagnostics: capture.candidatePoolDiagnostics,
    responseDebug: capture.debug,
    responseBytes: capture.responseBytes,
    performanceLedger: capture.performanceLedger,
    performanceLedgerError: capture.performanceLedgerError,
  });
  state.presentationCaptureDiagnostics.responseIntercepted = capture.status !== 'pending';
  state.presentationCaptureDiagnostics.responseSettled = capture.status !== 'pending';
  state.presentationCaptureDiagnostics.responseRejected = capture.status === 'rejected';
  state.presentationCaptureDiagnostics.rejectionCode = capture.errorCode || null;
  state.presentationCaptureDiagnostics.rejectionMessage = capture.errorMessage || null;
  state.presentationCaptureDiagnostics.capturedResponseAuditId = capture.responseAuditId || null;
  if (capture.auditId) state.runtimeCaptures.set(capture.auditId, capture);
  return capture;
}

function persistPresentationEvidenceCapture(capture, slot, legacy = false) {
  if (!capture?.presentationCapture) throw gateError('PRESENTATION_EVIDENCE_MISSING', 'successful response did not contain presentation evidence');
  const validation = validatePresentationEvidenceCapture(capture.presentationCapture);
  const file = legacy ? PRESENTATION_EVIDENCE_FILE : presentationEvidenceFileFor(slot);
  if (!file) throw gateError('PRESENTATION_EVIDENCE_SLOT_INVALID', `unsupported presentation evidence slot: ${slot}`);
  state.presentationEvidence = {
    bytes: validation.bytes,
    cardCount: capture.presentationCapture.evidence.cards.length,
    pii: 'passed',
    slot: slot || null,
    file,
  };
  writeJson(file, capture.presentationCapture.evidence);
  const persistedEvidence = JSON.parse(fs.readFileSync(path.join(EVIDENCE_DIR, file), 'utf8'));
  const persistedPiiIssues = scanPresentationEvidencePii(
    persistedEvidence,
    capture.presentationCapture.cards.flatMap((card) => [card.outfitKey, ...(card.itemIds || [])]),
  );
  if (persistedPiiIssues.length > 0) {
    throw new Error(`PRESENTATION_EVIDENCE_FILE_PII: ${persistedPiiIssues.join(', ')}`);
  }
  writeJson('production-presentation-evidence-pii.json', { status: 'passed', issues: [], bytes: validation.bytes, slot: slot || null });
  writeText('production-presentation-evidence-tables.md', presentationEvidenceTables(capture.presentationCapture.evidence));
  if (slot && Object.prototype.hasOwnProperty.call(state.presentationEvidenceArtifacts, slot)) {
    state.presentationEvidenceArtifacts[slot] = {
      status: 'passed',
      file,
      bytes: validation.bytes,
      cardCount: capture.presentationCapture.evidence.cards.length,
      version: capture.presentationCapture.evidence.version,
    };
  }
  return validation;
}

async function captureProductionPresentationEvidence() {
  const capture = await state.mini.evaluate(async () => {
    const result = await wx.cloud.callFunction({
      name: 'generateOutfit',
      data: {
        scene: 'sport',
        weatherMode: 'disabled',
        maxResults: 8,
        trigger: 'initial',
        presentationEvidenceMode: 'sanitized_v1',
      },
    });
    const response = result?.result || result || {};
    const data = response?.data || {};
    return {
      evidence: data?.debug?.presentationEvidence || null,
      cards: Array.isArray(data?.outfits) ? data.outfits.slice(0, data?.countContract?.expectedCardCount ?? data.outfits.length).map((card) => ({
        outfitKey: typeof card.outfitKey === 'string' ? card.outfitKey : null,
        itemIds: Array.isArray(card.clothingIds) ? card.clothingIds.map(String) : [],
        title: typeof (card.displayTitle || card.title) === 'string' ? (card.displayTitle || card.title) : null,
        todayReason: typeof card.copyContract?.todayReason === 'string' ? card.copyContract.todayReason : null,
        tags: Array.isArray(card.styleTags) ? card.styleTags : [],
      })) : [],
    };
  });
  state.hasRealRequest = true;
  return persistPresentationEvidenceCapture({ presentationCapture: capture }, null, true);
}

function error(code, message, context = {}) {
  state.errors.push({ timestamp: now(), code, message: String(message).slice(0, 900), context: compact(context) });
}

function fail(code, message, context = {}) {
  state.failed = true;
  error(code, message, context);
}

function compact(value, depth = 2) {
  const forbidden = new Set([
    'data', 'debug', 'outfits', 'candidates', 'facts', 'imageUrl', 'thumbnailUrl', 'displayImageUrl',
    'image', 'thumbnail', 'url', 'openid', 'userId', 'clothingId', 'clothingIds', 'itemId', 'itemIds',
    'recommendationBatchId', 'requestedCandidatePoolId', 'outfitKey',
  ]);
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.slice(0, 512);
  if (depth <= 0) return Array.isArray(value) ? '[array]' : typeof value;
  if (Array.isArray(value)) return value.slice(0, 16).map((entry) => compact(entry, depth - 1));
  if (!value || typeof value !== 'object') return undefined;
  return Object.fromEntries(Object.keys(value).slice(0, 32)
    .filter((key) => !forbidden.has(key))
    .map((key) => [key, ['timings', 'responseBytes', 'clientTimings'].includes(key)
      ? compactDiagnosticMap(value[key])
      : compact(value[key], depth - 1)])
    .filter(([, entry]) => entry !== undefined));
}

function compactDiagnosticMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([, entry]) => typeof entry === 'boolean' || Number.isFinite(Number(entry)))
    .map(([key, entry]) => [String(key).slice(0, 64), typeof entry === 'boolean' ? entry : Math.max(0, Number(entry))])
    .filter(([key]) => Boolean(key)));
}

function collect(value, strings, objects, depth = 5) {
  if (typeof value === 'string') {
    strings.push(value);
    return;
  }
  if (!value || typeof value !== 'object' || depth <= 0) return;
  if (Array.isArray(value)) {
    value.slice(0, 24).forEach((entry) => collect(entry, strings, objects, depth - 1));
    return;
  }
  if (typeof value.auditId === 'string') objects.push(value);
  Object.keys(value).slice(0, 32).forEach((key) => collect(value[key], strings, objects, depth - 1));
}

function parseConsole(event) {
  const labels = ['[RecommendStart]', '[RecommendResponse]', '[RecommendationQA]', '[RecommendDone]', '[RecommendReject]', '[RecommendError]'];
  const strings = [];
  const objects = [];
  collect(event, strings, objects);
  const label = labels.find((entry) => strings.some((text) => text.includes(entry)));
  if (!label) return null;
  for (const text of strings) {
    if (!text.trim().startsWith('{')) continue;
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed.auditId === 'string') objects.unshift(parsed);
    } catch {}
  }
  const payload = objects.find((entry) => typeof entry.auditId === 'string') || {};
  return { timestamp: now(), label, phase: phaseForLabel(label), payload: sanitizeLifecyclePayload(payload) };
}

function phaseForLabel(label) {
  return String(label || '').replace(/^\[|\]$/g, '').toLowerCase() || 'unknown';
}

function recordLifecycleEvent(entry) {
  if (!entry) return;
  state.lifecycle.push(entry);
  if (entry.payload?.auditId) {
    state.sanitizedLifecycle.push({
      timestamp: entry.timestamp,
      auditId: entry.payload.auditId,
      phase: entry.phase || phaseForLabel(entry.label),
      payload: entry.payload,
    });
  }
}

function sanitizeLifecyclePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
  const result = {};
  for (const [key, value] of Object.entries(payload)) {
    if (key === 'countContract') {
      const contract = sanitizeRecommendationCountContract(value);
      if (contract) result[key] = contract;
      continue;
    }
    if (key === 'eligibilityRejectionAudit') {
      const audit = sanitizeEligibilityRejectionAudit(value);
      if (audit) result[key] = audit;
      continue;
    }
    if (key === 'qaGateSummary') {
      const summary = sanitizeQaGateSummary(value);
      if (summary) result[key] = summary;
      continue;
    }
    if (LIFECYCLE_PRIMITIVE_KEYS.has(key)) {
      const safe = sanitizeLifecyclePrimitive(key, value);
      if (safe !== undefined) result[key] = safe;
      continue;
    }
    if (LIFECYCLE_MAP_KEYS.has(key)) {
      result[key] = sanitizeNumberMap(value);
      continue;
    }
    if (LIFECYCLE_HISTOGRAM_KEYS.has(key)) {
      result[key] = sanitizeHistogramArray(value);
      continue;
    }
    if (LIFECYCLE_ARRAY_KEYS.has(key)) {
      result[key] = sanitizeKnownArray(key, value);
    }
  }
  return result;
}

function sanitizeQaGateSummary(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = {};
  for (const key of QA_AUTHORITATIVE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    if (key === 'counts') {
      if (!value.counts || typeof value.counts !== 'object' || Array.isArray(value.counts)) continue;
      result.counts = Object.fromEntries(QA_GATE_COUNT_KEYS
        .filter((countKey) => Object.prototype.hasOwnProperty.call(value.counts, countKey))
        .map((countKey) => [countKey, safeNumber(value.counts[countKey])]));
    } else if (key === 'qaBlockReasons') {
      result.qaBlockReasons = sanitizeKnownArray(key, value[key]);
    } else if (['version', 'gateStatus', 'duplicateCause'].includes(key)) {
      result[key] = safeText(value[key], key === 'version' ? 64 : 32);
    } else if (['qaGatePassed', 'qaTruncated'].includes(key)) {
      if (typeof value[key] === 'boolean') result[key] = value[key];
    } else if (typeof value[key] === 'number' && Number.isFinite(value[key]) && value[key] >= 0) {
      result[key] = value[key];
    }
  }
  return result;
}

function sanitizeEligibilityRejectionAudit(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = {};
  for (const key of ELIGIBILITY_AUDIT_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    if (key.endsWith('Histogram')) result[key] = sanitizeCountMap(value[key]);
    else if (key === 'categoryDistribution') result[key] = sanitizeCategoryDistribution(value[key]);
    else if (key === 'samples') result[key] = sanitizeEligibilitySamples(value[key]);
    else if (key === 'version') result[key] = safeText(value[key], 64);
    else if (key === 'truncated') result[key] = value[key] === true;
    else result[key] = safeNumber(value[key]);
  }
  return result;
}

function sanitizeCategoryDistribution(value) {
  if (!value || typeof value !== 'object') return {};
  return {
    top: sanitizeRoleDistribution(value.top),
    bottom: sanitizeRoleDistribution(value.bottom),
    shoes: sanitizeRoleDistribution(value.shoes),
    roleCompleteness: sanitizeCountMap(value.roleCompleteness),
    sportFactCounts: sanitizeCountMap(value.sportFactCounts),
    safeSportCandidate: {
      exists: value.safeSportCandidate?.exists === true,
      count: safeNumber(value.safeSportCandidate?.count),
    },
  };
}

function sanitizeRoleDistribution(value) {
  if (!value || typeof value !== 'object') return {};
  return {
    categories: sanitizeCountMap(value.categories),
    subtypes: sanitizeCountMap(value.subtypes),
  };
}

function sanitizeEligibilitySamples(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).map((sample) => {
    if (!sample || typeof sample !== 'object') return null;
    const result = {};
    for (const key of ELIGIBILITY_SAMPLE_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(sample, key)) continue;
      if (['top', 'bottom', 'shoes'].includes(key)) result[key] = sanitizeRoleSnapshot(sample[key]);
      else if (key === 'rejectionCodes') result[key] = sanitizeCodeArray(sample[key]);
      else if (key === 'weather') result[key] = sanitizeWeather(sample[key]);
      else if (key === 'rejectionStage') result[key] = safeText(sample[key], 64);
      else if (key === 'roleCompleteness') result[key] = sample[key] === true;
      else result[key] = safeNumber(sample[key]);
    }
    return result;
  }).filter(Boolean);
}

function sanitizeRoleSnapshot(value) {
  if (!value || typeof value !== 'object') return { category: '', subtype: '', sportFacts: {} };
  return {
    category: safeCategory(value.category),
    subtype: safeSubtype(value.subtype),
    sportFacts: Object.fromEntries(Object.entries(value.sportFacts || {})
      .filter(([key, flag]) => ELIGIBILITY_FACT_KEYS.has(key) && typeof flag === 'boolean')),
  };
}

function sanitizeWeather(value) {
  return {
    mode: safeText(value?.mode, 24),
    temperatureBucket: safeText(value?.temperatureBucket, 24),
    precipitationPresent: value?.precipitationPresent === true,
  };
}

function sanitizeCountMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([key, count]) => safeCode(key) && Number.isFinite(Number(count)) && Number(count) >= 0)
    .map(([key, count]) => [key, safeNumber(count)]));
}

function sanitizeNumberMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([, count]) => typeof count === 'boolean' || typeof count === 'number' || Number.isFinite(Number(count)))
    .map(([key, count]) => [safeText(key, 64), typeof count === 'boolean' ? count : safeNumber(count)])
    .filter(([key]) => Boolean(key)));
}

function sanitizeHistogramArray(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).map((entry) => ({
    reason: safeText(entry?.reason, 96),
    count: safeNumber(entry?.count),
  })).filter((entry) => entry.reason);
}

function sanitizeKnownArray(key, value) {
  if (!Array.isArray(value)) return [];
  if (key === 'exactReasonDuplicateGroups') {
    return value.slice(0, 8).map((entry) => ({
      sentenceHash: safeText(entry?.sentenceHash, 32),
      count: safeNumber(entry?.count),
      factSignatureCount: safeNumber(entry?.factSignatureCount),
      allowed: entry?.allowed === true,
      explanation: safeText(entry?.explanation, 64),
    }));
  }
  if (['exactTitleDuplicateGroups', 'normalizedTitleDuplicateGroups', 'normalizedReasonDuplicateGroups'].includes(key)) {
    return value.slice(0, 8).map((entry) => ({
      titleHash: safeText(entry?.titleHash, 32),
      textHash: safeText(entry?.textHash, 32),
      sentenceHash: safeText(entry?.sentenceHash, 32),
      count: safeNumber(entry?.count),
    }));
  }
  if (key === 'qaBlockReasons') return value.slice(0, 8).map((entry) => safeCode(entry) ? entry : '').filter(Boolean);
  return value.slice(0, 8).map((entry) => ({
    code: safeText(entry?.code, 64),
    repeatedRoles: Array.isArray(entry?.repeatedRoles) ? entry.repeatedRoles.slice(0, 5).map((role) => safeText(role, 32)) : [],
    count: safeNumber(entry?.count),
  }));
}

function sanitizeCodeArray(value) {
  return Array.isArray(value) ? value.slice(0, 12).map((entry) => safeText(entry, 96)).filter(safeCode) : [];
}

function safeCategory(value) {
  return ['top', 'bottom', 'shoes', 'missing'].includes(value) ? value : '';
}

function safeSubtype(value) {
  return typeof value === 'string' && /^[a-z0-9_-]{1,48}$/.test(value) ? value : '';
}

function safeCode(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_:+-]{1,96}$/.test(value);
}

function safeText(value, maxLength) {
  return typeof value === 'string' ? value.slice(0, maxLength) : '';
}

function safeNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : 0;
}

function sanitizeLifecyclePrimitive(key, value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return safeNumber(value);
  if (typeof value !== 'string') return undefined;
  return safeText(value, key === 'auditId' ? 80 : 96);
}

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function waitUntil(predicate, timeoutMs, description) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (caught) { lastError = caught; }
    await delay(200);
  }
  throw new Error(`Timed out waiting for ${description}${lastError ? `: ${lastError.message || lastError}` : ''}`);
}

function recommendationStarts() {
  return state.lifecycle.filter((entry) => entry.label === '[RecommendStart]' && entry.payload?.auditId);
}

function uniqueRecommendationStarts() {
  const seen = new Set();
  return recommendationStarts().filter((entry) => {
    const auditId = entry.payload.auditId;
    if (seen.has(auditId)) return false;
    seen.add(auditId);
    return true;
  });
}

function recommendationTerminal(auditId) {
  return state.lifecycle.find((entry) => entry.payload?.auditId === auditId
    && ['[RecommendDone]', '[RecommendReject]', '[RecommendError]'].includes(entry.label));
}

async function waitForBootstrapRequestsToSettle() {
  const deadline = Date.now() + 45000;
  let quietSince = Date.now();
  let observedCount = 0;
  while (Date.now() < deadline) {
    const starts = recommendationStarts();
    if (starts.length !== observedCount) {
      observedCount = starts.length;
      quietSince = Date.now();
    }
    const pending = starts.filter((entry) => !recommendationTerminal(entry.payload.auditId));
    if (!pending.length && Date.now() - quietSince >= 500) {
      starts.forEach((entry) => {
        const auditId = entry.payload.auditId;
        if (!state.requestSlots.has(auditId)) state.requestSlots.set(auditId, 'bootstrap');
      });
      return starts.map((entry) => ({
        auditId: entry.payload.auditId,
        slot: state.requestSlots.get(entry.payload.auditId) || 'bootstrap',
        terminal: recommendationTerminal(entry.payload.auditId)?.label || null,
      }));
    }
    await delay(200);
  }
  const pending = recommendationStarts()
    .filter((entry) => !recommendationTerminal(entry.payload.auditId))
    .map((entry) => entry.payload.auditId);
  throw gateError('BOOTSTRAP_REQUEST_NOT_SETTLED', `bootstrap recommendation requests did not settle: ${pending.join(', ') || 'unknown'}`);
}

async function page() { return state.mini.currentPage(); }
async function enterTodayPage() {
  const current = await page();
  if (current && current.path === TODAY_PAGE_PATH) return current;
  if (!state.mini || typeof state.mini.reLaunch !== 'function') {
    throw gateError('TODAY_PAGE_NAVIGATION_FAILED', 'DevTools automator cannot enter pages/today/index');
  }
  await state.mini.reLaunch(TODAY_RELAUNCH_URL);
  return waitUntil(async () => {
    const next = await page();
    return next && next.path === TODAY_PAGE_PATH ? next : null;
  }, 12000, 'Today page navigation');
}
async function textOf(element) { try { return element ? String(await element.text()).trim() : ''; } catch { return ''; } }
async function textsOf(elements) { return Promise.all((elements || []).map(textOf)).then((values) => values.filter(Boolean)); }
async function element(selector) { return (await page()).$(selector); }
async function elements(selector) { return (await page()).$$(selector); }

const SCENE_LABEL_TO_KEY = Object.freeze({
  居家: 'home',
  通勤: 'work',
  约会: 'date',
  运动: 'sport',
});

function sceneKeyFromLabel(label) {
  return SCENE_LABEL_TO_KEY[String(label || '').trim()] || 'NOT_OBSERVED';
}

async function readElementAttributeSafe(target, name) {
  try {
    if (target && typeof target.attribute === 'function') {
      const value = await target.attribute(name);
      if (value !== undefined && value !== null) return String(value);
    }
    if (target && typeof target.property === 'function') {
      const value = await target.property(name === 'class' ? 'className' : name);
      if (value !== undefined && value !== null) return String(value);
    }
  } catch {}
  return 'NOT_OBSERVED';
}

async function readElementCollectionSafe(pageInstance, selector) {
  try {
    if (!pageInstance || typeof pageInstance.$$ !== 'function') return null;
    const value = await pageInstance.$$(selector);
    return Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function hasClassToken(value, token) {
  return typeof value === 'string' && value.split(/\s+/).includes(token);
}

function normalizeOpenidForStorageScope(value) {
  return Array.from(String(value || '').trim()).map((character) => {
    if (/^[a-zA-Z0-9_-]$/.test(character)) return character;
    const codePoint = character.codePointAt(0);
    return codePoint === undefined ? '' : `~${codePoint.toString(16)}~`;
  }).join('');
}

function snapshotOutfitKeys(snapshot) {
  return Array.isArray(snapshot?.outfits)
    ? snapshot.outfits.map((outfit) => String(outfit?.outfitKey || outfit?.id || '')).filter(Boolean)
    : [];
}

function recommendationSnapshotIdentity(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const contract = snapshot.countContract || null;
  return {
    sceneKey: typeof snapshot.sceneKey === 'string'
      ? snapshot.sceneKey
      : typeof snapshot.selectedSceneKey === 'string' ? snapshot.selectedSceneKey : null,
    recommendationBatchId: typeof snapshot.recommendationBatchId === 'string' ? snapshot.recommendationBatchId : null,
    generatedAt: Number.isFinite(Number(snapshot.generatedAt)) ? Number(snapshot.generatedAt) : null,
    outfitKeys: snapshotOutfitKeys(snapshot),
    outfitCount: Array.isArray(snapshot.outfits) ? snapshot.outfits.length : null,
    expectedCardCount: Number.isInteger(contract?.expectedCardCount) ? contract.expectedCardCount : null,
    returnedCardCount: Number.isInteger(contract?.returnedCardCount) ? contract.returnedCardCount : null,
    batchLimited: snapshot.batchLimited === true,
    batchExhausted: snapshot.batchExhausted === true,
    hasRecommendations: snapshot.hasRecommendations !== false,
  };
}

function sameRecommendationSnapshotIdentity(left, right) {
  if (!left || !right) return false;
  return left.sceneKey === right.sceneKey
    && left.recommendationBatchId === right.recommendationBatchId
    && left.expectedCardCount === right.expectedCardCount
    && left.returnedCardCount === right.returnedCardCount
    && left.outfitCount === right.outfitCount
    && JSON.stringify(left.outfitKeys) === JSON.stringify(right.outfitKeys)
    && left.batchLimited === right.batchLimited
    && left.batchExhausted === right.batchExhausted
    && left.hasRecommendations === right.hasRecommendations;
}

async function readCurrentUserRecommendationStorage(activeScene = null) {
  if (!state.mini || typeof state.mini.callWxMethod !== 'function') {
    return { observable: false, reason: 'callWxMethod unavailable' };
  }
  const openid = await state.mini.callWxMethod('getStorageSync', 'openid');
  const normalizedOpenid = normalizeOpenidForStorageScope(openid);
  if (!normalizedOpenid) return { observable: false, reason: 'active openid unavailable' };
  const storageInfo = await state.mini.callWxMethod('getStorageInfoSync');
  const keys = Array.isArray(storageInfo?.keys) ? storageInfo.keys.map(String) : [];
  const userMarker = `:user:${normalizedOpenid}:`;
  const currentUserKeys = keys.filter((key) => key.startsWith(`${USER_STORAGE_PREFIX}:`) && key.includes(userMarker));
  const restoreSuffix = `:${TODAY_RESTORE_SNAPSHOT_BUSINESS_KEY}`;
  const encodedScenePrefix = `:${encodeURIComponent(TODAY_SCENE_SNAPSHOT_BUSINESS_PREFIX)}:`;
  const todayKey = currentUserKeys.find((key) => key.endsWith(restoreSuffix)) || null;
  const sceneKeys = currentUserKeys.filter((key) => key.includes(encodedScenePrefix));
  const todaySnapshot = todayKey ? await state.mini.callWxMethod('getStorageSync', todayKey) : null;
  const sceneSnapshots = [];
  for (const key of sceneKeys) {
    const snapshot = await state.mini.callWxMethod('getStorageSync', key);
    const identity = recommendationSnapshotIdentity(snapshot);
    if (identity) sceneSnapshots.push({ key, snapshot, identity });
  }
  const todayIdentity = recommendationSnapshotIdentity(todaySnapshot);
  const activeCandidates = sceneSnapshots.filter((entry) => !activeScene || entry.identity.sceneKey === activeScene);
  const sceneEntry = activeCandidates.find((entry) => sameRecommendationSnapshotIdentity(entry.identity, todayIdentity))
    || activeCandidates.sort((left, right) => (right.identity.generatedAt || 0) - (left.identity.generatedAt || 0))[0]
    || null;
  return {
    observable: true,
    currentUserKeyCount: currentUserKeys.length,
    todaySnapshotPresent: Boolean(todayIdentity),
    sceneSnapshotCount: sceneSnapshots.length,
    today: todayIdentity,
    scene: sceneEntry?.identity || null,
    sceneSnapshotKeyPresent: Boolean(sceneEntry),
    source: sceneEntry && todayIdentity && sameRecommendationSnapshotIdentity(sceneEntry.identity, todayIdentity)
      ? 'scene_snapshot'
      : todayIdentity ? 'today_restore_snapshot' : 'empty',
  };
}

function recommendationLifecycleState() {
  const starts = uniqueRecommendationStarts();
  const pending = starts.filter((entry) => !recommendationTerminal(entry.payload.auditId));
  return {
    intentStartCount: starts.length,
    pendingIntentCount: pending.length,
    latestIntentAuditId: starts.at(-1)?.payload?.auditId || null,
  };
}

function recommendationCounterBaseline(label = 'acceptance') {
  return {
    label,
    intentStartCount: uniqueRecommendationStarts().length,
    capturedRequestCount: state.requestCaptures.length,
  };
}

function recommendationCounterDelta(baseline) {
  const current = recommendationCounterBaseline(baseline?.label || 'acceptance');
  return {
    intentStartCount: current.intentStartCount - Number(baseline?.intentStartCount || 0),
    capturedRequestCount: current.capturedRequestCount - Number(baseline?.capturedRequestCount || 0),
  };
}

function assertSingleGenerateSinceBaseline(baseline, sceneKey) {
  const delta = recommendationCounterDelta(baseline);
  const baselineIntentCount = Number(baseline?.intentStartCount || 0);
  const newStarts = uniqueRecommendationStarts().slice(baselineIntentCount);
  const sceneStarts = newStarts.filter((entry) => entry.payload?.sceneKey === sceneKey);
  if (delta.intentStartCount !== 1 || sceneStarts.length !== 1) {
    throw gateError('INITIAL_REQUEST_NOT_UNIQUE', `expected exactly one ${sceneKey} Initial generate request`, {
      baseline,
      delta,
      observedScenes: newStarts.map((entry) => entry.payload?.sceneKey || null),
    });
  }
  return delta;
}

function assertNoGenerateSinceBaseline(baseline, label = 'snapshot reuse') {
  const delta = recommendationCounterDelta(baseline);
  if (delta.intentStartCount !== 0 || delta.capturedRequestCount !== 0) {
    throw gateError('SNAPSHOT_REUSE_GENERATED', `${label} unexpectedly generated a recommendation request`, {
      baseline,
      delta,
    });
  }
  return delta;
}

async function readTodayAcceptanceState() {
  const currentPage = await page();
  if (!currentPage) {
    return {
      path: 'NOT_OBSERVED',
      activeScene: 'NOT_OBSERVED',
      tabs: 'NOT_OBSERVED',
      tabCount: 'NOT_OBSERVED',
      sportTabCount: 'NOT_OBSERVED',
      sportActive: 'NOT_OBSERVED',
      sportHasBatch: 'NOT_OBSERVED',
      sportSnapshot: 'NOT_OBSERVED',
      outfitCardCount: 'NOT_OBSERVED',
      hasBatchCardCount: 'NOT_OBSERVED',
      loadingStateCount: 'NOT_OBSERVED',
      sceneLoadingOverlayCount: 'NOT_OBSERVED',
      refreshDisabled: 'NOT_OBSERVED',
      recommendationBatchId: 'NOT_OBSERVED',
      auditId: 'NOT_OBSERVED',
      pageInstanceId: 'NOT_OBSERVED',
      snapshot: { observable: false, reason: 'page unavailable' },
      lifecycle: recommendationLifecycleState(),
      capture: await readPresentationCaptureGeneration(),
    };
  }

  const tabElements = await readElementCollectionSafe(currentPage, '.scene-tab');
  const tabs = tabElements === null
    ? 'NOT_OBSERVED'
    : await Promise.all(tabElements.map(async (tab, index) => {
      const text = await textOf(tab);
      const className = await readElementAttributeSafe(tab, 'class');
      return {
        index,
        text: text || 'NOT_OBSERVED',
        className,
        sceneKey: sceneKeyFromLabel(text),
        active: hasClassToken(className, 'active'),
      };
    }));
  const tabList = Array.isArray(tabs) ? tabs : [];
  const activeTab = tabList.find((tab) => tab.active) || null;
  const sportTabs = tabList.filter((tab) => tab.sceneKey === 'sport');
  const outfitCards = await readElementCollectionSafe(currentPage, '.outfit-card');
  const batchCards = await readElementCollectionSafe(currentPage, '.outfit-card.has-batch');
  const loadingStates = await readElementCollectionSafe(currentPage, '.loading-state');
  const sceneLoadingOverlays = await readElementCollectionSafe(currentPage, '.scene-loading-overlay');
  const refreshButton = await (async () => {
    try { return await currentPage.$('.refresh-btn'); } catch { return null; }
  })();
  const refreshClass = await readElementAttributeSafe(refreshButton, 'class');
  const hasBatchCardCount = batchCards === null ? 'NOT_OBSERVED' : batchCards.length;
  const sportHasBatch = hasBatchCardCount === 'NOT_OBSERVED' ? 'NOT_OBSERVED' : hasBatchCardCount > 0;
  const activeScene = activeTab?.sceneKey || 'NOT_OBSERVED';
  const snapshot = await readCurrentUserRecommendationStorage(activeScene);
  const capture = await readPresentationCaptureGeneration();
  return {
    path: currentPage.path || 'NOT_OBSERVED',
    pageInstanceId: currentPage.id ?? 'NOT_OBSERVED',
    activeScene,
    tabs,
    tabCount: tabElements === null ? 'NOT_OBSERVED' : tabElements.length,
    sportTabCount: tabElements === null ? 'NOT_OBSERVED' : sportTabs.length,
    sportActive: activeTab?.sceneKey === 'sport',
    sportHasBatch,
    sportSnapshot: sportHasBatch === true ? 'reusable_visible_batch' : 'not_directly_readable',
    outfitCardCount: outfitCards === null ? 'NOT_OBSERVED' : outfitCards.length,
    hasBatchCardCount,
    loadingStateCount: loadingStates === null ? 'NOT_OBSERVED' : loadingStates.length,
    sceneLoadingOverlayCount: sceneLoadingOverlays === null ? 'NOT_OBSERVED' : sceneLoadingOverlays.length,
    refreshDisabled: refreshClass === 'NOT_OBSERVED' ? 'NOT_OBSERVED' : hasClassToken(refreshClass, 'disabled'),
    recommendationBatchId: 'NOT_OBSERVED',
    auditId: 'NOT_OBSERVED',
    snapshot,
    lifecycle: recommendationLifecycleState(),
    capture,
  };
}

function summarizeTapResult(value) {
  if (value === undefined) return { status: 'resolved', value: 'undefined' };
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return { status: 'resolved', value };
  }
  return { status: 'resolved', valueType: typeof value };
}

async function readTodayPageHealth() {
  const currentPage = await page();
  const size = typeof currentPage.size === 'function' ? await currentPage.size() : null;
  const data = typeof currentPage.data === 'function' ? await currentPage.data() : null;
  const selectorResult = await currentPage.$('.outfit-swiper');
  const health = {
    path: currentPage.path || null,
    size: {
      width: Number(size?.width) || null,
      height: Number(size?.height) || null,
    },
    data: {
      type: data === null ? 'null' : typeof data,
      keys: data && typeof data === 'object' && !Array.isArray(data) ? Object.keys(data).slice(0, 32) : [],
    },
    selectorResolved: selectorResult !== undefined,
    outfitSwiperFound: Boolean(selectorResult),
  };
  if (health.path !== 'pages/today/index' || !health.size.width || !health.size.height || !health.selectorResolved) {
    throw gateError('TODAY_PAGE_UNREADABLE', 'Today page APIs are not readable', health);
  }
  return health;
}

function field(value, name) { return value && Object.prototype.hasOwnProperty.call(value, name) ? value[name] : null; }
function number(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function nullableBoolean(value, name) {
  const candidate = field(value, name);
  return typeof candidate === 'boolean' ? candidate : null;
}
function nullableNumber(value, name) {
  const candidate = field(value, name);
  return candidate === null ? null : number(candidate);
}
function nullableArray(value, name) {
  const candidate = field(value, name);
  return Array.isArray(candidate) ? candidate : null;
}
function normalizeQaContractPayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  return { ...value };
}
function qaObservation(value) {
  const payload = normalizeQaContractPayload(value);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { status: 'not_observed', missingFields: [...QA_AUTHORITATIVE_FIELDS] };
  }
  const missingFields = QA_AUTHORITATIVE_FIELDS.filter((key) => {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) return true;
    const candidate = payload[key];
    if (key === 'counts') {
      return !candidate || typeof candidate !== 'object' || Array.isArray(candidate)
        || QA_GATE_COUNT_KEYS.some((countKey) => number(candidate[countKey]) === null || number(candidate[countKey]) < 0);
    }
    if (['qaGatePassed', 'qaTruncated'].includes(key)) return typeof candidate !== 'boolean';
    if (['version', 'gateStatus', 'duplicateCause'].includes(key)) return typeof candidate !== 'string';
    if (['presentationFactSignatureHash', 'primaryRelationCode', 'reasonSemanticSkeleton', 'titleSemanticSkeleton'].includes(key)) {
      return candidate !== null && typeof candidate !== 'string';
    }
    if (['qaBlockReasons', 'exactTitleDuplicateGroups', 'normalizedTitleDuplicateGroups', 'exactReasonDuplicateGroups', 'normalizedReasonDuplicateGroups', 'titleTokenDuplicateGroups'].includes(key)) {
      return !Array.isArray(candidate);
    }
    return number(candidate) === null || number(candidate) < 0;
  });
  return {
    status: missingFields.length === 0 ? 'authoritative' : 'partial',
    missingFields,
  };
}

function normalizeQaObservation(value) {
  const payload = normalizeQaContractPayload(value);
  const observation = qaObservation(payload);
  return {
    qaObservationStatus: QA_OBSERVATION_STATUSES.has(observation.status) ? observation.status : 'not_observed',
    qaObservationMissingFields: observation.missingFields,
    qaGatePassed: nullableBoolean(payload, 'qaGatePassed'),
    gateStatus: field(payload, 'gateStatus'),
    qaBlockReasons: nullableArray(payload, 'qaBlockReasons'),
    duplicateCause: field(payload, 'duplicateCause'),
    alternativeCandidateCount: nullableNumber(payload, 'alternativeCandidateCount'),
    syntheticSuffixCount: nullableNumber(payload, 'syntheticSuffixCount'),
    unsupportedClaimCount: nullableNumber(payload, 'unsupportedClaimCount'),
    qaTruncated: nullableBoolean(payload, 'qaTruncated'),
  };
}

function readQaBatchAudit(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidates = [
    value.qaBatchAudit,
    value.data?.qaBatchAudit,
    value.debug?.qaBatchAudit,
    value.data?.debug?.qaBatchAudit,
  ];
  return candidates.find((candidate) => candidate && typeof candidate === 'object' && !Array.isArray(candidate)) || null;
}

function resolveQaPayload(auditId, lifecyclePayload = null, responsePayload = null) {
  const runtimeCapture = state.runtimeCaptures.get(auditId);
  const runtimeResponse = runtimeCapture?.rawResponse || null;
  const ordered = [
    { source: 'runtime_response', payload: authoritativeResponseData(runtimeResponse)?.qaBatchAudit?.qaGateSummary },
    { source: 'lifecycle', payload: lifecyclePayload?.qaGateSummary },
  ].filter((entry) => entry.payload && typeof entry.payload === 'object' && !Array.isArray(entry.payload));
  const authoritative = ordered.find((entry) => qaObservation(entry.payload).status === 'authoritative');
  const selected = authoritative || ordered[0] || null;
  if (!selected) return { payload: null, source: 'not_observed', status: 'not_observed', missingFields: QA_AUTHORITATIVE_FIELDS.slice() };
  const payload = normalizeQaContractPayload(selected.payload);
  const observation = qaObservation(payload);
  return {
    payload,
    source: selected.source,
    status: observation.status,
    missingFields: observation.missingFields,
  };
}

function gateError(code, message, details = null) {
  const caught = new Error(`${code}: ${message}`);
  caught.code = code;
  if (details) caught.details = details;
  return caught;
}

function validateVersionContract(auditId, responsePayload, qaPayload) {
  const actualCloudBuild = field(responsePayload, 'cloudBuild');
  const actualQaVersion = field(qaPayload, 'version');
  const valid = actualCloudBuild === EXPECTED_CLOUD_BUILD && actualQaVersion === EXPECTED_QA_VERSION;
  if (valid) return { valid: true, actualCloudBuild, actualQaVersion };

  if (!state.versionMismatchAudits.has(auditId)) {
    state.versionMismatchAudits.add(auditId);
    fail('VERSION_CONTRACT_MISMATCH', 'successful response did not match the exact V6 version contract', {
      auditId,
      expectedCloudBuild: EXPECTED_CLOUD_BUILD,
      expectedQaVersion: EXPECTED_QA_VERSION,
      actualCloudBuild: actualCloudBuild || null,
      actualQaVersion: actualQaVersion || null,
    });
  }
  throw gateError('VERSION_CONTRACT_MISMATCH', `VERSION_CONTRACT_MISMATCH for ${auditId}`);
}

function validateCandidatePoolDiagnostics(auditId, rawResponse, responsePayload, qaPayload = responsePayload) {
  const responseData = authoritativeResponseData(rawResponse);
  const countContract = authoritativeResponseCountContract(rawResponse);
  try {
    if (!responseData) throw new Error('successful raw response is missing data');
    assertRecommendationCountContract(countContract);
    if (!Array.isArray(responseData.outfits)) throw new Error('successful response data.outfits must be an array');
    assertReturnedCardCount(countContract, responseData.outfits.length);
  } catch (error) {
    fail('COUNT_CONTRACT_INVALID', 'successful response did not satisfy the dynamic recommendation count contract', {
      auditId,
      protocolPath: 'result.data.countContract',
      countContract: sanitizeRecommendationCountContract(countContract),
      returnedCardCount: Array.isArray(responseData?.outfits) ? responseData.outfits.length : null,
      error: String(error.message || error),
    });
    throw gateError('COUNT_CONTRACT_INVALID', `invalid count contract for ${auditId}: ${error.message || error}`);
  }
  const executionMode = field(responsePayload, 'executionMode');
  if (!executionMode) {
    fail('EXECUTION_MODE_MISSING', 'successful response did not report executionMode in its response diagnostics', { auditId });
    throw gateError('EXECUTION_MODE_MISSING', `missing response executionMode for ${auditId}`);
  }
  const responseStatus = field(responsePayload, 'candidatePoolSaveStatus');
  const saveStatus = responseStatus || null;
  if (executionMode === 'full_compute' && !FULL_COMPUTE_SAVE_STATUSES.has(saveStatus)) {
    fail('CANDIDATE_POOL_SAVE_STATUS_INVALID', 'full_compute must report a terminal candidate pool save status', {
      auditId, executionMode, candidatePoolSaveStatus: saveStatus,
    });
    throw gateError('CANDIDATE_POOL_SAVE_STATUS_INVALID', `invalid full_compute save status for ${auditId}`);
  }

  if (executionMode !== 'candidate_pool_hit') return { valid: true, saveStatus };

  const cacheHit = field(responsePayload, 'cacheHit') === true || field(qaPayload, 'cacheHit') === true;
  const requestedPoolPresent = field(responsePayload, 'requestedCandidatePoolIdPresent') === true
    || field(qaPayload, 'requestedCandidatePoolIdPresent') === true;
  const timings = field(responsePayload, 'timings') || field(qaPayload, 'timings') || {};
  const candidatePoolLoadMs = number(field(timings, 'candidatePoolLoadMs'));
  const generationStages = GENERATION_TIMING_KEYS.filter((key) => {
    const value = field(timings, key);
    return value !== null && value !== undefined && number(value) !== 0;
  });
  const statusValid = responseStatus === null || responseStatus === undefined || responseStatus === '' || responseStatus === 'not_applicable';
  const valid = cacheHit && requestedPoolPresent && candidatePoolLoadMs !== null && candidatePoolLoadMs > 0
    && generationStages.length === 0 && statusValid;
  if (valid) return { valid: true, saveStatus: saveStatus || null };

  fail('CANDIDATE_POOL_HIT_CONTRACT_MISMATCH', 'candidate_pool_hit did not satisfy the no-write/read-hit contract', {
    auditId,
    executionMode,
    cacheHit,
    requestedCandidatePoolIdPresent: requestedPoolPresent,
    candidatePoolLoadMs,
    generationStages,
    candidatePoolSaveStatus: saveStatus,
  });
  throw gateError('CANDIDATE_POOL_HIT_CONTRACT_MISMATCH', `invalid candidate_pool_hit contract for ${auditId}`);
}

function validateCanonicalQa(auditId, qaPayload) {
  const payload = normalizeQaContractPayload(qaPayload);
  const observation = qaObservation(payload);
  const normalized = normalizeQaObservation(payload);
  const syntheticSuffixCount = normalized.syntheticSuffixCount;
  const unsupportedClaimCount = nullableNumber(payload, 'unsupportedClaimCount');
  const availableDifferentiatorCount = nullableNumber(payload, 'availableDifferentiatorCount');
  const titleDuplicateWarningCount = nullableNumber(payload, 'titleDuplicateWarningCount');
  const duplicateCause = normalized.duplicateCause;
  const gateStatus = normalized.gateStatus;
  const gatePassed = normalized.qaGatePassed === true
    && (gateStatus === 'passed' || gateStatus === 'passed_with_warnings');
  const blockReasons = normalized.qaBlockReasons;
  if (observation.status !== 'authoritative') {
    fail('QA_CAPTURE_INCOMPLETE', 'RecommendationQA does not contain the complete canonical QA contract', {
      auditId,
      qaObservationStatus: observation.status,
      missingFields: observation.missingFields,
      qaGatePassed: normalized.qaGatePassed,
      gateStatus,
      qaBlockReasons: blockReasons,
    });
    throw gateError('QA_CAPTURE_INCOMPLETE', `incomplete canonical QA capture for ${auditId}`);
  }
  const counts = field(payload, 'counts');
  const finalCardCount = nullableNumber(payload, 'finalCardCount');
  const alternativeCandidateCount = nullableNumber(payload, 'alternativeCandidateCount');
  const candidateCountsValid = counts.selected === finalCardCount
    && counts.candidate >= counts.selected
    && counts.generated >= counts.selected
    && counts.accepted >= counts.selected
    && counts.rejected >= 0
    && alternativeCandidateCount >= 0;
  const warningContract = gateStatus === 'passed_with_warnings'
    && titleDuplicateWarningCount > 0
    && duplicateCause === 'FACT_EQUIVALENCE'
    && syntheticSuffixCount === 0
    && number(field(payload, 'placeholderTitleCount')) === 0
    && blockReasons.length === 0;
  if (gatePassed && candidateCountsValid && blockReasons.length === 0 && syntheticSuffixCount === 0
    && unsupportedClaimCount === 0
    && !['DIFFERENTIATOR_IGNORED', 'SYNTHETIC_VARIATION'].includes(duplicateCause)
    && (gateStatus === 'passed' || warningContract)) {
    return {
      valid: true,
      warning: gateStatus === 'passed_with_warnings',
      duplicateCause,
      qaObservationStatus: observation.status,
    };
  }
  fail('CANONICAL_QA_GATE_FAILED', 'successful response failed the final canonical presentation gate', {
    auditId,
    qaObservationStatus: observation.status,
    qaGatePassed: gatePassed,
    syntheticSuffixCount,
    availableDifferentiatorCount,
    titleDuplicateWarningCount,
    candidateCountsValid,
    counts,
    finalCardCount,
    alternativeCandidateCount,
    duplicateCause,
    gateStatus,
    qaBlockReasons: blockReasons,
  });
  throw gateError('CANONICAL_QA_GATE_FAILED', `invalid canonical QA gate for ${auditId}`);
}

function recordTerminalRequestFailure(auditId, terminal, responsePayload = null) {
  const label = terminal?.label;
  const payload = terminal?.payload || {};
  const rejected = label === '[RecommendReject]';
  const code = field(payload, 'errorCode')
    || field(payload, 'rejectCode')
    || field(payload, 'code')
    || (rejected ? 'RECOMMEND_REQUEST_REJECTED' : 'RECOMMEND_REQUEST_ERROR');
  const message = field(payload, 'errorMessage')
    || field(payload, 'rejectReason')
    || field(payload, 'message')
    || field(payload, 'reason')
    || (rejected ? 'recommendation request was rejected' : 'recommendation request failed');
  fail(code, message, {
    auditId,
    terminalPhase: label === '[RecommendReject]' ? 'RecommendReject' : 'RecommendError',
    responseAvailable: Boolean(responsePayload),
  });
  if (!responsePayload) {
    error('RESPONSE_NOT_AVAILABLE_DUE_TO_REQUEST_ERROR', 'RecommendResponse is unavailable because the request ended in an error terminal phase', {
      auditId,
      terminalPhase: label === '[RecommendReject]' ? 'RecommendReject' : 'RecommendError',
      requestErrorCode: code,
    });
  }
  return {
    code,
    message,
    responseAvailable: Boolean(responsePayload),
  };
}

function buildRequests() {
  const groups = new Map();
  for (const event of state.lifecycle) {
    const auditId = event.payload?.auditId;
    if (!auditId) continue;
    const group = groups.get(auditId) || [];
    group.push(event);
    groups.set(auditId, group);
  }
  return [...groups.entries()].map(([auditId, events]) => {
    const start = events.find((entry) => entry.label === '[RecommendStart]');
    const response = events.find((entry) => entry.label === '[RecommendResponse]');
    const qa = events.find((entry) => entry.label === '[RecommendationQA]');
    const terminal = events.filter((entry) => ['[RecommendDone]', '[RecommendReject]', '[RecommendError]'].includes(entry.label)).at(-1);
    const clientDone = events.find((entry) => entry.label === '[RecommendDone]' && entry.payload?.clientTimings);
    const rp = response?.payload || {};
    const qaResolution = resolveQaPayload(auditId, qa?.payload || null, rp);
    const qp = qaResolution.payload || {};
    const qd = qa?.payload || {};
    const dp = terminal?.payload || {};
    const runtimeCapture = state.requestCaptures.find((entry) => entry.auditId === auditId) || null;
    const counts = qp.counts || rp.counts || {};
    const qaObservationValue = normalizeQaObservation(qp);
    const startedAt = start ? Date.parse(start.timestamp) : NaN;
    const finishedAt = terminal ? Date.parse(terminal.timestamp) : NaN;
    return {
      auditId,
      sceneKey: field(start?.payload, 'sceneKey') || field(rp, 'sceneKey') || field(dp, 'sceneKey') || null,
      scene: field(rp, 'scene') || field(dp, 'scene') || field(start?.payload, 'scene') || null,
      trigger: field(start?.payload, 'trigger') || field(rp, 'trigger') || null,
      slot: runtimeCapture?.slot ?? state.requestSlots.get(auditId) ?? field(start?.payload, 'slot') ?? field(rp, 'slot') ?? null,
      responseCode: runtimeCapture?.responseCode ?? null,
      responseMessage: runtimeCapture?.responseMessage ?? null,
      presentationEvidenceMode: runtimeCapture?.presentationEvidenceMode ?? null,
      responseDebug: runtimeCapture?.responseDebug ?? {},
      countContract: runtimeCapture?.countContract ?? null,
      returnedCardCount: runtimeCapture?.returnedCardCount ?? null,
      cloudBuild: runtimeCapture?.cloudBuild ?? field(rp, 'cloudBuild') ?? null,
      qaVersion: field(qp, 'version') || null,
      qaSource: qaResolution.source,
      presentationEvidenceVersion: runtimeCapture?.presentationEvidenceVersion
        ?? field(rp, 'presentationEvidenceVersion')
        ?? field(qp, 'presentationEvidenceVersion')
        ?? null,
      presentationEvidenceStatus: runtimeCapture?.presentationEvidenceStatus ?? null,
      executionMode: runtimeCapture?.executionMode ?? field(rp, 'executionMode') ?? null,
      candidatePoolIdentityHash: field(qd, 'candidatePoolIdentityHash') || field(rp, 'candidatePoolIdentityHash') || null,
      candidatePoolAgeMs: number(field(qd, 'candidatePoolAgeMs')),
      cacheHit: response ? (runtimeCapture ? runtimeCapture.cacheHit : nullableBoolean(rp, 'cacheHit')) : null,
      cacheMissReason: runtimeCapture?.cacheMissReason ?? field(rp, 'cacheMissReason') ?? null,
      generated: number(field(counts, 'generated')),
      candidate: number(field(counts, 'candidate')),
      accepted: number(field(counts, 'accepted')),
      rejected: number(field(counts, 'rejected')),
      selected: number(field(counts, 'selected')),
      fallbackReasonCount: number(field(qd, 'fallbackReasonCount')),
      exactTitleDuplicateGroups: nullableArray(qd, 'exactTitleDuplicateGroups'),
      exactReasonDuplicateGroups: nullableArray(qd, 'exactReasonDuplicateGroups'),
      normalizedTitleDuplicateGroups: nullableArray(qd, 'normalizedTitleDuplicateGroups'),
      normalizedReasonDuplicateGroups: nullableArray(qd, 'normalizedReasonDuplicateGroups'),
      syntheticSuffixCount: nullableNumber(qp, 'syntheticSuffixCount'),
      placeholderTitleCount: nullableNumber(qp, 'placeholderTitleCount'),
      availableDifferentiatorCount: nullableNumber(qp, 'availableDifferentiatorCount'),
      duplicateCause: field(qp, 'duplicateCause') || null,
      titleDuplicateWarningCount: nullableNumber(qp, 'titleDuplicateWarningCount'),
      unsupportedClaimCount: nullableNumber(qp, 'unsupportedClaimCount'),
      qaObservationStatus: qaObservationValue.qaObservationStatus,
      qaObservationMissingFields: qaObservationValue.qaObservationMissingFields,
      qaGatePassed: qaObservationValue.qaGatePassed,
      gateStatus: qaObservationValue.gateStatus,
      qaBlockReasons: qaObservationValue.qaBlockReasons,
      qaTruncated: qaObservationValue.qaTruncated,
      alternativeCandidateCount: qaObservationValue.alternativeCandidateCount,
      presentationFactSignatureHash: field(qd, 'presentationFactSignatureHash') ?? null,
      primaryRelationCode: field(qd, 'primaryRelationCode') ?? null,
      reasonSemanticSkeleton: field(qd, 'reasonSemanticSkeleton') ?? null,
      titleSemanticSkeleton: field(qd, 'titleSemanticSkeleton') ?? null,
      semanticEquivalentGroupCount: nullableNumber(qd, 'semanticEquivalentGroupCount'),
      reuseExplanations: nullableArray(qd, 'reuseExplanations'),
      rejectionStageHistogram: field(qd.eligibilityRejectionAudit, 'rejectionStageHistogram') || {},
      rejectionReasonHistogram: field(qd.eligibilityRejectionAudit, 'rejectionReasonHistogram') || {},
      rejectionReasonCombinationHistogram: field(qd.eligibilityRejectionAudit, 'rejectionReasonCombinationHistogram') || {},
      eligibilityRejectionSampleCount: Array.isArray(field(qd.eligibilityRejectionAudit, 'samples'))
        ? field(qd.eligibilityRejectionAudit, 'samples').length : 0,
      eligibilityRejectionAuditBytes: number(field(qd.eligibilityRejectionAudit, 'serializedBytes')),
      eligibilityRejectionAuditTruncated: field(qd.eligibilityRejectionAudit, 'truncated') === true,
      exclusionsAppliedCount: number(field(rp, 'exclusionsAppliedCount') || field(qd, 'exclusionsAppliedCount')),
      candidatePoolSaveStatus: runtimeCapture?.candidatePoolSaveStatus ?? field(rp, 'candidatePoolSaveStatus') ?? null,
      candidatePoolSaveReason: runtimeCapture?.candidatePoolSaveReason ?? field(rp, 'candidatePoolSaveReason') ?? null,
      candidatePoolSerializedBytes: number(field(rp, 'candidatePoolSerializedBytes')),
      candidatePoolChunkCount: number(field(rp, 'candidatePoolChunkCount')),
      candidatePoolManifestBytes: number(field(rp, 'candidatePoolManifestBytes')),
      candidatePoolChunksBytes: number(field(rp, 'candidatePoolChunksBytes')),
      candidatePoolCleanupAttempted: field(rp, 'candidatePoolCleanupAttempted') === true,
      candidatePoolCleanupDeletedCount: number(field(rp, 'candidatePoolCleanupDeletedCount')),
      candidatePoolCleanupFailedCount: number(field(rp, 'candidatePoolCleanupFailedCount')),
      recommendationBatchIdPresent: field(rp, 'recommendationBatchIdPresent') === true,
      recommendationBatchIdLength: number(field(rp, 'recommendationBatchIdLength')),
      requestedCandidatePoolIdPresent: response
        ? (runtimeCapture ? runtimeCapture.requestedCandidatePoolIdPresent : nullableBoolean(rp, 'requestedCandidatePoolIdPresent'))
        : null,
      requestedCandidatePoolIdLength: number(field(rp, 'requestedCandidatePoolIdLength')),
      timings: compactDiagnosticMap(field(rp, 'timings') || field(qd, 'timings') || field(dp, 'timings') || {}),
      responseBytes: compactDiagnosticMap(field(rp, 'responseBytes') || {}),
      clientTimings: compactDiagnosticMap(field(clientDone?.payload, 'clientTimings') || {}),
      hasResponse: Boolean(response),
      hasQa: Boolean(qaResolution.payload),
      hasDone: Boolean(clientDone),
      responseCount: events.filter((entry) => entry.label === '[RecommendResponse]').length,
      qaCount: events.filter((entry) => entry.label === '[RecommendationQA]').length,
      doneCount: events.filter((entry) => entry.label === '[RecommendDone]').length,
      startedAt: start?.timestamp || null,
      finishedAt: terminal?.timestamp || null,
      userPerceivedDurationMs: Number.isFinite(startedAt) && Number.isFinite(finishedAt) ? Math.max(0, finishedAt - startedAt) : null,
      requestOutcome: terminal?.label === '[RecommendDone]'
        ? (response ? 'successful_response' : 'successful_response_missing')
        : ['[RecommendReject]', '[RecommendError]'].includes(terminal?.label)
          ? 'request_failure'
          : 'incomplete',
      requestFailureCode: ['[RecommendReject]', '[RecommendError]'].includes(terminal?.label)
        ? field(dp, 'errorCode') || field(dp, 'rejectCode') || field(dp, 'code')
          || (terminal.label === '[RecommendReject]' ? 'RECOMMEND_REQUEST_REJECTED' : 'RECOMMEND_REQUEST_ERROR')
        : null,
      requestFailureMessage: ['[RecommendReject]', '[RecommendError]'].includes(terminal?.label)
        ? field(dp, 'errorMessage') || field(dp, 'rejectReason') || field(dp, 'message') || field(dp, 'reason') || null
        : null,
      responseUnavailableDueToRequestError: ['[RecommendReject]', '[RecommendError]'].includes(terminal?.label) && !response,
      successfulResponseVersionStatus: terminal?.label !== '[RecommendDone]'
        ? 'not_applicable'
        : !response
          ? 'response_missing'
          : response && qaResolution.payload && field(rp, 'cloudBuild') === EXPECTED_CLOUD_BUILD && field(qp, 'version') === EXPECTED_QA_VERSION
            ? 'matched'
            : 'mismatch',
      terminal: terminal?.label === '[RecommendDone]' ? 'done' : terminal?.label === '[RecommendReject]' ? 'reject' : terminal?.label === '[RecommendError]' ? 'error' : 'incomplete',
    };
  }).sort((left, right) => String(left.startedAt).localeCompare(String(right.startedAt)));
}

async function restoreExistingPresentationEvidenceCapture() {
  if (!RUNNER_CONFIG.capturePresentationEvidence) return { ok: true, restoredTargets: [], previousGeneration: null };
  let result;
  try {
    result = await state.mini.evaluate(() => {
      const globalObject = typeof globalThis === 'object' ? globalThis : {};
      const candidates = [
        { target: globalObject.wx?.cloud, name: 'wx.cloud.callFunction' },
        { target: globalObject.Taro?.cloud, name: 'Taro.cloud.callFunction' },
        { target: globalObject.taro?.cloud, name: 'taro.cloud.callFunction' },
        { target: globalObject.cloudHelper, name: 'cloudHelper.callFunction' },
      ];
      const registry = globalObject.__recommendationV61RunnerCaptureRegistry;
      const registryEntries = registry && typeof registry === 'object' ? Object.values(registry) : [];
      const entries = candidates.filter((entry, index, all) => all.findIndex((item) => item.target === entry.target) === index);
      const plans = [];
      const unknown = [];
      const isKnownTracker = (tracker, entry) => Boolean(tracker
        && tracker.target === entry.name
        && tracker.targetObject === entry.target
        && typeof tracker.originalCallFunction === 'function'
        && typeof tracker.wrapper === 'function'
        && Array.isArray(tracker.calls)
        && typeof tracker.captureGeneration === 'string'
        && (tracker.captureHookMarker === undefined || tracker.captureHookMarker === 'recommendation-v61-capture-hook-v1')
        && (entry.target.callFunction === tracker.wrapper || entry.target.callFunction === tracker.originalCallFunction));
      entries.forEach((entry) => {
        if (!entry.target || typeof entry.target.callFunction !== 'function') return;
        const marker = entry.target.__recommendationV61RunnerCapture;
        const tracker = registryEntries.find((candidate) => candidate === marker
          || candidate?.targetObject === entry.target
          || candidate?.target === entry.name) || null;
        if (!marker && !tracker) return;
        if (!tracker || (marker && marker !== tracker) || !isKnownTracker(tracker, entry)) {
          unknown.push({ target: entry.name, reason: 'capture wrapper source or original reference is not verifiable' });
          return;
        }
        plans.push({ entry, tracker });
      });
      registryEntries.forEach((tracker) => {
        if (tracker && typeof tracker === 'object' && !plans.some((plan) => plan.tracker === tracker)) {
          unknown.push({ target: tracker.target || 'NOT_OBSERVED', reason: 'capture registry contains an unknown tracker' });
        }
      });
      if (unknown.length > 0) {
        return {
          ok: false,
          errorCode: 'CAPTURE_HOOK_UNKNOWN_WRAPPER',
          reason: 'existing capture hook could not be proven to be installed by this runner',
          unknown,
          previousGeneration: plans.map((plan) => plan.tracker.captureGeneration).find(Boolean) || null,
        };
      }
      const restoredTargets = [];
      for (const plan of plans) {
        const { entry, tracker } = plan;
        try {
          if (entry.target.callFunction === tracker.wrapper) entry.target.callFunction = tracker.originalCallFunction;
          if (entry.target.callFunction !== tracker.originalCallFunction) {
            return {
              ok: false,
              errorCode: 'CAPTURE_HOOK_RESTORE_FAILED',
              reason: `original callFunction reference was not restored for ${entry.name}`,
              restoredTargets,
              previousGeneration: tracker.captureGeneration,
            };
          }
          if (entry.target.__recommendationV61RunnerCapture === tracker) delete entry.target.__recommendationV61RunnerCapture;
          tracker.captureHookInstalled = false;
          tracker.calls.length = 0;
          restoredTargets.push(entry.name);
        } catch (error) {
          return {
            ok: false,
            errorCode: 'CAPTURE_HOOK_RESTORE_FAILED',
            reason: String(error?.message || error).slice(0, 512),
            restoredTargets,
            previousGeneration: tracker.captureGeneration,
          };
        }
      }
      if (registry && typeof registry === 'object') {
        try { delete globalObject.__recommendationV61RunnerCaptureRegistry; } catch (error) {
          return {
            ok: false,
            errorCode: 'CAPTURE_HOOK_RESTORE_FAILED',
            reason: String(error?.message || error).slice(0, 512),
            restoredTargets,
          };
        }
      }
      return {
        ok: true,
        restoredTargets,
        previousGeneration: plans.map((plan) => plan.tracker.captureGeneration).find(Boolean) || null,
        requestBufferCount: 0,
      };
    });
  } catch (caught) {
    throw gateError('CAPTURE_HOOK_RESTORE_FAILED', caught.message || caught);
  }
  if (!result?.ok) throw gateError(result?.errorCode || 'CAPTURE_HOOK_RESTORE_FAILED', result?.reason || 'existing capture hook could not be restored', result);
  return result;
}

async function installPresentationEvidenceCapture(expectedPreviousGeneration = null) {
  if (!RUNNER_CONFIG.capturePresentationEvidence) return { installed: false, skipped: true };
  const previous = await readPresentationCaptureGeneration();
  const restored = await restoreExistingPresentationEvidenceCapture();
  const previousGeneration = expectedPreviousGeneration || previous.captureGeneration || restored.previousGeneration || null;
  let result;
  try {
    result = await state.mini.evaluate(() => {
      const globalObject = typeof globalThis === 'object' ? globalThis : {};
      const candidates = [
        { target: globalObject.wx?.cloud, name: 'wx.cloud.callFunction' },
        { target: globalObject.Taro?.cloud, name: 'Taro.cloud.callFunction' },
        { target: globalObject.taro?.cloud, name: 'taro.cloud.callFunction' },
        { target: globalObject.cloudHelper, name: 'cloudHelper.callFunction' },
      ];
      const seenTargets = [];
      const seenTargetNames = [];
      const targetEntries = candidates.map((candidate) => {
        const available = Boolean(candidate.target && typeof candidate.target.callFunction === 'function');
        if (available && seenTargets.includes(candidate.target)) {
          return {
            ...candidate,
            available: true,
            duplicate: true,
            duplicateOf: seenTargetNames[seenTargets.indexOf(candidate.target)],
          };
        }
        if (available) {
          seenTargets.push(candidate.target);
          seenTargetNames.push(candidate.name);
        }
        return { ...candidate, available, duplicate: false, duplicateOf: null };
      });
      const targetDiagnostics = targetEntries.map((entry) => ({
        target: entry.name,
        available: entry.available,
        hookInstalled: false,
        reason: entry.available ? null : 'callFunction unavailable',
      }));
      const availableEntries = targetEntries.filter((entry) => entry.available && !entry.duplicate);
      if (!availableEntries.length) {
        return {
          installed: false,
          handshakeStatus: 'failed',
          captureHookInstalled: false,
          captureHookTarget: null,
          captureGeneration: null,
          targetDiagnostics,
          availableTargets: [],
          installedTargets: [],
          unavailableTargets: targetDiagnostics.filter((entry) => !entry.available).map((entry) => entry.target),
          failedTargets: [],
          installedTargetCount: 0,
          reason: 'no capture target is available',
        };
      }

      const registry = {};
      try {
        Object.defineProperty(globalObject, '__recommendationV61RunnerCaptureRegistry', {
          configurable: true,
          value: registry,
        });
      } catch (error) {
        return {
          installed: false,
          handshakeStatus: 'failed',
          captureHookInstalled: false,
          captureHookTarget: null,
          captureGeneration: null,
          targetDiagnostics,
          availableTargets: availableEntries.map((entry) => entry.name),
          installedTargets: [],
          unavailableTargets: targetDiagnostics.filter((entry) => !entry.available).map((entry) => entry.target),
          failedTargets: availableEntries.map((entry) => entry.name),
          installedTargetCount: 0,
          requestBufferCount: 0,
          errorCode: 'CAPTURE_HOOK_INSTALL_FAILED',
          reason: String(error?.message || error).slice(0, 512),
        };
      }
      const captureGeneration = `recommendation-v61-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const responseAuditId = (value) => {
        const outer = value?.result || value || {};
        const data = outer?.data || outer?.result?.data || {};
        const candidate = data?.debug?.auditId || data?.meta?.auditId || data?.qaBatchAudit?.auditId;
        return typeof candidate === 'string' ? candidate : null;
      };
      const installedTrackers = [];
      const rollback = () => {
        installedTrackers.forEach((tracker) => {
          try {
            if (tracker.targetObject.callFunction === tracker.wrapper) tracker.targetObject.callFunction = tracker.originalCallFunction;
            if (tracker.targetObject.__recommendationV61RunnerCapture === tracker) delete tracker.targetObject.__recommendationV61RunnerCapture;
            tracker.captureHookInstalled = false;
            tracker.calls.length = 0;
          } catch {}
        });
        try { delete globalObject.__recommendationV61RunnerCaptureRegistry; } catch {}
      };
      const installOnTarget = (entry) => {
        const target = entry.target;
        if (target.__recommendationV61RunnerCapture) {
          return { installed: false, reused: false, reason: 'capture wrapper marker remained after restoration' };
        }
        const original = target.callFunction;
        const tracker = {
          captureHookMarker: 'recommendation-v61-capture-hook-v1',
          target: entry.name,
          targetObject: target,
          originalCallFunction: original,
          wrapper: null,
          calls: [],
          nextSlot: 'initial',
          captureHookInstalled: true,
          captureHookTarget: entry.name,
          captureGeneration,
          requestIntercepted: false,
          actualInterceptedTarget: null,
          slot: null,
          responseIntercepted: false,
          responseSettled: false,
          responseRejected: false,
          rejectionCode: null,
          rejectionMessage: null,
          injectedPresentationEvidenceMode: null,
          capturedResponseAuditId: null,
        };
        const wrapped = function recommendationV61RunnerCallFunction(options) {
          if (!options || options.name !== 'generateOutfit') return original.call(this, options);
          const requestData = options.data && typeof options.data === 'object' ? { ...options.data } : {};
          const slot = tracker.nextSlot === 'refresh' ? 'refresh' : 'initial';
          if (slot === 'initial') {
            delete requestData.candidatePoolId;
            delete requestData.requestedCandidatePoolId;
          }
          const request = {
            ...options,
            data: { ...requestData, slot, presentationEvidenceMode: 'sanitized_v1' },
          };
          const record = {
            target: entry.name,
            auditId: typeof request.data.auditId === 'string' ? request.data.auditId : null,
            trigger: typeof request.data.trigger === 'string' ? request.data.trigger : null,
            slot,
            status: 'pending',
            injectedPresentationEvidenceMode: request.data.presentationEvidenceMode,
            requestIntercepted: true,
            actualInterceptedTarget: entry.name,
            responseSettled: false,
            responseRejected: false,
            rejectionCode: null,
            rejectionMessage: null,
          };
          tracker.calls.push(record);
          tracker.requestIntercepted = true;
          tracker.actualInterceptedTarget = entry.name;
          tracker.slot = slot;
          tracker.injectedPresentationEvidenceMode = request.data.presentationEvidenceMode;
          let pending;
          try {
            pending = original.call(this, request);
          } catch (error) {
            tracker.responseIntercepted = true;
            tracker.responseSettled = true;
            tracker.responseRejected = true;
            tracker.rejectionCode = error?.code ?? null;
            tracker.rejectionMessage = String(error?.message || error).slice(0, 512);
            record.status = 'rejected';
            record.responseSettled = true;
            record.responseRejected = true;
            record.error = { code: error?.code ?? null, message: String(error?.message || error).slice(0, 512) };
            record.rejectionCode = tracker.rejectionCode;
            record.rejectionMessage = tracker.rejectionMessage;
            throw error;
          }
          Promise.resolve(pending).then((value) => {
            tracker.responseIntercepted = true;
            tracker.responseSettled = true;
            tracker.responseRejected = false;
            tracker.rejectionCode = null;
            tracker.rejectionMessage = null;
            record.status = 'fulfilled';
            record.responseSettled = true;
            record.responseRejected = false;
            record.result = value;
            record.responseAuditId = responseAuditId(value);
            tracker.capturedResponseAuditId = record.responseAuditId || null;
          }, (error) => {
            tracker.responseIntercepted = true;
            tracker.responseSettled = true;
            tracker.responseRejected = true;
            tracker.rejectionCode = error?.code ?? null;
            tracker.rejectionMessage = String(error?.message || error).slice(0, 512);
            record.status = 'rejected';
            record.responseSettled = true;
            record.responseRejected = true;
            record.error = { code: error?.code ?? null, message: String(error?.message || error).slice(0, 512) };
            record.rejectionCode = tracker.rejectionCode;
            record.rejectionMessage = tracker.rejectionMessage;
            tracker.capturedResponseAuditId = null;
          });
          return pending;
        };
        tracker.wrapper = wrapped;
        try {
          Object.defineProperty(target, '__recommendationV61RunnerCapture', {
            configurable: true,
            value: tracker,
          });
          target.callFunction = wrapped;
          if (target.callFunction !== wrapped) throw new Error('callFunction replacement was not retained');
          registry[entry.name] = tracker;
          installedTrackers.push(tracker);
          return { installed: true, reused: false };
        } catch (error) {
          try { target.callFunction = original; } catch {}
          try { delete target.__recommendationV61RunnerCapture; } catch {}
          return { installed: false, reused: false, reason: String(error?.message || error).slice(0, 512) };
        }
      };

      availableEntries.forEach((entry) => {
        const resultForTarget = installOnTarget(entry);
        const diagnostic = targetDiagnostics.find((candidate) => candidate.target === entry.name);
        if (diagnostic) {
          diagnostic.hookInstalled = resultForTarget.installed;
          diagnostic.reason = resultForTarget.installed ? (resultForTarget.reused ? 'reused existing hook' : null) : resultForTarget.reason;
        }
      });
      targetEntries.filter((entry) => entry.available && entry.duplicate).forEach((entry) => {
        const diagnostic = targetDiagnostics.find((candidate) => candidate.target === entry.name);
        const primary = targetDiagnostics.find((candidate) => candidate.target === entry.duplicateOf);
        if (diagnostic && primary) {
          diagnostic.hookInstalled = primary.hookInstalled;
          diagnostic.reason = `same target as ${entry.duplicateOf}`;
        }
      });
      const availableTargets = targetDiagnostics.filter((entry) => entry.available).map((entry) => entry.target);
      const installedTargets = targetDiagnostics.filter((entry) => entry.hookInstalled).map((entry) => entry.target);
      const unavailableTargets = targetDiagnostics.filter((entry) => !entry.available).map((entry) => entry.target);
      const failedTargets = targetDiagnostics.filter((entry) => entry.available && !entry.hookInstalled).map((entry) => entry.target);
      if (failedTargets.length > 0) {
        rollback();
        return {
          installed: false,
          handshakeStatus: 'failed',
          captureHookInstalled: false,
          captureHookTarget: null,
          captureGeneration,
          targetDiagnostics,
          availableTargets,
          installedTargets: [],
          unavailableTargets,
          failedTargets,
          installedTargetCount: 0,
          requestBufferCount: 0,
          errorCode: 'CAPTURE_HOOK_INSTALL_FAILED',
          reason: 'capture hook installation rolled back after a target failure',
        };
      }
      return {
        installed: installedTargets.length > 0,
        reused: false,
        handshakeStatus: installedTargets.length > 0 ? 'passed' : 'failed',
        captureHookInstalled: installedTargets.length > 0,
        captureHookTarget: installedTargets.join(','),
        captureGeneration,
        requestBufferCount: installedTargets.reduce((count, targetName) => {
          const tracker = registry[targetName];
          return count + (Array.isArray(tracker?.calls) ? tracker.calls.length : 0);
        }, 0),
        targetDiagnostics,
        availableTargets,
        installedTargets,
        unavailableTargets,
        failedTargets,
        installedTargetCount: installedTargets.length,
        reason: failedTargets.length > 0 ? 'available capture targets could not be hooked' : null,
      };
    });
  } catch (caught) {
    throw gateError('CAPTURE_HOOK_INSTALL_FAILED', caught.message || caught);
  }
  result = {
    ...result,
    previousCaptureGeneration: previousGeneration,
    generationFresh: !previousGeneration || result.captureGeneration !== previousGeneration,
  };
  state.presentationCaptureDiagnostics = {
    ...state.presentationCaptureDiagnostics,
    captureHookInstalled: result.captureHookInstalled === true,
    captureHookTarget: result.captureHookTarget || null,
    captureGeneration: result.captureGeneration || null,
    previousCaptureGeneration: result.previousCaptureGeneration || null,
    generationFresh: result.generationFresh === true,
    requestBufferCount: Number(result.requestBufferCount) || 0,
    targetDiagnostics: result.targetDiagnostics || [],
    availableTargets: result.availableTargets || [],
    installedTargets: result.installedTargets || [],
    unavailableTargets: result.unavailableTargets || [],
    failedTargets: result.failedTargets || [],
    installedTargetCount: Number(result.installedTargetCount) || 0,
    handshakeStatus: result.handshakeStatus || 'failed',
    requestIntercepted: result.requestIntercepted === true,
    actualInterceptedTarget: result.actualInterceptedTarget || null,
    responseIntercepted: result.responseIntercepted === true,
    injectedPresentationEvidenceMode: result.injectedPresentationEvidenceMode || null,
    capturedResponseAuditId: result.capturedResponseAuditId || null,
  };
  if (!result?.installed) {
    const code = result?.errorCode || (result?.availableTargets?.length > 0
      ? 'CAPTURE_HOOK_INSTALL_FAILED'
      : 'CAPTURE_NO_AVAILABLE_TARGET');
    throw gateError(code, result?.reason || 'runtime capture was not installed');
  }
  state.presentationCaptureInstalled = true;
  return result;
}

async function installResetRecommendationBlocker() {
  if (!state.mini || typeof state.mini.evaluate !== 'function') {
    throw gateError(PRECONDITION_NOT_CLEAN, 'page reset requires DevTools evaluate support');
  }
  const result = await state.mini.evaluate(() => {
    const globalObject = typeof globalThis === 'object' ? globalThis : {};
    const candidates = [
      { target: globalObject.wx?.cloud, name: 'wx.cloud.callFunction' },
      { target: globalObject.Taro?.cloud, name: 'Taro.cloud.callFunction' },
      { target: globalObject.taro?.cloud, name: 'taro.cloud.callFunction' },
      { target: globalObject.cloudHelper, name: 'cloudHelper.callFunction' },
    ];
    const registry = globalObject.__recommendationV61RunnerResetBlocker
        && typeof globalObject.__recommendationV61RunnerResetBlocker === 'object'
        ? globalObject.__recommendationV61RunnerResetBlocker
        : { resetBlockerMarker: 'recommendation-v61-reset-blocker-v1', active: false, blockedGenerateOutfitCount: 0, targets: {}, restored: false, restorationCount: 0 };
    try {
      Object.defineProperty(globalObject, '__recommendationV61RunnerResetBlocker', {
        configurable: true,
        value: registry,
      });
    } catch {}

    const installedTargets = [];
    const failedTargets = [];
    const restorePartialInstall = () => {
      registry.active = false;
      Object.values(registry.targets || {}).forEach((entry) => {
        try {
          if (entry.target && entry.target.callFunction === entry.blocker) entry.target.callFunction = entry.original;
        } catch {}
      });
      registry.restored = true;
      registry.restorationCount = (Number(registry.restorationCount) || 0) + 1;
      try { delete globalObject.__recommendationV61RunnerResetBlocker; } catch {}
    };
    candidates.forEach((entry) => {
      const target = entry.target;
      if (!target || typeof target.callFunction !== 'function') return;
      const existing = registry.targets[entry.name];
      if (existing && target.callFunction === existing.blocker) {
        installedTargets.push(entry.name);
        return;
      }
      const original = target.callFunction;
      const blocker = function recommendationV61RunnerResetCallFunction(options) {
        if (registry.active && options && options.name === 'generateOutfit') {
          registry.blockedGenerateOutfitCount += 1;
          const error = new Error('recommendation call blocked while resetting Today page');
          error.code = 'RUNNER_RESET_BLOCKED';
          return Promise.reject(error);
        }
        return original.call(this, options);
      };
      try {
        target.callFunction = blocker;
        if (target.callFunction !== blocker) throw new Error('reset blocker replacement was not retained');
        registry.targets[entry.name] = { target, original, blocker };
        installedTargets.push(entry.name);
      } catch (error) {
        try { target.callFunction = original; } catch {}
        failedTargets.push({ target: entry.name, reason: String(error?.message || error) });
      }
    });
    const installed = installedTargets.length > 0 && failedTargets.length === 0;
    if (!installed) restorePartialInstall();
    return {
      installed,
      installedTargets,
      failedTargets,
      blockedGenerateOutfitCount: registry.blockedGenerateOutfitCount,
      restoredAfterInstallFailure: !installed,
      restorationCount: registry.restorationCount,
    };
  });
  if (!result?.installed) {
    throw gateError(PRECONDITION_NOT_CLEAN, 'could not install the temporary reset blocker', result || {});
  }
  return result;
}

async function setResetRecommendationBlockerActive(active) {
  if (!state.mini || typeof state.mini.evaluate !== 'function') {
    throw gateError(PRECONDITION_NOT_CLEAN, 'reset blocker state cannot be changed');
  }
  const result = await state.mini.evaluate((nextActive) => {
    const registry = globalThis.__recommendationV61RunnerResetBlocker;
    if (!registry || typeof registry !== 'object') return false;
    registry.active = nextActive === true;
    return registry.active;
  }, active === true);
  if (result !== (active === true)) {
    throw gateError(PRECONDITION_NOT_CLEAN, 'reset blocker state was not confirmed');
  }
  return result;
}

async function removeResetRecommendationBlocker() {
  if (!state.mini || typeof state.mini.evaluate !== 'function') return { removed: false };
  return state.mini.evaluate(() => {
    const globalObject = typeof globalThis === 'object' ? globalThis : {};
    const registry = globalObject.__recommendationV61RunnerResetBlocker;
    if (!registry || typeof registry !== 'object') return { removed: false };
    if (registry.restored === true) {
      return {
        removed: false,
        alreadyRestored: true,
        blockedGenerateOutfitCount: Number(registry.blockedGenerateOutfitCount) || 0,
        restorationCount: Number(registry.restorationCount) || 0,
      };
    }
    const targets = Object.values(registry.targets || {});
    const unknown = targets.filter((entry) => !entry
      || !entry.target
      || typeof entry.original !== 'function'
      || typeof entry.blocker !== 'function'
      || (entry.target.callFunction !== entry.blocker && entry.target.callFunction !== entry.original));
    if (unknown.length > 0) {
      return {
        removed: false,
        errorCode: 'PRECONDITION_UNKNOWN_WRAPPER',
        reason: 'reset blocker target no longer matches its known wrapper or original reference',
      };
    }
    registry.active = false;
    targets.forEach((entry) => {
      try {
        if (entry.target && entry.target.callFunction === entry.blocker) entry.target.callFunction = entry.original;
      } catch {}
    });
    const blockedGenerateOutfitCount = Number(registry.blockedGenerateOutfitCount) || 0;
    registry.restored = true;
    registry.restorationCount = (Number(registry.restorationCount) || 0) + 1;
    const restorationCount = registry.restorationCount;
    try { delete globalObject.__recommendationV61RunnerResetBlocker; } catch (error) {
      return { removed: false, errorCode: 'PRECONDITION_NOT_CLEAN', reason: String(error?.message || error) };
    }
    const restored = targets.every((entry) => entry.target.callFunction === entry.original);
    return { removed: restored, blockedGenerateOutfitCount, restorationCount };
  });
}

async function readPresentationCaptureGeneration() {
  if (!state.mini || typeof state.mini.evaluate !== 'function') {
    return {
      captureGeneration: null,
      requestBufferCount: 0,
      pendingRequestCount: 0,
      uncommittedResponseCount: 0,
      captureHookInstalled: false,
    };
  }
  return state.mini.evaluate(() => {
    const registry = globalThis.__recommendationV61RunnerCaptureRegistry;
    const trackers = registry && typeof registry === 'object'
      ? Object.values(registry).filter((tracker) => tracker && Array.isArray(tracker.calls))
      : [];
    const markerTargets = [
      globalThis.wx?.cloud,
      globalThis.Taro?.cloud,
      globalThis.taro?.cloud,
      globalThis.cloudHelper,
    ].filter(Boolean);
    return {
      captureGeneration: trackers.map((tracker) => tracker.captureGeneration).find(Boolean) || null,
      requestBufferCount: trackers.reduce((count, tracker) => count + tracker.calls.length, 0),
      pendingRequestCount: trackers.reduce((count, tracker) => (
        count + tracker.calls.filter((call) => call?.status === 'pending').length
      ), 0),
      uncommittedResponseCount: trackers.reduce((count, tracker) => (
        count + tracker.calls.filter((call) => call?.status !== 'pending' && call?.consumed !== true).length
      ), 0),
      captureHookInstalled: trackers.some((tracker) => tracker.captureHookInstalled !== false),
      wrapperMarkerPresent: markerTargets.some((target) => Boolean(target.__recommendationV61RunnerCapture)),
      registryPresent: Boolean(registry && typeof registry === 'object'),
      registryEntryCount: trackers.length,
    };
  });
}

function assertPresentationCaptureHandshakeReady({ expectedGeneration = null, requireEmptyBuffer = false } = {}) {
  const diagnostics = state.presentationCaptureDiagnostics;
  if (diagnostics.captureHookInstalled !== true
    || Number(diagnostics.installedTargetCount) < 1
    || !Array.isArray(diagnostics.installedTargets)
    || diagnostics.installedTargets.length < 1
    || diagnostics.handshakeStatus !== 'passed'
    || (expectedGeneration && diagnostics.captureGeneration !== expectedGeneration)
    || (requireEmptyBuffer && Number(diagnostics.requestBufferCount) !== 0)
    || (expectedGeneration && diagnostics.generationFresh !== true)) {
    throw gateError('CAPTURE_HOOK_INSTALL_FAILED', 'capture hook handshake is not ready before request');
  }
}

function validateFreshCaptureHandshake(installed, previousGeneration = null) {
  if (!installed || installed.handshakeStatus !== 'passed'
    || installed.generationFresh !== true
    || !installed.captureGeneration
    || (previousGeneration && installed.captureGeneration === previousGeneration)
    || Number(installed.requestBufferCount) !== 0) {
    throw gateError(PRECONDITION_HOOK_NOT_FRESH, 'fresh capture generation could not be proven');
  }
  assertPresentationCaptureHandshakeReady({
    expectedGeneration: installed.captureGeneration,
    requireEmptyBuffer: true,
  });
  return installed;
}

async function setPresentationCaptureSlot(slot) {
  if (!state.presentationCaptureInstalled) return;
  const normalizedSlot = slot === 'refresh' ? 'refresh' : 'initial';
  await state.mini.evaluate((targetSlot) => {
    const globalObject = typeof globalThis === 'object' ? globalThis : {};
    const registry = globalObject.__recommendationV61RunnerCaptureRegistry || {};
    const trackers = Object.values(registry).filter((tracker) => tracker && tracker.captureHookInstalled !== false);
    trackers.forEach((tracker) => { tracker.nextSlot = targetSlot; });
    return trackers.length > 0;
  }, normalizedSlot);
}

function clearRunnerStateAfterPageReset() {
  state.lifecycle = [];
  state.sanitizedLifecycle = [];
  state.cards = [];
  state.requestCaptures = [];
  state.runtimeCaptures.clear();
  state.requestSlots.clear();
  state.qaArtifacts = { initial: null, refresh: null };
  state.presentationEvidenceArtifacts = { initial: null, refresh: null };
  state.responseArtifacts = { initial: null, refresh: null };
  state.hasRealRequest = false;
  state.presentationCaptureInstalled = false;
  state.presentationCaptureDiagnostics = createPresentationCaptureDiagnostics();
}

async function resetCurrentUserRecommendationCache() {
  if (!state.mini || typeof state.mini.callWxMethod !== 'function') {
    throw gateError(PRECONDITION_NOT_CLEAN, 'precise recommendation cache reset requires callWxMethod');
  }
  const openid = await state.mini.callWxMethod('getStorageSync', 'openid');
  const normalizedOpenid = normalizeOpenidForStorageScope(openid);
  if (!normalizedOpenid) throw gateError(PRECONDITION_NOT_CLEAN, 'active user scope is unavailable for precise reset');
  const beforeInfo = await state.mini.callWxMethod('getStorageInfoSync');
  const beforeKeys = Array.isArray(beforeInfo?.keys) ? beforeInfo.keys.map(String) : [];
  const userMarker = `:user:${normalizedOpenid}:`;
  const restoreSuffix = `:${TODAY_RESTORE_SNAPSHOT_BUSINESS_KEY}`;
  const encodedScenePrefix = `:${encodeURIComponent(TODAY_SCENE_SNAPSHOT_BUSINESS_PREFIX)}:`;
  const targetKeys = beforeKeys.filter((key) => key.startsWith(`${USER_STORAGE_PREFIX}:`)
    && key.includes(userMarker)
    && (key.endsWith(restoreSuffix) || key.includes(encodedScenePrefix)));
  const preservedKeysBefore = beforeKeys.filter((key) => !targetKeys.includes(key)).sort();
  for (const key of targetKeys) await state.mini.callWxMethod('removeStorageSync', key);
  const afterInfo = await state.mini.callWxMethod('getStorageInfoSync');
  const afterKeys = Array.isArray(afterInfo?.keys) ? afterInfo.keys.map(String) : [];
  const preservedKeysAfter = afterKeys.filter((key) => !targetKeys.includes(key)).sort();
  const remainingTargets = targetKeys.filter((key) => afterKeys.includes(key));
  const nonTargetKeysUnchanged = JSON.stringify(preservedKeysBefore) === JSON.stringify(preservedKeysAfter);
  if (remainingTargets.length > 0 || !nonTargetKeysUnchanged) {
    throw gateError(PRECONDITION_NOT_CLEAN, 'precise recommendation cache reset changed unexpected storage keys', {
      targetCount: targetKeys.length,
      remainingTargetCount: remainingTargets.length,
      preservedKeyCountBefore: preservedKeysBefore.length,
      preservedKeyCountAfter: preservedKeysAfter.length,
      nonTargetKeysUnchanged,
    });
  }
  const result = {
    strategy: 'current-user-explicit-recommendation-cache-keys',
    removedTodayRestoreSnapshotCount: targetKeys.filter((key) => key.endsWith(restoreSuffix)).length,
    removedSceneSnapshotCount: targetKeys.filter((key) => key.includes(encodedScenePrefix)).length,
    removedTotal: targetKeys.length,
    preservedKeyCount: preservedKeysAfter.length,
    nonTargetKeysUnchanged,
    fullStorageClearUsed: false,
    preservedNamespaces: [
      'wardrobe', 'recommendationInputVersions', 'profile/preferences', 'auth/identity',
      'weather', 'exposure', 'favorites/history', 'all-other-storage',
    ],
  };
  state.recommendationCacheReset = result;
  return result;
}

function snapshotMatchesRenderedState(pageState) {
  const storage = pageState?.snapshot;
  const cardCount = pageState?.outfitCardCount;
  const batchCardCount = pageState?.hasBatchCardCount;
  if (!storage?.observable || !Number.isInteger(cardCount) || !Number.isInteger(batchCardCount)) return false;
  const today = storage.today;
  const scene = storage.scene;
  if (!today && !scene) return cardCount === 0 && batchCardCount === 0;
  const active = scene || today;
  if (!active || active.sceneKey !== pageState.activeScene) return false;
  if (today && today.sceneKey !== pageState.activeScene) return false;
  if (scene && today && !sameRecommendationSnapshotIdentity(scene, today)) return false;
  if (!Number.isInteger(active.expectedCardCount) || !Number.isInteger(active.returnedCardCount)) return false;
  if (active.expectedCardCount !== active.returnedCardCount || active.outfitCount !== active.returnedCardCount) return false;
  if (cardCount !== active.returnedCardCount) return false;
  if (active.returnedCardCount > 0 && batchCardCount !== active.returnedCardCount) return false;
  if (active.returnedCardCount === 0) {
    return batchCardCount === 0
      && active.batchExhausted === true
      && active.hasRecommendations === false;
  }
  return true;
}

function isCleanTodayAcceptanceState(snapshot, options = {}) {
  const expectedScene = options.expectedScene || null;
  const requireEmptyCaptureBuffer = options.requireEmptyCaptureBuffer === true;
  return Boolean(snapshot)
    && snapshot.path === TODAY_PAGE_PATH
    && (!expectedScene || snapshot.activeScene === expectedScene)
    && snapshot.tabCount === 4
    && snapshot.sportTabCount === 1
    && snapshot.loadingStateCount === 0
    && snapshot.sceneLoadingOverlayCount === 0
    && Number(snapshot.lifecycle?.pendingIntentCount) === 0
    && Number(snapshot.capture?.pendingRequestCount) === 0
    && Number(snapshot.capture?.uncommittedResponseCount) === 0
    && (!requireEmptyCaptureBuffer || Number(snapshot.capture?.requestBufferCount) === 0)
    && snapshotMatchesRenderedState(snapshot);
}

async function prepareSportAcceptancePrecondition(options = {}) {
  const keepBlocker = options.keepBlocker === true;
  const resetBeforeRestore = options.resetBeforeRestore === true;
  let before;
  let captureBefore;
  try {
    before = await readTodayAcceptanceState();
    captureBefore = await readPresentationCaptureGeneration();
    if (Number(captureBefore.pendingRequestCount) > 0 || Number(captureBefore.uncommittedResponseCount) > 0) {
      throw gateError(PRECONDITION_NOT_CLEAN, 'an earlier recommendation response is still pending or uncommitted', {
        captureBefore,
      });
    }
    if (!resetBeforeRestore && !isCleanTodayAcceptanceState(before)) {
      before = await waitUntil(async () => {
        const current = await readTodayAcceptanceState();
        return isCleanTodayAcceptanceState(current) ? current : null;
      }, 12000, 'idle and internally consistent Today page before acceptance reset');
    }
  } catch (caught) {
    state.sportPrecondition = {
      status: 'blocked',
      before: null,
      reset: null,
      after: null,
      hookReadyAfterReset: null,
    };
    markRunnerBlocked(PRECONDITION_NOT_CLEAN, caught.message || caught, { stage: 'read-before-reset' });
    return { ok: false, before: null, after: null, error: caught };
  }
  state.sportPrecondition = {
    status: 'checking',
    before,
    reset: null,
    after: null,
    hookReadyAfterReset: 'NOT_INSTALLED_YET',
  };
  const resetStartedAt = now();
  let blockerAttempted = false;
  let blockerInstalled = false;
  let blocker = null;
  let blockerStatus = null;
  let removed = null;
  let staleBlocker = null;
  let captureRestore = null;
  let cacheReset = null;
  let after = null;
  let resetError = null;
  let restoreError = null;
  try {
    if (!resetBeforeRestore && before.path !== TODAY_PAGE_PATH) {
      throw gateError(PRECONDITION_NOT_CLEAN, `expected Today page before reset, observed ${before.path}`);
    }
    staleBlocker = await removeResetRecommendationBlocker();
    if (staleBlocker?.errorCode) {
      throw gateError(staleBlocker.errorCode, staleBlocker.reason || 'stale reset blocker could not be proven safe to remove');
    }
    if (!resetBeforeRestore) captureRestore = await restoreExistingPresentationEvidenceCapture();
    clearRunnerStateAfterPageReset();
    blockerAttempted = true;
    blocker = await installResetRecommendationBlocker();
    blockerInstalled = blocker?.installed === true;
    if (!blockerInstalled) {
      throw gateError(PRECONDITION_NOT_CLEAN, 'could not install the temporary reset blocker');
    }
    await setResetRecommendationBlockerActive(true);
    cacheReset = await resetCurrentUserRecommendationCache();
    if (!state.mini || typeof state.mini.reLaunch !== 'function') {
      throw gateError(PRECONDITION_NOT_CLEAN, 'miniprogram-automator reLaunch is unavailable');
    }
    await state.mini.reLaunch(TODAY_RELAUNCH_URL);
    await waitUntil(async () => {
      const current = await readTodayAcceptanceState();
      return current.path === TODAY_PAGE_PATH ? current : null;
    }, 12000, 'Today page after reLaunch');
    after = await waitUntil(async () => {
      const current = await readTodayAcceptanceState();
      const settled = Date.now() - Date.parse(resetStartedAt) >= RESET_SETTLE_MS;
      return settled && isCleanTodayAcceptanceState(current, { expectedScene: 'home' }) ? current : null;
    }, 20000, 'idle and internally consistent Today page after precise reset');
    if (before?.pageInstanceId !== 'NOT_OBSERVED'
      && after?.pageInstanceId !== 'NOT_OBSERVED'
      && before?.pageInstanceId === after?.pageInstanceId) {
      throw gateError(PRECONDITION_NOT_CLEAN, 'mini.reLaunch did not create a new Today page instance', {
        beforePageInstanceId: before.pageInstanceId,
        afterPageInstanceId: after.pageInstanceId,
      });
    }
    if (resetBeforeRestore) captureRestore = await restoreExistingPresentationEvidenceCapture();
    blockerStatus = await state.mini.evaluate(() => {
      const registry = globalThis.__recommendationV61RunnerResetBlocker;
      return registry && typeof registry === 'object'
        ? { blockedGenerateOutfitCount: Number(registry.blockedGenerateOutfitCount) || 0 }
        : { blockedGenerateOutfitCount: 'NOT_OBSERVED' };
    });
  } catch (caught) {
    resetError = caught;
    after = await readTodayAcceptanceState().catch(() => null);
  } finally {
    if (blockerAttempted && (!keepBlocker || resetError)) {
      try {
        if (blockerInstalled) await setResetRecommendationBlockerActive(false);
      } catch (caught) {
        restoreError = caught;
      } finally {
        try {
          removed = await removeResetRecommendationBlocker();
          if (blockerInstalled && removed?.removed !== true && !restoreError) {
            restoreError = gateError(
              removed?.errorCode || PRECONDITION_NOT_CLEAN,
              removed?.reason || 'temporary reset blocker was not restored',
            );
          }
        } catch (caught) {
          if (!restoreError) restoreError = caught;
        }
      }
    }
  }
  if (resetError || restoreError) {
    state.sportPrecondition.reset = {
      method: 'mini.reLaunch(/pages/today/index)',
      startedAt: resetStartedAt,
      completedAt: now(),
      pageMemoryRecreated: resetError ? false : true,
      blockerTargets: blocker?.installedTargets || [],
      blockedGenerateOutfitCount: blockerStatus?.blockedGenerateOutfitCount ?? 'NOT_OBSERVED',
      blockerRemoved: removed?.removed === true,
      blockerActive: keepBlocker && !resetError && !restoreError,
      restorationCount: removed?.restorationCount ?? blocker?.restorationCount ?? 'NOT_OBSERVED',
      noBusinessRequestSent: blockerStatus?.blockedGenerateOutfitCount !== 'NOT_OBSERVED',
      noRefresh: true,
      noCaptureBatch: true,
      noScreenshot: true,
      snapshotStorage: 'page-memory:sceneSnapshotsRef',
      preciseCacheReset: cacheReset,
      staleBlocker,
      captureRestore,
    };
    state.sportPrecondition.after = after;
    state.sportPrecondition.status = 'blocked';
    markRunnerBlocked(PRECONDITION_NOT_CLEAN, (resetError || restoreError).message || (resetError || restoreError), {
      before,
      after,
      reset: state.sportPrecondition.reset,
      captureGenerationBefore: captureBefore?.captureGeneration || null,
      restoreError: restoreError?.message || null,
    });
    return { ok: false, before, after, captureBefore, error: resetError || restoreError };
  }

  state.sportPrecondition.reset = {
    method: 'mini.reLaunch(/pages/today/index)',
    startedAt: resetStartedAt,
    completedAt: now(),
    pageMemoryRecreated: true,
    blockerTargets: blocker?.installedTargets || [],
    blockedGenerateOutfitCount: blockerStatus?.blockedGenerateOutfitCount ?? 'NOT_OBSERVED',
    blockerRemoved: removed?.removed === true,
    blockerActive: keepBlocker,
    restorationCount: removed?.restorationCount ?? 'NOT_OBSERVED',
    noBusinessRequestSent: true,
    noRefresh: true,
    noCaptureBatch: true,
    noScreenshot: true,
    snapshotStorage: 'current-user persistent Today and scene snapshot keys',
    preciseCacheReset: cacheReset,
    captureGenerationBefore: captureBefore?.captureGeneration || null,
    requestBufferCountBefore: captureBefore?.requestBufferCount ?? 'NOT_OBSERVED',
    staleBlocker,
    captureRestore,
  };
  clearRunnerStateAfterPageReset();
  after = await readTodayAcceptanceState();
  if (!isCleanTodayAcceptanceState(after, { expectedScene: 'home', requireEmptyCaptureBuffer: true })) {
    const caught = gateError(PRECONDITION_NOT_CLEAN, 'acceptance baseline was not clean after precise reset', { after });
    state.sportPrecondition.after = after;
    state.sportPrecondition.status = 'blocked';
    markRunnerBlocked(PRECONDITION_NOT_CLEAN, caught.message, caught.details);
    return { ok: false, before, after, captureBefore, error: caught };
  }
  const counters = recommendationCounterBaseline('post-reset');
  state.acceptanceBaseline = {
    establishedAt: now(),
    pageInstanceId: after.pageInstanceId,
    route: after.path,
    activeScene: after.activeScene,
    requestCount: state.requestCaptures.length,
    intentStartCount: counters.intentStartCount,
    capturedRequestCount: counters.capturedRequestCount,
    pendingIntentCount: after.lifecycle.pendingIntentCount,
    captureRequestBufferCount: after.capture.requestBufferCount,
    capturePendingRequestCount: after.capture.pendingRequestCount,
    captureUncommittedResponseCount: after.capture.uncommittedResponseCount,
    automatorWsEndpoint: RUNNER_CONFIG.automatorWsEndpoint,
  };
  state.sportPrecondition.after = after;
  state.sportPrecondition.status = 'clean';
  return {
    ok: true,
    before,
    after,
    captureBefore,
    blocker,
    blockerStatus,
    blockerRetained: keepBlocker,
    cacheReset,
    baseline: state.acceptanceBaseline,
  };
}

async function readPresentationCaptureStatus(auditId) {
  if (!state.presentationCaptureInstalled) return { captureHookInstalled: false };
  const status = await state.mini.evaluate((targetAuditId) => {
    const globalObject = typeof globalThis === 'object' ? globalThis : {};
    const registry = globalObject.__recommendationV61RunnerCaptureRegistry || {};
    const trackers = Object.values(registry).filter((tracker) => tracker && Array.isArray(tracker.calls));
    if (!trackers.length) return {
      captureHookInstalled: false,
      requestIntercepted: false,
      responseIntercepted: false,
      responseSettled: false,
      responseRejected: false,
    };
    const responseAuditId = (value) => {
      const outer = value?.result || value || {};
      const data = outer?.data || outer?.result?.data || {};
      const candidate = data?.debug?.auditId || data?.meta?.auditId || data?.qaBatchAudit?.auditId;
      return typeof candidate === 'string' ? candidate : null;
    };
    const calls = trackers.flatMap((tracker) => tracker.calls);
    const request = calls.find((entry) => entry.auditId === targetAuditId
      || entry.responseAuditId === targetAuditId || responseAuditId(entry.result) === targetAuditId) || null;
    const correlatedResponse = calls.find((entry) => entry.status !== 'pending'
      && (entry.responseAuditId === targetAuditId || responseAuditId(entry.result) === targetAuditId)) || null;
    const completed = calls.filter((entry) => entry.status !== 'pending');
    return {
      captureHookInstalled: trackers.some((tracker) => tracker.captureHookInstalled !== false),
      captureHookTarget: trackers.map((tracker) => tracker.captureHookTarget).filter(Boolean).join(',') || null,
      captureGeneration: trackers.map((tracker) => tracker.captureGeneration).find(Boolean) || null,
      requestIntercepted: Boolean(request),
      actualInterceptedTarget: request?.target || null,
      slot: request?.slot || null,
      responseIntercepted: Boolean(request && request.status !== 'pending'),
      responseSettled: request?.responseSettled === true,
      responseRejected: request?.responseRejected === true,
      rejectionCode: request?.rejectionCode ?? null,
      rejectionMessage: request?.rejectionMessage || null,
      auditCorrelationAvailable: Boolean(correlatedResponse),
      anyRequestIntercepted: calls.length > 0,
      completedRequestCount: completed.length,
      injectedPresentationEvidenceMode: request?.injectedPresentationEvidenceMode || null,
      capturedResponseAuditId: correlatedResponse?.responseAuditId || null,
    };
  }, auditId);
  state.presentationCaptureDiagnostics = {
    ...state.presentationCaptureDiagnostics,
    ...status,
  };
  return status;
}

async function readPresentationEvidenceRuntimeCapture(auditId) {
  if (!state.presentationCaptureInstalled) return null;
  return state.mini.evaluate((targetAuditId) => {
    const globalObject = typeof globalThis === 'object' ? globalThis : {};
    const registry = globalObject.__recommendationV61RunnerCaptureRegistry || {};
    const trackers = Object.values(registry).filter((tracker) => tracker && Array.isArray(tracker.calls));
    const responseAuditId = (value) => {
      const outer = value?.result || value || {};
      const data = outer?.data || outer?.result?.data || {};
      const candidate = data?.debug?.auditId || data?.meta?.auditId || data?.qaBatchAudit?.auditId;
      return typeof candidate === 'string' ? candidate : null;
    };
    const record = trackers.flatMap((tracker) => tracker.calls).find((entry) => entry.status !== 'pending' && !entry.consumed
      && (entry.responseAuditId === targetAuditId || responseAuditId(entry.result) === targetAuditId));
    if (!record) return null;
    record.consumed = true;
    return record;
  }, auditId);
}

function captureFailureReason(status, auditId) {
  if (!status?.requestIntercepted || !status.actualInterceptedTarget
    || status.injectedPresentationEvidenceMode !== PRESENTATION_EVIDENCE_MODE) {
    return 'request_not_intercepted';
  }
  if (!status.responseIntercepted) return 'response_not_intercepted';
  if (!status.auditCorrelationAvailable || status.capturedResponseAuditId !== auditId) {
    return 'audit_correlation_failed';
  }
  return null;
}

function presentationEvidenceBudgetFailure(capture, auditId) {
  const status = capture?.presentationEvidenceStatus;
  if (!status || status.status !== 'omitted_over_budget') return null;
  const failure = gateError(
    'PRESENTATION_EVIDENCE_OVER_BUDGET',
    `presentation evidence exceeds ${Number(status.limitBytes) || PRESENTATION_EVIDENCE_MAX_BYTES} bytes: ${Number(status.actualBytes) || 0}`,
  );
  failure.auditId = auditId || null;
  failure.presentationEvidenceStatus = status;
  return failure;
}

function runtimeCaptureFailure(reason, auditId, trigger, status) {
  const codeByReason = {
    request_not_intercepted: 'CAPTURE_REQUEST_NOT_INTERCEPTED',
    response_not_intercepted: 'CAPTURE_RESPONSE_NOT_INTERCEPTED',
    audit_correlation_failed: 'CAPTURE_AUDIT_CORRELATION_FAILED',
  };
  const code = codeByReason[reason] || 'RUNTIME_CAPTURE_FAILED';
  error(code, `runtime response capture failed: ${reason}`, {
    auditId,
    trigger,
    captureFailureReason: reason,
    capture: status,
  });
  return null;
}

async function waitAndRecordRuntimeCapture(auditId, trigger, slot) {
  if (!RUNNER_CONFIG.capturePresentationEvidence) return null;
  const deadline = Date.now() + 12000;
  let status = await readPresentationCaptureStatus(auditId);
  if (!status.captureHookInstalled) return runtimeCaptureFailure('request_not_intercepted', auditId, trigger, status);
  const initialFailure = captureFailureReason(status, auditId);
  if (initialFailure === 'request_not_intercepted') return runtimeCaptureFailure(initialFailure, auditId, trigger, status);
  while (Date.now() < deadline) {
    const call = await readPresentationEvidenceRuntimeCapture(auditId);
    if (call) {
      const capture = recordRuntimeResponseCapture(call, { auditId, trigger, slot });
      const capturedStatus = await readPresentationCaptureStatus(auditId);
      if (!capturedStatus.responseIntercepted) {
        return runtimeCaptureFailure('response_not_intercepted', auditId, trigger, capturedStatus);
      }
      if (capturedStatus.capturedResponseAuditId !== auditId) {
        return runtimeCaptureFailure('audit_correlation_failed', auditId, trigger, capturedStatus);
      }
      return capture;
    }
    status = await readPresentationCaptureStatus(auditId);
    if (!status.captureHookInstalled) return runtimeCaptureFailure('request_not_intercepted', auditId, trigger, status);
    if (captureFailureReason(status, auditId) === 'request_not_intercepted') {
      return runtimeCaptureFailure('request_not_intercepted', auditId, trigger, status);
    }
    await delay(200);
  }
  return runtimeCaptureFailure(captureFailureReason(status, auditId) || 'response_not_intercepted', auditId, trigger, status);
}

function rememberQaArtifact(auditId, slot, resolution = null) {
  if (!slot || !Object.prototype.hasOwnProperty.call(state.qaArtifacts, slot)) return;
  const qa = state.lifecycle.find((entry) => entry.label === '[RecommendationQA]' && entry.payload?.auditId === auditId);
  const qaResolution = resolution || resolveQaPayload(auditId, qa?.payload || null);
  if (qaResolution.payload) state.qaArtifacts[slot] = {
    ...compact(qaResolution.payload, 6),
    ...normalizeQaObservation(qaResolution.payload),
    qaSource: qaResolution.source,
  };
}

async function persistRuntimePresentationEvidence(auditId, slot) {
  const capture = state.runtimeCaptures.get(auditId);
  if (!capture) throw gateError('PRESENTATION_EVIDENCE_CAPTURE_MISSING', `no runtime capture for ${auditId}`);
  persistResponseArtifacts(capture, slot);
  if (capture.status !== 'fulfilled' || !capture.hasResponse || capture.responseCode !== null && capture.responseCode !== 0) {
    return { status: 'not_applicable', reason: 'request did not return a successful response' };
  }
  rememberQaArtifact(auditId, slot);
  if (!capture.presentationCapture) {
    throw gateError('PRESENTATION_EVIDENCE_MISSING', `successful response did not contain presentation evidence for ${auditId}`);
  }
  return persistPresentationEvidenceCapture(capture, slot);
}

function shouldRunPresentationRefresh(audit, config = RUNNER_CONFIG) {
  return config.capturePresentationEvidence === true
    && audit?.slot === 'initial'
    && audit?.terminal?.label === '[RecommendDone]'
    && audit?.runtimeCapture?.status === 'fulfilled'
    && audit?.runtimeCapture?.presentationEvidenceStatus?.status !== 'omitted_over_budget';
}

async function waitAudit(from, expectedSceneKey, slot = 'initial') {
  const waitStartedAt = now();
  let start;
  try {
    start = await waitUntil(() => state.lifecycle.slice(from).find((entry) => (
      entry.label === '[RecommendStart]' && (!expectedSceneKey || entry.payload?.sceneKey === expectedSceneKey)
    )), 32000, `RecommendStart ${expectedSceneKey || ''}`);
  } catch (caught) {
    const waitEndedAt = now();
    if (expectedSceneKey === 'sport' && slot === 'initial') {
      const after = await readTodayAcceptanceState().catch(() => null);
      state.sportAction = {
        ...state.sportAction,
        status: 'failed',
        after,
        waitStartedAt,
        waitEndedAt,
      };
      throw gateError('SPORT_ACTION_NO_RECOMMEND_START', 'Sport action completed without RecommendStart', {
        actionBefore: state.sportAction.before,
        actionAfter: after,
        tapResult: state.sportAction.tapResult,
        tapError: state.sportAction.tapError,
        waitStartedAt,
        waitEndedAt,
        lifecycleStartIndex: from,
        observedRecommendStartCount: state.lifecycle.slice(from).filter((entry) => entry.label === '[RecommendStart]').length,
        originalTimeout: String(caught.message || caught),
      });
    }
    throw caught;
  }
  const auditId = start.payload.auditId;
  const terminal = await waitUntil(() => {
    const terminals = state.lifecycle.filter((entry) => (
      entry.payload?.auditId === auditId && ['[RecommendDone]', '[RecommendReject]', '[RecommendError]'].includes(entry.label)
    ));
    return terminals.at(-1);
  }, 45000, `terminal audit ${auditId}`);
  state.requestSlots.set(auditId, slot);
  const runtimeCapture = await waitAndRecordRuntimeCapture(auditId, start.payload?.trigger || null, slot);
  let response = null;
  let qa = null;
  if (terminal.label === '[RecommendDone]') {
    try {
      response = await waitUntil(() => state.lifecycle.find((entry) => entry.label === '[RecommendResponse]' && entry.payload?.auditId === auditId), 12000, `Response ${auditId}`);
    } catch (caught) {
      fail('EVIDENCE_INCOMPLETE', 'successful audit is missing RecommendResponse', { auditId, missing: 'RecommendResponse' });
      throw caught;
    }
    const earlyQaResolution = resolveQaPayload(auditId, null, response?.payload || null);
    if (earlyQaResolution.status !== 'authoritative') {
      try {
        qa = await waitUntil(() => state.lifecycle.find((entry) => entry.label === '[RecommendationQA]' && entry.payload?.auditId === auditId), 12000, `QA ${auditId}`);
      } catch {
        qa = null;
      }
    }
    const qaResolution = resolveQaPayload(auditId, qa?.payload || null, response?.payload || null);
    if (!qaResolution.payload) {
      fail('EVIDENCE_INCOMPLETE', 'successful audit is missing an authoritative or partial QA payload', {
        auditId,
        missing: 'qaBatchAudit/RecommendationQA',
      });
      throw gateError('EVIDENCE_INCOMPLETE', `missing QA payload for ${auditId}`);
    }
    qa = {
      ...(qa || { timestamp: now(), label: '[RecommendationQA]' }),
      payload: qaResolution.payload,
      qaSource: qaResolution.source,
    };
    rememberQaArtifact(auditId, slot, qaResolution);
    const latestTerminal = state.lifecycle.filter((entry) => (
      entry.payload?.auditId === auditId && ['[RecommendDone]', '[RecommendReject]', '[RecommendError]'].includes(entry.label)
    )).at(-1);
    if (latestTerminal && latestTerminal.label !== '[RecommendDone]') {
      recordTerminalRequestFailure(auditId, latestTerminal, response.payload);
      return { auditId, start, terminal: latestTerminal, response, qa };
    }
    validateVersionContract(auditId, response.payload, qa.payload);
    validateCandidatePoolDiagnostics(auditId, runtimeCapture?.rawResponse || null, response.payload, qa.payload);
    validateCanonicalQa(auditId, qa.payload);
    if (RUNNER_CONFIG.capturePresentationEvidence && runtimeCapture?.status === 'fulfilled') {
      const budgetFailure = presentationEvidenceBudgetFailure(runtimeCapture, auditId);
      if (budgetFailure) throw budgetFailure;
      if (!runtimeCapture.presentationCapture) {
        throw gateError('PRESENTATION_EVIDENCE_MISSING', `successful response did not contain presentation evidence for ${auditId}`);
      }
    }
  } else if (terminal.label === '[RecommendError]' || terminal.label === '[RecommendReject]') {
    // Request failures are terminal evidence in their own right. They do not
    // have a successful response contract, so version validation is not applicable.
    response = state.lifecycle.find((entry) => entry.label === '[RecommendResponse]' && entry.payload?.auditId === auditId);
    recordTerminalRequestFailure(auditId, terminal, response?.payload || null);
  }
  return { auditId, start, terminal, response, qa, runtimeCapture, slot };
}

async function action(name, scene, run, slot = 'initial') {
  const from = state.lifecycle.length;
  const startedAt = now();
  try {
    if (RUNNER_CONFIG.capturePresentationEvidence) {
      assertPresentationCaptureHandshakeReady();
      await setPresentationCaptureSlot(slot);
    }
    await run();
    const audit = await waitAudit(from, scene, slot);
    state.requestSlots.set(audit.auditId, slot);
    if (RUNNER_CONFIG.capturePresentationEvidence && scene === 'sport') {
      rememberQaArtifact(audit.auditId, slot);
      if (audit?.terminal?.label === '[RecommendDone]' && audit.runtimeCapture) {
        await persistRuntimePresentationEvidence(audit.auditId, slot);
      }
    }
    const status = audit.terminal.label === '[RecommendDone]' ? 'completed' : 'failed';
    if (status !== 'completed') fail('MATRIX_STEP_FAILED', 'recommendation action did not complete successfully', { name, scene, auditId: audit.auditId });
    state.matrix.push({ name, status, auditId: audit.auditId, startedAt });
    return audit;
  } catch (caught) {
    if (caught?.code === PRECONDITION_NOT_CLEAN) {
      if (!state.runnerBlocked) markRunnerBlocked(PRECONDITION_NOT_CLEAN, caught.message || caught, { name, scene });
      state.matrix.push({ name, status: 'blocked', startedAt, error: String(caught.message || caught) });
      return null;
    }
    if (typeof caught?.code === 'string'
      && (caught.code.startsWith('CAPTURE_')
        || caught.code === 'PRESENTATION_EVIDENCE_MISSING'
        || caught.code === 'PRESENTATION_EVIDENCE_OVER_BUDGET')) {
      error(caught.code, caught.message || caught, { name, scene });
    }
    fail('MATRIX_STEP_FAILED', caught.message || caught, { name, scene });
    state.matrix.push({ name, status: 'failed', startedAt, error: String(caught.message || caught) });
    return null;
  }
}

async function interaction(name, run) {
  const startedAt = now();
  try {
    await run();
    state.matrix.push({ name, status: 'completed', startedAt });
    return true;
  } catch (caught) {
    fail('MATRIX_INTERACTION_FAILED', caught.message || caught, { name });
    state.matrix.push({ name, status: 'failed', startedAt, error: String(caught.message || caught) });
    return false;
  }
}

async function readTodaySnapshot() {
  try {
    const openid = await state.mini.callWxMethod('getStorageSync', 'openid');
    const normalizedOpenid = normalizeOpenidForStorageScope(openid);
    const storageInfo = await state.mini.callWxMethod('getStorageInfoSync');
    const keys = Array.isArray(storageInfo?.keys) ? storageInfo.keys.map(String) : [];
    const userMarker = `:user:${normalizedOpenid}:`;
    const key = normalizedOpenid
      ? keys.find((entry) => entry.startsWith(`${USER_STORAGE_PREFIX}:`)
        && entry.includes(userMarker)
        && entry.endsWith(`:${TODAY_RESTORE_SNAPSHOT_BUSINESS_KEY}`))
      : null;
    if (!key) return [];
    const snapshot = await state.mini.callWxMethod('getStorageSync', key);
    const expectedCount = Number.isInteger(snapshot?.countContract?.expectedCardCount)
      ? snapshot.countContract.expectedCardCount
      : (Array.isArray(snapshot?.outfits) ? snapshot.outfits.length : 0);
    const result = Array.isArray(snapshot?.outfits) ? snapshot.outfits.slice(0, expectedCount).map((outfit) => ({
      outfitId: typeof outfit.id === 'string' ? outfit.id : null,
      outfitKey: typeof outfit.outfitKey === 'string' ? outfit.outfitKey : null,
      itemIds: Array.isArray(outfit.clothingIds) ? outfit.clothingIds.map(String) : [],
      title: typeof outfit.title === 'string' ? outfit.title : null,
      tags: Array.isArray(outfit.styleTags) ? outfit.styleTags : [],
      todayReason: typeof outfit.copyContract?.todayReason === 'string' ? outfit.copyContract.todayReason : null,
      weather: outfit.weatherSnapshot || null,
    })) : [];
    Object.defineProperties(result, {
      countContract: { value: snapshot?.countContract || null, enumerable: false },
      limited: { value: snapshot?.batchLimited === true, enumerable: false },
      exhausted: { value: snapshot?.batchExhausted === true, enumerable: false },
    });
    return result;
  } catch (caught) {
    error('SNAPSHOT_READ_FAILED', caught.message || caught);
    return [];
  }
}

function annotateBatch(records, metadata) {
  Object.defineProperties(records, {
    expectedCount: { value: metadata.expectedCount, enumerable: false },
    limited: { value: metadata.limited === true, enumerable: false },
    exhausted: { value: metadata.exhausted === true, enumerable: false },
    requireScreenshots: { value: metadata.requireScreenshots === true, enumerable: false },
    evidenceComplete: { value: metadata.evidenceComplete === true, enumerable: false },
  });
  return records;
}

async function findDisplayedCard(expectedIndex, total) {
  const expected = `${expectedIndex} / ${total}`;
  const currentPage = await page();
  const swiper = await currentPage.$('.outfit-swiper');
  if (!swiper) return null;
  const snapshot = await readTodaySnapshot();
  const active = await readActiveSwiperState(currentPage, swiper, snapshot);
  return active.targetCounter === expected
    && active.current === expectedIndex - 1
    && active.activeDotIndex === expectedIndex - 1
    && active.targetOutfitMatchesTarget
    ? active.card
    : null;
}

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseCounter(value) {
  const match = String(value || '').match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!match) return null;
  return { index: Number(match[1]) - 1, total: Number(match[2]) };
}

async function optionalElementValue(element, method, argument) {
  if (!element || typeof element[method] !== 'function') return null;
  try {
    return await element[method](argument);
  } catch {
    return null;
  }
}

function normalizeIdentity(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function snapshotOutfitIdentity(snapshot, index) {
  const outfit = snapshot?.[index];
  return normalizeIdentity(outfit?.outfitKey) || normalizeIdentity(outfit?.outfitId) || null;
}

function outfitIdentityHash(identity) {
  return identity ? truncatedSha256(identity, 'swiper-outfit-v1') : null;
}

async function readCardOutfitIdentity(card, fallbackIdentity) {
  const names = ['data-outfit-key', 'data-outfit-id', 'outfit-key', 'outfit-id', 'outfitKey', 'outfitId'];
  for (const name of names) {
    const attribute = normalizeIdentity(await optionalElementValue(card, 'attribute', name));
    if (attribute) return attribute;
    const property = normalizeIdentity(await optionalElementValue(card, 'property', name));
    if (property) return property;
  }
  return fallbackIdentity;
}

function sameHorizontalPosition(left, right, width) {
  if (![left, right, width].every((value) => Number.isFinite(value))) return false;
  return Math.abs(left - right) <= Math.max(3, width * 0.03);
}

async function readActiveSwiperState(pageInstance, swiper, snapshot = [], requestedTargetIndex = null) {
  // swiper.offset() and swiper.size() must come from the freshly queried node.
  let currentSwiper = null;
  try {
    currentSwiper = await pageInstance.$('.outfit-swiper');
  } catch {
    currentSwiper = null;
  }
  const swiperNodeQueried = Boolean(currentSwiper);
  const swiperOffset = currentSwiper ? await currentSwiper.offset() : null;
  const swiperSize = currentSwiper ? await currentSwiper.size() : null;
  const left = finiteNumber(swiperOffset?.left);
  const top = finiteNumber(swiperOffset?.top);
  const width = finiteNumber(swiperSize?.width);
  const height = finiteNumber(swiperSize?.height);
  const currentProperty = await optionalElementValue(currentSwiper, 'property', 'current');
  const currentAttribute = await optionalElementValue(currentSwiper, 'attribute', 'current');
  const currentValues = [currentProperty, currentAttribute]
    .map(finiteNumber)
    .filter((value) => value !== null);
  const current = currentValues.length > 0 ? currentValues[0] : null;
  const hasRequestedTarget = requestedTargetIndex !== null
    && requestedTargetIndex !== undefined
    && Number.isInteger(Number(requestedTargetIndex));
  const targetIndex = hasRequestedTarget
    ? Number(requestedTargetIndex)
    : current;
  const cards = await pageInstance.$$('.outfit-card');
  const cardStates = [];
  for (let index = 0; index < cards.length; index += 1) {
    const card = cards[index];
    const cardOffset = await card.offset();
    const cardLeft = finiteNumber(cardOffset?.left);
    const cardTop = finiteNumber(cardOffset?.top);
    cardStates.push({
      card,
      index,
      offset: { left: cardLeft, top: cardTop },
      active: sameHorizontalPosition(cardLeft, left, width)
        && sameHorizontalPosition(cardTop, top, height),
    });
  }
  const activeCardState = cardStates.find((entry) => entry.active) || null;
  const activeCounter = activeCardState ? await textOf(await activeCardState.card.$('.card-count')) : null;
  const parsedActiveCounter = parseCounter(activeCounter);
  const visibleCardIndex = activeCardState?.index ?? null;
  const targetCardState = targetIndex === null
    ? null
    : cardStates.find((entry) => entry.index === targetIndex) || null;
  const targetCard = targetCardState?.card || null;
  const targetCounter = targetCard ? await textOf(await targetCard.$('.card-count')) : null;
  const parsedTargetCounter = parseCounter(targetCounter);
  const dots = await pageInstance.$$('.pagination-dot');
  let activeDotIndex = null;
  for (let index = 0; index < dots.length; index += 1) {
    const className = await elementAttribute(dots[index], 'class', 'className');
    if (/(?:^|\s)active(?:\s|$)/.test(className)) {
      activeDotIndex = index;
      break;
    }
  }
  const visibleFallbackIdentity = snapshotOutfitIdentity(snapshot, visibleCardIndex);
  const targetOutfitId = snapshotOutfitIdentity(snapshot, targetIndex);
  const visibleOutfitId = await readCardOutfitIdentity(activeCardState?.card, visibleFallbackIdentity);
  const targetCardOutfitId = await readCardOutfitIdentity(targetCard, targetOutfitId);
  const visibleOutfitHash = outfitIdentityHash(visibleOutfitId);
  const targetOutfitHash = outfitIdentityHash(targetCardOutfitId);
  const currentMatchesTarget = targetIndex !== null && currentValues.length > 0
    && currentValues.every((value) => value === targetIndex);
  const activeDotMatchesTarget = activeDotIndex === targetIndex;
  const visibleCardMatchesTarget = visibleCardIndex === targetIndex;
  const visibleOutfitMatchesTarget = Boolean(visibleOutfitId && targetOutfitId)
    && (visibleOutfitId === targetOutfitId || visibleOutfitHash === outfitIdentityHash(targetOutfitId));
  const targetOutfitMatchesTarget = Boolean(targetCardOutfitId && targetOutfitId)
    && (targetCardOutfitId === targetOutfitId || targetOutfitHash === outfitIdentityHash(targetOutfitId));
  const cardCount = cards.length;
  return {
    swiper: currentSwiper,
    swiperNodeQueried,
    cardNodesQueried: true,
    swiperOffset: { left, top },
    swiperSize: { width, height },
    currentProperty,
    currentAttribute,
    current,
    cards: cardStates,
    card: targetCard,
    geometricCard: activeCardState?.card || null,
    cardCount,
    targetCardNodeQueried: Boolean(targetCard),
    visibleCardIndex,
    visibleOutfitId,
    visibleOutfitHash,
    targetIndex,
    targetOutfitId,
    targetOutfitHash,
    targetCardOutfitId,
    currentMatchesTarget,
    activeDotIndex,
    activeDotMatchesTarget,
    visibleCardMatchesTarget,
    visibleOutfitMatchesTarget,
    targetOutfitMatchesTarget,
    allConsistent: currentMatchesTarget
      && activeDotMatchesTarget
      && targetOutfitMatchesTarget,
    activeIndex: visibleCardIndex,
    activeCounter,
    targetCounter,
    activeTotal: parsedTargetCounter?.total ?? parsedActiveCounter?.total ?? null,
    activeOutfitKey: targetCardOutfitId,
  };
}

function navigationStateSummary(stateValue) {
  if (!stateValue) return null;
  return {
    current: stateValue.current,
    activeDotIndex: stateValue.activeDotIndex,
    visibleCardIndex: stateValue.visibleCardIndex,
    visibleOutfitId: stateValue.visibleOutfitId,
    visibleOutfitHash: stateValue.visibleOutfitHash,
    targetIndex: stateValue.targetIndex,
    targetOutfitId: stateValue.targetOutfitId,
    targetOutfitHash: stateValue.targetOutfitHash,
    targetCardOutfitId: stateValue.targetCardOutfitId,
    cardCount: stateValue.cardCount,
    allConsistent: stateValue.allConsistent,
    currentMatchesTarget: stateValue.currentMatchesTarget,
    activeDotMatchesTarget: stateValue.activeDotMatchesTarget,
    visibleCardMatchesTarget: stateValue.visibleCardMatchesTarget,
    visibleOutfitMatchesTarget: stateValue.visibleOutfitMatchesTarget,
    targetOutfitMatchesTarget: stateValue.targetOutfitMatchesTarget,
    swiperNodeQueried: stateValue.swiperNodeQueried,
    cardNodesQueried: stateValue.cardNodesQueried,
    targetCardNodeQueried: stateValue.targetCardNodeQueried,
    activeIndex: stateValue.activeIndex,
    activeCounter: stateValue.activeCounter,
    targetCounter: stateValue.targetCounter,
    activeTotal: stateValue.activeTotal,
    activeOutfitKey: stateValue.activeOutfitKey,
    currentProperty: stateValue.currentProperty,
    currentAttribute: stateValue.currentAttribute,
    swiperOffset: stateValue.swiperOffset,
    swiperSize: stateValue.swiperSize,
    activeCardOffset: stateValue.cards?.find((entry) => entry.active)?.offset || null,
  };
}

function sanitizeWxml(value) {
  return String(value || '')
    .replace(/\s+(?:src|id|data-[^=\s]+|item-id|openid|recommendationBatchId|requestedCandidatePoolId)=(?:"[^"]*"|'[^']*')/gi, '')
    .replace(/>([^<]*)</g, '>[text]<')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2400);
}

async function readSanitizedSwiperWxml(swiper) {
  const wxml = await optionalElementValue(swiper, 'outerWxml');
  return wxml ? sanitizeWxml(wxml) : null;
}

async function waitForSwiperTarget({ page: pageInstance, swiper, targetIndex, expectedCounter, before, snapshot }) {
  const started = Date.now();
  let previousSignature = '';
  let stableReads = 0;
  let lastState = null;
  while (Date.now() - started < 8000) {
    lastState = await readActiveSwiperState(pageInstance, swiper, snapshot, targetIndex);
    const signature = JSON.stringify({
      current: lastState.current,
      activeDotIndex: lastState.activeDotIndex,
      targetOutfitHash: lastState.targetOutfitHash,
      targetCounter: lastState.targetCounter,
      targetCardNodeQueried: lastState.targetCardNodeQueried,
    });
    stableReads = signature === previousSignature ? stableReads + 1 : 1;
    previousSignature = signature;
    if (lastState.allConsistent && lastState.targetCounter === expectedCounter && stableReads >= 2) {
      lastState.waitedMs = Date.now() - started;
      return lastState;
    }
    await delay(200);
  }
  const timeout = new Error(`Timed out waiting for active swiper state ${expectedCounter}`);
  timeout.code = 'SWIPER_STATE_TIMEOUT';
  timeout.lastState = lastState;
  timeout.waitedMs = Date.now() - started;
  throw timeout;
}

function relativeSwipeGeometry(swiperState, direction) {
  const left = swiperState?.swiperOffset?.left;
  const top = swiperState?.swiperOffset?.top;
  const width = swiperState?.swiperSize?.width;
  const height = swiperState?.swiperSize?.height;
  if (![left, top, width, height].every((value) => Number.isFinite(value)) || width <= 0 || height <= 0) {
    throw new Error('swiper offset/size unavailable for relative gesture');
  }
  const startRatio = direction > 0 ? 0.75 : 0.25;
  const endRatio = direction > 0 ? 0.25 : 0.75;
  const y = top + height * 0.5;
  return {
    start: { identifier: 0, pageX: left + width * startRatio, pageY: y },
    middle: { identifier: 0, pageX: left + width * ((startRatio + endRatio) / 2), pageY: y },
    end: { identifier: 0, pageX: left + width * endRatio, pageY: y },
    rect: { left, top, width, height },
    direction: direction > 0 ? 'next' : 'previous',
  };
}

async function performRelativeSwipe(swiper, swiperState, direction) {
  const geometry = relativeSwipeGeometry(swiperState, direction);
  const touch = (point) => ({ touches: [point], changeTouches: [point] });
  await swiper.touchstart(touch(geometry.start));
  await delay(80);
  await swiper.touchmove(touch(geometry.middle));
  await delay(80);
  await swiper.touchmove(touch(geometry.end));
  await delay(80);
  await swiper.touchend({ touches: [], changeTouches: [geometry.end] });
  return { ok: true, geometry: { rect: geometry.rect, direction: geometry.direction } };
}

async function navigateSwiperToCard({ page: pageInstance, swiper, targetIndex, expectedCounter, snapshot: providedSnapshot = null }) {
  const snapshot = providedSnapshot || await readTodaySnapshot();
  const before = await readActiveSwiperState(pageInstance, swiper, snapshot, targetIndex);
  const diagnostics = {
    targetIndex,
    expectedCounter,
    before: navigationStateSummary(before),
    swipeTo: null,
    afterSwipeTo: null,
    touch: null,
    afterTouch: null,
    fallbackExecuted: false,
    waits: [],
    waitElapsedMs: 0,
    cardNodeReacquired: false,
  };
  const waitForTargetWithDiagnostics = async (phase) => {
    const waitStartedAt = Date.now();
    try {
      const result = await waitForSwiperTarget({
        page: pageInstance,
        swiper: before.swiper || swiper,
        targetIndex,
        expectedCounter,
        before,
        snapshot,
      });
      const waitedMs = result.waitedMs ?? Date.now() - waitStartedAt;
      diagnostics.waits.push({ phase, ok: true, waitedMs });
      diagnostics.waitElapsedMs += waitedMs;
      diagnostics.cardNodeReacquired = diagnostics.cardNodeReacquired || result.cardNodesQueried === true;
      return result;
    } catch (caught) {
      const waitedMs = caught.waitedMs ?? Date.now() - waitStartedAt;
      diagnostics.waits.push({
        phase,
        ok: false,
        code: caught.code || 'SWIPER_STATE_TIMEOUT',
        waitedMs,
      });
      diagnostics.waitElapsedMs += waitedMs;
      if (caught.lastState?.cardNodesQueried) diagnostics.cardNodeReacquired = true;
      throw caught;
    }
  };
  let swipeToError = null;
  try {
    const result = await swiper.swipeTo(targetIndex);
    diagnostics.swipeTo = { ok: true, result: result === undefined ? null : compact(result, 1) };
  } catch (caught) {
    swipeToError = caught;
    diagnostics.swipeTo = { ok: false, error: String(caught.message || caught).slice(0, 240) };
  }
  try {
    return await waitForTargetWithDiagnostics('swipeTo');
  } catch (caught) {
    diagnostics.afterSwipeTo = navigationStateSummary(
      caught.lastState || await readActiveSwiperState(pageInstance, swiper, snapshot, targetIndex),
    );
  }

  let touchError = null;
  diagnostics.fallbackExecuted = true;
  try {
    const afterSwipeState = await readActiveSwiperState(pageInstance, swiper, snapshot, targetIndex);
    const directionBase = afterSwipeState.current ?? before.current ?? 0;
    const direction = targetIndex >= directionBase ? 1 : -1;
    diagnostics.touch = await performRelativeSwipe(afterSwipeState.swiper || swiper, afterSwipeState, direction);
  } catch (caught) {
    touchError = caught;
    diagnostics.touch = { ok: false, error: String(caught.message || caught).slice(0, 240) };
  }
  try {
    return await waitForTargetWithDiagnostics('touchFallback');
  } catch (caught) {
    const after = caught.lastState || await readActiveSwiperState(pageInstance, swiper, snapshot, targetIndex);
    diagnostics.afterTouch = navigationStateSummary(after);
    diagnostics.after = diagnostics.afterTouch;
    diagnostics.cardNodeReacquired = diagnostics.cardNodeReacquired || after.cardNodesQueried === true;
  }

  diagnostics.fallback = diagnostics.touch || { ok: false, error: 'fallback was not available' };
  diagnostics.outerWxml = await readSanitizedSwiperWxml(
    diagnostics.afterTouch?.swiper || diagnostics.afterSwipeTo?.swiper || before.swiper || swiper,
  );
  const failure = new Error(`SWIPER_NAVIGATION_FAILED: unable to reach ${expectedCounter}`);
  failure.code = 'SWIPER_NAVIGATION_FAILED';
  failure.diagnostics = diagnostics;
  failure.cause = touchError || swipeToError || null;
  throw failure;
}

async function elementAttribute(elementValue, name, propertyName = name) {
  const attribute = await optionalElementValue(elementValue, 'attribute', name);
  if (attribute !== null && attribute !== undefined) return String(attribute);
  const property = await optionalElementValue(elementValue, 'property', propertyName);
  return property === null || property === undefined ? '' : String(property);
}

function safeImageSourceFingerprint(source) {
  return truncatedSha256(source || '', 'card-visual-src-v1');
}

function safeVisualFingerprint(sample) {
  return {
    swiperIndex: sample.swiperIndex,
    title: sample.title,
    reason: sample.reason,
    imageSrcList: sample.imageSources.map(safeImageSourceFingerprint),
    loadedCount: sample.loadedImageCount,
  };
}

function visualFingerprintKey(sample) {
  return JSON.stringify({
    swiperIndex: sample.swiperIndex,
    title: sample.title,
    reason: sample.reason,
    imageSources: sample.imageSources,
    loadedCount: sample.loadedImageCount,
  });
}

function attachPrivateVisualFingerprint(value, key) {
  Object.defineProperty(value, '_fingerprintKey', { value: key, enumerable: false });
  return value;
}

async function readCardVisualSample(pageInstance, cardIndex, slot, providedSnapshot = null) {
  const snapshot = providedSnapshot || await readTodaySnapshot();
  const expectedImageCount = Array.isArray(snapshot?.[cardIndex]?.itemIds)
    ? snapshot[cardIndex].itemIds.length
    : 0;
  const swiper = await pageInstance.$('.outfit-swiper');
  if (!swiper) throw new Error('swiper selector unavailable while observing card visual state');
  const activeState = await readActiveSwiperState(pageInstance, swiper, snapshot);
  const currentIndexes = [activeState.currentProperty, activeState.currentAttribute]
    .map(finiteNumber)
    .filter((value) => value !== null);
  const swiperIndex = currentIndexes.length > 0 ? currentIndexes[0] : null;
  const currentIndexMatches = currentIndexes.length > 0
    && currentIndexes.every((value) => value === cardIndex);
  const card = activeState.cards?.[cardIndex]?.card || null;
  const cardVisible = Boolean(card
    && activeState.targetIndex === cardIndex
    && activeState.currentMatchesTarget
    && activeState.activeDotMatchesTarget
    && activeState.targetOutfitMatchesTarget);
  const title = await textOf(await card?.$('.outfit-title'));
  const reason = await textOf(await card?.$('.reason-text'));
  const images = card ? await card.$$('.item-image') : [];
  const imageSources = await Promise.all(images.map((image) => elementAttribute(image, 'src')));
  const imageClasses = await Promise.all(images.map((image) => elementAttribute(image, 'class', 'className')));
  const loadedImageCount = imageClasses.filter((className) => /(?:^|\s)loaded(?:\s|$)/.test(className)).length;
  const skeletons = card ? await card.$$('.image-skeleton') : [];
  const sceneLoading = await pageInstance.$$('.scene-loading-overlay');
  const initialLoading = await pageInstance.$$('.loading-state');
  const refreshButton = await pageInstance.$('.refresh-btn');
  const refreshButtonPresent = Boolean(refreshButton);
  const refreshClass = await elementAttribute(refreshButton, 'class', 'className');
  const refreshText = await textOf(refreshButton);
  const pageData = typeof pageInstance.data === 'function' ? await pageInstance.data() : null;
  const loadingFromData = typeof pageData?.loading === 'boolean' ? pageData.loading : false;
  const refreshLoading = /(?:^|\s)disabled(?:\s|$)/.test(refreshClass)
    || /正在|loading|refreshing/i.test(refreshText);
  const loading = loadingFromData || sceneLoading.length > 0 || initialLoading.length > 0;
  const sample = {
    sampledAt: Date.now(),
    cardIndex,
    slot,
    swiperIndex,
    currentIndexMatches,
    cardVisible,
    expectedImageCount,
    loadedImageCount,
    itemImageCount: images.length,
    skeletonCount: skeletons.length,
    title,
    reason,
    titlePresent: Boolean(title),
    reasonPresent: Boolean(reason),
    imageSources,
    loading,
    refreshLoading,
    refreshButtonPresent,
    baseReady: currentIndexMatches
      && cardVisible
      && Boolean(title)
      && Boolean(reason)
      && expectedImageCount > 0
      && images.length === expectedImageCount
      && loadedImageCount === expectedImageCount
      && imageClasses.every((className) => /(?:^|\s)loaded(?:\s|$)/.test(className))
      && skeletons.length === 0
      && !loading
      && refreshButtonPresent
      && !refreshLoading,
  };
  sample.fingerprintKey = visualFingerprintKey(sample);
  sample.fingerprint = safeVisualFingerprint(sample);
  return attachPrivateVisualFingerprint(sample, sample.fingerprintKey);
}

function visualStabilityEvidence(sample, indexChanges, fingerprints, startedAt) {
  const evidence = {
    cardIndex: sample.cardIndex,
    slot: sample.slot,
    expectedImageCount: sample.expectedImageCount,
    loadedImageCount: sample.loadedImageCount,
    skeletonCount: sample.skeletonCount,
    titlePresent: sample.titlePresent,
    reasonPresent: sample.reasonPresent,
    currentIndexMatches: sample.currentIndexMatches,
    cardVisible: sample.cardVisible,
    itemImageCount: sample.itemImageCount,
    loading: sample.loading,
    refreshButtonPresent: sample.refreshButtonPresent,
    refreshLoading: sample.refreshLoading,
    swiperIndex: sample.swiperIndex,
    swiperIndexChanges: indexChanges.slice(-20),
    lastFingerprints: fingerprints.slice(-2),
    waitedMs: Math.max(0, Date.now() - startedAt),
  };
  return attachPrivateVisualFingerprint(evidence, sample._fingerprintKey);
}

async function waitForCardVisualStability(pageInstance, cardIndex, slot, providedSnapshot = null) {
  const startedAt = Date.now();
  const timeoutMs = Number.isFinite(Number(state.visualStabilityTimeoutMs))
    ? Number(state.visualStabilityTimeoutMs)
    : CARD_VISUAL_STABILITY_TIMEOUT_MS;
  const sampleIntervalMs = Number.isFinite(Number(state.visualStabilitySampleIntervalMs))
    ? Number(state.visualStabilitySampleIntervalMs)
    : CARD_VISUAL_STABILITY_SAMPLE_INTERVAL_MS;
  const minIntervalMs = Number.isFinite(Number(state.visualStabilityMinIntervalMs))
    ? Number(state.visualStabilityMinIntervalMs)
    : CARD_VISUAL_STABILITY_MIN_INTERVAL_MS;
  const renderBufferMs = Number.isFinite(Number(state.visualStabilityRenderBufferMs))
    ? Number(state.visualStabilityRenderBufferMs)
    : CARD_VISUAL_STABILITY_RENDER_BUFFER_MS;
  const indexChanges = [];
  const fingerprints = [];
  let lastReadySample = null;
  let lastSample = null;
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const sample = await readCardVisualSample(pageInstance, cardIndex, slot, providedSnapshot);
      lastSample = sample;
      indexChanges.push(sample.swiperIndex);
      fingerprints.push(sample.fingerprint);
      if (sample.baseReady) {
        if (lastReadySample
          && sample._fingerprintKey === lastReadySample._fingerprintKey
          && sample.sampledAt - lastReadySample.sampledAt >= minIntervalMs) {
          await delay(renderBufferMs);
          const buffered = await readCardVisualSample(pageInstance, cardIndex, slot, providedSnapshot);
          lastSample = buffered;
          indexChanges.push(buffered.swiperIndex);
          fingerprints.push(buffered.fingerprint);
          if (buffered.baseReady && buffered._fingerprintKey === sample._fingerprintKey) {
            return visualStabilityEvidence(buffered, indexChanges, fingerprints, startedAt);
          }
          lastReadySample = buffered.baseReady ? buffered : null;
        } else if (!lastReadySample || sample._fingerprintKey !== lastReadySample._fingerprintKey) {
          lastReadySample = sample;
        }
      } else {
        lastReadySample = null;
      }
    } catch (caught) {
      lastError = caught;
      lastReadySample = null;
    }
    await delay(sampleIntervalMs);
  }
  const diagnostic = lastSample || {
    cardIndex,
    slot,
    swiperIndex: null,
    expectedImageCount: Array.isArray(providedSnapshot?.[cardIndex]?.itemIds)
      ? providedSnapshot[cardIndex].itemIds.length
      : 0,
    loadedImageCount: 0,
    skeletonCount: null,
    titlePresent: false,
    reasonPresent: false,
    itemImageCount: 0,
    loading: true,
    refreshButtonPresent: false,
    refreshLoading: true,
  };
  const failure = gateError('CARD_VISUAL_STABILITY_TIMEOUT', `card ${cardIndex} did not reach visual stability`);
  failure.details = {
    cardIndex,
    slot,
    expectedImageCount: diagnostic.expectedImageCount,
    loadedImageCount: diagnostic.loadedImageCount,
    skeletonCount: diagnostic.skeletonCount,
    itemImageCount: diagnostic.itemImageCount ?? null,
    titlePresent: diagnostic.titlePresent,
    reasonPresent: diagnostic.reasonPresent,
    currentIndexMatches: diagnostic.currentIndexMatches ?? false,
    cardVisible: diagnostic.cardVisible ?? false,
    loading: diagnostic.loading ?? null,
    refreshButtonPresent: diagnostic.refreshButtonPresent ?? false,
    refreshLoading: diagnostic.refreshLoading ?? null,
    swiperIndexChanges: indexChanges.slice(-20),
    lastFingerprints: fingerprints.slice(-2),
    waitedMs: Math.max(0, Date.now() - startedAt),
    lastError: lastError ? String(lastError.message || lastError).slice(0, 240) : null,
  };
  throw failure;
}

async function swipeToCaptureCard({ pageInstance, swiper, targetIndex, total, snapshot }) {
  const current = await readActiveSwiperState(pageInstance, swiper, snapshot, targetIndex);
  if (current.allConsistent) {
    return current;
  }
  await navigateSwiperToCard({
    page: pageInstance,
    swiper,
    targetIndex,
    expectedCounter: `${targetIndex + 1} / ${total}`,
    snapshot,
  });
  // Navigation may replace the card tree; always return a post-navigation query.
  return readActiveSwiperState(pageInstance, swiper, snapshot, targetIndex);
}

function uniqueScreenshot(scene, batch, index, auditId, outfitIdentity = null) {
  const sequence = String(++state.screenshotSequence).padStart(4, '0');
  const dir = path.join(EVIDENCE_DIR, 'screenshots', scene, batch);
  ensureDir(dir);
  const identity = normalizeIdentity(outfitIdentity);
  const identityHash = identity ? outfitIdentityHash(identity) : 'identity-missing';
  const identityLabel = identity
    ? identity.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64)
    : 'identity-missing';
  const file = path.join(dir, `${sequence}-${String(auditId || 'no-audit').replace(/[^a-zA-Z0-9_-]/g, '_')}-card-${String(index).padStart(2, '0')}-outfit-${identityLabel}-${identityHash}.png`);
  if (fs.existsSync(file)) throw new Error(`refusing to overwrite screenshot ${file}`);
  return file;
}

async function captureBatch(scene, batch, auditId) {
  const snapshot = await readTodaySnapshot();
  let countContract;
  try {
    assertRecommendationCountContract(snapshot.countContract);
    countContract = snapshot.countContract;
  } catch (error) {
    throw gateError('COUNT_CONTRACT_MISSING', error.message);
  }
  if (countContract.expectedCardCount === 0) {
    return annotateBatch([], {
      expectedCount: 0,
      limited: countContract.expectedCardCount < countContract.requestedBatchSize,
      exhausted: countContract.poolExhaustedAfterConsume,
      requireScreenshots: false,
      evidenceComplete: true,
    });
  }
  const currentPage = await page();
  const swiper = await currentPage.$('.outfit-swiper');
  if (!swiper) throw gateError('MATRIX_CAPTURE_FAILED', 'no active recommendation swiper for this batch');
  const initialState = await readActiveSwiperState(currentPage, swiper, snapshot);
  const firstCount = initialState.activeCounter || await textOf(await element('.card-count'));
  const total = initialState.activeTotal || Number(String(firstCount).split('/')[1]?.trim()) || (await elements('.outfit-card')).length;
  if (total !== countContract.expectedCardCount) {
    throw gateError('COUNT_CONTRACT_CARD_MISMATCH', `expected ${countContract.expectedCardCount} recommendation cards, observed ${total}`);
  }
  const records = [];
  const expectedCount = countContract.expectedCardCount;

  // Keep the historical one-card sequence: navigate and stabilize only the
  // current card immediately before its screenshot.
  for (let cardIndex = 0; cardIndex < expectedCount; cardIndex += 1) {
    await swipeToCaptureCard({ pageInstance: currentPage, swiper, targetIndex: cardIndex, total, snapshot });
    const stable = await waitForCardVisualStability(currentPage, cardIndex, batch, snapshot);
    const card = (await readActiveSwiperState(currentPage, swiper, snapshot)).card;
    const title = await textOf(await card?.$('.outfit-title'));
    const tags = await textsOf(await card?.$$('.style-tag'));
    const todayReason = await textOf(await card?.$('.reason-text'));
    const visibleItems = card ? (await card.$$('.collage-item')).length : 0;
    const stored = snapshot[cardIndex] || {};
    const record = {
      timestamp: now(), auditId: auditId || null, scene, batch, cardIndex: cardIndex + 1,
      cardCount: `${cardIndex + 1} / ${total}`,
      title, tags, todayReason, pageDisplayedItemCount: visibleItems, imageTimeout: false,
      visualStability: stable,
      outfitKey: stored.outfitKey || null, itemIds: stored.itemIds || [], weather: stored.weather || null,
      screenshot: null,
    };
    state.cards.push(record);
    records.push(record);
    const outfitIdentity = stored.outfitKey || stored.outfitId || null;
    const shot = uniqueScreenshot(scene, batch, cardIndex + 1, auditId, outfitIdentity);
    const screenshotCapture = captureWindowsDevToolsScreenshot(shot, {
      label: `${scene}/${batch}/${cardIndex + 1}`,
      batch,
      cardIndex: cardIndex + 1,
      outfitIdentity,
      cardTitle: title,
    });
    record.screenshot = screenshotCapture.file;
    record.screenshotCapture = screenshotCapture;
    const afterScreenshot = await readCardVisualSample(currentPage, cardIndex, batch, snapshot);
    if (!afterScreenshot.baseReady || afterScreenshot._fingerprintKey !== stable._fingerprintKey) {
      const failure = gateError('CARD_VISUAL_STABILITY_TIMEOUT', `${scene}/${batch}/${cardIndex + 1} card became unhealthy after screenshot`);
      failure.details = {
        ...stable,
        afterScreenshot: visualStabilityEvidence(afterScreenshot, [afterScreenshot.swiperIndex], [afterScreenshot.fingerprint], Date.now()),
      };
      throw failure;
    }
  }
  validateCapturedBatch(records, expectedCount);
  return annotateBatch(records, {
    expectedCount,
    limited: countContract.expectedCardCount < countContract.requestedBatchSize,
    exhausted: countContract.poolExhaustedAfterConsume,
    requireScreenshots: true,
    evidenceComplete: true,
  });
}

function validateCapturedBatch(records, expectedCount) {
  const expectedIndexes = Array.from({ length: expectedCount }, (_, index) => index + 1);
  const actualIndexes = records.map((record) => record.cardIndex);
  const screenshotsComplete = records.every((record) => {
    if (!record.screenshot) return false;
    const target = path.isAbsolute(record.screenshot) ? record.screenshot : path.join(EVIDENCE_DIR, record.screenshot);
    return fs.existsSync(target);
  });
  const indexesComplete = actualIndexes.length === expectedCount
    && new Set(actualIndexes).size === expectedCount
    && actualIndexes.every((value, index) => value === expectedIndexes[index]);
  const keysComplete = records.every((record) => typeof record.outfitKey === 'string' && record.outfitKey.length > 0);
  if (!indexesComplete || !screenshotsComplete || !keysComplete) {
    const failure = gateError('EVIDENCE_INCOMPLETE', 'captured card evidence is incomplete');
    failure.details = {
      expectedCount,
      actualCount: records.length,
      actualIndexes,
      screenshotsComplete,
      keysComplete,
    };
    throw failure;
  }
  return true;
}

async function captureBatchOrContinue(scene, batch, auditId) {
  try {
    return await captureBatch(scene, batch, auditId);
  } catch (caught) {
    const code = caught?.code || 'MATRIX_CAPTURE_FAILED';
    fail(code, caught.message || caught, {
      scene,
      batch,
      auditId: auditId || null,
      ...(caught?.details ? { visualStability: caught.details } : {}),
    });
    state.matrix.push({ name: `${scene}:${batch}:capture`, status: 'failed', auditId: auditId || null, error: code });
    if (!state.cards.length) throw caught;
    return annotateBatch([], {
      expectedCount: 0,
      limited: false,
      exhausted: false,
      requireScreenshots: true,
      evidenceComplete: false,
    });
  }
}

function continueAfterProductAssertion(run) {
  try {
    run();
    return true;
  } catch (caught) {
    if (['EVIDENCE_INCOMPLETE', 'REFRESH_REUSED_PREVIOUS_OUTFIT'].includes(caught?.code)) return false;
    throw caught;
  }
}

function isBatchEvidenceComplete(batch) {
  if (!Array.isArray(batch) || batch.evidenceComplete === false) return false;
  if (Number.isInteger(batch.expectedCount) && batch.length !== batch.expectedCount) return false;
  if (!batch.length) return batch.limited === true || batch.exhausted === true;
  if (batch.requireScreenshots === true && batch.some((card) => !card?.screenshot)) return false;
  return batch.every((card) => typeof card?.outfitKey === 'string' && card.outfitKey.length > 0);
}

function markRefreshSceneFailed(context, code) {
  const auditId = context.auditId || null;
  const matrixEntry = [...state.matrix].reverse().find((entry) => entry.auditId === auditId && entry.status === 'completed');
  if (matrixEntry) {
    matrixEntry.status = 'failed';
    matrixEntry.error = code;
  } else {
    state.matrix.push({ name: context.label || 'refresh', status: 'failed', auditId, sceneKey: context.sceneKey || null, error: code });
  }
}

function assertRefreshExcludesPrevious(previous, next, context = {}) {
  const normalized = typeof context === 'string' ? { label: context } : context || {};
  const label = normalized.label || 'refresh';
  const common = {
    auditId: normalized.auditId || null,
    sceneKey: normalized.sceneKey || null,
    batch: normalized.batch || null,
  };
  if (!isBatchEvidenceComplete(previous) || !isBatchEvidenceComplete(next)) {
    fail('EVIDENCE_INCOMPLETE', 'refresh card or screenshot collection is incomplete; duplicate exclusion cannot be inferred', {
      ...common,
      previousCount: Array.isArray(previous) ? previous.length : null,
      currentCount: Array.isArray(next) ? next.length : null,
    });
    markRefreshSceneFailed(normalized, 'EVIDENCE_INCOMPLETE');
    throw gateError('EVIDENCE_INCOMPLETE', `incomplete refresh evidence for ${label}`);
  }
  const prior = new Set(previous.map((card) => card.outfitKey).filter(Boolean));
  const repeated = [...new Set(next.map((card) => card.outfitKey).filter((key) => prior.has(key)))];
  if (repeated.length) {
    fail('REFRESH_REUSED_PREVIOUS_OUTFIT', 'refresh returned outfit keys from the previous batch', {
      ...common,
      repeatedCount: repeated.length,
    });
    markRefreshSceneFailed(normalized, 'REFRESH_REUSED_PREVIOUS_OUTFIT');
    throw gateError('REFRESH_REUSED_PREVIOUS_OUTFIT', `refresh reused previous outfit for ${label}`);
  }
  return true;
}

async function tapScene(index, key, name) {
  const isSportInitial = key === 'sport' && name === 'sport-initial';
  if (isSportInitial) {
    state.sportAction = {
      status: 'running',
      startedAt: now(),
      lifecycleStartIndex: state.lifecycle.length,
      before: null,
      after: null,
      tapResult: 'NOT_OBSERVED',
      tapError: null,
      waitStartedAt: null,
      waitEndedAt: null,
    };
  }
  const result = await action(name, key, async () => {
    if (isSportInitial) {
      state.sportAction.before = await readTodayAcceptanceState();
      if (!isCleanTodayAcceptanceState(state.sportAction.before)) {
        markRunnerBlocked(PRECONDITION_NOT_CLEAN, 'Today page was not clean immediately before Sport tap', {
          actionBefore: state.sportAction.before,
        });
        throw gateError(PRECONDITION_NOT_CLEAN, 'Today page was not clean immediately before Sport tap');
      }
    }
    const tabs = await elements('.scene-tab');
    if (!tabs[index]) throw new Error(`scene tab ${index} unavailable`);
    try {
      const tapResult = await tabs[index].tap();
      if (isSportInitial) state.sportAction.tapResult = summarizeTapResult(tapResult);
    } catch (caught) {
      if (isSportInitial) state.sportAction.tapError = String(caught?.message || caught);
      throw caught;
    }
    if (isSportInitial) state.sportAction.after = await readTodayAcceptanceState();
  });
  if (isSportInitial) {
    if (!state.sportAction.after) state.sportAction.after = await readTodayAcceptanceState().catch(() => null);
    state.sportAction.status = result ? 'completed' : 'failed';
  }
  return result;
}

async function refresh(scene, name) {
  return action(name, scene, async () => {
    const button = await element('.refresh-btn');
    if (!button) throw new Error('refresh button unavailable');
    await button.tap();
    state.refreshClickCount += 1;
  }, 'refresh');
}

async function captureWardrobeDetail(expected) {
  await state.mini.switchTab('/pages/wardrobe/index');
  await waitUntil(async () => (await page()).path === 'pages/wardrobe/index', 12000, 'wardrobe page');
  const tabs = await elements('.category-tag');
  const tab = tabs[expected.index];
  if (!tab) throw new Error(`wardrobe category ${expected.name} missing`);
  await tab.tap();
  await waitUntil(async () => categoryMatches(await textOf(await element('.category-tag.active')), expected.matches), 8000, `active ${expected.name} category`);
  const items = await elements('.grid-item');
  if (!items.length) return { category: expected.name, status: 'empty' };
  await items[0].tap();
  await waitUntil(async () => (await page()).path === 'pages/clothing-detail/index', 12000, 'real clothing detail page');
  const category = await textOf(await element('.clothing-category'));
  if (!categoryMatches(category, expected.matches)) throw new Error(`detail category mismatch: expected ${expected.name}, got ${category}`);
  const shot = uniqueScreenshot('wardrobe', expected.name, 1, 'detail');
  const screenshotCapture = captureWindowsDevToolsScreenshot(shot, {
    label: `wardrobe/${expected.name}/detail`,
    batch: expected.name,
    cardIndex: 1,
    cardTitle: category,
  });
  await state.mini.navigateBack();
  await waitUntil(async () => (await page()).path === 'pages/wardrobe/index', 12000, 'return wardrobe');
  return { category: expected.name, status: 'completed', screenshot: screenshotCapture.file, screenshotCapture };
}

function categoryMatches(value, matches) {
  const text = String(value || '').toLowerCase();
  return (Array.isArray(matches) ? matches : []).some((match) => text.includes(String(match).toLowerCase()));
}

async function todayDetailConsistency() {
  const card = await findDisplayedCard(1, Number(String(await textOf(await element('.card-count'))).split('/')[1]?.trim()) || 1);
  if (!card) throw new Error('active Today card unavailable');
  const today = {
    title: await textOf(await card.$('.outfit-title')),
    tags: await textsOf(await card.$$('.style-tag')),
    todayReason: await textOf(await card.$('.reason-text')),
  };
  const detail = await element('.action-btn.detail');
  if (!detail) throw new Error('detail action unavailable');
  await detail.tap();
  await waitUntil(async () => (await page()).path === 'pages/outfit-detail/index', 12000, 'outfit detail');
  const observed = {
    title: await textOf(await element('.hero-title')),
    tags: await textsOf(await elements('.style-tag')),
    todayReason: await textOf(await element('.core-reason-text')),
  };
  state.todayDetail = { today, detail: observed, equal: JSON.stringify(today) === JSON.stringify(observed) };
  if (!state.todayDetail.equal) error('TODAY_DETAIL_SNAPSHOT_MISMATCH', 'detail did not render the saved Today snapshot', state.todayDetail);
  await state.mini.navigateBack();
  await waitUntil(async () => (await page()).path === 'pages/today/index', 12000, 'return Today');
}

function median(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function buildSummary(requests) {
  const refreshes = requests.filter((entry) => entry.slot === 'refresh');
  const poolHits = refreshes.filter((entry) => entry.executionMode === 'candidate_pool_hit' && entry.cacheHit).length;
  const poolSkipStages = refreshes.filter((entry) => entry.executionMode === 'candidate_pool_hit' && ['compositionMs', 'canonicalizeMs', 'eligibilityMs', 'scoringMs'].every((key) => Number(entry.timings?.[key]) === 0)).length;
  const titleDuplicates = duplicateGroups(state.cards.map((card) => card.title));
  const reasonDuplicates = duplicateGroups(state.cards.map((card) => card.todayReason));
  const canonicalQaFailures = requests.filter((entry) => (
    entry.terminal === 'done'
    && entry.hasResponse
    && entry.qaObservationStatus === 'authoritative'
    && (entry.gateStatus === 'failed' || entry.qaGatePassed === false || entry.syntheticSuffixCount > 0)
  ));
  const canonicalQaWarnings = requests.filter((entry) => (
    entry.terminal === 'done'
    && entry.hasResponse
    && entry.qaObservationStatus === 'authoritative'
    && entry.gateStatus === 'passed_with_warnings'
  ));
  const qaCaptureIncomplete = requests.filter((entry) => entry.qaObservationStatus !== 'authoritative');
  const requestFailures = requests.filter((entry) => entry.requestOutcome === 'request_failure');
  const successfulResponseVersionMismatches = requests.filter((entry) => (
    entry.requestOutcome === 'successful_response'
    && entry.successfulResponseVersionStatus === 'mismatch'
  ));
  const observedVersionRequests = requests.filter((entry) => (
    entry.requestOutcome === 'successful_response'
    && entry.hasResponse
    && typeof entry.cloudBuild === 'string'
    && typeof entry.qaVersion === 'string'
  ));
  const observedVersionMismatches = observedVersionRequests.filter((entry) => (
    entry.successfulResponseVersionStatus === 'mismatch'
  ));
  const successfulResponses = requests.filter((entry) => entry.requestOutcome === 'successful_response');
  const invalidCountContracts = successfulResponses.filter((entry) => {
    try {
      assertRecommendationCountContract(entry.countContract);
      assertReturnedCardCount(entry.countContract, entry.returnedCardCount);
      return false;
    } catch {
      return true;
    }
  });
  const poolIoBudgetViolations = requests.flatMap((entry) => ['candidatePoolLoadMs', 'candidatePoolSaveMs']
    .filter((key) => Number(entry.timings?.[key]) > 300)
    .map((key) => ({ auditId: entry.auditId, metric: key, value: Number(entry.timings[key]) })));
  return {
    status: state.failed ? 'FAILED' : requests.length ? 'PASSED' : 'NOT_OBSERVED',
    cloudBuilds: [...new Set(requests.map((entry) => entry.cloudBuild).filter(Boolean))],
    qaVersions: [...new Set(requests.map((entry) => entry.qaVersion).filter(Boolean))],
    requestCount: requests.length,
    cardCount: state.cards.length,
    alternativeCandidateCounts: requests.map((entry) => ({
      auditId: entry.auditId,
      value: entry.alternativeCandidateCount,
    })),
    firstMedianMs: median(requests.filter((entry) => entry.slot !== 'refresh').map((entry) => entry.userPerceivedDurationMs)),
    refreshMedianMs: median(refreshes.map((entry) => entry.userPerceivedDurationMs)),
    candidatePoolHits: poolHits,
    refreshesSkippingGeneration: poolSkipStages,
    titleDuplicates,
    reasonDuplicates,
    canonicalQaFailures: canonicalQaFailures.map((entry) => ({ auditId: entry.auditId, qaBlockReasons: entry.qaBlockReasons })),
    qaCaptureIncomplete: qaCaptureIncomplete.map((entry) => ({
      auditId: entry.auditId,
      slot: entry.slot,
      qaObservationStatus: entry.qaObservationStatus,
      missingFields: entry.qaObservationMissingFields,
    })),
    canonicalQaWarnings: canonicalQaWarnings.map((entry) => ({
      auditId: entry.auditId,
      duplicateCause: entry.duplicateCause,
      availableDifferentiatorCount: entry.availableDifferentiatorCount,
      titleDuplicateWarningCount: entry.titleDuplicateWarningCount,
    })),
    requestFailures: requestFailures.map((entry) => ({
      auditId: entry.auditId,
      terminal: entry.terminal,
      code: entry.requestFailureCode || entry.code,
      message: entry.requestFailureMessage || entry.message,
      responseUnavailable: entry.responseUnavailableDueToRequestError ?? true,
      source: entry.source || 'request',
    })),
    requestFailureCount: requestFailures.length,
    successfulResponseVersionMismatches: successfulResponseVersionMismatches.map((entry) => ({
      auditId: entry.auditId,
      expectedCloudBuild: EXPECTED_CLOUD_BUILD,
      expectedQaVersion: EXPECTED_QA_VERSION,
      actualCloudBuild: entry.cloudBuild,
      actualQaVersion: entry.qaVersion,
    })),
    successfulResponseVersionMismatchCount: successfulResponseVersionMismatches.length,
    poolIoBudgetViolations,
    imageTimeoutCount: state.cards.filter((card) => card.imageTimeout).length,
    recommendErrors: state.lifecycle.filter((entry) => ['[RecommendReject]', '[RecommendError]'].includes(entry.label)).map((entry) => ({ label: entry.label, auditId: entry.payload?.auditId || null })),
    failedMatrix: state.matrix.filter((entry) => entry.status !== 'completed'),
    versionContract: {
      status: observedVersionRequests.length === 0
        ? 'NOT_OBSERVED'
        : (observedVersionMismatches.length > 0 || state.errors.some((entry) => entry.code === 'VERSION_CONTRACT_MISMATCH')
          ? 'FAILED'
          : 'PASSED'),
      expectedCloudBuild: EXPECTED_CLOUD_BUILD,
      expectedQaVersion: EXPECTED_QA_VERSION,
    },
    countContract: {
      status: successfulResponses.length === 0
        ? 'NOT_OBSERVED'
        : (invalidCountContracts.length > 0 || state.errors.some((entry) => entry.code === 'COUNT_CONTRACT_INVALID') ? 'FAILED' : 'PASSED'),
      protocolPath: 'result.data.countContract',
      observed: successfulResponses.map((entry) => ({
        auditId: entry.auditId,
        returnedCardCount: entry.returnedCardCount,
        value: entry.countContract,
      })),
    },
    sportPrecondition: state.sportPrecondition,
    sportAction: state.sportAction,
  };
}

function duplicateGroups(values) {
  const counts = new Map();
  values.filter(Boolean).forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  return [...counts.entries()].filter(([, count]) => count > 1).map(([value, count]) => ({ value, count }));
}

function markRunnerBlocked(code, message, context = {}) {
  state.failed = true;
  state.runnerBlocked = { status: 'blocked', code, message: String(message), context: compact(context) };
  error(code, message, context);
  if (EVIDENCE_DIR) {
    ensureDir(EVIDENCE_DIR);
    writeJson('runner-blocked.json', state.runnerBlocked);
  }
}

function buildCardsTable(cards) {
  const rows = cards.map((card) => [
    card.scene,
    card.batch,
    card.cardCount,
    card.title,
    card.todayReason,
    card.imageTimeout ? 'timeout' : 'ready',
    card.screenshot,
  ].map(escapeTable));
  return [
    '# Captured cards', '',
    '| scene | batch | card | title | todayReason | image | screenshot |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map((row) => `| ${row.join(' | ')} |`),
    '',
  ].join('\n');
}

function qaArtifact(slot) {
  const value = state.qaArtifacts[slot];
  return value ? { status: 'captured', ...value } : {
    status: 'N/A',
    reason: slot === 'refresh' ? 'refresh not executed or no QA lifecycle event observed' : 'initial request not executed or no QA lifecycle event observed',
  };
}

function buildValidationReport(summary, requests) {
  const productionRequestExecuted = RUNNER_CONFIG.preflightOnly
    ? state.hasRealRequest
    : state.hasRealRequest || requests.length > 0;
  return {
    schemaVersion: 'recommendation-v6.1-runner-validation-v1',
    status: summary.status,
    productionRequestExecuted,
    preflight: state.preflightReady,
    runnerConfig: RUNNER_CONFIG,
    runnerBlocked: state.runnerBlocked,
    presentationCapture: state.presentationCaptureDiagnostics,
    refreshClickCount: state.refreshClickCount,
    versionContract: summary.versionContract,
    countContract: summary.countContract,
    requestFailures: summary.requestFailures,
    requestFailureCount: summary.requestFailureCount,
    failedMatrix: summary.failedMatrix,
    sportPrecondition: state.sportPrecondition,
    sportAction: state.sportAction,
    requests: requests.map((request) => ({
      auditId: request.auditId,
      trigger: request.trigger,
      slot: request.slot,
      responseCode: request.responseCode,
      responseMessage: request.responseMessage,
      presentationEvidenceMode: request.presentationEvidenceMode,
      cloudBuild: request.cloudBuild,
      qaVersion: request.qaVersion,
      presentationEvidenceVersion: request.presentationEvidenceVersion,
      executionMode: request.executionMode,
      cacheHit: request.cacheHit,
      cacheMissReason: request.cacheMissReason,
      requestedCandidatePoolIdPresent: request.requestedCandidatePoolIdPresent,
      requestOutcome: request.requestOutcome,
      successfulResponseVersionStatus: request.successfulResponseVersionStatus,
      qaObservationStatus: request.qaObservationStatus,
      qaObservationMissingFields: request.qaObservationMissingFields,
      qaGatePassed: request.qaGatePassed,
      gateStatus: request.gateStatus,
      qaBlockReasons: request.qaBlockReasons,
      alternativeCandidateCount: request.alternativeCandidateCount,
      countContract: request.countContract,
      returnedCardCount: request.returnedCardCount,
    })),
    qa: { initial: qaArtifact('initial'), refresh: qaArtifact('refresh') },
    responses: state.responseArtifacts,
    presentationEvidence: state.presentationEvidenceArtifacts,
    errors: state.errors,
  };
}

function quotePowerShell(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function createEvidenceZip() {
  if (!EVIDENCE_DIR) return null;
  const zipPath = `${EVIDENCE_DIR}.zip`;
  if (fs.existsSync(zipPath)) throw new Error(`refusing to overwrite evidence ZIP ${zipPath}`);
  if (process.platform === 'win32') {
    childProcess.execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `$source=${quotePowerShell(EVIDENCE_DIR)}; $destination=${quotePowerShell(zipPath)}; Compress-Archive -Path (Join-Path $source '*') -DestinationPath $destination`,
    ], { stdio: 'ignore' });
  } else {
    childProcess.execFileSync('zip', ['-r', '-q', zipPath, '.'], { cwd: EVIDENCE_DIR, stdio: 'ignore' });
  }
  return zipPath;
}

function assertMiniProgramMethodContract(mini) {
  const required = ['currentPage', 'reLaunch', 'evaluate', 'on', 'disconnect'];
  const missing = required.filter((name) => typeof mini?.[name] !== 'function');
  if (missing.length > 0) {
    throw gateError('AUTOMATOR_METHOD_CONTRACT_INVALID', 'connected mini instance is missing required runner methods', { missing });
  }
  return { required, validated: true };
}

function validatePreflightEvidenceDirectory() {
  ensureDir(EVIDENCE_DIR);
  ensureDir(path.join(EVIDENCE_DIR, 'screenshots'));
  const file = path.join(EVIDENCE_DIR, 'preflight-write-read.json');
  const payload = { status: 'write-read-check', writtenAt: now(), utf8: true };
  fs.writeFileSync(file, JSON.stringify(payload) + '\n', 'utf8');
  const readBack = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (readBack.status !== payload.status || readBack.utf8 !== true) {
    throw gateError('EVIDENCE_WRITE_READ_FAILED', 'evidence JSON write/read verification did not round-trip');
  }
  return { directory: EVIDENCE_DIR, jsonFile: relative(file), jsonReadable: true };
}

function validatePreflightContracts() {
  const config = RESOLVED_RUNNER_CONFIG;
  const expected = {
    scene: 'sport',
    slot: 'initial',
    cloudBuild: EXPECTED_CLOUD_BUILD,
    qaVersion: EXPECTED_QA_VERSION,
    presentationEvidenceMode: PRESENTATION_EVIDENCE_MODE,
    presentationEvidenceVersion: PRESENTATION_EVIDENCE_VERSION,
  };
  const actual = {
    scene: config?.contracts?.initialScene,
    slot: config?.contracts?.initialSlot,
    cloudBuild: config?.contracts?.expectedCloudBuild,
    qaVersion: config?.contracts?.expectedQaVersion,
    presentationEvidenceMode: config?.contracts?.presentationEvidenceMode,
    presentationEvidenceVersion: config?.contracts?.presentationEvidenceVersion,
  };
  const mismatches = Object.keys(expected).filter((key) => actual[key] !== expected[key]);
  if (config?.preflightOnly !== true || config?.capturePresentationEvidence !== true || mismatches.length > 0) {
    throw gateError('INITIAL_CONTRACT_NOT_READY', 'Initial runner scene/mode/version contract is not ready', { expected, actual, mismatches });
  }
  return { expected, actual, validated: true };
}

async function cleanupPreflight(precondition) {
  const cleanup = { hookRestored: false, pageRestored: false, blockerDisabled: false, blockerRemoved: false };
  const errors = [];
  try {
    if (state.presentationCaptureInstalled) {
      const restored = await restoreExistingPresentationEvidenceCapture();
      cleanup.hookRestored = restored?.ok === true;
      state.presentationCaptureInstalled = false;
      state.presentationCaptureDiagnostics = createPresentationCaptureDiagnostics({
        previousCaptureGeneration: restored?.previousGeneration || null,
      });
    } else {
      cleanup.hookRestored = true;
    }
  } catch (caught) {
    errors.push(`hook: ${caught.message || caught}`);
  }
  try {
    if (precondition?.blockerRetained) {
      await state.mini.reLaunch(TODAY_RELAUNCH_URL);
      await waitUntil(async () => {
        const current = await readTodayAcceptanceState();
        return isCleanTodayAcceptanceState(current) ? current : null;
      }, 12000, 'clean Today page during preflight cleanup');
      cleanup.pageRestored = true;
    } else {
      cleanup.pageRestored = true;
    }
  } catch (caught) {
    errors.push(`page: ${caught.message || caught}`);
  }
  try {
    if (precondition?.blockerRetained) {
      cleanup.blockerDisabled = (await setResetRecommendationBlockerActive(false)) === false;
      const removed = await removeResetRecommendationBlocker();
      cleanup.blockerRemoved = removed?.removed === true;
      if (!cleanup.blockerRemoved) throw gateError(removed?.errorCode || PRECONDITION_NOT_CLEAN, removed?.reason || 'temporary reset blocker was not removed');
    } else {
      cleanup.blockerDisabled = true;
      cleanup.blockerRemoved = true;
    }
  } catch (caught) {
    errors.push(`blocker: ${caught.message || caught}`);
  }
  if (errors.length > 0) throw gateError('PREFLIGHT_CLEANUP_FAILED', 'preflight cleanup did not complete', { cleanup, errors });
  return cleanup;
}

async function runPreflightOnly() {
  const startedAt = now();
  let precondition = null;
  let primaryError = null;
  let cleanup = null;
  let evidence = null;
  let screenshot = null;
  let methodContract = null;
  let pageHealth = null;
  let contracts = null;
  try {
    methodContract = assertMiniProgramMethodContract(state.mini);
    evidence = validatePreflightEvidenceDirectory();
    precondition = await prepareSportAcceptancePrecondition({ keepBlocker: true, resetBeforeRestore: true });
    if (!precondition.ok || !precondition.blockerRetained) {
      throw gateError(PRECONDITION_NOT_CLEAN, 'temporary request blocker was not retained for preflight');
    }
    pageHealth = await readTodayPageHealth();
    const installed = await installPresentationEvidenceCapture(precondition.captureBefore?.captureGeneration || null);
    validateFreshCaptureHandshake(installed, precondition.captureBefore?.captureGeneration || null);
    const postHookState = await readTodayAcceptanceState();
    if (!isCleanTodayAcceptanceState(postHookState)) {
      throw gateError(PRECONDITION_NOT_CLEAN, 'Today page was not clean after fresh preflight handshake', { postHookState });
    }
    state.sportPrecondition.hookReadyAfterReset = {
      captureHookInstalled: true,
      handshakeStatus: installed.handshakeStatus,
      captureGeneration: installed.captureGeneration,
      previousCaptureGeneration: installed.previousCaptureGeneration,
      generationFresh: installed.generationFresh,
      requestBufferCount: installed.requestBufferCount,
      installedTargets: installed.installedTargets,
    };
    const smokePath = path.join(EVIDENCE_DIR, 'preflight-primary-screen.png');
    if (!state.mini || typeof state.mini['screenshot'] !== 'function') {
      throw gateError('SCREENSHOT_UNAVAILABLE', 'direct automator session has no screenshot()');
    }
    await state.mini['screenshot']({ path: smokePath });
    screenshot = { screenshotProvider: 'automator', file: relative(smokePath), bytes: fs.statSync(smokePath).size };
    if (!fs.existsSync(smokePath) || readPngDimensions(smokePath).width <= 0) {
      throw gateError('SCREENSHOT_INVALID', 'formal preflight screenshot was not readable');
    }
    contracts = validatePreflightContracts();
    const generationAfterSmoke = await readPresentationCaptureGeneration();
    const preflightRequests = buildRequests();
    const blockedRecommendationRequests = preflightRequests.filter((request) => request.requestFailureCode === 'RUNNER_RESET_BLOCKED');
    const unblockedRecommendationRequests = preflightRequests.filter((request) => request.requestFailureCode !== 'RUNNER_RESET_BLOCKED');
    if (state.hasRealRequest || unblockedRecommendationRequests.length > 0 || Number(generationAfterSmoke.requestBufferCount) !== 0) {
      throw gateError('PREFLIGHT_REQUEST_LEAK', 'preflight observed a real recommendation request or non-empty capture buffer', {
        hasRealRequest: state.hasRealRequest,
        blockedRecommendationRequestCount: blockedRecommendationRequests.length,
        unblockedRecommendationRequestCount: unblockedRecommendationRequests.length,
        generationAfterSmoke,
      });
    }
  } catch (caught) {
    primaryError = caught;
  } finally {
    try {
      cleanup = await cleanupPreflight(precondition);
    } catch (caught) {
      if (!primaryError) primaryError = caught;
      cleanup = caught.details?.cleanup || null;
    }
  }
  if (primaryError) throw primaryError;
  const result = {
    status: 'READY_FOR_INITIAL',
    startedAt,
    completedAt: now(),
    productionRequestExecuted: false,
    realRecommendationRequestCount: 0,
    blockedRecommendationRequestCount: buildRequests().filter((request) => request.requestFailureCode === 'RUNNER_RESET_BLOCKED').length,
    configHash: RESOLVED_RUNNER_CONFIG.configHash,
    automator: {
      package: `${RESOLVED_RUNNER_CONFIG.automatorPackageName}@${RESOLVED_RUNNER_CONFIG.automatorVersion}`,
      modulePath: RESOLVED_RUNNER_CONFIG.automatorModulePath,
      resolvedEntry: RESOLVED_RUNNER_CONFIG.automatorResolvedEntry,
      wsEndpoint: RESOLVED_RUNNER_CONFIG.automatorWsEndpoint,
    },
    methodContract,
    pageHealth,
    precondition: state.sportPrecondition,
    blocker: precondition?.blockerStatus || null,
    hook: state.sportPrecondition.hookReadyAfterReset,
    screenshot,
    evidence,
    contracts,
    cleanup,
  };
  writeJson('preflight.json', result);
  state.preflightReady = result;
  return result;
}

async function finalize() {
  if (!EVIDENCE_DIR) {
    state.failed = true;
    process.exitCode = 1;
    return;
  }
  ensureDir(EVIDENCE_DIR);
  ensureDir(path.join(EVIDENCE_DIR, 'screenshots'));
  const sanitizedLifecycle = state.sanitizedLifecycle.length > 0
    ? state.sanitizedLifecycle
    : state.lifecycle.filter((entry) => entry?.payload?.auditId).map((entry) => ({
      timestamp: entry.timestamp,
      auditId: entry.payload.auditId,
      phase: entry.phase || phaseForLabel(entry.label),
      payload: sanitizeLifecyclePayload(entry.payload),
    }));
  writeJsonl('sanitized-lifecycle.jsonl', sanitizedLifecycle);
  const requests = buildRequests();
  const summary = buildSummary(requests);
  writeJsonl('requests.jsonl', requests);
  writeJsonl('cards.jsonl', state.cards);
  writeJsonl('errors.jsonl', state.errors);
  writeJson('matrix.json', state.matrix);
  writeJson('qa-initial.json', qaArtifact('initial'));
  writeJson('qa-refresh.json', qaArtifact('refresh'));
  for (const slot of ['initial', 'refresh']) {
    if (!fs.existsSync(path.join(EVIDENCE_DIR, `response-${slot}.json`))) {
      writeJson(`response-${slot}.json`, { status: 'not_observed', reason: `${slot} response was not captured` });
    }
    if (!fs.existsSync(path.join(EVIDENCE_DIR, `debug-${slot}.json`))) writeJson(`debug-${slot}.json`, null);
    if (!fs.existsSync(path.join(EVIDENCE_DIR, `qa-${slot}-raw.json`))) writeJson(`qa-${slot}-raw.json`, null);
  }
  writeJson('responses.json', state.responseArtifacts);
  writeText('cards-table.md', buildCardsTable(state.cards));
  writeJson('environment.json', {
    startedAt: state.startedAt, finishedAt: now(), scriptVersion: SCRIPT_VERSION,
    status: summary.status,
    expectedCloudBuild: EXPECTED_CLOUD_BUILD, expectedQaVersion: EXPECTED_QA_VERSION,
    actualCloudBuilds: summary.cloudBuilds, actualQaVersions: summary.qaVersions,
    observedCloudBuilds: summary.cloudBuilds, observedQaVersions: summary.qaVersions,
    versionContract: summary.versionContract,
    requestFailures: summary.requestFailures,
    requestFailureCount: summary.requestFailureCount,
    failedMatrix: summary.failedMatrix,
    sportPrecondition: state.sportPrecondition,
    sportAction: state.sportAction,
    responses: state.responseArtifacts,
    runnerConfig: RUNNER_CONFIG,
    invocation: runnerInvocationEvidence(),
    presentationCapture: state.presentationCaptureDiagnostics,
    refreshClickCount: state.refreshClickCount,
    productionRequestExecuted: RUNNER_CONFIG.preflightOnly ? state.hasRealRequest : state.hasRealRequest || requests.length > 0,
    preflight: state.preflightReady,
    runnerBlocked: state.runnerBlocked,
  });
  writeJson('hook-diagnostics.json', state.presentationCaptureDiagnostics);
  writeJson('validation.json', buildValidationReport(summary, requests));
  writeText('summary.md', [
    '# Recommendation V6 E2E evidence summary', '',
    `- status: ${summary.status}`,
    `- expected cloud build: ${EXPECTED_CLOUD_BUILD}`,
    `- actual cloud build: ${summary.cloudBuilds.join(', ') || 'not observed'}`,
    `- expected QA version: ${EXPECTED_QA_VERSION}`,
    `- actual QA version: ${summary.qaVersions.join(', ') || 'not observed'}`,
    `- version contract: ${summary.versionContract.status}`,
    `- count contract (${summary.countContract.protocolPath}): ${summary.countContract.status} ${JSON.stringify(summary.countContract.observed)}`,
    `- requests/cards: ${summary.requestCount}/${summary.cardCount}`,
    `- refresh median: ${summary.refreshMedianMs ?? 'n/a'} ms`,
    `- candidate_pool_hit: ${summary.candidatePoolHits}; generation-skipping hits: ${summary.refreshesSkippingGeneration}`,
    `- candidate pool IO >300ms: ${JSON.stringify(summary.poolIoBudgetViolations)}`,
    `- image timeouts: ${summary.imageTimeoutCount}`,
    `- Today/detail equal: ${state.todayDetail ? state.todayDetail.equal : 'not covered'}`,
    `- RecommendReject/RecommendError: ${JSON.stringify(summary.recommendErrors)}`,
    `- failed matrix: ${JSON.stringify(summary.failedMatrix)}`,
    `- duplicate titles: ${JSON.stringify(summary.titleDuplicates)}`,
    `- duplicate reasons: ${JSON.stringify(summary.reasonDuplicates)}`,
    `- canonical QA failures: ${JSON.stringify(summary.canonicalQaFailures)}`,
    `- QA capture incomplete: ${JSON.stringify(summary.qaCaptureIncomplete)}`,
    `- canonical QA warnings: ${JSON.stringify(summary.canonicalQaWarnings)}`,
    `- alternativeCandidateCount: ${JSON.stringify(summary.alternativeCandidateCounts)}`,
    `- request failures: ${JSON.stringify(summary.requestFailures)}`,
    `- successful response version mismatches: ${JSON.stringify(summary.successfulResponseVersionMismatches)}`,
    `- production request executed: ${RUNNER_CONFIG.preflightOnly ? state.hasRealRequest : state.hasRealRequest || requests.length > 0}`,
    `- response artifacts: ${JSON.stringify(state.responseArtifacts)}`,
    `- presentation evidence: ${JSON.stringify(state.presentationEvidenceArtifacts)}`,
    `- presentation capture: ${JSON.stringify(state.presentationCaptureDiagnostics)}`,
    `- unicode input preflight: ${JSON.stringify(state.unicodeInputPreflight)}`,
    `- runner blocked: ${JSON.stringify(state.runnerBlocked)}`,
    `- sport precondition: ${JSON.stringify(state.sportPrecondition)}`,
    `- sport action: ${JSON.stringify(state.sportAction)}`,
  ].join('\n') + '\n');
  writeText('manual-review.md', state.manual.length ? JSON.stringify(state.manual, null, 2) : 'No automatic manual-review flags.\n');
  try {
    state.evidenceZip = createEvidenceZip();
  } catch (caught) {
    state.failed = true;
    error('ZIP_CREATE_FAILED', caught.message || caught);
    writeJsonl('errors.jsonl', state.errors);
  }
  process.exitCode = state.failed ? 1 : 0;
}

async function main() {
  try {
    const runnerArgv = process.argv.slice(2);
    assertRunnerArgv(runnerArgv);
    applyResolvedRunnerConfig(resolveRunnerConfig({
      argv: runnerArgv,
      preResolvedConfigJson: process.env.D1D_RUNNER_RESOLVED_CONFIG_JSON,
    }));
  } catch (caught) {
    const firstIssue = caught instanceof RunnerConfigError ? caught.issues?.[0] : null;
    markRunnerBlocked('RUNNER_CONFIG_INVALID', firstIssue?.message || caught.message || caught, configFailureDetails(caught));
    return;
  }
  ensureDir(EVIDENCE_DIR);
  ensureDir(path.join(EVIDENCE_DIR, 'screenshots'));
  try {
    const directSession = await ensureDevToolsDirectSession({ endpoint: RUNNER_CONFIG.automatorWsEndpoint });
    state.mini = directSession.mini;
  } catch (caught) {
    markRunnerBlocked(caught.code || 'AUTOMATOR_ATTACH_FAILED', caught.message || caught, {
      automatorModulePath: AUTOMATOR_MODULE_PATH,
      automatorWsEndpoint: RUNNER_CONFIG.automatorWsEndpoint,
      resolvedConfigHash: RESOLVED_RUNNER_CONFIG?.configHash || null,
      details: caught.details || null,
    });
    return;
  }
  try {
    assertMiniProgramMethodContract(state.mini);
  } catch (caught) {
    markRunnerBlocked(caught.code || 'AUTOMATOR_METHOD_CONTRACT_INVALID', caught.message || caught, caught.details || {});
    return;
  }
  try {
    state.unicodeInputPreflight = await unicodeInputPreflight(state.mini);
    process.stdout.write(`${state.unicodeInputPreflight.status}\n`);
  } catch (caught) {
    markRunnerBlocked(caught.code || 'UNICODE_INPUT_PREFLIGHT_FAILED', caught.message || caught, caught.details || {});
    return;
  }
  state.mini.on('console', (event) => { const parsed = parseConsole(event); if (parsed) recordLifecycleEvent(parsed); });

  if (RUNNER_CONFIG.preflightOnly) {
    try {
      await runPreflightOnly();
    } catch (caught) {
      markRunnerBlocked(caught.code || 'PREFLIGHT_FAILED', caught.message || caught, caught.details || {});
    }
    return;
  }

  try {
    const current = await enterTodayPage();
    if (!current) throw gateError('TODAY_PAGE_UNAVAILABLE', 'current DevTools page is not Today');
    await readTodayPageHealth();
  } catch (caught) {
    fail(caught.code || 'TODAY_PAGE_UNAVAILABLE', caught.message || caught);
    return;
  }

  if (RUNNER_CONFIG.evidenceOnly) {
    await captureProductionPresentationEvidence();
  } else {
    const precondition = await prepareSportAcceptancePrecondition();
    if (!precondition.ok) return;
    if (RUNNER_CONFIG.capturePresentationEvidence) {
      try {
        const installed = await installPresentationEvidenceCapture(precondition.captureBefore?.captureGeneration || null);
        const previousGeneration = installed.previousCaptureGeneration
          || precondition.captureBefore?.captureGeneration
          || null;
        validateFreshCaptureHandshake(installed, previousGeneration);
        const postHookState = await readTodayAcceptanceState();
        if (!isCleanTodayAcceptanceState(postHookState)) {
          markRunnerBlocked(PRECONDITION_NOT_CLEAN, 'Today page was not clean after fresh capture handshake', {
            after: postHookState,
            captureGeneration: installed.captureGeneration,
          });
          return;
        }
        state.sportPrecondition.hookReadyAfterReset = {
          captureHookInstalled: true,
          handshakeStatus: installed.handshakeStatus,
          captureGeneration: installed.captureGeneration,
          previousCaptureGeneration: previousGeneration,
          generationFresh: installed.generationFresh,
          requestBufferCount: installed.requestBufferCount,
          installedTargets: installed.installedTargets,
        };
        state.sportPrecondition.after = postHookState;
      } catch (caught) {
        const code = caught.code === 'PRECONDITION_HOOK_NOT_FRESH'
          ? caught.code
          : 'PRECONDITION_HOOK_NOT_FRESH';
        markRunnerBlocked(code, caught.message || caught, state.presentationCaptureDiagnostics);
        return;
      }
    }
    if (RUNNER_CONFIG.preconditionOnly) return;
    await waitForBootstrapRequestsToSettle();
    const sport = await tapScene(3, 'sport', 'sport-initial');
    if (!sport || sport.terminal?.label !== '[RecommendDone]') return;
    assertSingleGenerateSinceBaseline(state.acceptanceBaseline, 'sport');
    const sportInitial = await captureBatchOrContinue('sport', 'initial', sport.auditId);
    if (!isBatchEvidenceComplete(sportInitial)) {
      throw gateError('SPORT_INITIAL_EVIDENCE_INCOMPLETE', 'sport initial must complete before refresh');
    }
    if (RUNNER_CONFIG.capturePresentationEvidence && !shouldRunPresentationRefresh(sport)) {
      throw gateError('SPORT_INITIAL_EVIDENCE_INCOMPLETE', 'sport initial presentation evidence is not ready for refresh');
    }
    const sportRefresh = await refresh('sport', 'sport-refresh');
    if (!sportRefresh || sportRefresh.terminal?.label !== '[RecommendDone]') return;
    const sportNext = await captureBatchOrContinue('sport', 'refresh', sportRefresh.auditId);
    if (!isBatchEvidenceComplete(sportNext)) {
      throw gateError('SPORT_REFRESH_EVIDENCE_INCOMPLETE', 'sport refresh must complete with eight screenshots');
    }
    assertRefreshExcludesPrevious(sportInitial, sportNext, {
      label: 'sport-refresh', auditId: sportRefresh.auditId, sceneKey: 'sport', batch: 'refresh',
    });
    return;

  /* Legacy broad matrix is intentionally excluded from standard sport acceptance.
  await interaction('weather-real-success-or-explicit-failure', async () => {
    const card = await element('.weather-card');
    if (!card) throw new Error('weather card unavailable');
    await card.tap();
    await waitUntil(async () => {
      const text = await textOf(await element('.weather-status')) || await textOf(await element('.weather-card'));
      return text && !text.includes('同步中');
    }, 20000, 'weather success or explicit failure state');
  });

  await interaction('rapid-home-work-date', async () => {
    await state.mini.switchTab('/pages/today/index');
    await waitUntil(async () => (await page()).path === 'pages/today/index', 12000, 'Today before rapid switch');
    const tabs = await elements('.scene-tab');
    if (tabs.length < 3) throw new Error('scene tabs unavailable for rapid switch');
    const from = state.lifecycle.length;
    await tabs[0].tap(); await tabs[1].tap(); await tabs[2].tap();
    await waitAudit(from, 'date');
  });

  await interaction('today-detail-consistency', () => todayDetailConsistency());
  for (const category of [
    { index: 1, name: 'top', matches: ['top', '上衣', '上装'] },
    { index: 2, name: 'bottom', matches: ['bottom', '下装', '裤'] },
    { index: 4, name: 'shoes', matches: ['shoe', '鞋'] },
  ]) {
    try { state.matrix.push({ name: `wardrobe-${category.name}-detail`, ...(await captureWardrobeDetail(category)) }); }
    catch (caught) { error('WARDROBE_DETAIL_FAILED', caught.message || caught, category); }
  }
  */
  }
}

main().catch((caught) => fail('RUNNER_FATAL', caught.stack || caught.message || caught)).finally(async () => {
  let finalized = false;
  try {
    await finalize();
    finalized = true;
  } finally {
    if (state.mini) state.mini.disconnect();
    if (finalized && state.preflightReady && !state.failed) console.log('READY_FOR_INITIAL');
  }
});
