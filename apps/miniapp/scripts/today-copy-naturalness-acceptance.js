'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  assertAcceptanceSingleRequest,
  ensureDevToolsDirectSession,
  installAcceptanceSingleRequestGuard,
  readAcceptanceCapture,
  readAcceptanceCumulativeRequestCount,
  readAcceptanceSingleRequestGuard,
  resetAcceptanceSingleRequestGuard,
  unicodeInputPreflight,
  unwrapCloudResponse,
} = require('./devtools-direct-session');
const { validateProductionRequest } = require('./today-full-compute-acceptance');

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..', '..');
const ARTIFACT_ROOT = path.join(REPOSITORY_ROOT, 'artifacts', 'today-copy-naturalness-acceptance');
const SCENES = Object.freeze(['home', 'work', 'date', 'sport']);
const SCENE_TAGS = Object.freeze({ home: '居家', work: '上班', date: '约会', sport: '运动' });
const COPY_CONTRACT_VERSION = 'recommendation-copy-contract-v4';
const NATURALNESS_GATE_VERSION = 'copy-naturalness-gate-v1';
const OLD_EDITORIAL_COPY = /中性色过渡|适合.+场景|配色简洁|整体协调|整体利落|整体更完整|更显质感|已经配齐|已经配上|唯一有明确事实|已经配成上下装|已经配成一身/;
const SCENE_SEMANTIC_TOKENS = Object.freeze({ home: '宅家', work: '通勤', date: '约会', sport: '轻运动' });

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function waitUntil(read, predicate, timeoutMs, label, intervalMs = 150) {
  const deadline = Date.now() + timeoutMs;
  let value;
  do {
    value = await read();
    if (predicate(value)) return value;
    await sleep(intervalMs);
  } while (Date.now() < deadline);
  throw Object.assign(new Error(`${label} timed out`), { lastValue: value });
}

async function readBridge(mini) {
  return mini.evaluate(() => {
    const bridge = globalThis.__d1dTodayDiagnostics;
    return bridge ? {
      marker: bridge.marker,
      copyAcceptanceBuild: bridge.copyAcceptanceBuild,
      ready: bridge.ready,
      sceneKey: bridge.sceneKey,
    } : null;
  });
}

async function readTodayCopyState(mini) {
  return mini.evaluate(() => {
    const bridge = globalThis.__d1dTodayDiagnostics;
    return bridge?.readCopyAcceptanceState ? bridge.readCopyAcceptanceState() : null;
  });
}

async function selectScene(session, scene) {
  const page = await session.mini.currentPage();
  const tabs = await page.$$('.scene-tab');
  const index = SCENES.indexOf(scene);
  if (!tabs[index]) throw new Error(`scene tab unavailable: ${scene}`);
  const bridge = await readBridge(session.mini);
  if (bridge?.sceneKey !== scene) await tabs[index].tap();
  return waitUntil(
    () => readBridge(session.mini),
    (value) => value?.marker === 'd1d-today-production-handler-v1'
      && value.copyAcceptanceBuild === 'today-copy-naturalness-v1'
      && value.ready === true
      && value.sceneKey === scene,
    60000,
    `TODAY_${scene.toUpperCase()}_READY`,
  );
}

async function waitForNetworkIdle(mini) {
  return waitUntil(
    () => readAcceptanceSingleRequestGuard(mini),
    (guard) => guard
      && guard.activeGenerateOutfitCalls === 0
      && typeof guard.quiescenceStartedAt === 'number'
      && Date.now() - guard.quiescenceStartedAt >= guard.quiescenceWindowMs,
    60000,
    'NETWORK_IDLE_READY',
  );
}

async function triggerProductionRequest(mini, identifiers) {
  return mini.evaluate(async (request) => {
    const bridge = globalThis.__d1dTodayDiagnostics;
    if (!bridge || bridge.marker !== 'd1d-today-production-handler-v1') {
      throw new Error('Today production diagnostics bridge is unavailable');
    }
    return bridge.triggerFullCompute(request);
  }, identifiers);
}

async function readUiCards(session) {
  const page = await session.mini.currentPage();
  const cards = await page.$$('.outfit-card');
  return Promise.all(cards.map(async (card, index) => ({
    index,
    title: await readText(await card.$('.outfit-title')),
    todayReason: await readText(await card.$('.reason-text')),
  })));
}

async function readText(element) {
  if (!element) return '';
  return String(await element.text() || '').trim();
}

function auditFinalTodayCopy(scene, data, uiCards) {
  const outfits = Array.isArray(data?.outfits) ? data.outfits : [];
  const uiReasons = uiCards.map((card) => card.todayReason).filter(Boolean);
  const canonicalReasons = outfits.map((outfit) => String(outfit?.copyContract?.todayReason || '').trim());
  const failures = [];
  if (outfits.length < 4) failures.push(`returned_card_count:${outfits.length}`);
  if (uiReasons.length < 4) failures.push(`ui_reason_count:${uiReasons.length}`);
  outfits.forEach((outfit, index) => {
    const contract = outfit?.copyContract || {};
    const provenance = contract.todayCopyProvenance || {};
    const clothingIds = new Set((Array.isArray(outfit?.clothingIds) ? outfit.clothingIds : []).map(String));
    if (![scene, SCENE_TAGS[scene]].includes(outfit.scene)) failures.push(`scene:${index}`);
    if (outfit.copyContractVersion !== COPY_CONTRACT_VERSION || contract.copyContractVersion !== COPY_CONTRACT_VERSION) failures.push(`contract:${index}`);
    if (contract.naturalnessGateVersion !== NATURALNESS_GATE_VERSION || contract.naturalnessGateResult !== 'PASS') failures.push(`naturalness:${index}`);
    if (!Array.isArray(contract.naturalnessRiskFlags) || contract.naturalnessRiskFlags.length > 0) failures.push(`naturalness_flags:${index}`);
    if (!Array.isArray(provenance.clauses) || provenance.clauses.length === 0 || provenance.text !== contract.todayReason) failures.push(`provenance:${index}`);
    if (OLD_EDITORIAL_COPY.test(contract.todayReason || '')) failures.push(`editorial_copy:${index}`);
    if (countText(contract.todayReason || '', SCENE_SEMANTIC_TOKENS[scene]) > 1) failures.push(`repeated_scene_semantics:${index}`);
    if (Number(contract.unsupportedClaimCount) !== 0) failures.push(`unsupported:${index}`);
    for (const clause of Array.isArray(provenance.clauses) ? provenance.clauses : []) {
      if (!Array.isArray(clause.subjectItemIds) || clause.subjectItemIds.some((id) => !clothingIds.has(String(id)))) failures.push(`subject_binding:${index}`);
      if (clause.slot === 'benefit' && (!Array.isArray(clause.evidenceFactIds) || clause.evidenceFactIds.length === 0)) failures.push(`benefit_evidence:${index}`);
    }
  });
  canonicalReasons.slice(0, uiReasons.length).forEach((reason, index) => {
    if (uiReasons[index] !== reason) failures.push(`ui_binding:${index}`);
  });
  return {
    scene,
    passed: failures.length === 0,
    failures: [...new Set(failures)],
    finalCardCount: outfits.length,
    uiCardCount: uiReasons.length,
    samples: uiReasons.slice(0, 8),
  };
}

function countText(value, token) {
  return token ? String(value).split(token).length - 1 : 0;
}

async function captureScene(session, scene, runId) {
  await selectScene(session, scene);
  const selectedState = await readTodayCopyState(session.mini);
  const selectedUiCards = await readUiCards(session);
  await resetAcceptanceSingleRequestGuard(session.mini);
  const baselineCumulativeRequestCount = await readAcceptanceCumulativeRequestCount(session.mini);
  const identifiers = {
    acceptanceRunId: `${runId}-${scene}`,
    captureId: `copy-naturalness-${scene}-${crypto.randomBytes(3).toString('hex')}`,
    weatherModeOverride: 'disabled',
  };
  await installAcceptanceSingleRequestGuard(session.mini, { ...identifiers, baselineCumulativeRequestCount });
  await waitForNetworkIdle(session.mini);
  await triggerProductionRequest(session.mini, identifiers);
  const guard = await waitForNetworkIdle(session.mini);
  const capture = await readAcceptanceCapture(session.mini);
  const finalCumulativeRequestCount = await readAcceptanceCumulativeRequestCount(session.mini);
  assertAcceptanceSingleRequest({
    baselineCumulativeRequestCount,
    finalCumulativeRequestCount,
    capturedRequestCount: guard.capturedRequestCount,
  });
  if (!capture || capture.status !== 'fulfilled') {
    throw Object.assign(new Error(`${scene} production request was not fulfilled: ${capture?.status || 'missing'} ${capture?.error || ''}`), { capture });
  }
  const requestValidation = validateProductionRequest(capture.originalRequestData);
  if (!requestValidation.equivalentToRetryProductionBuilder || capture.originalRequestData.scene !== SCENE_TAGS[scene]) {
    throw Object.assign(new Error(`${scene} did not use the Today production request builder`), { requestValidation });
  }
  const unwrapped = unwrapCloudResponse(capture.rawResponse);
  const responseData = unwrapped?.data;
  const responseHasOutfits = Boolean(responseData && Array.isArray(responseData.outfits));
  const data = responseHasOutfits ? responseData : { outfits: selectedState?.outfits || [] };
  if (!Array.isArray(data.outfits) || data.outfits.length < 4) {
    throw Object.assign(new Error(`${scene} response and Today state are missing four outfits`), { capture, unwrapped, selectedState });
  }
  if (!responseHasOutfits) {
    const fallbackAudit = auditFinalTodayCopy(scene, data, selectedUiCards);
    if (!fallbackAudit.passed) throw Object.assign(new Error(`${scene} selected Today state failed after production scene load`), { audit: fallbackAudit, capture, unwrapped });
    return {
      ...fallbackAudit,
      request: requestValidation.businessRequest,
      requestOutcome: `retry_rejected_after_scene_load:${unwrapped?.message || 'unknown'}`,
      evidenceSource: 'today_state_after_production_scene_load',
    };
  }
  await waitUntil(
    () => readUiCards(session),
    (cards) => cards.filter((card) => card.todayReason).length === data.outfits.length,
    30000,
    `${scene} UI copy commit`,
  );
  const uiCards = await readUiCards(session);
  const audit = auditFinalTodayCopy(scene, data, uiCards);
  if (!audit.passed) throw Object.assign(new Error(`${scene} final Today copy failed`), { audit });
  return { ...audit, request: requestValidation.businessRequest, requestOutcome: 'fulfilled', evidenceSource: 'captured_public_dto_and_ui' };
}

async function runAcceptance() {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const runId = `today-copy-naturalness-${stamp}`;
  const artifactDirectory = path.join(ARTIFACT_ROOT, runId);
  let session;
  try {
    session = await ensureDevToolsDirectSession();
    await session.mini.reLaunch('/pages/today/index');
    await waitUntil(
      () => readBridge(session.mini),
      (bridge) => bridge?.marker === 'd1d-today-production-handler-v1'
        && bridge.copyAcceptanceBuild === 'today-copy-naturalness-v1'
        && bridge.ready === true,
      60000,
      'TODAY_FRESH_BUILD_READY',
    );
    await unicodeInputPreflight(session.mini);
    const scenes = [];
    for (const scene of SCENES) {
      const result = await captureScene(session, scene, runId);
      scenes.push(result);
      process.stdout.write(`${scene.toUpperCase()}_TODAY_COPY_PASS ${JSON.stringify(result.samples.slice(0, 4))}\n`);
    }
    const result = {
      version: 'today-copy-naturalness-acceptance-v1',
      runId,
      passed: scenes.every((scene) => scene.passed && scene.samples.length >= 4),
      scenes,
    };
    fs.mkdirSync(artifactDirectory, { recursive: true });
    fs.writeFileSync(path.join(artifactDirectory, 'acceptance.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    if (!result.passed) throw Object.assign(new Error('COPY_NATURALNESS_ACCEPTANCE_FAILED'), { result });
    process.stdout.write(`COPY_NATURALNESS_REAL_TODAY_PASS ${artifactDirectory}\n`);
    return result;
  } finally {
    if (session?.mini) {
      try { await resetAcceptanceSingleRequestGuard(session.mini); } catch {}
      try { session.mini.disconnect(); } catch {}
    }
  }
}

if (require.main === module) {
  runAcceptance().catch((error) => {
    process.stderr.write(`${error.stack || error.message || error}\n`);
    if (error.audit) process.stderr.write(`${JSON.stringify(error.audit, null, 2)}\n`);
    if (error.capture) process.stderr.write(`${JSON.stringify(error.capture, null, 2)}\n`);
    if (error.unwrapped) process.stderr.write(`${JSON.stringify(error.unwrapped, null, 2)}\n`);
    if (error.requestValidation) process.stderr.write(`${JSON.stringify(error.requestValidation, null, 2)}\n`);
    process.exitCode = 1;
  });
}

module.exports = { OLD_EDITORIAL_COPY, SCENES, auditFinalTodayCopy, runAcceptance };
