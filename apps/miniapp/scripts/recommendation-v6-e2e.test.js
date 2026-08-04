const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const countContract = require('../cloudfunctions/generateOutfit/shared/countContract');
const {
  buildQaAuditSummaries,
  fitQaBatchAuditToBudget,
  serializedBytes,
} = require('../cloudfunctions/generateOutfit/services/qaBatchAudit');
const { adaptCompositionCandidate, hydrateCanonicalScore } = require('../cloudfunctions/generateOutfit/services/canonicalCandidate');
const { logRecommendationEvent } = require('../src/lib/recommendationDiagnostics');

const TEST_WINDOW_HANDLE = 0x100000 + process.pid;
const TEST_PROCESS_ID = process.pid;

function countContractFor({ before = 8, returned = 8, executionMode = 'candidate_pool_hit' } = {}) {
  return {
    requestedBatchSize: 8,
    expectedCardCount: before === 0 ? 0 : Math.min(8, before),
    returnedCardCount: returned,
    remainingUniqueBeforeConsume: before,
    remainingUniqueAfterConsume: before - returned,
    tailBatchAuthorized: before > 0 && before < 8,
    poolExhaustedAfterConsume: before - returned === 0,
    executionMode,
    candidatePoolId: null,
  };
}

function rawRecommendationResponse({
  contract = countContractFor(),
  returned = contract?.returnedCardCount ?? 0,
  debug = {},
  qaBatchAudit = null,
} = {}) {
  return {
    code: 0,
    message: 'ok',
    data: {
      countContract: contract,
      outfits: Array.from({ length: returned }, (_, index) => ({ outfitKey: `outfit-${index + 1}` })),
      debug,
      ...(qaBatchAudit ? { qaBatchAudit } : {}),
    },
  };
}

function chainCandidate(index) {
  const itemId = `chain-item-${index}`;
  const candidate = adaptCompositionCandidate({
    outfitKey: `chain-outfit-${index}`,
    items: [{ _id: itemId, category: 'top', outfitSlot: 'top', outfitRole: 'core', styleTags: ['casual'] }],
  }, { scene: 'home', weather: {} });
  candidate.archetype = 'chain-test';
  candidate.eligibilityReason = { code: 'HOME_COMFORT', subjectItemIds: [itemId] };
  candidate.rankingScore = 100 - index;
  hydrateCanonicalScore(candidate, { title: `chain title ${index}`, scores: { total: 100 - index } });
  return candidate;
}

function loadE2eInternals({
  capturePresentationEvidence = false,
  wxAvailable = true,
  taroAvailable = false,
  cloudHelperAvailable = false,
  failedTargets = [],
  evidenceDir = path.join(os.tmpdir(), 'recommendation-v61-runner-test'),
  dateImpl = Date,
} = {}) {
  const source = fs.readFileSync(path.join(__dirname, 'recommendation-v6-e2e.cjs'), 'utf8');
  // Strip the env guard, automator require, and main() invocation so the module
  // can be evaluated in a sandbox without side effects.
  const cleaned = source
    .replace(/if \(!EVIDENCE_DIR[^\n]*\n\s*throw[^}]*\}\n/, '')
    .replace(/const automator = require\(AUTOMATOR_MODULE_PATH\);/, 'const automator = {};')
    .replace(/main\(\)\.catch[\s\S]*$/, '')
  + '\nmodule.exports = { buildRunnerConfig, buildRecommendationRequestData, presentationEvidenceFileFor, authoritativeResponseData, authoritativeResponseCountContract, sanitizeRecommendationCountContract, sanitizeResponseForEvidence, normalizeCloudCallCapture, recordRuntimeResponseCapture, shouldRunPresentationRefresh, presentationEvidenceBudgetFailure, buildValidationReport, compact, compactDiagnosticMap, buildRequests, parseConsole, sanitizeLifecyclePayload, sanitizeEligibilityRejectionAudit, recordLifecycleEvent, recordTerminalRequestFailure, waitAudit, waitForBootstrapRequestsToSettle, state, field, number, validateVersionContract, validateCandidatePoolDiagnostics, validateCanonicalQa, normalizeQaContractPayload, normalizeQaObservation, qaObservation, resolveQaPayload, assertRefreshExcludesPrevious, buildSummary, navigateSwiperToCard, readActiveSwiperState, readTodayPageHealth, readTodayAcceptanceState, readCurrentUserRecommendationStorage, resetCurrentUserRecommendationCache, snapshotMatchesRenderedState, isCleanTodayAcceptanceState, recommendationCounterBaseline, recommendationCounterDelta, assertSingleGenerateSinceBaseline, assertNoGenerateSinceBaseline, prepareSportAcceptancePrecondition, installResetRecommendationBlocker, setResetRecommendationBlockerActive, removeResetRecommendationBlocker, tapScene, readCardVisualSample, waitForCardVisualStability, swipeToCaptureCard, captureBatch, captureBatchOrContinue, validateCapturedBatch, validatePresentationEvidenceCapture, scanPresentationEvidencePii, presentationEvidenceTables, installPresentationEvidenceCapture, restoreExistingPresentationEvidenceCapture, setPresentationCaptureSlot, readPresentationEvidenceRuntimeCapture, readPresentationCaptureStatus, readPresentationCaptureGeneration, validateFreshCaptureHandshake, clearRunnerStateAfterPageReset, captureFailureReason, runtimeCaptureFailure, readPngDimensions, captureWindowsDevToolsScreenshot, uniqueScreenshot, WINDOWS_CAPTURE_HELPER, SCREENSHOT_PROVIDER, EXPECTED_CLOUD_BUILD, EXPECTED_QA_VERSION, PRESENTATION_EVIDENCE_MODE, PRESENTATION_EVIDENCE_VERSION, PRESENTATION_EVIDENCE_MAX_BYTES };\n';

  const sandbox = {
    module: { exports: {} },
    exports: {},
    require: (mod) => {
      if (mod === 'fs') return fs;
      if (mod === 'node:crypto') return crypto;
      if (mod === 'node:child_process') return {
        execFileSync: () => { throw new Error('unexpected real PowerShell invocation in unit test'); },
      };
      if (mod === './runner-preflight-resolver.cjs') return {
        AUTOMATOR_WS_ENDPOINT: 'ws://127.0.0.1:9420',
      };
      if (mod === '../cloudfunctions/generateOutfit/shared/countContract') return countContract;
      if (mod === 'path') return path;
      return {};
    },
    process: { env: {
      EVIDENCE_DIR: evidenceDir,
      MINIPROGRAM_AUTOMATOR_PATH: 'mock',
      CAPTURE_PRESENTATION_EVIDENCE: capturePresentationEvidence ? 'true' : 'false',
      D1D_DEVTOOLS_HWND: String(TEST_WINDOW_HANDLE),
      SCREENSHOT_PROVIDER: 'windows-native-primary-screen',
    } },
    console,
    Date: dateImpl,
    Map,
    Set,
    Array,
    Object,
    JSON,
    String,
    Number,
    Boolean,
    Buffer,
    Promise,
    setTimeout,
    clearTimeout,
    __dirname,
  };
  sandbox.__runnerCallOptions = [];
  const targetObjects = {};
  const createCloudTarget = (target) => {
    const cloud = {
      callFunction: (options) => {
        sandbox.__runnerCallOptions.push(options);
        return Promise.resolve({ result: { code: 0, message: 'ok', data: { debug: { auditId: options?.data?.auditId } } } });
      },
    };
    targetObjects[target] = cloud;
    if (failedTargets.includes(target)) {
      Object.defineProperty(cloud, 'callFunction', { configurable: false, writable: false, value: cloud.callFunction });
    }
    return cloud;
  };
  if (wxAvailable) sandbox.wx = { cloud: createCloudTarget('wx.cloud.callFunction') };
  if (taroAvailable) sandbox.Taro = { cloud: createCloudTarget('Taro.cloud.callFunction') };
  if (cloudHelperAvailable) sandbox.cloudHelper = createCloudTarget('cloudHelper.callFunction');
  sandbox.globalThis = sandbox;
  sandbox.global = sandbox;

  vm.runInNewContext(cleaned, sandbox, { filename: 'recommendation-v6-e2e.cjs' });
  sandbox.module.exports.__invokeCloudCall = (options, target = 'wx.cloud.callFunction') => targetObjects[target].callFunction(options);
  sandbox.module.exports.__runnerCallOptions = sandbox.__runnerCallOptions;
  sandbox.module.exports.__targetObjects = targetObjects;
  return sandbox.module.exports;
}

function writePngFixture(file, width = 363, height = 785) {
  const bytes = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes, 0);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  fs.writeFileSync(file, bytes);
}

function windowsCaptureSuccess(file, { width = 363, height = 785, skipStat = false } = {}) {
  const stat = skipStat ? { size: 24 } : fs.statSync(file);
  return JSON.stringify({
    ok: true,
    screenshotProvider: 'windows-native-primary-screen',
    windowHandle: TEST_WINDOW_HANDLE,
    processId: TEST_PROCESS_ID,
    processName: '微信开发者工具.exe',
    windowTitle: 'd1d',
    primaryScreenBounds: { left: -1920, top: 0, right: -1920 + width, bottom: height, width, height },
    dpi: { awareness: 'per_monitor_v2', window: 144, system: 144 },
    width,
    height,
    bytes: stat.size,
    capturedAt: '2026-07-29T00:00:00.000Z',
    restoredOriginalForeground: true,
  });
}

function windowsCaptureFailure(code, message = code) {
  const error = new Error(message);
  error.stdout = JSON.stringify({ ok: false, errorCode: code, errorMessage: message, restoredOriginalForeground: true });
  error.stderr = '';
  throw error;
}

function createAdvancingDate() {
  let current = Date.now();
  return class AdvancingDate extends Date {
    constructor(...args) {
      super(...(args.length > 0 ? args : [current]));
    }

    static now() {
      current += 2000;
      return current;
    }

    static parse(value) {
      return Date.parse(value);
    }

    static UTC(...args) {
      return Date.UTC(...args);
    }
  };
}

test('standard runner uses one Windows native provider and never calls DevTools screenshot RPC', () => {
  const source = fs.readFileSync(path.join(__dirname, 'recommendation-v6-e2e.cjs'), 'utf8');
  assert.doesNotMatch(source, /SetIsBorderRequired|Computer Use|initial_window_state_capture/);
  assert.match(source, /SCREENSHOT_PROVIDER = 'windows-native-primary-screen'/);
  assert.match(source, /captureWindowsDevToolsScreenshot/);
  assert.match(source, /windows-devtools-capture\.ps1/);
  assert.doesNotMatch(source, /mini\.screenshot|App\.captureScreenshot|captureAutomatorScreenshot/);
  assert.match(source, /runPreflightOnly/);
  assert.match(source, /waitForCardVisualStability/);
});

test('capture lifecycle has one installer and no fresh injection options', () => {
  const source = fs.readFileSync(path.join(__dirname, 'recommendation-v6-e2e.cjs'), 'utf8');
  assert.match(source, /async function restoreExistingPresentationEvidenceCapture\(\)/);
  assert.match(source, /async function installPresentationEvidenceCapture\(expectedPreviousGeneration = null\)/);
  assert.doesNotMatch(source, /installPresentationEvidenceCapture\(\{\s*forceFreshGeneration/);
  assert.doesNotMatch(source, /state\.mini\.evaluate\(\(options = \{\}\)/);
  assert.match(source, /captureHookMarker: 'recommendation-v61-capture-hook-v1'/);
});

test('Windows capture validates PNG dimensions without a request-time preflight', () => {
  const evidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recommendation-v61-stable-shot-'));
  try {
    const internals = loadE2eInternals({ evidenceDir });
    fs.mkdirSync(path.join(evidenceDir, 'screenshots'), { recursive: true });
    let screenshotCalls = 0;
    const target = path.join(evidenceDir, 'screenshots', 'stable-card.png');
    internals.state.windowsCaptureExecFileSync = (_exe, args) => {
      screenshotCalls += 1;
      writePngFixture(args[args.indexOf('-OutputPath') + 1]);
      return windowsCaptureSuccess(target);
    };
    const result = internals.captureWindowsDevToolsScreenshot(target, {
      label: 'stable-card', batch: 'initial', cardIndex: 1, outfitIdentity: 'outfit-a', cardTitle: 'Sport title 1',
    });
    assert.equal(screenshotCalls, 1);
    assert.equal(internals.state.hasRealRequest, false);
    assert.equal(result.screenshotProvider, 'windows-native-primary-screen');
    assert.equal(result.file, 'screenshots/stable-card.png');
    assert.equal(result.windowHandle, TEST_WINDOW_HANDLE);
    assert.deepEqual(result.screenBounds, { left: -1920, top: 0, right: -1557, bottom: 785, width: 363, height: 785 });
    assert.deepEqual(result.primaryScreenBounds, result.screenBounds);
    assert.deepEqual(result.dpi, { awareness: 'per_monitor_v2', window: 144, system: 144 });
    assert.equal(result.cardIndex, 1);
    assert.equal(result.outfitIdentity, 'outfit-a');
    assert.equal(result.cardTitle, 'Sport title 1');
    assert.equal(result.bytes, 24);
  } finally {
    fs.rmSync(evidenceDir, { recursive: true, force: true });
  }
});

test('Windows provider executes PowerShell exactly once and does not call mini.screenshot', () => {
  const evidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recommendation-v61-provider-once-'));
  try {
    const internals = loadE2eInternals({ evidenceDir });
    const target = path.join(evidenceDir, 'one.png');
    let calls = 0;
    let captureArgs = null;
    internals.state.mini = { screenshot: () => { throw new Error('mini.screenshot must not be called'); } };
    internals.state.windowsCaptureExecFileSync = (_exe, args) => {
      calls += 1;
      captureArgs = args;
      writePngFixture(args[args.indexOf('-OutputPath') + 1]);
      return windowsCaptureSuccess(target);
    };
    internals.captureWindowsDevToolsScreenshot(target, { label: 'one' });
    assert.equal(calls, 1);
    assert.equal(captureArgs[captureArgs.indexOf('-WindowHandle') + 1], String(TEST_WINDOW_HANDLE));
  } finally {
    fs.rmSync(evidenceDir, { recursive: true, force: true });
  }
});

test('a Windows screenshot that does not land on disk cannot be treated as success', () => {
  const evidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recommendation-v61-missing-shot-'));
  try {
    const internals = loadE2eInternals({ evidenceDir });
    const target = path.join(evidenceDir, 'missing.png');
    internals.state.windowsCaptureExecFileSync = () => windowsCaptureSuccess(target, { skipStat: true });
    assert.throws(
      () => internals.captureWindowsDevToolsScreenshot(target, { label: 'missing' }),
      (caught) => caught.code === 'SCREENSHOT_INVALID',
    );
  } finally {
    fs.rmSync(evidenceDir, { recursive: true, force: true });
  }
});

for (const [name, code] of [
  ['no visible matching window', 'DEVTOOLS_WINDOW_NOT_FOUND'],
  ['multiple matching windows', 'DEVTOOLS_WINDOW_NOT_UNIQUE'],
  ['foreground activation failure', 'DEVTOOLS_WINDOW_NOT_FOREGROUND'],
  ['minimized-window restore failure', 'DEVTOOLS_WINDOW_RESTORE_FAILED'],
]) {
  test(`Windows provider fails on ${name}`, () => {
    const evidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recommendation-v61-window-failure-'));
    try {
      const internals = loadE2eInternals({ evidenceDir });
      const target = path.join(evidenceDir, 'failed.png');
      internals.state.windowsCaptureExecFileSync = () => windowsCaptureFailure(code);
      assert.throws(
        () => internals.captureWindowsDevToolsScreenshot(target, { label: name }),
        (caught) => caught.code === code,
      );
    } finally {
      fs.rmSync(evidenceDir, { recursive: true, force: true });
    }
  });
}

test('Windows capture rejects a PNG whose dimensions differ from the real window rect', () => {
  const evidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recommendation-v61-dimension-mismatch-'));
  try {
    const internals = loadE2eInternals({ evidenceDir });
    const target = path.join(evidenceDir, 'wrong-size.png');
    internals.state.windowsCaptureExecFileSync = (_exe, args) => {
      writePngFixture(args[args.indexOf('-OutputPath') + 1], 364, 785);
      return windowsCaptureSuccess(target, { width: 363, height: 785 });
    };
    assert.throws(
      () => internals.captureWindowsDevToolsScreenshot(target, { label: 'wrong-size' }),
      (caught) => caught.code === 'SCREENSHOT_DIMENSIONS_MISMATCH',
    );
  } finally {
    fs.rmSync(evidenceDir, { recursive: true, force: true });
  }
});

test('PowerShell helper restores the original foreground window in finally', () => {
  const source = fs.readFileSync(path.join(__dirname, 'windows-devtools-capture.ps1'), 'utf8');
  assert.match(source, /\$originalForeground\s*=\s*\[D1dWindowCapture\]::GetForeground\(\)/);
  assert.match(source, /finally\s*\{/);
  assert.match(source, /RestoreForeground\(\$originalForeground\)/);
});

test('request lifecycle contains no screenshot call before initial business request', () => {
  const source = fs.readFileSync(path.join(__dirname, 'recommendation-v6-e2e.cjs'), 'utf8');
  const mainSource = source.slice(source.indexOf('async function main()'));
  assert.match(mainSource, /runPreflightOnly/);
  assert.ok(mainSource.indexOf('await installPresentationEvidenceCapture') < mainSource.indexOf("await tapScene(3, 'sport'"));
  assert.ok(mainSource.indexOf("await tapScene(3, 'sport'") < mainSource.indexOf("captureBatchOrContinue('sport', 'initial'"));
  assert.equal(internalsHasScreenshotCallBeforeRequest(mainSource), false);
});

test('runner enters Today automatically before the Sport precondition', () => {
  const source = fs.readFileSync(path.join(__dirname, 'recommendation-v6-e2e.cjs'), 'utf8');
  assert.match(source, /async function enterTodayPage\(\)/);
  const mainSource = source.slice(source.indexOf('async function main()'));
  assert.ok(mainSource.indexOf('await enterTodayPage()') < mainSource.indexOf('await prepareSportAcceptancePrecondition()'));
  assert.match(source, /TODAY_RELAUNCH_URL = '\/pages\/today\/index'/);
});

test('initial and refresh screenshot paths remain independent from preflight artifacts', () => {
  const evidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recommendation-v61-screenshots-'));
  try {
    const internals = loadE2eInternals({ evidenceDir });
    const initial = internals.uniqueScreenshot('sport', 'initial', 1, 'audit-initial');
    const refresh = internals.uniqueScreenshot('sport', 'refresh', 1, 'audit-refresh');
    assert.notEqual(initial, refresh);
    assert.match(initial, /screenshots[\\/]sport[\\/]initial/);
    assert.match(refresh, /screenshots[\\/]sport[\\/]refresh/);
    const source = fs.readFileSync(path.join(__dirname, 'recommendation-v6-e2e.cjs'), 'utf8');
    assert.match(source, /response-\$\{slot\}\.json/);
    assert.match(source, /preflight-primary-screen\.png/);
    assert.match(source, /createEvidenceZip\(\)/);
  } finally {
    fs.rmSync(evidenceDir, { recursive: true, force: true });
  }
});

function internalsHasScreenshotCallBeforeRequest(mainSource) {
  const requestIndex = mainSource.indexOf("await tapScene(3, 'sport'");
  const screenshotIndex = mainSource.indexOf('captureWindowsDevToolsScreenshot');
  return screenshotIndex >= 0 && screenshotIndex < requestIndex;
}

test('runner retains visual stability ordering without the old DevTools RPC audit branch', () => {
  const source = fs.readFileSync(path.join(__dirname, 'recommendation-v6-e2e.cjs'), 'utf8');
  assert.match(source, /swiper\.swipeTo\(targetIndex\)/);
  assert.match(source, /waitForCardVisualStability/);
  assert.match(source, /captureWindowsDevToolsScreenshot/);
  assert.doesNotMatch(source, /mini\.screenshot|App\.captureScreenshot|SCREENSHOT_LIFECYCLE_AUDIT/);
});

test('unobserved versions never produce a passing validation report', () => {
  const internals = loadE2eInternals();
  const summary = internals.buildSummary([]);
  const report = internals.buildValidationReport(summary, []);
  assert.equal(summary.versionContract.status, 'NOT_OBSERVED');
  assert.notEqual(report.status, 'PASSED');
});

test('bootstrap STALE_REQUEST_SEQ remains isolated from sport initial slot', async () => {
  const internals = loadE2eInternals();
  const bootstrapId = 'rec_bootstrap_stale';
  const sportId = 'rec_sport_initial';
  internals.state.lifecycle = [
    { label: '[RecommendStart]', payload: { auditId: bootstrapId, sceneKey: 'home', trigger: 'initial', slot: 'initial' } },
    { label: '[RecommendError]', payload: { auditId: bootstrapId, errorCode: 'STALE_REQUEST_SEQ' } },
    { label: '[RecommendStart]', payload: { auditId: sportId, sceneKey: 'sport', trigger: 'scene', slot: 'initial' } },
    { label: '[RecommendResponse]', payload: { auditId: sportId, cloudBuild: internals.EXPECTED_CLOUD_BUILD } },
    { label: '[RecommendationQA]', payload: { auditId: sportId, version: internals.EXPECTED_QA_VERSION } },
    { label: '[RecommendDone]', payload: { auditId: sportId } },
  ];
  internals.state.requestSlots.set(sportId, 'initial');
  await internals.waitForBootstrapRequestsToSettle();
  const requests = internals.buildRequests();
  assert.equal(requests.find((entry) => entry.auditId === bootstrapId).slot, 'bootstrap');
  assert.equal(requests.find((entry) => entry.auditId === sportId).slot, 'initial');
  assert.equal(requests.find((entry) => entry.auditId === bootstrapId).requestOutcome, 'request_failure');
});

test('V6 E2E runner records the explicit QA contract and active-card screenshot gates', () => {
  const source = fs.readFileSync(path.join(__dirname, 'recommendation-v6-e2e.cjs'), 'utf8');
  for (const field of [
    'executionMode', 'candidatePoolIdentityHash', 'candidatePoolAgeMs', 'cacheHit', 'cacheMissReason',
    'generated', 'accepted', 'rejected', 'selected', 'fallbackReasonCount', 'exactReasonDuplicateGroups',
    'reuseExplanations', 'exclusionsAppliedCount', 'timings',
    'candidatePoolSaveStatus', 'candidatePoolSaveReason', 'candidatePoolSerializedBytes', 'candidatePoolChunkCount',
    'recommendationBatchIdPresent', 'recommendationBatchIdLength',
    'requestedCandidatePoolIdPresent', 'requestedCandidatePoolIdLength',
  ]) assert.equal(source.includes(field), true, field);
  assert.match(source, /waitForCardVisualStability/);
  assert.match(source, /CARD_VISUAL_STABILITY_TIMEOUT/);
  assert.match(source, /SCREENSHOT_DIMENSIONS_MISMATCH/);
  const helper = fs.readFileSync(path.join(__dirname, 'windows-devtools-capture.ps1'), 'utf8');
  assert.match(helper, /DEVTOOLS_WINDOW_NOT_UNIQUE/);
  assert.match(source, /refusing to overwrite screenshot/);
  assert.match(source, /detail category mismatch/);
  assert.equal(/\bocr\b/i.test(source), false);
  assert.equal(/tap\([^)]*\d+\s*,\s*\d+/.test(source), false);
  assert.match(source, /function navigateSwiperToCard/);
  assert.match(source, /swiper\.offset\(\)/);
  assert.match(source, /swiper\.size\(\)/);
  assert.match(source, /touchstart/);
  assert.match(source, /SWIPER_NAVIGATION_FAILED/);
  assert.equal(/setData\s*\(/.test(source), false);
  assert.equal(/trigger\s*\(\s*['"]change/.test(source), false);
});

function createSwiperHarness({
  swipeMode = 'native',
  keys = ['outfit-a', 'outfit-b'],
  startIndex = 0,
  visualMode = 'follow',
  cardOutfitKeys = keys,
  dotIndex = null,
  replaceCardsOnSwipe = false,
} = {}) {
  let current = startIndex;
  let visualCurrent = startIndex;
  let cardGeneration = 0;
  let cardQueryCount = 0;
  const calls = { swipeTo: [], touchstart: [], touchmove: [], touchend: [] };
  const rect = { left: 10, top: 20, width: 100, height: 200 };
  const card = (index) => ({
    generation: cardGeneration,
    offset: async () => ({ left: rect.left + (index - visualCurrent) * rect.width, top: rect.top }),
    size: async () => ({ width: rect.width, height: rect.height }),
    attribute: async (name) => name === 'data-outfit-key' ? cardOutfitKeys[index] : null,
    property: async (name) => name === 'outfitKey' ? cardOutfitKeys[index] : null,
    $: async (selector) => selector === '.card-count'
      ? { text: async () => `${index + 1} / ${keys.length}` }
      : null,
  });
  const makeCards = () => {
    cardQueryCount += 1;
    return keys.map((_, index) => card(index));
  };
  let cards = makeCards();
  const swiper = {
    offset: async () => ({ left: rect.left, top: rect.top }),
    size: async () => ({ width: rect.width, height: rect.height }),
    property: async () => current,
    attribute: async () => String(current),
    outerWxml: async () => '<swiper class="outfit-swiper" src="secret-image-url"><view class="outfit-card">secret-title</view></swiper>',
    swipeTo: async (index) => {
      calls.swipeTo.push(index);
      if (swipeMode === 'native') {
        current = index;
        if (visualMode !== 'stale') visualCurrent = index;
        if (replaceCardsOnSwipe) {
          cardGeneration += 1;
          cards = makeCards();
        }
      }
    },
    touchstart: async (options) => { calls.touchstart.push(options); },
    touchmove: async (options) => { calls.touchmove.push(options); },
    touchend: async (options) => {
      calls.touchend.push(options);
      if (swipeMode === 'gesture') {
        current = 1;
        if (visualMode !== 'stale') visualCurrent = 1;
      }
    },
  };
  const page = {
    $: async (selector) => selector === '.outfit-swiper' ? swiper : null,
    $$: async (selector) => {
      if (selector === '.outfit-card') return cards;
      if (selector === '.pagination-dot') {
        return keys.map((_, index) => ({
          attribute: async (name) => name === 'class' ? `pagination-dot${index === (dotIndex ?? current) ? ' active' : ''}` : null,
          property: async (name) => name === 'className' ? `pagination-dot${index === (dotIndex ?? current) ? ' active' : ''}` : null,
        }));
      }
      return [];
    },
  };
  return { page, swiper, calls, rect, getCurrent: () => current, getCardQueryCount: () => cardQueryCount };
}

function setSnapshotState(internals, keys) {
  const snapshot = {
    outfits: keys.map((outfitKey) => ({ outfitKey, clothingIds: [] })),
    countContract: countContractFor({ before: keys.length, returned: keys.length }),
  };
  internals.state.mini = {
    callWxMethod: async (name, key) => {
      if (name === 'getStorageInfoSync') return { keys: [TEST_TODAY_SNAPSHOT_KEY] };
      if (name === 'getStorageSync' && key === 'openid') return 'test-openid';
      if (name === 'getStorageSync' && key === TEST_TODAY_SNAPSHOT_KEY) return snapshot;
      return '';
    },
  };
}

function createVisualStabilityHarness({
  cardCount = 8,
  itemCount = 2,
  loadedByCard = Array.from({ length: cardCount }, () => itemCount),
  skeletonByCard = Array.from({ length: cardCount }, () => 0),
  moving = false,
  staleVisual = false,
  refreshLoading = false,
} = {}) {
  let current = 0;
  let visualCurrent = 0;
  const swipeCalls = [];
  const rect = { left: 10, top: 20, width: 100, height: 200 };
  const cards = Array.from({ length: cardCount }, (_, index) => {
    const images = Array.from({ length: itemCount }, (_, imageIndex) => ({
      attribute: async (name) => name === 'class'
        ? (imageIndex < (loadedByCard[index] || 0) ? 'item-image loaded' : 'item-image')
        : name === 'src' ? `cloud://card-${index}-image-${imageIndex}` : null,
      property: async (name) => name === 'className'
        ? (imageIndex < (loadedByCard[index] || 0) ? 'item-image loaded' : 'item-image')
        : name === 'src' ? `cloud://card-${index}-image-${imageIndex}` : null,
    }));
    return {
      offset: async () => ({ left: rect.left + (index - visualCurrent) * rect.width, top: rect.top }),
      $: async (selector) => {
        if (selector === '.card-count') return { text: async () => `${index + 1} / ${cardCount}` };
        if (selector === '.outfit-title') return { text: async () => `Sport title ${index + 1}` };
        if (selector === '.reason-text') return { text: async () => `Sport reason ${index + 1}` };
        return null;
      },
      $$: async (selector) => {
        if (selector === '.item-image') return images;
        if (selector === '.image-skeleton') return Array.from({ length: skeletonByCard[index] || 0 }, () => ({}));
        if (selector === '.collage-item') return Array.from({ length: itemCount }, () => ({}));
        if (selector === '.style-tag') return [];
        return [];
      },
    };
  });
  const swiper = {
    offset: async () => ({ left: rect.left, top: rect.top }),
    size: async () => ({ width: rect.width, height: rect.height }),
    property: async () => moving ? 1 : current,
    attribute: async () => String(moving ? 1 : current),
    swipeTo: async (index) => {
      swipeCalls.push(index);
      current = index;
      if (!staleVisual) visualCurrent = index;
    },
  };
  const page = {
    path: 'pages/today/index',
    size: async () => ({ width: 390, height: 744 }),
    data: async () => ({ loading: false }),
    $: async (selector) => {
      if (selector === '.outfit-swiper') return swiper;
      if (selector === '.refresh-btn') return {
        attribute: async (name) => name === 'class' ? (refreshLoading ? 'refresh-btn disabled' : 'refresh-btn') : null,
        property: async (name) => name === 'className' ? (refreshLoading ? 'refresh-btn disabled' : 'refresh-btn') : null,
        text: async () => refreshLoading ? 'refreshing' : 'refresh',
      };
      return null;
    },
    $$: async (selector) => {
      if (selector === '.outfit-card') return cards;
      if (selector === '.pagination-dot') {
        return Array.from({ length: cardCount }, (_, index) => ({
          attribute: async (name) => name === 'class' ? `pagination-dot${index === current ? ' active' : ''}` : null,
          property: async (name) => name === 'className' ? `pagination-dot${index === current ? ' active' : ''}` : null,
        }));
      }
      if (selector === '.scene-loading-overlay' || selector === '.loading-state') return [];
      return [];
    },
  };
  return { page, swiper, cards, swipeCalls, getCurrent: () => current };
}

function setVisualSnapshotState(internals, cardCount = 8, itemCount = 2) {
  const snapshot = {
    countContract: countContractFor({ before: cardCount, returned: cardCount }),
    outfits: Array.from({ length: cardCount }, (_, index) => ({
      outfitKey: `outfit-${index + 1}`,
      clothingIds: Array.from({ length: itemCount }, (_, itemIndex) => `item-${index + 1}-${itemIndex + 1}`),
    })),
  };
  internals.state.mini = {
    callWxMethod: async (name, key) => {
      if (name === 'getStorageInfoSync') return { keys: [TEST_TODAY_SNAPSHOT_KEY] };
      if (name === 'getStorageSync' && key === 'openid') return 'test-openid';
      if (name === 'getStorageSync' && key === TEST_TODAY_SNAPSHOT_KEY) return snapshot;
      return '';
    },
  };
}

function attachHarnessToMini(internals, harness, { screenshot } = {}) {
  internals.state.mini.currentPage = async () => harness.page;
  internals.state.windowsCaptureExecFileSync = (_exe, args) => {
    const target = args[args.indexOf('-OutputPath') + 1];
    if (screenshot) screenshot({ path: target });
    else writePngFixture(target);
    return windowsCaptureSuccess(target);
  };
}

const TEST_USER_STORAGE_SCOPE = 'd1d:userStorage:v1:develop:cloud:test:user:test-openid';
const TEST_TODAY_SNAPSHOT_KEY = `${TEST_USER_STORAGE_SCOPE}:today:outfitReturnSnapshot:recommendation-copy-contract-v3`;
const TEST_SCENE_SNAPSHOT_PREFIX = `${TEST_USER_STORAGE_SCOPE}:${encodeURIComponent('today:sceneSnapshot:recommendation-copy-contract-v3')}`;

function acceptanceSnapshot({ sceneKey = 'home', count = 8, batchId = 'batch-test', exhausted = false } = {}) {
  return {
    selectedSceneKey: sceneKey,
    sceneKey,
    outfits: Array.from({ length: count }, (_, index) => ({ outfitKey: `${sceneKey}-outfit-${index + 1}` })),
    recommendationBatchId: batchId,
    generatedAt: Date.now(),
    hasRecommendations: count > 0,
    batchLimited: count > 0 && count < 8,
    batchExhausted: exhausted,
    countContract: countContractFor({ before: count, returned: count }),
  };
}

function acceptanceStorageEntries(snapshot) {
  return {
    [TEST_TODAY_SNAPSHOT_KEY]: snapshot,
    [`${TEST_SCENE_SNAPSHOT_PREFIX}:${encodeURIComponent(`scene-key-${snapshot.sceneKey}`)}`]: snapshot,
  };
}

function acceptancePageState({
  sceneKey = 'home',
  count = 0,
  snapshot = null,
  loading = false,
  pendingIntentCount = 0,
  pendingRequestCount = 0,
  uncommittedResponseCount = 0,
} = {}) {
  const identity = snapshot ? {
    sceneKey,
    recommendationBatchId: snapshot.recommendationBatchId,
    generatedAt: snapshot.generatedAt,
    outfitKeys: snapshot.outfits.map((outfit) => outfit.outfitKey),
    outfitCount: snapshot.outfits.length,
    expectedCardCount: snapshot.countContract.expectedCardCount,
    returnedCardCount: snapshot.countContract.returnedCardCount,
    batchLimited: snapshot.batchLimited === true,
    batchExhausted: snapshot.batchExhausted === true,
    hasRecommendations: snapshot.hasRecommendations !== false,
  } : null;
  return {
    path: 'pages/today/index',
    activeScene: sceneKey,
    tabCount: 4,
    sportTabCount: 1,
    outfitCardCount: count,
    hasBatchCardCount: count,
    loadingStateCount: loading ? 1 : 0,
    sceneLoadingOverlayCount: 0,
    lifecycle: { intentStartCount: 0, pendingIntentCount },
    capture: {
      requestBufferCount: pendingRequestCount + uncommittedResponseCount,
      pendingRequestCount,
      uncommittedResponseCount,
    },
    snapshot: {
      observable: true,
      todaySnapshotPresent: Boolean(identity),
      sceneSnapshotKeyPresent: Boolean(identity),
      source: identity ? 'scene_snapshot' : 'empty',
      today: identity,
      scene: identity,
    },
  };
}

function createTodayAcceptanceHarness({
  beforeScene = 'home',
  beforeHasBatch = false,
  afterScene = 'home',
  afterHasBatch = false,
  relaunchError = null,
  storageEntries = {},
} = {}) {
  let phase = 'before';
  let relaunchCalls = 0;
  let cloudCalls = 0;
  let screenshotCalls = 0;
  const labels = ['居家', '通勤', '约会', '运动'];
  const sceneKeyToIndex = { home: 0, work: 1, date: 2, sport: 3 };
  const activeIndex = (scene) => sceneKeyToIndex[scene] ?? 0;
  const pages = {
    before: {
      id: 11,
      path: 'pages/today/index',
    },
    after: {
      id: 12,
      path: 'pages/today/index',
    },
  };
  const storage = new Map([
    ['openid', 'test-openid'],
    ['wardrobe:items', { count: 31 }],
    ['preferences:styles', ['minimal']],
    ...Object.entries(storageEntries),
  ]);
  const page = {
    get id() { return pages[phase].id; },
    path: 'pages/today/index',
    $: async (selector) => selector === '.refresh-btn'
      ? { attribute: async (name) => name === 'class' ? 'refresh-btn' : null }
      : null,
    $$: async (selector) => {
      const scene = phase === 'before' ? beforeScene : afterScene;
      const hasBatch = phase === 'before' ? beforeHasBatch : afterHasBatch;
      if (selector === '.scene-tab') {
        return labels.map((label, index) => ({
          text: async () => label,
          attribute: async (name) => name === 'class'
            ? `scene-tab${index === activeIndex(scene) ? ' active' : ''}`
            : null,
        }));
      }
      if (selector === '.outfit-card') return hasBatch ? Array.from({ length: 8 }, () => ({})) : [];
      if (selector === '.outfit-card.has-batch') return hasBatch ? Array.from({ length: 8 }, () => ({})) : [];
      if (selector === '.loading-state' || selector === '.scene-loading-overlay') return [];
      return [];
    },
  };
  const mini = {
    currentPage: async () => page,
    reLaunch: async () => {
      relaunchCalls += 1;
      if (relaunchError) throw new Error(relaunchError);
      phase = 'after';
      return page;
    },
    evaluate: async (fn, arg) => {
      const source = String(fn);
      if (source.includes('recommendationV61RunnerResetCallFunction')) {
        return { installed: true, installedTargets: ['wx.cloud.callFunction'], failedTargets: [], blockedGenerateOutfitCount: 0 };
      }
      if (source.includes('registry.active = nextActive')) return arg === true;
      if (source.includes('delete globalObject.__recommendationV61RunnerResetBlocker')) {
        return { removed: true, blockedGenerateOutfitCount: 0 };
      }
      if (source.includes('blockedGenerateOutfitCount')) return { blockedGenerateOutfitCount: 0 };
      if (source.includes('pendingRequestCount') && source.includes('uncommittedResponseCount')) {
        return {
          captureGeneration: null,
          requestBufferCount: 0,
          pendingRequestCount: 0,
          uncommittedResponseCount: 0,
          captureHookInstalled: false,
          wrapperMarkerPresent: false,
          registryPresent: false,
          registryEntryCount: 0,
        };
      }
      return true;
    },
    callWxMethod: async (name, key) => {
      if (name === 'getStorageInfoSync') return { keys: [...storage.keys()] };
      if (name === 'getStorageSync') return storage.get(key) ?? '';
      if (name === 'removeStorageSync') {
        storage.delete(key);
        return undefined;
      }
      throw new Error(`unexpected wx method ${name}`);
    },
    callFunction: async () => {
      cloudCalls += 1;
      return { result: { code: 0 } };
    },
    screenshot: async () => { screenshotCalls += 1; },
  };
  return {
    page,
    mini,
    getCounts: () => ({ relaunchCalls, cloudCalls, screenshotCalls }),
    storage,
  };
}

test('clean Today home with no cards is accepted', () => {
  const internals = loadE2eInternals();
  assert.equal(internals.isCleanTodayAcceptanceState(acceptancePageState()), true);
});

test('new Today page restored from a valid eight-card scene snapshot is clean', () => {
  const internals = loadE2eInternals();
  const snapshot = acceptanceSnapshot({ count: 8 });
  assert.equal(internals.isCleanTodayAcceptanceState(acceptancePageState({ count: 8, snapshot })), true);
});

test('five-card tail snapshot is clean', () => {
  const internals = loadE2eInternals();
  const snapshot = acceptanceSnapshot({ count: 5, exhausted: true });
  assert.equal(internals.isCleanTodayAcceptanceState(acceptancePageState({ count: 5, snapshot })), true);
});

test('zero-card exhausted snapshot is clean', () => {
  const internals = loadE2eInternals();
  const snapshot = acceptanceSnapshot({ count: 0, exhausted: true });
  assert.equal(internals.isCleanTodayAcceptanceState(acceptancePageState({ count: 0, snapshot })), true);
});

test('in-flight request is not clean', () => {
  const internals = loadE2eInternals();
  assert.equal(internals.isCleanTodayAcceptanceState(acceptancePageState({ pendingRequestCount: 1 })), false);
  assert.equal(internals.isCleanTodayAcceptanceState(acceptancePageState({ pendingIntentCount: 1 })), false);
});

test('settled but uncommitted old response is not clean', () => {
  const internals = loadE2eInternals();
  assert.equal(internals.isCleanTodayAcceptanceState(acceptancePageState({ uncommittedResponseCount: 1 })), false);
});

test('rendered cards with mismatched snapshot identity are not clean', () => {
  const internals = loadE2eInternals();
  const snapshot = acceptanceSnapshot({ count: 8 });
  const state = acceptancePageState({ count: 8, snapshot });
  state.snapshot.scene = { ...state.snapshot.scene, recommendationBatchId: 'different-batch' };
  assert.equal(internals.isCleanTodayAcceptanceState(state), false);
});

test('clean Today home is precisely reset before Sport tap', async () => {
  const internals = loadE2eInternals();
  const harness = createTodayAcceptanceHarness();
  internals.state.mini = harness.mini;
  const result = await internals.prepareSportAcceptancePrecondition();
  assert.equal(result.ok, true);
  assert.equal(harness.getCounts().relaunchCalls, 1);
  assert.equal(harness.getCounts().cloudCalls, 0);
  assert.equal(harness.getCounts().screenshotCalls, 0);
  assert.equal(internals.state.sportPrecondition.status, 'clean');
  assert.equal(internals.state.sportPrecondition.after.activeScene, 'home');
  assert.equal(internals.state.sportPrecondition.after.sportHasBatch, false);
  assert.equal(result.cacheReset.fullStorageClearUsed, false);
  assert.equal(result.baseline.intentStartCount, 0);
});

test('Sport page with a previous batch is reset without business calls', async () => {
  const internals = loadE2eInternals();
  const snapshot = acceptanceSnapshot({ sceneKey: 'sport', count: 8 });
  const harness = createTodayAcceptanceHarness({
    beforeScene: 'sport',
    beforeHasBatch: true,
    storageEntries: acceptanceStorageEntries(snapshot),
  });
  internals.state.mini = harness.mini;
  const result = await internals.prepareSportAcceptancePrecondition();
  assert.equal(result.ok, true);
  assert.equal(result.before.activeScene, 'sport');
  assert.equal(result.before.sportHasBatch, true);
  assert.equal(result.after.activeScene, 'home');
  assert.equal(result.after.outfitCardCount, 0);
  assert.equal(result.after.hasBatchCardCount, 0);
  assert.equal(harness.getCounts().cloudCalls, 0);
});

test('precise reset removes only current-user recommendation snapshots', async () => {
  const internals = loadE2eInternals();
  const snapshot = acceptanceSnapshot({ count: 8 });
  const otherUserSnapshotKey = 'd1d:userStorage:v1:develop:cloud:test:user:other-user:today:outfitReturnSnapshot:recommendation-copy-contract-v3';
  const harness = createTodayAcceptanceHarness({
    storageEntries: {
      ...acceptanceStorageEntries(snapshot),
      [otherUserSnapshotKey]: snapshot,
      [`${TEST_USER_STORAGE_SCOPE}:today:recommendationInput:wardrobeVersion`]: 7,
      [`${TEST_USER_STORAGE_SCOPE}:today:recommendationInput:profileVersion`]: 9,
      [`${TEST_USER_STORAGE_SCOPE}:wardrobe:items`]: [{ id: 'cloth-1' }],
      [`${TEST_USER_STORAGE_SCOPE}:preferences:styles`]: ['minimal'],
      [`${TEST_USER_STORAGE_SCOPE}:favorites`]: ['outfit-1'],
    },
  });
  internals.state.mini = harness.mini;
  const result = await internals.resetCurrentUserRecommendationCache();
  assert.equal(result.removedTodayRestoreSnapshotCount, 1);
  assert.equal(result.removedSceneSnapshotCount, 1);
  assert.equal(result.nonTargetKeysUnchanged, true);
  assert.equal(harness.storage.has(TEST_TODAY_SNAPSHOT_KEY), false);
  assert.equal([...harness.storage.keys()].some((key) => key.startsWith(TEST_SCENE_SNAPSHOT_PREFIX)), false);
  assert.equal(harness.storage.has(otherUserSnapshotKey), true);
  assert.deepEqual(harness.storage.get(`${TEST_USER_STORAGE_SCOPE}:wardrobe:items`), [{ id: 'cloth-1' }]);
  assert.deepEqual(harness.storage.get(`${TEST_USER_STORAGE_SCOPE}:preferences:styles`), ['minimal']);
  assert.equal(harness.storage.get(`${TEST_USER_STORAGE_SCOPE}:today:recommendationInput:wardrobeVersion`), 7);
  assert.equal(harness.storage.get(`${TEST_USER_STORAGE_SCOPE}:today:recommendationInput:profileVersion`), 9);
});

test('post-reset baseline permits exactly one Initial generate request', () => {
  const internals = loadE2eInternals();
  const baseline = internals.recommendationCounterBaseline('post-reset');
  internals.state.lifecycle.push(
    { label: '[RecommendStart]', payload: { auditId: 'sport-initial', sceneKey: 'sport' } },
    { label: '[RecommendStart]', payload: { auditId: 'sport-initial', sceneKey: 'sport' } },
    { label: '[RecommendStart]', payload: { auditId: 'sport-initial', sceneKey: 'sport' } },
    { label: '[RecommendDone]', payload: { auditId: 'sport-initial', sceneKey: 'sport' } },
  );
  assert.deepEqual(
    { ...internals.assertSingleGenerateSinceBaseline(baseline, 'sport') },
    { intentStartCount: 1, capturedRequestCount: 0 },
  );
  internals.state.lifecycle.push(
    { label: '[RecommendStart]', payload: { auditId: 'sport-duplicate', sceneKey: 'sport' } },
  );
  assert.throws(
    () => internals.assertSingleGenerateSinceBaseline(baseline, 'sport'),
    (caught) => caught.code === 'INITIAL_REQUEST_NOT_UNIQUE',
  );
});

test('scene snapshot reuse phase has zero generate requests', () => {
  const internals = loadE2eInternals();
  const baseline = internals.recommendationCounterBaseline('date-snapshot-reuse');
  assert.deepEqual(
    { ...internals.assertNoGenerateSinceBaseline(baseline, 'second Date') },
    { intentStartCount: 0, capturedRequestCount: 0 },
  );
  internals.state.lifecycle.push(
    { label: '[RecommendStart]', payload: { auditId: 'date-unexpected', sceneKey: 'date' } },
  );
  assert.throws(
    () => internals.assertNoGenerateSinceBaseline(baseline, 'second Date'),
    (caught) => caught.code === 'SNAPSHOT_REUSE_GENERATED',
  );
});

test('unavailable page reset blocks with PRECONDITION_NOT_CLEAN before Sport action', async () => {
  const internals = loadE2eInternals();
  const harness = createTodayAcceptanceHarness({ relaunchError: 'reLaunch unavailable' });
  internals.state.mini = harness.mini;
  const result = await internals.prepareSportAcceptancePrecondition();
  assert.equal(result.ok, false);
  assert.equal(internals.state.runnerBlocked.code, 'PRECONDITION_NOT_CLEAN');
  assert.equal(harness.getCounts().cloudCalls, 0);
  assert.equal(harness.getCounts().screenshotCalls, 0);
  assert.equal(harness.getCounts().relaunchCalls, 1);
});

test('reset blocker restores the exact callFunction reference and only blocks generateOutfit', async () => {
  const internals = loadE2eInternals();
  internals.state.mini = { evaluate: async (fn, argument) => fn(argument) };
  const target = internals.__targetObjects['wx.cloud.callFunction'];
  const original = target.callFunction;
  const installed = await internals.installResetRecommendationBlocker();
  assert.equal(installed.installed, true);
  await internals.setResetRecommendationBlockerActive(true);
  await assert.rejects(
    internals.__invokeCloudCall({ name: 'generateOutfit', data: { auditId: 'reset-blocked' } }),
    (caught) => caught.code === 'RUNNER_RESET_BLOCKED',
  );
  await internals.__invokeCloudCall({ name: 'getWeather', data: { city: 'test' } });
  assert.equal(internals.__runnerCallOptions.at(-1).name, 'getWeather');
  const removed = await internals.removeResetRecommendationBlocker();
  assert.equal(removed.removed, true);
  assert.equal(removed.restorationCount, 1);
  assert.equal(target.callFunction, original);
  assert.equal((await internals.removeResetRecommendationBlocker()).removed, false);
});

test('reLaunch success restores the exact callFunction before any formal hook installation', async () => {
  const internals = loadE2eInternals({ capturePresentationEvidence: true });
  const harness = createTodayAcceptanceHarness();
  const target = internals.__targetObjects['wx.cloud.callFunction'];
  const original = target.callFunction;
  harness.mini.evaluate = async (fn, argument) => fn(argument);
  internals.state.mini = harness.mini;
  const result = await internals.prepareSportAcceptancePrecondition();
  assert.equal(result.ok, true);
  assert.equal(target.callFunction, original);
  assert.equal(target.__recommendationV61RunnerResetBlocker, undefined);
  assert.equal(internals.state.presentationCaptureInstalled, false);
  assert.equal(internals.state.sportPrecondition.reset.restorationCount, 1);
});

test('reLaunch failure restores the exact callFunction and never installs or invokes the formal hook', async () => {
  const internals = loadE2eInternals({ capturePresentationEvidence: true });
  const harness = createTodayAcceptanceHarness({ relaunchError: 'reLaunch failed' });
  const target = internals.__targetObjects['wx.cloud.callFunction'];
  const original = target.callFunction;
  harness.mini.evaluate = async (fn, argument) => fn(argument);
  internals.state.mini = harness.mini;
  const result = await internals.prepareSportAcceptancePrecondition();
  assert.equal(result.ok, false);
  assert.equal(internals.state.runnerBlocked.code, 'PRECONDITION_NOT_CLEAN');
  assert.equal(target.callFunction, original);
  assert.equal(target.__recommendationV61RunnerCapture, undefined);
  assert.equal(internals.state.presentationCaptureInstalled, false);
  assert.equal(internals.state.lifecycle.length, 0);
  assert.equal(internals.state.refreshClickCount, 0);
  assert.equal(harness.getCounts().screenshotCalls, 0);
  assert.equal(internals.__runnerCallOptions.length, 0);
});

test('clean-state timeout still runs finally and returns PRECONDITION_NOT_CLEAN', async () => {
  const internals = loadE2eInternals({ capturePresentationEvidence: true, dateImpl: createAdvancingDate() });
  const harness = createTodayAcceptanceHarness({ afterHasBatch: true });
  const target = internals.__targetObjects['wx.cloud.callFunction'];
  const original = target.callFunction;
  harness.mini.evaluate = async (fn, argument) => fn(argument);
  internals.state.mini = harness.mini;
  const result = await internals.prepareSportAcceptancePrecondition();
  assert.equal(result.ok, false);
  assert.equal(internals.state.runnerBlocked.code, 'PRECONDITION_NOT_CLEAN');
  assert.equal(target.callFunction, original);
  assert.equal(target.__recommendationV61RunnerResetBlocker, undefined);
  assert.equal(internals.state.presentationCaptureInstalled, false);
  assert.equal(harness.getCounts().screenshotCalls, 0);
  assert.equal(internals.__runnerCallOptions.length, 0);
});

test('each installer call restores old runner hook and changes generation', async () => {
  const internals = loadE2eInternals({ capturePresentationEvidence: true });
  internals.state.mini = { evaluate: async (fn, argument) => fn(argument) };
  const first = await internals.installPresentationEvidenceCapture();
  await internals.setPresentationCaptureSlot('initial');
  await internals.__invokeCloudCall({ name: 'generateOutfit', data: { auditId: 'old-buffer' } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const oldStatus = await internals.readPresentationCaptureGeneration();
  assert.equal(oldStatus.captureGeneration, first.captureGeneration);
  assert.equal(oldStatus.requestBufferCount, 1);
  internals.state.lifecycle = [{ label: '[RecommendStart]', payload: { auditId: 'old-buffer' } }];
  internals.clearRunnerStateAfterPageReset();
  assert.equal(internals.state.lifecycle.length, 0);
  assert.equal(internals.state.presentationCaptureDiagnostics.handshakeStatus, 'not_started');
  const fresh = await internals.installPresentationEvidenceCapture();
  assert.notEqual(fresh.captureGeneration, oldStatus.captureGeneration);
  assert.equal(fresh.generationFresh, true);
  assert.equal(fresh.requestBufferCount, 0);
  assert.equal((await internals.readPresentationCaptureGeneration()).requestBufferCount, 0);
});

test('old-generation handshake returns PRECONDITION_HOOK_NOT_FRESH before any request', () => {
  const internals = loadE2eInternals({ capturePresentationEvidence: true });
  internals.state.presentationCaptureDiagnostics = {
    captureHookInstalled: true,
    installedTargetCount: 1,
    installedTargets: ['wx.cloud.callFunction'],
    handshakeStatus: 'passed',
    captureGeneration: 'generation-old',
    generationFresh: false,
    requestBufferCount: 0,
  };
  assert.throws(
    () => internals.validateFreshCaptureHandshake({
      handshakeStatus: 'passed',
      captureGeneration: 'generation-old',
      generationFresh: false,
      requestBufferCount: 0,
    }, 'generation-old'),
    (caught) => caught.code === 'PRECONDITION_HOOK_NOT_FRESH',
  );
  assert.equal(internals.__runnerCallOptions.length, 0);
});

test('unknown capture wrapper is blocked without overwriting the target', async () => {
  const internals = loadE2eInternals({ capturePresentationEvidence: true });
  const target = internals.__targetObjects['wx.cloud.callFunction'];
  const unknownWrapper = () => Promise.resolve({ result: { code: 0 } });
  target.callFunction = unknownWrapper;
  target.__recommendationV61RunnerCapture = { unknown: true };
  internals.state.mini = { evaluate: async (fn, argument) => fn(argument) };
  await assert.rejects(
    internals.installPresentationEvidenceCapture(),
    (caught) => caught.code === 'CAPTURE_HOOK_UNKNOWN_WRAPPER',
  );
  assert.equal(target.callFunction, unknownWrapper);
  assert.equal(internals.__runnerCallOptions.length, 0);
});

test('formal hook installation is ordered after blocker restoration', async () => {
  const internals = loadE2eInternals({ capturePresentationEvidence: true });
  internals.state.mini = { evaluate: async (fn, argument) => fn(argument) };
  const target = internals.__targetObjects['wx.cloud.callFunction'];
  const blocker = await internals.installResetRecommendationBlocker();
  await internals.setResetRecommendationBlockerActive(true);
  await internals.setResetRecommendationBlockerActive(false);
  const removed = await internals.removeResetRecommendationBlocker();
  assert.equal(removed.removed, true);
  assert.equal(target.__recommendationV61RunnerResetBlocker, undefined);
  const installed = await internals.installPresentationEvidenceCapture();
  assert.equal(blocker.installed, true);
  assert.equal(installed.handshakeStatus, 'passed');
  assert.equal(installed.requestBufferCount, 0);
  assert.equal(target.__recommendationV61RunnerResetBlocker, undefined);
});

test('all reset failures remain before tap, capture, screenshot, refresh, and business request stages', () => {
  const source = fs.readFileSync(path.join(__dirname, 'recommendation-v6-e2e.cjs'), 'utf8');
  const reset = source.indexOf('const precondition = await prepareSportAcceptancePrecondition();');
  const tap = source.indexOf("const sport = await tapScene(3, 'sport', 'sport-initial');", reset);
  const refresh = source.indexOf("const sportRefresh = await refresh('sport', 'sport-refresh');", reset);
  const capture = source.indexOf("captureBatchOrContinue('sport', 'initial'", reset);
  assert.ok(reset >= 0 && tap > reset);
  assert.ok(capture > tap);
  assert.ok(refresh > capture);
  assert.match(source.slice(reset, tap), /if \(!precondition\.ok\) return;/);
  assert.match(source.slice(reset, tap), /PRECONDITION_HOOK_NOT_FRESH/);
  assert.match(source.slice(reset, tap), /validateFreshCaptureHandshake\(installed, previousGeneration\)/);
});

test('runner records before/after Sport state and rejects generic no-start timeout', () => {
  const source = fs.readFileSync(path.join(__dirname, 'recommendation-v6-e2e.cjs'), 'utf8');
  const preconditionIndex = source.indexOf('prepareSportAcceptancePrecondition');
  const tapIndex = source.indexOf("const sport = await tapScene(3, 'sport', 'sport-initial');");
  assert.ok(preconditionIndex >= 0 && preconditionIndex < tapIndex);
  assert.match(source, /SPORT_ACTION_NO_RECOMMEND_START/);
  assert.match(source, /actionBefore: state\.sportAction\.before/);
  assert.match(source, /actionAfter: after/);
  assert.match(source, /tapResult: state\.sportAction\.tapResult/);
  assert.match(source, /captureBatchOrContinue\('sport', 'initial'/);
});

test('only the current visible card must have loaded images', async () => {
  const internals = loadE2eInternals();
  setVisualSnapshotState(internals);
  const harness = createVisualStabilityHarness({
    loadedByCard: [2, 0, 0, 0, 0, 0, 0, 0],
  });
  attachHarnessToMini(internals, harness);
  const stability = await internals.waitForCardVisualStability(harness.page, 0, 'initial');
  assert.equal(stability.cardIndex, 0);
  assert.equal(stability.expectedImageCount, 2);
  assert.equal(stability.loadedImageCount, 2);
  assert.equal(stability.skeletonCount, 0);
});

test('skeleton presence prevents screenshot eligibility', async () => {
  const internals = loadE2eInternals();
  internals.state.visualStabilityTimeoutMs = 700;
  setVisualSnapshotState(internals);
  const harness = createVisualStabilityHarness({ loadedByCard: [1, 0, 0, 0, 0, 0, 0, 0], skeletonByCard: [1, 0, 0, 0, 0, 0, 0, 0] });
  let screenshotCalls = 0;
  attachHarnessToMini(internals, harness, { screenshot: async () => { screenshotCalls += 1; } });
  await assert.rejects(
    internals.captureBatch('sport', 'initial', 'audit-skeleton'),
    (caught) => caught.code === 'CARD_VISUAL_STABILITY_TIMEOUT',
  );
  assert.equal(screenshotCalls, 0);
});

test('a changing swiper never reaches stable-card screenshot eligibility', async () => {
  const internals = loadE2eInternals();
  internals.state.visualStabilityTimeoutMs = 700;
  setVisualSnapshotState(internals);
  const harness = createVisualStabilityHarness({ moving: true });
  attachHarnessToMini(internals, harness);
  await assert.rejects(
    internals.waitForCardVisualStability(harness.page, 0, 'initial'),
    (caught) => caught.code === 'CARD_VISUAL_STABILITY_TIMEOUT' && caught.details.swiperIndexChanges.includes(1),
  );
});

test('fingerprint changes restart the stability window', async () => {
  const internals = loadE2eInternals();
  setVisualSnapshotState(internals);
  const harness = createVisualStabilityHarness();
  let titleVersion = 0;
  const originalTitle = harness.cards[0].$;
  harness.cards[0].$ = async (selector) => {
    const value = await originalTitle(selector);
    if (selector === '.outfit-title') return { text: async () => `Sport title ${titleVersion}` };
    return value;
  };
  const originalPageData = harness.page.data;
  let samples = 0;
  harness.page.data = async () => {
    samples += 1;
    if (samples === 4) titleVersion = 1;
    return originalPageData();
  };
  attachHarnessToMini(internals, harness);
  const stability = await internals.waitForCardVisualStability(harness.page, 0, 'initial');
  assert.equal(stability.titlePresent, true);
  assert.ok(stability.waitedMs >= 1000);
  assert.ok(stability.lastFingerprints.length >= 2);
});

function useFastVisualStabilityForBatchTest(internals) {
  internals.state.visualStabilityTimeoutMs = 1000;
  internals.state.visualStabilitySampleIntervalMs = 1;
  internals.state.visualStabilityMinIntervalMs = 10;
  internals.state.visualStabilityRenderBufferMs = 1;
}

test('each batch captures the current card before moving to the next card', async () => {
  const evidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recommendation-v61-batch-lifecycle-'));
  try {
    const internals = loadE2eInternals({ evidenceDir });
    useFastVisualStabilityForBatchTest(internals);
    const harness = createVisualStabilityHarness();
    const screenshotTargets = [];
    setVisualSnapshotState(internals);
    attachHarnessToMini(internals, harness, {
      screenshot: async ({ path: target }) => {
        screenshotTargets.push(target);
        writePngFixture(target);
      },
    });
    const initial = await internals.captureBatch('sport', 'initial', 'audit-initial');
    assert.equal(initial.length, 8);
    assert.deepEqual(harness.getCurrent(), 7);
    assert.deepEqual(screenshotTargets.map((target) => path.basename(target).match(/card-(\d+)-outfit-/)?.[1]), [
      '01', '02', '03', '04', '05', '06', '07', '08',
    ]);
    assert.equal(screenshotTargets.length, 8);
    assert.ok(screenshotTargets.every((target) => target.includes(`${path.sep}sport${path.sep}initial${path.sep}`)));
    assert.equal(JSON.stringify(internals.state.cards.map((card) => card.cardIndex)), JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8]));
    assert.equal(JSON.stringify(harness.swipeCalls), JSON.stringify([
      1, 2, 3, 4, 5, 6, 7,
    ]));

    const refreshSnapshot = {
      countContract: countContractFor({ before: 8, returned: 8 }),
      outfits: Array.from({ length: 8 }, (_, index) => ({
        outfitKey: `refresh-outfit-${index + 1}`,
        clothingIds: ['item-a', 'item-b'],
      })),
    };
    internals.state.mini.callWxMethod = async (name, key) => {
      if (name === 'getStorageInfoSync') return { keys: [TEST_TODAY_SNAPSHOT_KEY] };
      if (name === 'getStorageSync' && key === 'openid') return 'test-openid';
      if (name === 'getStorageSync' && key === TEST_TODAY_SNAPSHOT_KEY) return refreshSnapshot;
      return '';
    };
    const refreshed = await internals.captureBatch('sport', 'refresh', 'audit-refresh');
    assert.equal(refreshed.length, 8);
    assert.equal(screenshotTargets.length, 16);
    assert.ok(screenshotTargets.slice(8).every((target) => target.includes(`${path.sep}sport${path.sep}refresh${path.sep}`)));
    assert.equal(internals.state.cards.length, 16);
    assert.equal(JSON.stringify(harness.swipeCalls), JSON.stringify([
      1, 2, 3, 4, 5, 6, 7,
      0, 1, 2, 3, 4, 5, 6, 7,
    ]));
  } finally {
    fs.rmSync(evidenceDir, { recursive: true, force: true });
  }
});

for (const cardCount of [1, 5, 7]) {
  test(`runner captures a legal ${cardCount}-card tail batch without padding`, async () => {
    const evidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), `recommendation-v61-tail-${cardCount}-`));
    try {
      const internals = loadE2eInternals({ evidenceDir });
      useFastVisualStabilityForBatchTest(internals);
      const harness = createVisualStabilityHarness({ cardCount });
      setVisualSnapshotState(internals, cardCount);
      attachHarnessToMini(internals, harness);
      const captured = await internals.captureBatch('date', `tail-${cardCount}`, `audit-tail-${cardCount}`);
      assert.equal(captured.length, cardCount);
      assert.equal(captured.expectedCount, cardCount);
      assert.equal(captured.exhausted, true);
      assert.equal(harness.swipeCalls.length, Math.max(0, cardCount - 1));
    } finally {
      fs.rmSync(evidenceDir, { recursive: true, force: true });
    }
  });
}

test('navigation failure stops before visual stability and screenshot calls', async () => {
  const evidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recommendation-v61-nav-failure-'));
  try {
    const internals = loadE2eInternals({ evidenceDir });
    useFastVisualStabilityForBatchTest(internals);
    setVisualSnapshotState(internals);
    const harness = createVisualStabilityHarness({ moving: true });
    let screenshotCalls = 0;
    attachHarnessToMini(internals, harness, {
      screenshot: async () => { screenshotCalls += 1; },
    });
    await assert.rejects(
      internals.captureBatch('sport', 'initial', 'audit-nav-failure'),
      (caught) => caught.code === 'SWIPER_NAVIGATION_FAILED',
    );
    assert.equal(screenshotCalls, 0);
    assert.equal(internals.state.cards.length, 0);
    assert.equal(internals.state.refreshClickCount, 0);
    assert.equal(internals.state.hasRealRequest, false);
  } finally {
    fs.rmSync(evidenceDir, { recursive: true, force: true });
  }
});

test('screenshot failure stops the current batch before the next card or refresh', async () => {
  const evidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recommendation-v61-stable-timeout-'));
  try {
    const internals = loadE2eInternals({ evidenceDir });
    useFastVisualStabilityForBatchTest(internals);
    setVisualSnapshotState(internals);
    const harness = createVisualStabilityHarness();
    let screenshotCalls = 0;
    attachHarnessToMini(internals, harness, {
      screenshot: () => {
        screenshotCalls += 1;
        windowsCaptureFailure('SCREENSHOT_FAILED', 'native capture failed');
      },
    });
    await assert.rejects(
      internals.captureBatch('sport', 'initial', 'audit-timeout'),
      (caught) => caught.code === 'SCREENSHOT_FAILED',
    );
    assert.equal(screenshotCalls, 1);
    assert.equal(internals.state.cards[0].visualStability.cardIndex, 0);
    assert.equal(internals.state.cards[0].screenshot, null);
    assert.equal(internals.state.cards.length, 1);
    assert.equal(internals.state.refreshClickCount, 0);
    assert.equal(internals.state.hasRealRequest, false);
    assert.deepEqual(harness.swipeCalls, []);
  } finally {
    fs.rmSync(evidenceDir, { recursive: true, force: true });
  }
});

test('current, dot, and target identity pass even when geometry points to an adjacent card', async () => {
  const internals = loadE2eInternals();
  const harness = createSwiperHarness({ swipeMode: 'native', visualMode: 'stale' });
  setSnapshotState(internals, ['outfit-a', 'outfit-b']);
  const result = await internals.navigateSwiperToCard({
    page: harness.page, swiper: harness.swiper, targetIndex: 1, expectedCounter: '2 / 2',
  });
  assert.equal(result.allConsistent, true);
  assert.equal(result.activeIndex, 0);
  assert.equal(result.activeCounter, '1 / 2');
  assert.equal(result.targetCounter, '2 / 2');
  assert.equal(result.activeOutfitKey, 'outfit-b');
  assert.equal(result.current, 1);
  assert.equal(result.activeDotIndex, 1);
  assert.equal(result.visibleCardIndex, 0);
  assert.equal(result.visibleOutfitId, 'outfit-a');
  assert.equal(result.targetOutfitId, 'outfit-b');
  assert.equal(result.targetCardOutfitId, 'outfit-b');
  assert.equal(result.targetOutfitMatchesTarget, true);
  assert.equal(result.visibleCardMatchesTarget, false);
  assert.equal(result.allConsistent, true);
  assert.deepEqual(harness.calls.swipeTo, [1]);
  assert.equal(harness.calls.touchend.length, 0);
});

test('current and active dot reaching target while the geometric card is old is accepted', async () => {
  const internals = loadE2eInternals({ dateImpl: createAdvancingDate() });
  const harness = createSwiperHarness({ swipeMode: 'native', visualMode: 'stale' });
  setSnapshotState(internals, ['outfit-a', 'outfit-b']);
  const result = await internals.navigateSwiperToCard({
    page: harness.page, swiper: harness.swiper, targetIndex: 1, expectedCounter: '2 / 2',
  });
  assert.equal(result.allConsistent, true);
  assert.equal(result.visibleCardIndex, 0);
  assert.equal(result.targetCardOutfitId, 'outfit-b');
  assert.equal(internals.state.errors.some((entry) => entry.code === 'SWIPER_VISUAL_STATE_DESYNC'), false);
});

test('target identity mismatch is not complete', async () => {
  const internals = loadE2eInternals({ dateImpl: createAdvancingDate() });
  const harness = createSwiperHarness({
    swipeMode: 'native',
    cardOutfitKeys: ['outfit-a', 'wrong-outfit'],
  });
  setSnapshotState(internals, ['outfit-a', 'outfit-b']);
  await assert.rejects(
    internals.navigateSwiperToCard({ page: harness.page, swiper: harness.swiper, targetIndex: 1, expectedCounter: '2 / 2' }),
    (caught) => caught.code === 'SWIPER_NAVIGATION_FAILED'
      && caught.diagnostics.afterSwipeTo.targetIndex === 1
      && caught.diagnostics.afterSwipeTo.targetCardOutfitId === 'wrong-outfit'
      && caught.diagnostics.afterSwipeTo.targetOutfitId === 'outfit-b',
  );
});

test('current mismatch fails navigation even when dot and target identity are ready', async () => {
  const internals = loadE2eInternals({ dateImpl: createAdvancingDate() });
  const harness = createSwiperHarness({ swipeMode: 'none', dotIndex: 1 });
  setSnapshotState(internals, ['outfit-a', 'outfit-b']);
  await assert.rejects(
    internals.navigateSwiperToCard({ page: harness.page, swiper: harness.swiper, targetIndex: 1, expectedCounter: '2 / 2' }),
    (caught) => caught.code === 'SWIPER_NAVIGATION_FAILED'
      && caught.diagnostics.afterSwipeTo.current === 0
      && caught.diagnostics.afterSwipeTo.activeDotIndex === 1,
  );
});

test('dot mismatch fails navigation even when current and target identity are ready', async () => {
  const internals = loadE2eInternals({ dateImpl: createAdvancingDate() });
  const harness = createSwiperHarness({ swipeMode: 'native', dotIndex: 0 });
  setSnapshotState(internals, ['outfit-a', 'outfit-b']);
  await assert.rejects(
    internals.navigateSwiperToCard({ page: harness.page, swiper: harness.swiper, targetIndex: 1, expectedCounter: '2 / 2' }),
    (caught) => caught.code === 'SWIPER_NAVIGATION_FAILED'
      && caught.diagnostics.afterSwipeTo.current === 1
      && caught.diagnostics.afterSwipeTo.activeDotIndex === 0,
  );
});

test('navigation reads the real starting index when moving from card 1 to card 0', async () => {
  const internals = loadE2eInternals();
  const harness = createSwiperHarness({ swipeMode: 'native', startIndex: 1 });
  setSnapshotState(internals, ['outfit-a', 'outfit-b']);
  const before = await internals.readActiveSwiperState(harness.page, harness.swiper, [
    { outfitKey: 'outfit-a' }, { outfitKey: 'outfit-b' },
  ], 1);
  assert.equal(before.current, 1);
  assert.equal(before.activeDotIndex, 1);
  assert.equal(before.visibleCardIndex, 1);
  const result = await internals.navigateSwiperToCard({
    page: harness.page, swiper: harness.swiper, targetIndex: 0, expectedCounter: '1 / 2',
  });
  assert.equal(result.allConsistent, true);
  assert.deepEqual(harness.calls.swipeTo, [0]);
});

test('navigation re-queries the card tree after the swiper replaces old elements', async () => {
  const internals = loadE2eInternals();
  const harness = createSwiperHarness({ swipeMode: 'native', replaceCardsOnSwipe: true });
  setSnapshotState(internals, ['outfit-a', 'outfit-b']);
  const result = await internals.navigateSwiperToCard({
    page: harness.page, swiper: harness.swiper, targetIndex: 1, expectedCounter: '2 / 2',
  });
  assert.equal(result.allConsistent, true);
  assert.ok(harness.getCardQueryCount() >= 2);
});

test('native swipeTo with no visible state change falls back to an element-relative gesture', async () => {
  const internals = loadE2eInternals();
  const harness = createSwiperHarness({ swipeMode: 'gesture' });
  setSnapshotState(internals, ['outfit-a', 'outfit-b']);
  const result = await internals.navigateSwiperToCard({
    page: harness.page, swiper: harness.swiper, targetIndex: 1, expectedCounter: '2 / 2',
  });
  assert.equal(result.allConsistent, true);
  assert.equal(result.activeIndex, 1);
  assert.equal(harness.calls.swipeTo.length, 1);
  assert.equal(harness.calls.touchstart.length, 1);
  assert.equal(harness.calls.touchmove.length, 2);
  assert.equal(harness.calls.touchend.length, 1);
  assert.equal(harness.calls.touchstart[0].touches[0].pageX, harness.rect.left + harness.rect.width * 0.75);
  assert.equal(harness.calls.touchend[0].changeTouches[0].pageX, harness.rect.left + harness.rect.width * 0.25);
});

test('method return without counter change is not a successful navigation', async () => {
  const internals = loadE2eInternals();
  const harness = createSwiperHarness({ swipeMode: 'none' });
  setSnapshotState(internals, ['outfit-a', 'outfit-b']);
  await assert.rejects(
    internals.navigateSwiperToCard({ page: harness.page, swiper: harness.swiper, targetIndex: 1, expectedCounter: '2 / 2' }),
    (caught) => caught.code === 'SWIPER_NAVIGATION_FAILED',
  );
});

test('counter change with a mismatched target outfit identity is not a successful navigation', async () => {
  const internals = loadE2eInternals();
  const harness = createSwiperHarness({ swipeMode: 'native', keys: ['outfit-a', 'outfit-b'], cardOutfitKeys: ['outfit-a', 'same-key'] });
  setSnapshotState(internals, ['outfit-a', 'outfit-b']);
  await assert.rejects(
    internals.navigateSwiperToCard({ page: harness.page, swiper: harness.swiper, targetIndex: 1, expectedCounter: '2 / 2' }),
    (caught) => caught.code === 'SWIPER_NAVIGATION_FAILED' && caught.diagnostics.afterSwipeTo.activeCounter === '2 / 2',
  );
});

test('geometry is diagnostic only and never produces the old visual desync error', () => {
  const source = fs.readFileSync(path.join(__dirname, 'recommendation-v6-e2e.cjs'), 'utf8');
  assert.doesNotMatch(source, /SWIPER_VISUAL_STATE_DESYNC/);
  assert.match(source, /targetOutfitMatchesTarget/);
});

test('failed navigation retains sanitized before/after state, WXML, and gesture diagnostics', async () => {
  const internals = loadE2eInternals();
  const harness = createSwiperHarness({ swipeMode: 'none' });
  setSnapshotState(internals, ['outfit-a', 'outfit-b']);
  await assert.rejects(
    internals.navigateSwiperToCard({ page: harness.page, swiper: harness.swiper, targetIndex: 1, expectedCounter: '2 / 2' }),
    (caught) => {
      assert.equal(caught.code, 'SWIPER_NAVIGATION_FAILED');
      assert.equal(caught.diagnostics.targetIndex, 1);
      assert.equal(caught.diagnostics.before.activeCounter, '1 / 2');
      assert.equal(caught.diagnostics.afterSwipeTo.activeCounter, '1 / 2');
      assert.equal(caught.diagnostics.afterTouch.activeCounter, '1 / 2');
      assert.equal(caught.diagnostics.touch.ok, true);
      assert.equal(caught.diagnostics.outerWxml.includes('secret-image-url'), false);
      assert.equal(caught.diagnostics.outerWxml.includes('secret-title'), false);
      return true;
    },
  );
});

test('captured cards 1 through 8 require ordered indexes, screenshots, and outfitKeys', () => {
  const internals = loadE2eInternals();
  const records = Array.from({ length: 8 }, (_, index) => ({
    cardIndex: index + 1,
    outfitKey: `outfit-${index + 1}`,
    screenshot: __filename,
  }));
  assert.equal(internals.validateCapturedBatch(records, 8), true);
});

test('missing card or screenshot evidence raises EVIDENCE_INCOMPLETE', () => {
  const internals = loadE2eInternals();
  const records = Array.from({ length: 7 }, (_, index) => ({
    cardIndex: index + 1,
    outfitKey: `outfit-${index + 1}`,
    screenshot: __filename,
  }));
  assert.throws(() => internals.validateCapturedBatch(records, 8), /EVIDENCE_INCOMPLETE/);
});

test('production presentation evidence validator keeps raw response fields out of saved evidence', () => {
  const internals = loadE2eInternals();
  const cards = Array.from({ length: 8 }, (_, index) => ({
    outfitKey: `private-outfit-${index + 1}`,
    itemIds: [`private-item-${index + 1}`],
    title: `Sport set ${index + 1}`,
    todayReason: `Sport reason ${index + 1}`,
    tags: ['sport'],
  }));
  const evidence = {
    version: 'presentation-evidence-v3',
    auditId: 'rec_presentation_evidence_test',
    countContract: countContractFor(),
    shared: {
      scene: 'sport',
      planVersion: 'presentation-plan-v2',
      copyContractVersion: 'recommendation-copy-contract-v3',
      qaVersion: internals.EXPECTED_QA_VERSION,
    },
    cards: cards.map((card, index) => ({
      cardAlias: `C${String(index + 1).padStart(2, '0')}`,
      outfitKeyHash: crypto.createHash('sha256').update(`outfit-key-v1|${card.outfitKey}`, 'utf8').digest('hex').slice(0, 16),
      presentationFactSignatureHash: 'a'.repeat(16),
      itemRoles: [],
      primaryRelationCode: null,
      availableDifferentiators: [],
      selectedDifferentiator: null,
      binding: {
        canonicalFactSignatureHash: 'a'.repeat(16),
        contentPlanFactSignatureHash: 'a'.repeat(16),
        copyContractFactSignatureHash: 'a'.repeat(16),
        factSignaturesEqual: true,
        canonicalRelationCode: null,
        contentPlanRelationCode: null,
        copyContractRelationCode: null,
        relationCodesEqual: true,
        titleMatchesPlan: true,
        reasonMatchesPlan: true,
      },
      contentPlanSummary: {},
      copyContractSummary: {},
      reasonSemanticSkeleton: '',
      titleSemanticSkeleton: '',
      finalTitle: card.title,
      finalReason: card.todayReason,
      finalTags: card.tags,
    })),
  };
  const result = internals.validatePresentationEvidenceCapture({ evidence, cards });
  assert.ok(result.bytes < internals.PRESENTATION_EVIDENCE_MAX_BYTES);
  assert.equal(internals.scanPresentationEvidencePii(evidence, cards.flatMap((card) => [card.outfitKey, ...card.itemIds])).length, 0);
  const tables = internals.presentationEvidenceTables(evidence);
  assert.equal((tables.match(/^## /gm) || []).length, 9);
  assert.equal(tables.includes('private-outfit-'), false);

  const missingBinding = JSON.parse(JSON.stringify(evidence));
  delete missingBinding.cards[0].binding.reasonMatchesPlan;
  assert.throws(
    () => internals.validatePresentationEvidenceCapture({ evidence: missingBinding, cards }),
    /PRESENTATION_EVIDENCE_INVALID/,
  );

  const missingEvidenceCard = JSON.parse(JSON.stringify(evidence));
  missingEvidenceCard.cards.pop();
  assert.throws(
    () => internals.validatePresentationEvidenceCapture({ evidence: missingEvidenceCard, cards }),
    /PRESENTATION_EVIDENCE_CARD_COUNT/,
  );
});

test('runner modes keep standalone evidence-only independent from normal capture', () => {
  const internals = loadE2eInternals();
  assert.equal(JSON.stringify(internals.buildRunnerConfig({
    EVIDENCE_ONLY: 'true',
    PRESENTATION_EVIDENCE_ONLY: 'false',
    CAPTURE_PRESENTATION_EVIDENCE: 'false',
  })), JSON.stringify({ evidenceOnly: true, capturePresentationEvidence: false, preconditionOnly: false, preflightOnly: false, windowHandle: null, screenshotProvider: 'windows-native-primary-screen', automatorWsEndpoint: 'ws://127.0.0.1:9420' }));
  assert.equal(JSON.stringify(internals.buildRunnerConfig({
    EVIDENCE_ONLY: 'false',
    PRESENTATION_EVIDENCE_ONLY: 'false',
    CAPTURE_PRESENTATION_EVIDENCE: 'true',
  })), JSON.stringify({ evidenceOnly: false, capturePresentationEvidence: true, preconditionOnly: false, preflightOnly: false, windowHandle: null, screenshotProvider: 'windows-native-primary-screen', automatorWsEndpoint: 'ws://127.0.0.1:9420' }));
  assert.equal(internals.buildRunnerConfig({
    EVIDENCE_ONLY: 'false',
    PRESENTATION_EVIDENCE_ONLY: 'false',
    CAPTURE_PRESENTATION_EVIDENCE: 'true',
    PRECONDITION_ONLY: 'true',
  }).preconditionOnly, true);
  const source = fs.readFileSync(path.join(__dirname, 'recommendation-v6-e2e.cjs'), 'utf8');
  assert.match(source, /if \(RUNNER_CONFIG\.evidenceOnly\) \{[\s\S]*captureProductionPresentationEvidence\(\);[\s\S]*\} else \{/);
  assert.match(source, /CAPTURE_NO_AVAILABLE_TARGET/);
});

test('normal capture adds sanitized presentation mode without changing disabled requests', () => {
  const internals = loadE2eInternals();
  const base = { scene: 'sport', trigger: 'refresh', maxResults: 8 };
  assert.equal(JSON.stringify(internals.buildRecommendationRequestData(base, { evidenceOnly: false, capturePresentationEvidence: false })), JSON.stringify(base));
  assert.equal(JSON.stringify(internals.buildRecommendationRequestData(base, { evidenceOnly: false, capturePresentationEvidence: true })), JSON.stringify({
    ...base,
    presentationEvidenceMode: internals.PRESENTATION_EVIDENCE_MODE,
  }));
  assert.equal(internals.presentationEvidenceFileFor('initial'), 'production-presentation-evidence-initial.json');
  assert.equal(internals.presentationEvidenceFileFor('refresh'), 'production-presentation-evidence-refresh.json');
  assert.notEqual(internals.presentationEvidenceFileFor('initial'), internals.presentationEvidenceFileFor('refresh'));
});

test('capture mode refreshes only after a successful initial audit', () => {
  const internals = loadE2eInternals();
  const config = { evidenceOnly: false, capturePresentationEvidence: true };
  const runtimeCapture = { status: 'fulfilled' };
  assert.equal(internals.shouldRunPresentationRefresh({ slot: 'initial', terminal: { label: '[RecommendDone]' }, runtimeCapture }, config), true);
  assert.equal(internals.shouldRunPresentationRefresh({ terminal: { label: '[RecommendError]' } }, config), false);
  assert.equal(internals.shouldRunPresentationRefresh({ terminal: { label: '[RecommendReject]' } }, config), false);
  assert.equal(internals.shouldRunPresentationRefresh({ terminal: { label: '[RecommendDone]' } }, { ...config, capturePresentationEvidence: false }), false);
});

test('runtime response capture records actual response diagnostics and no inferred mode', () => {
  const internals = loadE2eInternals();
  const capture = internals.recordRuntimeResponseCapture({
    status: 'fulfilled',
    result: { result: {
      code: 0,
      message: 'ok',
      data: {
        debug: {
          cloudBuildVersion: internals.EXPECTED_CLOUD_BUILD,
          executionMode: 'candidate_pool_hit',
          cacheHit: true,
          requestedCandidatePoolIdPresent: true,
    presentationEvidence: { version: 'presentation-evidence-v3', cards: [], shared: {} },
        },
        qaBatchAudit: { version: internals.EXPECTED_QA_VERSION },
      },
    } },
  }, { auditId: 'rec_runtime_capture', trigger: 'refresh' });
  assert.equal(capture.responseCode, 0);
  assert.equal(capture.executionMode, 'candidate_pool_hit');
  assert.equal(capture.cacheHit, true);
  assert.equal(capture.requestedCandidatePoolIdPresent, true);
  assert.equal(capture.presentationEvidenceVersion, 'presentation-evidence-v3');
  assert.equal(internals.state.requestCaptures.length, 1);

  const failed = internals.recordRuntimeResponseCapture({
    status: 'rejected',
    error: { code: 'TIMEOUT', message: 'request timed out' },
  }, { auditId: 'rec_runtime_timeout', trigger: 'refresh' });
  assert.equal(failed.responseCode, null);
  assert.equal(failed.executionMode, null);
  assert.equal(failed.cacheHit, null);
  assert.equal(failed.errorCode, 'TIMEOUT');
});

test('omitted presentation evidence keeps successful response data and blocks refresh', () => {
  const internals = loadE2eInternals({ capturePresentationEvidence: true });
  const capture = internals.recordRuntimeResponseCapture({
    status: 'fulfilled',
    result: { result: {
      code: 0,
      message: 'ok',
      data: {
        outfits: Array.from({ length: 8 }, (_, index) => ({ title: `card-${index}` })),
        qaBatchAudit: { version: internals.EXPECTED_QA_VERSION, qaGatePassed: true },
        debug: {
          auditId: 'rec_over_budget',
          presentationEvidenceStatus: {
            status: 'omitted_over_budget',
            version: 'presentation-evidence-v3',
            actualBytes: 25472,
            limitBytes: 24576,
          },
        },
      },
    } },
  }, { auditId: 'rec_over_budget', trigger: 'scene', slot: 'initial' });
  assert.equal(capture.responseCode, 0);
  assert.equal(capture.rawResponse.data.outfits.length, 8);
  assert.equal(capture.rawResponse.data.qaBatchAudit.version, internals.EXPECTED_QA_VERSION);
  assert.equal(capture.presentationEvidenceStatus.status, 'omitted_over_budget');
  const failure = internals.presentationEvidenceBudgetFailure(capture, 'rec_over_budget');
  assert.equal(failure.code, 'PRESENTATION_EVIDENCE_OVER_BUDGET');
  assert.equal(internals.shouldRunPresentationRefresh({
    slot: 'initial',
    terminal: { label: '[RecommendDone]' },
    runtimeCapture: capture,
  }, { capturePresentationEvidence: true }), false);
});

test('presentation hook captures the real cloud helper Promise and preserves an explicit slot', async () => {
  const internals = loadE2eInternals({ capturePresentationEvidence: true });
  internals.state.mini = { evaluate: async (fn, argument) => fn(argument) };
  const installed = await internals.installPresentationEvidenceCapture();
  assert.equal(installed.captureHookInstalled, true);
  assert.match(installed.captureHookTarget, /wx\.cloud\.callFunction/);
  assert.ok(installed.captureGeneration);

  await internals.setPresentationCaptureSlot('refresh');
  await internals.__invokeCloudCall({
    name: 'generateOutfit',
    data: { auditId: 'rec_hook_capture', trigger: 'scene' },
  });
  const options = internals.__runnerCallOptions[0];
  assert.equal(options.data.presentationEvidenceMode, 'sanitized_v1');
  assert.equal(options.data.slot, 'refresh');
  const call = await internals.readPresentationEvidenceRuntimeCapture('rec_hook_capture');
  assert.equal(call.slot, 'refresh');
  assert.equal(call.status, 'fulfilled');
  const status = await internals.readPresentationCaptureStatus('rec_hook_capture');
  assert.equal(status.requestIntercepted, true);
  assert.equal(status.responseIntercepted, true);
});

test('presentation hook persists request and Promise rejection diagnostics', async () => {
  const internals = loadE2eInternals({ capturePresentationEvidence: true });
  internals.state.mini = { evaluate: async (fn, argument) => fn(argument) };
  const target = internals.__targetObjects['wx.cloud.callFunction'];
  target.callFunction = () => Promise.reject(Object.assign(new Error('diagnostic rejection'), { code: 'DIAGNOSTIC_REJECTED' }));
  await internals.installPresentationEvidenceCapture();
  await internals.setPresentationCaptureSlot('initial');
  await assert.rejects(
    internals.__invokeCloudCall({ name: 'generateOutfit', data: { auditId: 'rec_hook_rejected', trigger: 'scene' } }),
    /diagnostic rejection/,
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  const status = await internals.readPresentationCaptureStatus('rec_hook_rejected');
  assert.equal(status.requestIntercepted, true);
  assert.equal(status.actualInterceptedTarget, 'wx.cloud.callFunction');
  assert.equal(status.slot, 'initial');
  assert.equal(status.injectedPresentationEvidenceMode, 'sanitized_v1');
  assert.equal(status.responseSettled, true);
  assert.equal(status.responseRejected, true);
  assert.equal(status.rejectionCode, 'DIAGNOSTIC_REJECTED');
  assert.equal(status.rejectionMessage, 'diagnostic rejection');
});

test('capture handshake passes and initial can execute with only wx.cloud available', async () => {
  const internals = loadE2eInternals({ capturePresentationEvidence: true, taroAvailable: false });
  internals.state.mini = { evaluate: async (fn, argument) => fn(argument) };
  const installed = await internals.installPresentationEvidenceCapture();
  assert.equal(installed.handshakeStatus, 'passed');
  assert.deepEqual(Array.from(installed.installedTargets), ['wx.cloud.callFunction']);
  assert.equal(installed.installedTargetCount, 1);
  assert.ok(installed.unavailableTargets.includes('Taro.cloud.callFunction'));

  await internals.setPresentationCaptureSlot('initial');
  await internals.__invokeCloudCall({ name: 'generateOutfit', data: { auditId: 'rec_wx_only_initial', trigger: 'initial' } });
  const capture = await internals.readPresentationEvidenceRuntimeCapture('rec_wx_only_initial');
  assert.equal(capture.target, 'wx.cloud.callFunction');
  assert.equal(capture.status, 'fulfilled');
});

test('capture handshake passes with only Taro.cloud available', async () => {
  const internals = loadE2eInternals({ capturePresentationEvidence: true, wxAvailable: false, taroAvailable: true });
  internals.state.mini = { evaluate: async (fn, argument) => fn(argument) };
  const installed = await internals.installPresentationEvidenceCapture();
  assert.equal(installed.handshakeStatus, 'passed');
  assert.deepEqual(Array.from(installed.installedTargets), ['Taro.cloud.callFunction']);

  await internals.__invokeCloudCall(
    { name: 'generateOutfit', data: { auditId: 'rec_taro_only', trigger: 'initial' } },
    'Taro.cloud.callFunction',
  );
  const capture = await internals.readPresentationEvidenceRuntimeCapture('rec_taro_only');
  assert.equal(capture.target, 'Taro.cloud.callFunction');
});

test('capture handshake installs both wx.cloud and Taro.cloud when both are available', async () => {
  const internals = loadE2eInternals({ capturePresentationEvidence: true, taroAvailable: true });
  internals.state.mini = { evaluate: async (fn, argument) => fn(argument) };
  const installed = await internals.installPresentationEvidenceCapture();
  assert.equal(installed.handshakeStatus, 'passed');
  assert.deepEqual(Array.from(installed.installedTargets), ['wx.cloud.callFunction', 'Taro.cloud.callFunction']);
  assert.equal(installed.installedTargetCount, 2);
  assert.equal(installed.targetDiagnostics.filter((entry) => entry.hookInstalled).length, 2);
});

test('unavailable Taro target is diagnostic only and does not cause handshake failure', async () => {
  const internals = loadE2eInternals({ capturePresentationEvidence: true, taroAvailable: false });
  internals.state.mini = { evaluate: async (fn, argument) => fn(argument) };
  await internals.installPresentationEvidenceCapture();
  const taro = internals.state.presentationCaptureDiagnostics.targetDiagnostics.find((entry) => entry.target === 'Taro.cloud.callFunction');
  assert.deepEqual(JSON.parse(JSON.stringify(taro)), {
    target: 'Taro.cloud.callFunction', available: false, hookInstalled: false, reason: 'callFunction unavailable',
  });
  assert.equal(internals.state.presentationCaptureDiagnostics.failedTargets.includes('Taro.cloud.callFunction'), false);
  assert.equal(internals.state.presentationCaptureDiagnostics.handshakeStatus, 'passed');
});

test('installer failure rolls back every partially installed target', async () => {
  const internals = loadE2eInternals({
    capturePresentationEvidence: true,
    taroAvailable: true,
    failedTargets: ['Taro.cloud.callFunction'],
  });
  internals.state.mini = { evaluate: async (fn, argument) => fn(argument) };
  const wx = internals.__targetObjects['wx.cloud.callFunction'];
  const original = wx.callFunction;
  await assert.rejects(
    internals.installPresentationEvidenceCapture(),
    (caught) => caught.code === 'CAPTURE_HOOK_INSTALL_FAILED',
  );
  assert.equal(wx.callFunction, original);
  assert.equal(wx.__recommendationV61RunnerCapture, undefined);
  assert.equal(internals.__runnerCallOptions.length, 0);
});

test('all capture targets unavailable uses CAPTURE_NO_AVAILABLE_TARGET', async () => {
  const internals = loadE2eInternals({ capturePresentationEvidence: true, wxAvailable: false, taroAvailable: false });
  internals.state.mini = { evaluate: async (fn, argument) => fn(argument) };
  await assert.rejects(
    internals.installPresentationEvidenceCapture(),
    (caught) => caught.code === 'CAPTURE_NO_AVAILABLE_TARGET',
  );
  assert.equal(internals.state.presentationCaptureDiagnostics.handshakeStatus, 'failed');
  assert.equal(internals.state.presentationCaptureDiagnostics.availableTargets.length, 0);
  assert.deepEqual(Array.from(internals.state.presentationCaptureDiagnostics.failedTargets), []);
});

test('post-request capture validation reports CAPTURE_REQUEST_NOT_INTERCEPTED', () => {
  const internals = loadE2eInternals({ capturePresentationEvidence: true });
  const status = {
    requestIntercepted: false,
    actualInterceptedTarget: null,
    injectedPresentationEvidenceMode: null,
    responseIntercepted: false,
    auditCorrelationAvailable: false,
    capturedResponseAuditId: null,
  };
  assert.equal(internals.captureFailureReason(status, 'rec_not_intercepted'), 'request_not_intercepted');
  internals.runtimeCaptureFailure('request_not_intercepted', 'rec_not_intercepted', 'initial', status);
  assert.equal(internals.state.errors.at(-1).code, 'CAPTURE_REQUEST_NOT_INTERCEPTED');
});

test('post-request capture validation reports CAPTURE_RESPONSE_NOT_INTERCEPTED', () => {
  const internals = loadE2eInternals({ capturePresentationEvidence: true });
  const status = {
    requestIntercepted: true,
    actualInterceptedTarget: 'wx.cloud.callFunction',
    injectedPresentationEvidenceMode: 'sanitized_v1',
    responseIntercepted: false,
    auditCorrelationAvailable: false,
    capturedResponseAuditId: null,
  };
  assert.equal(internals.captureFailureReason(status, 'rec_pending'), 'response_not_intercepted');
  internals.runtimeCaptureFailure('response_not_intercepted', 'rec_pending', 'initial', status);
  assert.equal(internals.state.errors.at(-1).code, 'CAPTURE_RESPONSE_NOT_INTERCEPTED');
});

test('final validation report marks unexecuted QA as N/A and names all finalize artifacts', () => {
  const internals = loadE2eInternals();
  const report = internals.buildValidationReport({
    status: 'FAILED',
    versionContract: { status: 'PASSED' },
  }, []);
  assert.equal(report.productionRequestExecuted, false);
  assert.equal(report.qa.initial.status, 'N/A');
  assert.equal(report.qa.refresh.status, 'N/A');
  const source = fs.readFileSync(path.join(__dirname, 'recommendation-v6-e2e.cjs'), 'utf8');
  for (const artifact of ['summary.md', 'validation.json', 'hook-diagnostics.json', 'requests.jsonl', 'sanitized-lifecycle.jsonl', 'qa-initial.json', 'qa-refresh.json', 'errors.jsonl', 'cards-table.md']) {
    assert.match(source, new RegExp(artifact.replace('.', '\\.') ));
  }
  assert.match(source, /createEvidenceZip\(\)/);
});

function resetGateState(internals) {
  internals.state.failed = false;
  internals.state.errors.length = 0;
  internals.state.matrix.length = 0;
  internals.state.versionMismatchAudits.clear();
}

function authoritativeQa(overrides = {}) {
  return {
    version: 'qa-batch-audit-v6-1-semantic-presentation',
    counts: { candidate: 8, generated: 8, accepted: 8, rejected: 0, selected: 8 },
    qaGatePassed: true,
    gateStatus: 'passed',
    qaBlockReasons: [],
    duplicateCause: 'NONE',
    syntheticSuffixCount: 0,
    unsupportedClaimCount: 0,
    finalCardCount: 8,
    alternativeCandidateCount: 0,
    exactTitleDuplicateGroups: [],
    normalizedTitleDuplicateGroups: [],
    exactReasonDuplicateGroups: [],
    normalizedReasonDuplicateGroups: [],
    titleTokenDuplicateGroups: [],
    placeholderTitleCount: 0,
    availableDifferentiatorCount: 0,
    titleDuplicateWarningCount: 0,
    tagSceneMismatchCount: 0,
    cardConsistencyFailures: 0,
    presentationFactSignatureHash: 'fact-hash',
    primaryRelationCode: 'RELATION_NONE',
    reasonSemanticSkeleton: 'reason-skeleton',
    titleSemanticSkeleton: 'title-skeleton',
    semanticEquivalentGroupCount: 0,
    qaTruncated: false,
    ...overrides,
  };
}

function batch(keys, metadata = {}) {
  const records = keys.map((outfitKey) => ({ outfitKey }));
  Object.defineProperties(records, {
    evidenceComplete: { value: metadata.evidenceComplete !== false },
    expectedCount: { value: metadata.expectedCount ?? records.length },
    limited: { value: metadata.limited === true },
    exhausted: { value: metadata.exhausted === true },
  });
  return records;
}

test('exact V6.1 version contract accepts the current build and QA version', () => {
  const internals = loadE2eInternals();
  assert.doesNotThrow(() => internals.validateVersionContract('rec_version_ok', {
    cloudBuild: internals.EXPECTED_CLOUD_BUILD,
  }, { version: internals.EXPECTED_QA_VERSION }));
  assert.equal(internals.state.failed, false);
});

for (const [name, response, qa] of [
  ['old storage-hotfix build', { cloudBuild: 'generateOutfit-recommendation-v6-storage-hotfix-20260721' }, { version: 'qa-batch-audit-v6' }],
  ['V5 build', { cloudBuild: 'generateOutfit-recommendation-v5-20260720' }, { version: 'qa-batch-audit-v5' }],
  ['missing cloud build', {}, { version: 'qa-batch-audit-v6-1-semantic-presentation' }],
  ['missing QA version', { cloudBuild: 'generateOutfit-recommendation-v6-1-presentation-evidence-20260724' }, {}],
]) {
  test(`version contract rejects ${name}`, () => {
    const internals = loadE2eInternals();
    assert.throws(() => internals.validateVersionContract(`rec_version_${name.replace(/\s+/g, '_')}`, response, qa), /VERSION_CONTRACT_MISMATCH/);
    assert.equal(internals.state.failed, true);
    assert.equal(internals.state.errors.at(-1).code, 'VERSION_CONTRACT_MISMATCH');
  });
}

test('request error terminals are classified without version mismatch', () => {
  for (const [label, payload, expectedCode] of [
    ['[RecommendError]', { errorCode: 'CARD_COMPILATION_FAILED', errorMessage: 'title quality failed' }, 'CARD_COMPILATION_FAILED'],
    ['[RecommendReject]', { rejectCode: 'RECOMMENDATION_REJECTED', rejectReason: 'no eligible card' }, 'RECOMMENDATION_REJECTED'],
  ]) {
    const internals = loadE2eInternals();
    resetGateState(internals);
    internals.state.lifecycle = [
      { timestamp: '2026-07-23T00:00:00.000Z', label: '[RecommendStart]', payload: { auditId: 'rec_request_error', sceneKey: 'sport' } },
      { timestamp: '2026-07-23T00:00:01.000Z', label, payload: { auditId: 'rec_request_error', ...payload } },
    ];
    const failure = internals.recordTerminalRequestFailure(
      'rec_request_error',
      internals.state.lifecycle[1],
    );
    const request = internals.buildRequests()[0];
    const summary = internals.buildSummary([request]);

    assert.equal(failure.code, expectedCode);
    assert.equal(request.requestOutcome, 'request_failure');
    assert.equal(request.responseUnavailableDueToRequestError, true);
    assert.equal(summary.requestFailureCount, 1);
    assert.equal(summary.successfulResponseVersionMismatchCount, 0);
    assert.equal(internals.state.errors.some((entry) => entry.code === 'VERSION_CONTRACT_MISMATCH'), false);
    assert.equal(internals.state.failed, true);
  }
});

test('successful response version mismatch is reported separately from request failure', () => {
  const internals = loadE2eInternals();
  resetGateState(internals);
  const auditId = 'rec_success_version_mismatch';
  internals.state.lifecycle = [
    { timestamp: '2026-07-23T00:00:00.000Z', label: '[RecommendStart]', payload: { auditId, sceneKey: 'sport' } },
    { timestamp: '2026-07-23T00:00:01.000Z', label: '[RecommendResponse]', payload: { auditId, cloudBuild: 'old-build' } },
    { timestamp: '2026-07-23T00:00:01.100Z', label: '[RecommendationQA]', payload: { auditId, version: 'old-qa' } },
    { timestamp: '2026-07-23T00:00:02.000Z', label: '[RecommendDone]', payload: { auditId, clientTimings: {} } },
  ];
  const request = internals.buildRequests()[0];
  const summary = internals.buildSummary([request]);

  assert.equal(request.requestOutcome, 'successful_response');
  assert.equal(request.successfulResponseVersionStatus, 'mismatch');
  assert.equal(summary.requestFailureCount, 0);
  assert.equal(summary.successfulResponseVersionMismatchCount, 1);
  assert.equal(summary.successfulResponseVersionMismatches[0].actualCloudBuild, 'old-build');
});

test('refresh channel timeout keeps failure semantics and never runs success version validation', () => {
  const internals = loadE2eInternals();
  const auditId = 'rec_refresh_timeout';
  internals.state.lifecycle = [
    { timestamp: '2026-07-23T00:00:00.000Z', label: '[RecommendStart]', payload: { auditId, sceneKey: 'sport', trigger: 'refresh' } },
    { timestamp: '2026-07-23T00:00:30.000Z', label: '[RecommendError]', payload: { auditId, errorCode: 'TIMEOUT', errorMessage: 'refresh timed out' } },
  ];
  const request = internals.buildRequests()[0];
  const summary = internals.buildSummary([request]);
  assert.equal(request.requestOutcome, 'request_failure');
  assert.equal(request.requestFailureCode, 'TIMEOUT');
  assert.equal(request.responseUnavailableDueToRequestError, true);
  assert.equal(request.successfulResponseVersionStatus, 'not_applicable');
  assert.equal(summary.requestFailureCount, 1);
  assert.equal(summary.successfulResponseVersionMismatchCount, 0);
});

test('FACT_EQUIVALENCE passed_with_warnings is accepted and recorded in the summary', () => {
  const internals = loadE2eInternals();
  resetGateState(internals);
  const auditId = 'rec_fact_equivalence_warning';
  const qaPayload = authoritativeQa({
    auditId,
    alternativeCandidateCount: 8,
    gateStatus: 'passed_with_warnings',
    qaGatePassed: true,
    availableDifferentiatorCount: 17,
    duplicateCause: 'FACT_EQUIVALENCE',
    titleDuplicateWarningCount: 5,
    syntheticSuffixCount: 0,
    placeholderTitleCount: 0,
    qaBlockReasons: [],
  });
  const validation = internals.validateCanonicalQa(auditId, qaPayload);
  assert.equal(validation.valid, true);
  assert.equal(validation.warning, true);
  assert.equal(validation.duplicateCause, 'FACT_EQUIVALENCE');
  internals.state.lifecycle = [
    { timestamp: '2026-07-23T00:00:00.000Z', label: '[RecommendStart]', payload: { auditId, sceneKey: 'sport' } },
    { timestamp: '2026-07-23T00:00:01.000Z', label: '[RecommendResponse]', payload: {
      auditId, cloudBuild: internals.EXPECTED_CLOUD_BUILD,
    } },
    { timestamp: '2026-07-23T00:00:01.100Z', label: '[RecommendationQA]', payload: {
      auditId, qaGateSummary: { ...qaPayload, version: internals.EXPECTED_QA_VERSION },
    } },
    { timestamp: '2026-07-23T00:00:02.000Z', label: '[RecommendDone]', payload: { auditId, clientTimings: {} } },
  ];
  const requests = internals.buildRequests();
  const summary = internals.buildSummary(requests);
  assert.equal(requests[0].alternativeCandidateCount, 8);
  assert.deepEqual(JSON.parse(JSON.stringify(summary.alternativeCandidateCounts)), [
    { auditId, value: 8 },
  ]);
  assert.equal(summary.status, 'PASSED');
  assert.equal(summary.canonicalQaFailures.length, 0);
  assert.equal(summary.canonicalQaWarnings.length, 1);
  assert.equal(summary.canonicalQaWarnings[0].auditId, auditId);
  assert.equal(summary.canonicalQaWarnings[0].duplicateCause, 'FACT_EQUIVALENCE');
  assert.equal(summary.canonicalQaWarnings[0].availableDifferentiatorCount, 17);
  assert.equal(summary.canonicalQaWarnings[0].titleDuplicateWarningCount, 5);
});

test('truncated QA remains authoritative through the fixed gate summary path', () => {
  const internals = loadE2eInternals();
  const auditId = 'rec_truncated_authoritative';
  const gate = authoritativeQa({
    auditId,
    qaTruncated: true,
    gateStatus: 'passed_with_warnings',
    duplicateCause: 'FACT_EQUIVALENCE',
    titleDuplicateWarningCount: 3,
    alternativeCandidateCount: 8,
  });
  internals.state.runtimeCaptures.set(auditId, {
    rawResponse: rawRecommendationResponse({ qaBatchAudit: { auditId, version: gate.version, qaTruncated: true, qaGateSummary: gate } }),
  });
  const resolution = internals.resolveQaPayload(auditId, {
    auditId,
    qaGatePassed: false,
    gateStatus: 'failed',
  });
  assert.equal(resolution.source, 'runtime_response');
  assert.equal(resolution.status, 'authoritative');
  assert.equal(resolution.payload.alternativeCandidateCount, 8);
  assert.equal(resolution.payload.qaTruncated, true);
  assert.doesNotThrow(() => internals.validateCanonicalQa(auditId, resolution.payload));
});

test('alternativeCandidateCount survives the full QA-to-runner chain without array fallback', () => {
  for (const [label, acceptedCount, expectedAlternativeCount] of [
    ['positive', 9, 1],
    ['zero', 8, 0],
  ]) {
    const internals = loadE2eInternals();
    const auditId = `rec_chain_${label}`;
    const accepted = Array.from({ length: acceptedCount }, (_, index) => chainCandidate(index));
    const { clientAudit } = buildQaAuditSummaries({
      auditId,
      cloudBuild: internals.EXPECTED_CLOUD_BUILD,
      guardAcceptedCandidates: accepted,
      selectedOutfits: accepted.slice(0, 8),
      compiledOutfits: accepted.slice(0, 8).map((candidate) => ({
        outfitKey: candidate.outfitKey,
        title: `chain title ${candidate.outfitKey}`,
      })),
      execution: { countContract: countContractFor({ before: 8, returned: 8, executionMode: 'full_compute' }) },
    });
    clientAudit.qaGateSummary.gateStatus = 'passed_with_warnings';
    clientAudit.qaGateSummary.qaGatePassed = true;
    clientAudit.qaGateSummary.duplicateCause = 'FACT_EQUIVALENCE';
    clientAudit.qaGateSummary.titleDuplicateWarningCount = 1;
    clientAudit.qaGateSummary.qaBlockReasons = [];
    clientAudit.qaGateSummary.syntheticSuffixCount = 0;
    clientAudit.qaGateSummary.placeholderTitleCount = 0;
    clientAudit.qaGateSummary.unsupportedClaimCount = 0;
    fitQaBatchAuditToBudget(clientAudit, serializedBytes(clientAudit) - 1);

    const response = JSON.parse(JSON.stringify(rawRecommendationResponse({
      qaBatchAudit: clientAudit,
    })));
    const fixedSummary = response.data.qaBatchAudit.qaGateSummary;
    assert.equal(Object.hasOwn(fixedSummary, 'alternativeCandidateCount'), true);
    assert.equal(fixedSummary.alternativeCandidateCount, expectedAlternativeCount);
    assert.equal(Object.hasOwn(response.data.qaBatchAudit, 'alternativeCandidates'), false);

    const clientEntries = [];
    const clientLog = logRecommendationEvent('[RecommendationQA]', response.data.qaBatchAudit, {
      info: (...args) => clientEntries.push(args),
    });
    assert.equal(clientEntries.length, 1);
    assert.equal(clientLog.payload.qaGateSummary.alternativeCandidateCount, expectedAlternativeCount);
    const hookPayload = internals.sanitizeLifecyclePayload(clientLog.payload);
    assert.equal(hookPayload.qaGateSummary.alternativeCandidateCount, expectedAlternativeCount);
    const requestsLine = JSON.stringify({ auditId, qaGateSummary: hookPayload.qaGateSummary });
    const requestsPayload = JSON.parse(requestsLine);
    assert.equal(requestsPayload.qaGateSummary.alternativeCandidateCount, expectedAlternativeCount);

    internals.state.runtimeCaptures.set(auditId, { rawResponse: response });
    const resolved = internals.resolveQaPayload(auditId, requestsPayload);
    assert.equal(resolved.status, 'authoritative');
    assert.equal(resolved.payload.alternativeCandidateCount, expectedAlternativeCount);
    assert.doesNotThrow(() => internals.validateCanonicalQa(auditId, resolved.payload));

    delete response.data.qaBatchAudit.qaGateSummary.alternativeCandidateCount;
    delete requestsPayload.qaGateSummary.alternativeCandidateCount;
    internals.state.runtimeCaptures.set(auditId, { rawResponse: response });
    const missing = internals.resolveQaPayload(auditId, requestsPayload);
    assert.equal(missing.status, 'partial');
    assert.throws(() => internals.validateCanonicalQa(auditId, missing.payload), /QA_CAPTURE_INCOMPLETE/);
  }
});

test('fixed QA summary keeps required missing fields observable and drops optional diagnostics', () => {
  const internals = loadE2eInternals();
  const gate = authoritativeQa();
  delete gate.alternativeCandidateCount;
  const sanitized = internals.sanitizeLifecyclePayload({
    auditId: 'rec_fixed_summary',
    qaGateSummary: gate,
    alternativeCandidates: [{ outfitKey: 'must-not-be-used' }],
    optionalCandidateDetails: [{ clothingId: 'private' }],
  });
  assert.equal(Object.hasOwn(sanitized.qaGateSummary, 'alternativeCandidateCount'), false);
  assert.equal(Object.hasOwn(sanitized, 'optionalCandidateDetails'), false);
  assert.throws(
    () => internals.validateCanonicalQa('rec_fixed_summary', sanitized.qaGateSummary),
    /QA_CAPTURE_INCOMPLETE/,
  );
});

test('partial QA payload preserves nulls and reports QA_CAPTURE_INCOMPLETE instead of canonical failure', () => {
  const internals = loadE2eInternals();
  resetGateState(internals);
  const auditId = 'rec_partial_qa';
  const partial = {
    auditId,
    version: internals.EXPECTED_QA_VERSION,
    cloudBuild: internals.EXPECTED_CLOUD_BUILD,
    executionMode: 'full_compute',
    cacheHit: false,
    candidatePoolSaveStatus: 'saved',
    eligibilityRejectionAudit: {},
  };
  assert.throws(() => internals.validateCanonicalQa(auditId, partial), /QA_CAPTURE_INCOMPLETE/);
  assert.equal(internals.state.errors.at(-1).code, 'QA_CAPTURE_INCOMPLETE');
  internals.state.lifecycle = [
    { timestamp: '2026-07-23T00:00:00.000Z', label: '[RecommendStart]', payload: { auditId, sceneKey: 'sport', trigger: 'scene' } },
    { timestamp: '2026-07-23T00:00:01.000Z', label: '[RecommendResponse]', payload: {
      auditId, cloudBuild: internals.EXPECTED_CLOUD_BUILD, executionMode: 'full_compute', candidatePoolSaveStatus: 'saved',
    } },
    { timestamp: '2026-07-23T00:00:01.100Z', label: '[RecommendationQA]', payload: { auditId, qaGateSummary: partial } },
    { timestamp: '2026-07-23T00:00:02.000Z', label: '[RecommendDone]', payload: { auditId, clientTimings: {} } },
  ];
  const request = internals.buildRequests()[0];
  assert.equal(request.qaObservationStatus, 'partial');
  assert.equal(request.qaGatePassed, null);
  assert.equal(request.gateStatus, null);
  assert.equal(request.qaBlockReasons, null);
  assert.equal(request.syntheticSuffixCount, null);
  assert.equal(request.unsupportedClaimCount, null);
  assert.equal(internals.buildSummary([request]).canonicalQaFailures.length, 0);
});

test('response-initial full QA remains authoritative and preserves the old ignored-differentiator failure', () => {
  const internals = loadE2eInternals();
  resetGateState(internals);
  const artifact = JSON.parse(fs.readFileSync(path.join(
    __dirname,
    '../../../artifacts/recommendation-v6-1-semantic-real-validation/20260726-193230/response-initial.json',
  ), 'utf8'));
  const auditId = artifact.data.qaBatchAudit.auditId;
  artifact.data.qaBatchAudit.qaGateSummary = authoritativeQa({
    version: artifact.data.qaBatchAudit.version,
    counts: artifact.data.qaBatchAudit.counts,
    qaGatePassed: artifact.data.qaBatchAudit.qaGatePassed,
    gateStatus: artifact.data.qaBatchAudit.gateStatus,
    qaBlockReasons: artifact.data.qaBatchAudit.qaBlockReasons,
    duplicateCause: artifact.data.qaBatchAudit.duplicateCause,
    syntheticSuffixCount: artifact.data.qaBatchAudit.syntheticSuffixCount,
    unsupportedClaimCount: artifact.data.qaBatchAudit.unsupportedClaimCount,
    placeholderTitleCount: artifact.data.qaBatchAudit.placeholderTitleCount,
    availableDifferentiatorCount: artifact.data.qaBatchAudit.availableDifferentiatorCount,
    titleDuplicateWarningCount: artifact.data.qaBatchAudit.titleDuplicateWarningCount,
    tagSceneMismatchCount: artifact.data.qaBatchAudit.tagSceneMismatchCount,
    cardConsistencyFailures: artifact.data.qaBatchAudit.cardConsistencyFailures,
    qaTruncated: artifact.data.qaBatchAudit.qaTruncated,
  });
  internals.state.runtimeCaptures.set(auditId, { rawResponse: artifact });

  const resolution = internals.resolveQaPayload(auditId, null, artifact);
  assert.equal(resolution.source, 'runtime_response');
  assert.equal(resolution.status, 'authoritative');
  assert.equal(resolution.payload.gateStatus, 'failed');
  assert.equal(resolution.payload.qaGatePassed, false);
  assert.equal(resolution.payload.duplicateCause, 'DIFFERENTIATOR_IGNORED');
  assert.deepEqual(resolution.payload.qaBlockReasons, ['DIFFERENTIATOR_IGNORED']);
  assert.throws(
    () => internals.validateCanonicalQa(auditId, resolution.payload),
    /CANONICAL_QA_GATE_FAILED/,
  );
  assert.equal(internals.state.errors.at(-1).code, 'CANONICAL_QA_GATE_FAILED');
});

test('E2E canonical QA rejects ignored differentiators and invalid warning contracts', () => {
  const internals = loadE2eInternals();
  for (const payload of [
    authoritativeQa({
      gateStatus: 'failed',
      qaGatePassed: false,
      availableDifferentiatorCount: 1,
      duplicateCause: 'DIFFERENTIATOR_IGNORED',
      titleDuplicateWarningCount: 2,
      syntheticSuffixCount: 0,
      placeholderTitleCount: 0,
      qaBlockReasons: ['DIFFERENTIATOR_IGNORED'],
    }),
    authoritativeQa({
      gateStatus: 'passed_with_warnings',
      qaGatePassed: true,
      availableDifferentiatorCount: 1,
      duplicateCause: 'DIFFERENTIATOR_IGNORED',
      titleDuplicateWarningCount: 2,
      syntheticSuffixCount: 0,
      placeholderTitleCount: 0,
      qaBlockReasons: [],
    }),
    authoritativeQa({
      gateStatus: 'passed_with_warnings',
      qaGatePassed: true,
      availableDifferentiatorCount: 17,
      duplicateCause: 'FACT_EQUIVALENCE',
      titleDuplicateWarningCount: 5,
      unsupportedClaimCount: 1,
      syntheticSuffixCount: 0,
      placeholderTitleCount: 0,
      qaBlockReasons: [],
    }),
    authoritativeQa({
      gateStatus: 'passed',
      qaGatePassed: true,
      availableDifferentiatorCount: 17,
      duplicateCause: 'DIFFERENTIATOR_IGNORED',
      titleDuplicateWarningCount: 0,
      syntheticSuffixCount: 0,
      placeholderTitleCount: 0,
      qaBlockReasons: [],
    }),
    authoritativeQa({
      gateStatus: 'passed',
      qaGatePassed: true,
      availableDifferentiatorCount: 17,
      duplicateCause: 'SYNTHETIC_VARIATION',
      titleDuplicateWarningCount: 0,
      syntheticSuffixCount: 0,
      placeholderTitleCount: 0,
      qaBlockReasons: [],
    }),
  ]) {
    internals.state.failed = false;
    internals.state.errors.length = 0;
    assert.throws(() => internals.validateCanonicalQa('rec_negative_contract', payload), /CANONICAL_QA_GATE_FAILED/);
    assert.equal(internals.state.failed, true);
  }
});

test('failed canonical QA action stops before captureBatchOrContinue', async () => {
  const source = fs.readFileSync(path.join(__dirname, 'recommendation-v6-e2e.cjs'), 'utf8');
  const mainSource = source.slice(source.indexOf('async function main()'));
  const actionIndex = mainSource.indexOf("const sport = await tapScene(3, 'sport', 'sport-initial');");
  const guardIndex = mainSource.indexOf("if (!sport || sport.terminal?.label !== '[RecommendDone]') return;", actionIndex);
  const captureIndex = mainSource.indexOf("captureBatchOrContinue('sport', 'initial', sport.auditId)", actionIndex);
  assert.ok(actionIndex >= 0);
  assert.ok(guardIndex > actionIndex && guardIndex < captureIndex);
});

test('candidate_pool_hit accepts an empty or not_applicable saveStatus and skips generation stages', () => {
  const internals = loadE2eInternals();
  const base = {
    executionMode: 'candidate_pool_hit',
    cacheHit: true,
    requestedCandidatePoolIdPresent: true,
    timings: { candidatePoolLoadMs: 12, compositionMs: 0, canonicalizeMs: 0, eligibilityMs: 0, scoringMs: 0 },
  };
  const rawResponse = rawRecommendationResponse();
  assert.doesNotThrow(() => internals.validateCandidatePoolDiagnostics('rec_pool_hit_empty', rawResponse, { ...base, candidatePoolSaveStatus: null }));
  assert.doesNotThrow(() => internals.validateCandidatePoolDiagnostics('rec_pool_hit_na', rawResponse, { ...base, candidatePoolSaveStatus: 'not_applicable' }));
});

test('candidate_pool_hit rejects a fabricated saved status', () => {
  const internals = loadE2eInternals();
  assert.throws(() => internals.validateCandidatePoolDiagnostics('rec_pool_hit_saved', rawRecommendationResponse(), {
    executionMode: 'candidate_pool_hit',
    cacheHit: true,
    requestedCandidatePoolIdPresent: true,
    candidatePoolSaveStatus: 'saved',
    timings: { candidatePoolLoadMs: 12, compositionMs: 0, canonicalizeMs: 0, eligibilityMs: 0, scoringMs: 0 },
  }), /CANDIDATE_POOL_HIT_CONTRACT_MISMATCH/);
  assert.equal(internals.state.failed, true);
});

test('full_compute accepts each terminal candidate pool save status', () => {
  const internals = loadE2eInternals();
  for (const status of ['saved', 'skipped_oversize', 'write_failed', 'write_timeout']) {
    internals.state.failed = false;
    internals.state.errors.length = 0;
    const contract = countContractFor({ executionMode: 'full_compute' });
    assert.doesNotThrow(() => internals.validateCandidatePoolDiagnostics(
      `rec_full_${status}`,
      rawRecommendationResponse({ contract }),
      { executionMode: 'full_compute', candidatePoolSaveStatus: status },
    ));
  }
});

for (const [name, before, executionMode] of [
  ['full_compute 8', 8, 'full_compute'],
  ['pool_hit 8', 8, 'candidate_pool_hit'],
  ['tail 1', 1, 'candidate_pool_hit'],
  ['tail 5', 5, 'candidate_pool_hit'],
  ['tail 7', 7, 'candidate_pool_hit'],
  ['exhausted 0', 0, 'candidate_pool_hit'],
]) {
  test(`runner accepts authoritative result.data.countContract for ${name}`, () => {
    const internals = loadE2eInternals();
    const contract = countContractFor({ before, returned: before, executionMode });
    const diagnostics = {
      executionMode,
      cacheHit: executionMode === 'candidate_pool_hit',
      requestedCandidatePoolIdPresent: executionMode === 'candidate_pool_hit',
      candidatePoolSaveStatus: executionMode === 'full_compute' ? 'saved' : null,
      timings: executionMode === 'candidate_pool_hit'
        ? { candidatePoolLoadMs: 12, compositionMs: 0, canonicalizeMs: 0, eligibilityMs: 0, scoringMs: 0 }
        : {},
    };
    assert.doesNotThrow(() => internals.validateCandidatePoolDiagnostics(
      `rec_${name.replaceAll(' ', '_')}`,
      rawRecommendationResponse({ contract, returned: before }),
      diagnostics,
    ));
  });
}

test('runner rejects missing, null, and misplaced count contracts without fallback', () => {
  const internals = loadE2eInternals();
  const diagnostics = { executionMode: 'full_compute', candidatePoolSaveStatus: 'saved' };
  for (const rawResponse of [
    { code: 0, data: { outfits: Array.from({ length: 8 }, () => ({})) } },
    rawRecommendationResponse({ contract: null, returned: 8 }),
    { code: 0, countContract: countContractFor(), data: { outfits: Array.from({ length: 8 }, () => ({})) } },
    { code: 0, data: { outfits: Array.from({ length: 8 }, () => ({})), debug: { countContract: countContractFor() } } },
    { code: 0, data: { outfits: Array.from({ length: 8 }, () => ({})), qaBatchAudit: { countContract: countContractFor() } } },
  ]) {
    internals.state.failed = false;
    internals.state.errors.length = 0;
    assert.throws(() => internals.validateCandidatePoolDiagnostics('rec_missing_contract', rawResponse, diagnostics), /COUNT_CONTRACT_INVALID/);
    assert.equal(internals.state.errors.at(-1).context.protocolPath, 'result.data.countContract');
  }
});

test('runner rejects returnedCardCount that differs from data.outfits length', () => {
  const internals = loadE2eInternals();
  const contract = countContractFor({ before: 8, returned: 8, executionMode: 'full_compute' });
  assert.throws(() => internals.validateCandidatePoolDiagnostics(
    'rec_card_mismatch',
    rawRecommendationResponse({ contract, returned: 7 }),
    { executionMode: 'full_compute', candidatePoolSaveStatus: 'saved' },
  ), /COUNT_CONTRACT_INVALID/);
});

test('refresh batches with no repeated outfit keys pass', () => {
  const internals = loadE2eInternals();
  resetGateState(internals);
  assert.doesNotThrow(() => internals.assertRefreshExcludesPrevious(batch(['a', 'b']), batch(['c', 'd']), {
    auditId: 'rec_refresh_ok', sceneKey: 'home', batch: 'batch-02', label: 'home-refresh-2',
  }));
  assert.equal(internals.state.failed, false);
});

for (const [name, current] of [
  ['one repeated key', batch(['a', 'c'])],
  ['all repeated keys', batch(['a', 'b'])],
]) {
  test(`refresh rejects ${name}`, () => {
    const internals = loadE2eInternals();
    resetGateState(internals);
    assert.throws(() => internals.assertRefreshExcludesPrevious(batch(['a', 'b']), current, {
      auditId: `rec_refresh_${name.replace(/\s+/g, '_')}`, sceneKey: 'home', batch: 'batch-02', label: 'home-refresh-2',
    }), /REFRESH_REUSED_PREVIOUS_OUTFIT/);
    assert.equal(internals.state.failed, true);
    assert.equal(internals.state.errors.at(-1).code, 'REFRESH_REUSED_PREVIOUS_OUTFIT');
    assert.equal(internals.state.errors.at(-1).context.repeatedCount, name === 'one repeated key' ? 1 : 2);
    assert.equal(internals.state.errors.at(-1).context.keys, undefined);
  });
}

test('empty exhausted refresh is valid and is not treated as duplicate', () => {
  const internals = loadE2eInternals();
  resetGateState(internals);
  assert.doesNotThrow(() => internals.assertRefreshExcludesPrevious(batch(['a', 'b']), batch([], { exhausted: true }), {
    auditId: 'rec_refresh_exhausted', sceneKey: 'home', batch: 'batch-03', label: 'home-refresh-3',
  }));
  assert.equal(internals.state.failed, false);
});

test('incomplete card evidence fails instead of assuming no duplicate', () => {
  const internals = loadE2eInternals();
  resetGateState(internals);
  assert.throws(() => internals.assertRefreshExcludesPrevious(batch(['a'], { evidenceComplete: false }), batch(['b']), {
    auditId: 'rec_refresh_incomplete', sceneKey: 'home', batch: 'batch-02', label: 'home-refresh-2',
  }), /EVIDENCE_INCOMPLETE/);
  assert.equal(internals.state.failed, true);
  assert.equal(internals.state.errors.at(-1).code, 'EVIDENCE_INCOMPLETE');
});

test('complete normal lifecycle: Start -> Response -> QA -> Done merges into one auditId', () => {
  const internals = loadE2eInternals();
  const auditId = 'rec_lifecycle_001';
  internals.state.lifecycle = [
    { timestamp: '2026-07-21T10:00:00.000Z', label: '[RecommendStart]', payload: { auditId, sceneKey: 'home', trigger: 'initial', slot: 'initial', scene: '居家' } },
    { timestamp: '2026-07-21T10:00:05.000Z', label: '[RecommendResponse]', payload: {
      auditId, sceneKey: 'home', scene: '居家', trigger: 'initial',
      cloudBuild: internals.EXPECTED_CLOUD_BUILD,
      executionMode: 'full_compute', cacheHit: false, cacheMissReason: 'initial_request',
      exclusionsAppliedCount: 0,
      candidatePoolSaveStatus: 'saved', candidatePoolSaveReason: null,
      candidatePoolSerializedBytes: 102400, candidatePoolChunkCount: 1,
      recommendationBatchIdPresent: true, recommendationBatchIdLength: 32,
      requestedCandidatePoolIdPresent: false, requestedCandidatePoolIdLength: 0,
      timings: {
        totalMs: 4200,
        compositionMs: 100,
        candidatePoolSaveMs: 4613,
        snapshotUpsertMs: 27,
        serializationMs: 14,
      },
      responseBytes: { totalDataBytes: 204800, debugBytes: 512 },
    } },
    { timestamp: '2026-07-21T10:00:05.500Z', label: '[RecommendationQA]', payload: {
      auditId, version: 'qa-batch-audit-v6-1-semantic-presentation', cloudBuild: internals.EXPECTED_CLOUD_BUILD,
      executionMode: 'full_compute', cacheHit: false, cacheMissReason: 'initial_request',
      candidatePoolIdentityHash: 'abc123', candidatePoolAgeMs: 0, exclusionsAppliedCount: 0,
      counts: { generated: 320, candidate: 320, accepted: 320, rejected: 0, selected: 8 },
      qaGateSummary: authoritativeQa({
        counts: { generated: 320, candidate: 320, accepted: 320, rejected: 0, selected: 8 },
      }),
      timings: { totalMs: 4200 },
    } },
    { timestamp: '2026-07-21T10:00:12.000Z', label: '[RecommendDone]', payload: {
      auditId, clientTimings: { cloudRoundTripMs: 4961, clientApplyMs: 120, imageReadyMs: 6800, imageTimeout: false, requestedImageCount: 24, resolvedImageCount: 24 },
    } },
  ];

  const requests = internals.buildRequests();
  assert.equal(requests.length, 1);
  const req = requests[0];
  assert.equal(req.auditId, auditId);
  assert.equal(req.slot, 'initial');
  assert.equal(req.hasResponse, true);
  assert.equal(req.hasQa, true);
  assert.equal(req.hasDone, true);
  assert.equal(req.responseCount, 1);
  assert.equal(req.qaCount, 1);
  assert.equal(req.doneCount, 1);
  assert.equal(req.terminal, 'done');
  assert.equal(req.executionMode, 'full_compute');
  assert.equal(req.cacheMissReason, 'initial_request');
  assert.equal(req.generated, 320);
  assert.equal(req.selected, 8);
  assert.equal(req.candidatePoolSaveStatus, 'saved');
  assert.equal(req.candidatePoolSerializedBytes, 102400);
  assert.equal(req.timings.candidatePoolSaveMs, 4613);
  assert.equal(req.timings.snapshotUpsertMs, 27);
  assert.equal(req.timings.serializationMs, 14);
  assert.equal(req.responseBytes.totalDataBytes, 204800);
  assert.equal(req.responseBytes.debugBytes, 512);
  assert.equal(req.recommendationBatchIdPresent, true);
  assert.equal(req.recommendationBatchIdLength, 32);
  assert.equal(req.requestedCandidatePoolIdPresent, false);
  assert.deepEqual(req.clientTimings, { cloudRoundTripMs: 4961, clientApplyMs: 120, imageReadyMs: 6800, imageTimeout: false, requestedImageCount: 24, resolvedImageCount: 24 });
});

test('missing RecommendResponse marks evidence as incomplete', () => {
  const internals = loadE2eInternals();
  const auditId = 'rec_no_response';
  internals.state.lifecycle = [
    { timestamp: '2026-07-21T10:00:00.000Z', label: '[RecommendStart]', payload: { auditId, sceneKey: 'home' } },
    { timestamp: '2026-07-21T10:00:05.000Z', label: '[RecommendationQA]', payload: {
      auditId, version: 'qa-batch-audit-v6-1-semantic-presentation', executionMode: 'full_compute',
      counts: { generated: 100, selected: 8 },
    } },
    { timestamp: '2026-07-21T10:00:10.000Z', label: '[RecommendDone]', payload: {
      auditId, clientTimings: { cloudRoundTripMs: 4000 },
    } },
  ];

  const requests = internals.buildRequests();
  assert.equal(requests.length, 1);
  const req = requests[0];
  assert.equal(req.hasResponse, false, 'hasResponse must be false when RecommendResponse is missing');
  assert.equal(req.responseCount, 0);
  // executionMode must not be inferred from QA when the response is missing.
  assert.equal(req.executionMode, null);
  assert.equal(req.cacheHit, null);
  assert.equal(req.requestedCandidatePoolIdPresent, null);
  assert.equal(req.successfulResponseVersionStatus, 'response_missing');
  assert.equal(internals.buildSummary([req]).successfulResponseVersionMismatchCount, 0);
  // candidatePool diagnostics from Response are null/0
  assert.equal(req.candidatePoolSaveStatus, null);
  assert.equal(req.candidatePoolSerializedBytes, 0);
  assert.equal(req.recommendationBatchIdPresent, false);
});

test('two RecommendDone marks duplicate', () => {
  const internals = loadE2eInternals();
  const auditId = 'rec_dup_done';
  internals.state.lifecycle = [
    { timestamp: '2026-07-21T10:00:00.000Z', label: '[RecommendStart]', payload: { auditId, sceneKey: 'home' } },
    { timestamp: '2026-07-21T10:00:05.000Z', label: '[RecommendResponse]', payload: {
      auditId, executionMode: 'full_compute',
    } },
    { timestamp: '2026-07-21T10:00:05.500Z', label: '[RecommendationQA]', payload: {
      auditId, version: 'qa-batch-audit-v6-1-semantic-presentation',
    } },
    { timestamp: '2026-07-21T10:00:10.000Z', label: '[RecommendDone]', payload: {
      auditId, clientTimings: { cloudRoundTripMs: 4000, clientApplyMs: 100 },
    } },
    { timestamp: '2026-07-21T10:00:15.000Z', label: '[RecommendDone]', payload: {
      auditId, clientTimings: { cloudRoundTripMs: 4000, clientApplyMs: 200 },
    } },
  ];

  const requests = internals.buildRequests();
  assert.equal(requests.length, 1);
  const req = requests[0];
  assert.equal(req.doneCount, 2, 'doneCount must reflect duplicate Done');
  // clientTimings comes from the first matching clientDone
  assert.equal(req.clientTimings.cloudRoundTripMs, 4000);
});

test('Response and Done fields enter correct regions', () => {
  const internals = loadE2eInternals();
  const auditId = 'rec_field_separation';
  internals.state.lifecycle = [
    { timestamp: '2026-07-21T10:00:00.000Z', label: '[RecommendStart]', payload: { auditId, sceneKey: 'work' } },
    { timestamp: '2026-07-21T10:00:05.000Z', label: '[RecommendResponse]', payload: {
      auditId,
      executionMode: 'candidate_pool_hit',
      cacheHit: true,
      cacheMissReason: '',
      exclusionsAppliedCount: 8,
      candidatePoolSaveStatus: null,
      candidatePoolSaveReason: null,
      candidatePoolSerializedBytes: 51200,
      candidatePoolChunkCount: 1,
      recommendationBatchIdPresent: true,
      recommendationBatchIdLength: 32,
      requestedCandidatePoolIdPresent: true,
      requestedCandidatePoolIdLength: 32,
      timings: { totalMs: 800, candidatePoolLoadMs: 12 },
      responseBytes: { totalDataBytes: 102400 },
    } },
    { timestamp: '2026-07-21T10:00:05.500Z', label: '[RecommendationQA]', payload: {
      auditId, version: 'qa-batch-audit-v6-1-semantic-presentation',
      executionMode: 'candidate_pool_hit',
      candidatePoolIdentityHash: 'def456',
      candidatePoolAgeMs: 5000,
      cacheHit: true,
      counts: { generated: 312, candidate: 312, accepted: 312, rejected: 0, selected: 8 },
      qaGateSummary: authoritativeQa({
        counts: { generated: 312, candidate: 312, accepted: 312, rejected: 0, selected: 8 },
      }),
      timings: { totalMs: 800 },
    } },
    { timestamp: '2026-07-21T10:00:08.000Z', label: '[RecommendDone]', payload: {
      auditId,
      clientTimings: {
        cloudRoundTripMs: 950,
        clientApplyMs: 80,
        imageReadyMs: 2400,
        imageTimeout: false,
        requestedImageCount: 24,
        resolvedImageCount: 24,
      },
    } },
  ];

  const requests = internals.buildRequests();
  const req = requests[0];

  // Server-side fields from Response
  assert.equal(req.executionMode, 'candidate_pool_hit');
  assert.equal(req.cacheHit, true);
  assert.equal(req.exclusionsAppliedCount, 8);
  assert.equal(req.candidatePoolSaveStatus, null);
  assert.equal(req.candidatePoolSerializedBytes, 51200);
  assert.equal(req.candidatePoolChunkCount, 1);
  assert.equal(req.recommendationBatchIdPresent, true);
  assert.equal(req.recommendationBatchIdLength, 32);
  assert.equal(req.requestedCandidatePoolIdPresent, true);
  assert.equal(req.requestedCandidatePoolIdLength, 32);
  assert.equal(req.timings.totalMs, 800);
  assert.equal(req.timings.candidatePoolLoadMs, 12);
  assert.equal(req.responseBytes.totalDataBytes, 102400);

  // QA-only fields from QA
  assert.equal(req.qaVersion, 'qa-batch-audit-v6-1-semantic-presentation');
  assert.equal(req.candidatePoolIdentityHash, 'def456');
  assert.equal(req.candidatePoolAgeMs, 5000);
  assert.equal(req.generated, 312);

  // Client-side fields from Done only
  assert.equal(req.clientTimings.cloudRoundTripMs, 950);
  assert.equal(req.clientTimings.clientApplyMs, 80);
  assert.equal(req.clientTimings.imageReadyMs, 2400);
  assert.equal(req.clientTimings.imageTimeout, false);
  assert.equal(req.clientTimings.requestedImageCount, 24);
  assert.equal(req.clientTimings.resolvedImageCount, 24);
  // Done payload must not leak server fields into top-level request
  assert.equal(req.clientTimings.executionMode, undefined);
});

test('pool ID only retained as Present/Length, raw ID never in output', () => {
  const internals = loadE2eInternals();
  const auditId = 'rec_pool_id_safety';
  internals.state.lifecycle = [
    { timestamp: '2026-07-21T10:00:00.000Z', label: '[RecommendStart]', payload: { auditId, sceneKey: 'home' } },
    { timestamp: '2026-07-21T10:00:05.000Z', label: '[RecommendResponse]', payload: {
      auditId,
      executionMode: 'full_compute',
      recommendationBatchIdPresent: true,
      recommendationBatchIdLength: 36,
      requestedCandidatePoolIdPresent: false,
      requestedCandidatePoolIdLength: 0,
      // Simulate a raw ID accidentally leaking into the payload
      recommendationBatchId: 'batch_raw_secret_id_1234567890',
      requestedCandidatePoolId: 'pool_raw_secret_id_0987654321',
    } },
    { timestamp: '2026-07-21T10:00:05.500Z', label: '[RecommendationQA]', payload: { auditId, version: 'qa-batch-audit-v6-1-semantic-presentation' } },
    { timestamp: '2026-07-21T10:00:10.000Z', label: '[RecommendDone]', payload: { auditId, clientTimings: { cloudRoundTripMs: 4000 } } },
  ];

  const requests = internals.buildRequests();
  const req = requests[0];
  const json = JSON.stringify(req);

  // Present/Length are retained
  assert.equal(req.recommendationBatchIdPresent, true);
  assert.equal(req.recommendationBatchIdLength, 36);
  assert.equal(req.requestedCandidatePoolIdPresent, false);
  assert.equal(req.requestedCandidatePoolIdLength, 0);

  // Raw IDs must never appear in serialized output
  assert.equal(json.includes('batch_raw_secret_id_1234567890'), false, 'raw recommendationBatchId must not appear in output');
  assert.equal(json.includes('pool_raw_secret_id_0987654321'), false, 'raw requestedCandidatePoolId must not appear in output');
});

test('old logs without RecommendResponse are not silently misinterpreted as new protocol', () => {
  const internals = loadE2eInternals();
  const auditId = 'rec_old_protocol';
  // Simulate old-style lifecycle: Start -> Done (with server summary) -> QA
  // Old protocol used Done as server summary source; new protocol uses Response.
  internals.state.lifecycle = [
    { timestamp: '2026-07-21T10:00:00.000Z', label: '[RecommendStart]', payload: { auditId, sceneKey: 'home' } },
    { timestamp: '2026-07-21T10:00:05.000Z', label: '[RecommendDone]', payload: {
      auditId,
      // Old protocol put server summary in Done
      executionMode: 'full_compute',
      cloudBuild: internals.EXPECTED_CLOUD_BUILD,
      cacheHit: false,
      cacheMissReason: 'initial_request',
      counts: { generated: 320, selected: 8 },
      timings: { totalMs: 4200 },
      clientTimings: { cloudRoundTripMs: 4200 },
    } },
    { timestamp: '2026-07-21T10:00:05.500Z', label: '[RecommendationQA]', payload: {
      auditId, version: 'qa-batch-audit-v6-1-semantic-presentation',
    } },
  ];

  const requests = internals.buildRequests();
  const req = requests[0];

  // hasResponse must be false so old logs are flagged as incomplete
  assert.equal(req.hasResponse, false, 'old logs without RecommendResponse must be flagged as incomplete');
  assert.equal(req.responseCount, 0);

  // candidatePool diagnostics from Response are null (not silently sourced from Done)
  assert.equal(req.candidatePoolSaveStatus, null);
  assert.equal(req.candidatePoolSerializedBytes, 0);
  assert.equal(req.recommendationBatchIdPresent, false);
  assert.equal(req.requestedCandidatePoolIdPresent, null);
});

test('console lifecycle sanitizer retains the audit allowlist and removes sensitive fields recursively', () => {
  const internals = loadE2eInternals();
  const sanitized = internals.sanitizeLifecyclePayload({
    auditId: 'rec_sanitized',
    recommendationBatchId: 'batch-secret',
    clothingId: 'clothing-secret',
    imageUrl: 'https://private.example/image.jpg',
    freeText: 'must not survive',
    countContract: { ...countContractFor({ before: 5, returned: 5 }), candidatePoolId: 'pool-secret' },
    eligibilityRejectionAudit: {
      version: 'eligibility-rejection-audit-v1',
      generatedCount: 132,
      guardEnteredCount: 132,
      guardAcceptedCount: 0,
      guardRejectedCount: 132,
      rejectionStageHistogram: { scene_eligibility: 132 },
      rejectionReasonHistogram: { SPORT_NON_SPORT_APPAREL: 132 },
      rejectionReasonCombinationHistogram: { SPORT_NON_SPORT_APPAREL: 132 },
      categoryDistribution: {
        top: { categories: { top: 132 }, subtypes: { tshirt: 132 } },
        bottom: { categories: { bottom: 132 }, subtypes: { shorts: 132 } },
        shoes: { categories: { shoes: 132 }, subtypes: { home_shoe: 132 } },
        roleCompleteness: { complete: 132, incomplete: 0 },
        sportFactCounts: { isTshirtLike: 132 },
        safeSportCandidate: { exists: false, count: 0 },
      },
      samples: [{
        sampleIndex: 0,
        rejectionStage: 'scene_eligibility',
        rejectionCodes: ['SPORT_NON_SPORT_APPAREL'],
        top: { category: 'top', subtype: 'tshirt', sportFacts: { isTshirtLike: true }, itemId: 'secret-item' },
        bottom: { category: 'bottom', subtype: 'shorts', sportFacts: { isShorts: true } },
        shoes: { category: 'shoes', subtype: 'home_shoe', sportFacts: { isHomeShoe: true } },
        roleCompleteness: true,
        weather: { mode: 'disabled', temperatureBucket: 'unknown', precipitationPresent: false },
      }],
      truncated: false,
      serializedBytes: 1234,
    },
  });
  const json = JSON.stringify(sanitized);
  assert.equal(json.includes('batch-secret'), false);
  assert.equal(json.includes('clothing-secret'), false);
  assert.equal(json.includes('private.example'), false);
  assert.equal(json.includes('must not survive'), false);
  assert.equal(json.includes('secret-item'), false);
  assert.equal(json.includes('pool-secret'), false);
  assert.equal(sanitized.countContract.expectedCardCount, 5);
  assert.equal(sanitized.countContract.candidatePoolId, null);
  assert.equal(sanitized.eligibilityRejectionAudit.samples.length, 1);
});

test('raw cloud response serializes through runtime capture, requests, and summary at one fixed path', () => {
  const internals = loadE2eInternals();
  const auditId = 'rec_serialization_chain';
  const contract = countContractFor({ before: 8, returned: 8, executionMode: 'full_compute' });
  const rawResponse = rawRecommendationResponse({
    contract: { ...contract, candidatePoolId: 'pool-private-id' },
    debug: { auditId, cloudBuildVersion: internals.EXPECTED_CLOUD_BUILD, executionMode: 'full_compute', candidatePoolSaveStatus: 'saved' },
    qaBatchAudit: { auditId, version: internals.EXPECTED_QA_VERSION },
  });
  const capture = internals.normalizeCloudCallCapture({ status: 'fulfilled', result: { result: rawResponse } }, { auditId, slot: 'initial' });
  assert.deepEqual(capture.rawResponse.data.countContract, rawResponse.data.countContract);
  assert.equal(capture.countContract.candidatePoolId, null);
  internals.recordRuntimeResponseCapture({ status: 'fulfilled', result: { result: rawResponse } }, { auditId, slot: 'initial' });
  internals.state.lifecycle = [
    { timestamp: '2026-08-03T12:00:00.000Z', label: '[RecommendStart]', payload: { auditId, sceneKey: 'sport' } },
    { timestamp: '2026-08-03T12:00:01.000Z', label: '[RecommendResponse]', payload: { auditId, cloudBuild: internals.EXPECTED_CLOUD_BUILD, executionMode: 'full_compute' } },
    { timestamp: '2026-08-03T12:00:01.100Z', label: '[RecommendationQA]', payload: { auditId, version: internals.EXPECTED_QA_VERSION } },
    { timestamp: '2026-08-03T12:00:01.200Z', label: '[RecommendDone]', payload: { auditId } },
  ];
  const requests = internals.buildRequests();
  assert.deepEqual(requests[0].countContract, capture.countContract);
  assert.equal(requests[0].returnedCardCount, 8);
  const summary = internals.buildSummary(requests);
  assert.equal(summary.countContract.status, 'PASSED');
  assert.equal(summary.countContract.protocolPath, 'result.data.countContract');
  assert.deepEqual(summary.countContract.observed[0].value, capture.countContract);
  assert.equal(JSON.stringify(summary).includes('pool-private-id'), false);
});

test('sanitized response evidence preserves the fixed QA gate summary beyond the audit key budget', () => {
  const internals = loadE2eInternals();
  const gate = authoritativeQa({ alternativeCandidateCount: 8, qaTruncated: true });
  const leadingFields = Object.fromEntries(Array.from({ length: 36 }, (_, index) => [`leadingField${index}`, index]));
  const rawResponse = rawRecommendationResponse({
    qaBatchAudit: {
      ...leadingFields,
      qaGateSummary: gate,
    },
  });

  const sanitized = internals.sanitizeResponseForEvidence(rawResponse);
  const summary = sanitized.data.qaBatchAudit.qaGateSummary;
  assert.equal(Object.hasOwn(summary, 'alternativeCandidateCount'), true);
  assert.equal(summary.alternativeCandidateCount, 8);
  assert.equal(typeof summary.alternativeCandidateCount, 'number');
  assert.equal(summary.qaTruncated, true);
});

test('recordLifecycleEvent stores timestamp, auditId, phase, and full sanitized payload', () => {
  const internals = loadE2eInternals();
  internals.recordLifecycleEvent({
    timestamp: '2026-07-22T00:00:00.000Z',
    label: '[RecommendationQA]',
    phase: 'recommendationqa',
    payload: { auditId: 'rec_phase', version: 'eligibility-rejection-audit-v1' },
  });
  assert.equal(internals.state.sanitizedLifecycle.length, 1);
  assert.equal(internals.state.sanitizedLifecycle[0].timestamp, '2026-07-22T00:00:00.000Z');
  assert.equal(internals.state.sanitizedLifecycle[0].auditId, 'rec_phase');
  assert.equal(internals.state.sanitizedLifecycle[0].phase, 'recommendationqa');
  assert.equal(internals.state.sanitizedLifecycle[0].payload.version, 'eligibility-rejection-audit-v1');
});

test('requests retain eligibility aggregate fields after lifecycle compaction', () => {
  const internals = loadE2eInternals();
  const auditId = 'rec_sport_aggregate';
  internals.state.lifecycle = [
    { timestamp: '2026-07-22T00:00:00.000Z', label: '[RecommendStart]', payload: { auditId, sceneKey: 'sport' } },
    { timestamp: '2026-07-22T00:00:05.000Z', label: '[RecommendResponse]', payload: {
      auditId, executionMode: 'full_compute', candidatePoolSaveStatus: 'saved',
    } },
    { timestamp: '2026-07-22T00:00:05.500Z', label: '[RecommendationQA]', payload: {
      auditId,
      version: 'qa-batch-audit-v6-1-semantic-presentation',
      qaGateSummary: authoritativeQa(),
      eligibilityRejectionAudit: {
        rejectionStageHistogram: { scene_eligibility: 132 },
        rejectionReasonHistogram: { SPORT_NON_SPORT_APPAREL: 132 },
        rejectionReasonCombinationHistogram: { SPORT_NON_SPORT_APPAREL: 132 },
        samples: [{ sampleIndex: 0 }],
        serializedBytes: 2345,
        truncated: true,
      },
    } },
    { timestamp: '2026-07-22T00:00:06.000Z', label: '[RecommendDone]', payload: {
      auditId, clientTimings: { cloudRoundTripMs: 100 },
    } },
  ];
  const request = internals.buildRequests()[0];
  assert.deepEqual(request.rejectionStageHistogram, { scene_eligibility: 132 });
  assert.deepEqual(request.rejectionReasonHistogram, { SPORT_NON_SPORT_APPAREL: 132 });
  assert.deepEqual(request.rejectionReasonCombinationHistogram, { SPORT_NON_SPORT_APPAREL: 132 });
  assert.equal(request.eligibilityRejectionSampleCount, 1);
  assert.equal(request.eligibilityRejectionAuditBytes, 2345);
  assert.equal(request.eligibilityRejectionAuditTruncated, true);
});
