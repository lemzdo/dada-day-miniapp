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
const {
  DECISION_VALUE_GATE_VERSION,
  evaluateDecisionValue,
} = require('../cloudfunctions/generateOutfit/services/copyNaturalnessGate');
const {
  SCENE_EVIDENCE_FINGERPRINT,
  SCENE_EVIDENCE_VERSION,
} = require('../cloudfunctions/generateOutfit/services/sceneEvidenceRegistryV4');
const { inspectXiaodaPersonaCopy } = require('../cloudfunctions/generateOutfit/services/xiaodaPersonaContract');

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..', '..');
const ARTIFACT_ROOT = path.join(REPOSITORY_ROOT, 'artifacts', 'today-copy-naturalness-acceptance');
const SCENES = Object.freeze(['home', 'work', 'date', 'sport']);
const SCENE_TAGS = Object.freeze({ home: '居家', work: '上班', date: '约会', sport: '运动' });
const COPY_CONTRACT_VERSION = 'recommendation-copy-contract-v8';
const NATURALNESS_GATE_VERSION = 'copy-naturalness-gate-v3';
const OLD_EDITORIAL_COPY = /中性色过渡|适合.+场景|配色简洁|整体协调|整体利落|整体更完整|更显质感|已经配齐|已经配上|唯一有明确事实|已经配成上下装|已经配成一身/;
const GENERIC_SCENE_FALLBACK = /(?:宅家时|日常通勤|约会时|日常轻运动)可以直接这样穿/;
const SCENE_SEMANTIC_PATTERNS = Object.freeze({
  home: /宅家|居家|在家/g,
  work: /通勤|上班/g,
  date: /约会/g,
  sport: /轻运动|去运动|运动时/g,
});

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
  await session.mini.evaluate(() => {
    globalThis.__d1dTodayDiagnostics?.releaseCaptureLock?.();
  });
  const page = await session.mini.currentPage();
  const tabs = await page.$$('.scene-tab');
  const index = SCENES.indexOf(scene);
  if (!tabs[index]) throw new Error(`scene tab unavailable: ${scene}`);
  const bridge = await readBridge(session.mini);
  if (bridge?.sceneKey !== scene) await tabs[index].tap();
  return waitUntil(
    () => readBridge(session.mini),
    (value) => value?.marker === 'd1d-today-production-handler-v1'
      && value.copyAcceptanceBuild === 'today-copy-naturalness-v3'
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

async function triggerProductionRequest(mini, identifiers, requestKind = 'retry') {
  return mini.evaluate(async (payload) => {
    const bridge = globalThis.__d1dTodayDiagnostics;
    if (!bridge || bridge.marker !== 'd1d-today-production-handler-v1') {
      throw new Error('Today production diagnostics bridge is unavailable');
    }
    return payload.kind === 'refresh'
      ? bridge.triggerRefresh(payload.request)
      : bridge.triggerFullCompute(payload.request);
  }, { request: identifiers, kind: requestKind });
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

function auditFinalTodayCopy(scene, data, uiCards, { requireSceneEvidenceDiagnostics = true } = {}) {
  const outfits = Array.isArray(data?.outfits) ? data.outfits : [];
  const uiReasons = uiCards.map((card) => card.todayReason).filter(Boolean);
  const canonicalReasons = outfits.map((outfit) => String(outfit?.copyContract?.todayReason || '').trim());
  const failures = [];
  const sceneClauses = [];
  const cardDiagnostics = [];
  const sceneAcceptance = data?.debug?.sceneEvidenceAcceptance || null;
  let genericSceneFallbackCount = 0;
  let lowValueFinalReasonCount = 0;
  let omittedLowValueClauseCount = 0;
  let factCorrectnessCount = 0;
  let bindingCorrectnessCount = 0;
  let naturalnessCount = 0;
  let decisionValueCount = 0;
  if (data?.meta?.sceneEvidenceVersion !== SCENE_EVIDENCE_VERSION
    || data?.meta?.sceneEvidenceFingerprint !== SCENE_EVIDENCE_FINGERPRINT) {
    failures.push('scene_evidence_meta_version');
  }
  if (requireSceneEvidenceDiagnostics && (sceneAcceptance?.version !== SCENE_EVIDENCE_VERSION
    || sceneAcceptance?.fingerprint !== SCENE_EVIDENCE_FINGERPRINT)) {
    failures.push('scene_evidence_diagnostic_version');
  }
  if (outfits.length < 8) failures.push(`returned_card_count:${outfits.length}`);
  if (uiReasons.length < 8) failures.push(`ui_reason_count:${uiReasons.length}`);
  outfits.forEach((outfit, index) => {
    const contract = outfit?.copyContract || {};
    const provenance = contract.todayCopyProvenance || {};
    const clauses = Array.isArray(provenance.clauses) ? provenance.clauses : [];
    const clothingIds = new Set((Array.isArray(outfit?.clothingIds) ? outfit.clothingIds : []).map(String));
    const decisionValue = evaluateDecisionValue(provenance);
    const factCorrect = Number(contract.unsupportedClaimCount) === 0;
    const subjectBindingCorrect = clauses.every((clause) => Array.isArray(clause.subjectItemIds)
      && clause.subjectItemIds.every((id) => clothingIds.has(String(id))));
    const uiBindingCorrect = uiReasons[index] === canonicalReasons[index];
    const naturalnessPass = contract.naturalnessGateVersion === NATURALNESS_GATE_VERSION
      && contract.naturalnessGateResult === 'PASS'
      && Array.isArray(contract.naturalnessRiskFlags)
      && contract.naturalnessRiskFlags.length === 0
      && contract.structuralNaturalnessVersion === 'batch-editorial-review-v3'
      && contract.structuralNaturalnessResult === 'PASS'
      && Array.isArray(contract.structuralNaturalnessRiskFlags)
      && contract.structuralNaturalnessRiskFlags.length === 0;
    if (![scene, SCENE_TAGS[scene]].includes(outfit.scene)) failures.push(`scene:${index}`);
    if (outfit.copyContractVersion !== COPY_CONTRACT_VERSION || contract.copyContractVersion !== COPY_CONTRACT_VERSION) failures.push(`contract:${index}`);
    if (!naturalnessPass) failures.push(`naturalness:${index}`);
    if (clauses.length === 0 || provenance.text !== contract.todayReason) failures.push(`provenance:${index}`);
    if (OLD_EDITORIAL_COPY.test(contract.todayReason || '')) failures.push(`editorial_copy:${index}`);
    if (GENERIC_SCENE_FALLBACK.test(contract.todayReason || '')) {
      genericSceneFallbackCount += 1;
      failures.push(`generic_scene_fallback:${index}`);
    }
    if (countSceneSemantics(contract.todayReason || '', scene) > 1) failures.push(`repeated_scene_semantics:${index}`);
    if (!factCorrect) failures.push(`unsupported:${index}`);
    if (!subjectBindingCorrect) failures.push(`subject_binding:${index}`);
    if (!uiBindingCorrect) failures.push(`ui_binding:${index}`);
    if (decisionValue.version !== DECISION_VALUE_GATE_VERSION || decisionValue.result !== 'PASS') {
      lowValueFinalReasonCount += 1;
      failures.push(`decision_value:${index}`);
    }
    if (factCorrect) factCorrectnessCount += 1;
    if (subjectBindingCorrect && uiBindingCorrect) bindingCorrectnessCount += 1;
    if (naturalnessPass) naturalnessCount += 1;
    if (decisionValue.result === 'PASS') decisionValueCount += 1;
    const emittedSceneClauses = clauses.filter((clause) => (
      ['core_eligibility', 'evidence_composition'].includes(clause.source)
    ));
    sceneClauses.push(...emittedSceneClauses.map((clause) => String(clause.text || '').trim()).filter(Boolean));
    if (contract.coreEligibilityReasonCode && emittedSceneClauses.length === 0) omittedLowValueClauseCount += 1;
    cardDiagnostics.push({
      index,
      todayReason: String(contract.todayReason || '').trim(),
      coreEligibilityReasonCode: String(contract.coreEligibilityReasonCode || '').trim(),
      coreEligibilitySubjectItemIds: contract.coreEligibilitySubjectItemIds || [],
      coreEligibilitySupportingFactIds: contract.coreEligibilitySupportingFactIds || [],
      coreEligibilityRelationFactIds: contract.coreEligibilityRelationFactIds || [],
      coreEligibilitySourceRule: contract.coreEligibilitySourceRule || '',
      coreEligibilitySourceRuleReasons: contract.coreEligibilitySourceRuleReasons || [],
      coreEligibilityEvidence: contract.coreEligibilityEvidence || [],
      clauses,
      decisionValue,
      factCorrect,
      bindingCorrect: subjectBindingCorrect && uiBindingCorrect,
      naturalnessPass,
      structuralNaturalnessVersion: contract.structuralNaturalnessVersion,
      structuralNaturalnessResult: contract.structuralNaturalnessResult,
      structuralNaturalnessWarningFlags: contract.structuralNaturalnessWarningFlags || [],
      xiaodaPrimaryInsightCode: contract.xiaodaStyleInsight?.primary?.code || null,
      xiaodaPrimaryRelationCode: contract.xiaodaStyleInsight?.primary?.relationCode || null,
    });
    for (const clause of clauses) {
      if (clause.slot === 'benefit' && (!Array.isArray(clause.evidenceFactIds) || clause.evidenceFactIds.length === 0)) failures.push(`benefit_evidence:${index}`);
    }
  });
  return {
    scene,
    passed: failures.length === 0,
    failures: [...new Set(failures)],
    finalCardCount: outfits.length,
    uiCardCount: uiReasons.length,
    samples: uiReasons.slice(0, 8),
    finalCopies: uiReasons,
    sceneClauses,
    cardDiagnostics,
    blackBoxCards: outfits.map((outfit, index) => ({
      scene,
      garments: visibleGarments(outfit),
      today: uiReasons[index] || '',
    })),
    genericSceneFallbackCount,
    lowValueFinalReasonCount,
    omittedLowValueClauseCount,
    factCorrectnessCount,
    bindingCorrectnessCount,
    naturalnessCount,
    decisionValueCount,
    sceneEvidence: sceneAcceptance,
    finalSceneFitScores: outfits.map((outfit) => Number(outfit?.scores?.sceneFitScore ?? outfit?.scores?.sceneMatch) || 0),
  };
}

function buildCrossSceneComparisons(scenes) {
  const byOutfitKey = new Map();
  for (const scene of Array.isArray(scenes) ? scenes : []) {
    for (const candidate of scene?.sceneEvidence?.candidates || []) {
      if (!candidate?.outfitKey) continue;
      const entries = byOutfitKey.get(candidate.outfitKey) || [];
      entries.push({
        scene: scene.scene,
        rank: candidate.rank,
        sceneFitScore: candidate.sceneFitScore,
        selected: candidate.selected === true,
        positiveFamilies: candidate.positiveFamilies || [],
        negativeFamilies: candidate.negativeFamilies || [],
      });
      byOutfitKey.set(candidate.outfitKey, entries);
    }
  }
  return [...byOutfitKey.entries()]
    .filter(([, entries]) => entries.length >= 2)
    .map(([outfitKey, entries]) => ({
      outfitKey,
      scenes: entries.sort((left, right) => SCENES.indexOf(left.scene) - SCENES.indexOf(right.scene)),
      sceneFitSpread: Math.max(...entries.map((entry) => entry.sceneFitScore))
        - Math.min(...entries.map((entry) => entry.sceneFitScore)),
    }))
    .sort((left, right) => right.sceneFitSpread - left.sceneFitSpread
      || right.scenes.length - left.scenes.length
      || left.outfitKey.localeCompare(right.outfitKey))
    .slice(0, 12);
}

function summarizeNaturalnessMetrics(scenes) {
  const entries = Array.isArray(scenes) ? scenes : [];
  const finalCopies = entries.flatMap((scene) => Array.isArray(scene.finalCopies) ? scene.finalCopies : []);
  const sceneClauses = entries.flatMap((scene) => Array.isArray(scene.sceneClauses) ? scene.sceneClauses : []);
  const totalCardCount = finalCopies.length;
  const genericSceneFallbackCount = entries.reduce((sum, scene) => sum + Number(scene.genericSceneFallbackCount || 0), 0);
  const lowValueFinalReasonCount = entries.reduce((sum, scene) => sum + Number(scene.lowValueFinalReasonCount || 0), 0);
  const omittedLowValueClauseCount = entries.reduce((sum, scene) => sum + Number(scene.omittedLowValueClauseCount || 0), 0);
  return {
    totalCardCount,
    emittedSceneClauseCount: sceneClauses.length,
    exactSceneClauseDuplicateRate: duplicateRate(sceneClauses),
    exactFullCopyDuplicateRate: duplicateRate(finalCopies),
    fullReasonDuplicateRate: duplicateRate(finalCopies),
    genericSceneFallbackCount,
    genericSceneFallbackUsageRate: totalCardCount > 0 ? genericSceneFallbackCount / totalCardCount : 0,
    genericSceneFallbackRate: totalCardCount > 0 ? genericSceneFallbackCount / totalCardCount : 0,
    lowValueFinalReasonCount,
    lowValueFinalReasonRate: totalCardCount > 0 ? lowValueFinalReasonCount / totalCardCount : 0,
    omittedLowValueClauseCount,
    factCorrectnessCount: entries.reduce((sum, scene) => sum + Number(scene.factCorrectnessCount || 0), 0),
    bindingCorrectnessCount: entries.reduce((sum, scene) => sum + Number(scene.bindingCorrectnessCount || 0), 0),
    naturalnessCount: entries.reduce((sum, scene) => sum + Number(scene.naturalnessCount || 0), 0),
    decisionValueCount: entries.reduce((sum, scene) => sum + Number(scene.decisionValueCount || 0), 0),
  };
}

function duplicateRate(values) {
  const list = (Array.isArray(values) ? values : []).map((value) => String(value || '').trim()).filter(Boolean);
  return list.length > 0 ? (list.length - new Set(list).size) / list.length : 0;
}

function countSceneSemantics(value, scene) {
  return (String(value).match(SCENE_SEMANTIC_PATTERNS[scene]) || []).length;
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
  };
  await installAcceptanceSingleRequestGuard(session.mini, { ...identifiers, baselineCumulativeRequestCount });
  await waitForNetworkIdle(session.mini);
  const productionApplied = await triggerProductionRequest(session.mini, identifiers);
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
  if (!Array.isArray(data.outfits) || data.outfits.length < 8) {
    throw Object.assign(new Error(`${scene} response and Today state are missing eight outfits`), { capture, unwrapped, selectedState });
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
  const canonicalReasons = data.outfits.map((outfit) => String(outfit?.copyContract?.todayReason || '').trim());
  try {
    await waitUntil(
      () => readUiCards(session),
      (cards) => cards.length === canonicalReasons.length
        && cards.every((card, index) => card.todayReason === canonicalReasons[index]),
      30000,
      `${scene} exact UI copy commit`,
    );
  } catch (error) {
    error.detail = {
      scene,
      canonicalReasons,
      uiCards: await readUiCards(session),
      todayState: (await readTodayCopyState(session.mini))?.outfits.map((outfit) => ({
        outfitKey: outfit.outfitKey,
        todayReason: outfit.copyContract?.todayReason,
      })),
      productionApplied,
      recommendationConsoleEvents: (session.recommendationConsoleEvents || []).slice(-20),
    };
    throw error;
  }
  const uiCards = await readUiCards(session);
  const audit = auditFinalTodayCopy(scene, data, uiCards);
  if (!audit.passed) throw Object.assign(new Error(`${scene} final Today copy failed`), { audit });
  const firstBatch = {
    ...audit,
    batch: 1,
    request: requestValidation.businessRequest,
    requestOutcome: 'fulfilled',
    evidenceSource: 'captured_public_dto_and_ui',
  };
  const secondBatch = await captureSecondProductionBatch(session, scene, runId);
  return combineSceneBatches(firstBatch, secondBatch);
}

async function captureSecondProductionBatch(session, scene, runId) {
  const refreshBatch = await captureRefreshBatch(session, scene, runId);
  if (refreshBatch.supported === true) return refreshBatch;
  return captureWeatherFallbackBatch(session, scene, runId, refreshBatch.reason);
}

async function captureWeatherFallbackBatch(session, scene, runId, refreshReason) {
  await resetAcceptanceSingleRequestGuard(session.mini);
  const baselineCumulativeRequestCount = await readAcceptanceCumulativeRequestCount(session.mini);
  const identifiers = {
    acceptanceRunId: `${runId}-${scene}-weather-fallback`,
    captureId: `copy-naturalness-${scene}-weather-fallback-${crypto.randomBytes(3).toString('hex')}`,
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
    throw Object.assign(new Error(`${scene} weather-fallback request was not fulfilled: ${capture?.status || 'missing'} ${capture?.error || ''}`), { capture });
  }
  const requestValidation = validateProductionRequest(capture.originalRequestData);
  const request = requestValidation.businessRequest;
  const fallbackBuilderValid = requestValidation.equivalentToRetryProductionBuilder
    && request.scene === SCENE_TAGS[scene]
    && request.weatherMode === 'disabled'
    && request.maxResults === 8;
  if (!fallbackBuilderValid) {
    throw Object.assign(new Error(`${scene} did not use the production retry builder for the weather fallback`), { requestValidation });
  }
  const data = unwrapCloudResponse(capture.rawResponse)?.data;
  if (!data || !Array.isArray(data.outfits) || data.outfits.length < 8) {
    throw Object.assign(new Error(`${scene} weather-fallback response is missing eight outfits`), { capture });
  }
  const canonicalReasons = data.outfits.map((outfit) => String(outfit?.copyContract?.todayReason || '').trim());
  await waitUntil(
    () => readUiCards(session),
    (cards) => cards.length === canonicalReasons.length
      && cards.every((card, index) => card.todayReason === canonicalReasons[index]),
    30000,
    `${scene} weather-fallback exact UI copy commit`,
  );
  const audit = auditFinalTodayCopy(scene, data, await readUiCards(session), {
    requireSceneEvidenceDiagnostics: false,
  });
  if (!audit.passed) throw Object.assign(new Error(`${scene} weather-fallback Today batch failed`), { audit });
  return {
    ...audit,
    batch: 2,
    supported: true,
    request,
    requestOutcome: 'fulfilled',
    evidenceSource: 'captured_weather_fallback_public_dto_and_ui',
    refreshFallbackReason: refreshReason || 'refresh_not_available',
  };
}

async function captureRefreshBatch(session, scene, runId) {
  await resetAcceptanceSingleRequestGuard(session.mini);
  const baselineCumulativeRequestCount = await readAcceptanceCumulativeRequestCount(session.mini);
  const identifiers = {
    acceptanceRunId: `${runId}-${scene}-refresh`,
    captureId: `copy-naturalness-${scene}-refresh-${crypto.randomBytes(3).toString('hex')}`,
  };
  await installAcceptanceSingleRequestGuard(session.mini, { ...identifiers, baselineCumulativeRequestCount });
  await waitForNetworkIdle(session.mini);
  const triggered = await triggerProductionRequest(session.mini, identifiers, 'refresh');
  if (!triggered) {
    return { batch: 2, supported: false, reason: 'candidate_pool_exhausted_before_refresh' };
  }
  const guard = await waitForNetworkIdle(session.mini);
  const capture = await readAcceptanceCapture(session.mini);
  const finalCumulativeRequestCount = await readAcceptanceCumulativeRequestCount(session.mini);
  assertAcceptanceSingleRequest({
    baselineCumulativeRequestCount,
    finalCumulativeRequestCount,
    capturedRequestCount: guard.capturedRequestCount,
  });
  if (!capture || capture.status !== 'fulfilled') {
    throw Object.assign(new Error(`${scene} refresh request was not fulfilled: ${capture?.status || 'missing'} ${capture?.error || ''}`), { capture });
  }
  const requestValidation = validateProductionRequest(capture.originalRequestData);
  const request = requestValidation.businessRequest;
  const refreshBuilderValid = request.trigger === 'refresh'
    && request.scene === SCENE_TAGS[scene]
    && request.maxResults === 8
    && typeof request.recommendationBatchId === 'string'
    && request.recommendationBatchId.length > 0
    && Array.isArray(request.excludedOutfitKeys)
    && request.excludedOutfitKeys.length > 0
    && requestValidation.missingFields.length === 0
    && requestValidation.unicodeValid;
  if (!refreshBuilderValid) {
    throw Object.assign(new Error(`${scene} did not use the Today production refresh builder`), { requestValidation });
  }
  const data = unwrapCloudResponse(capture.rawResponse)?.data;
  if (!data || !Array.isArray(data.outfits) || data.outfits.length === 0) {
    return {
      batch: 2,
      supported: false,
      reason: 'candidate_pool_exhausted_on_refresh',
      request,
      countContract: data?.countContract || null,
    };
  }
  if (data.outfits.length < 8) {
    return {
      batch: 2,
      supported: false,
      reason: 'candidate_pool_partial_tail',
      request,
      countContract: data.countContract || null,
    };
  }
  await waitUntil(
    () => readUiCards(session),
    (cards) => cards.filter((card) => card.todayReason).length === data.outfits.length,
    30000,
    `${scene} refresh UI copy commit`,
  );
  const audit = auditFinalTodayCopy(scene, data, await readUiCards(session), {
    requireSceneEvidenceDiagnostics: false,
  });
  if (!audit.passed) throw Object.assign(new Error(`${scene} second Today batch failed`), { audit });
  return {
    ...audit,
    batch: 2,
    supported: true,
    request,
    requestOutcome: 'fulfilled',
    evidenceSource: 'captured_refresh_public_dto_and_ui',
  };
}

function combineSceneBatches(firstBatch, secondBatch) {
  const captured = [firstBatch, secondBatch].filter((batch) => batch?.supported !== false);
  const secondSupported = secondBatch?.supported === true;
  return {
    ...firstBatch,
    passed: captured.every((batch) => batch.passed),
    batches: [firstBatch, secondBatch],
    secondBatchSupported: secondSupported,
    secondBatchReason: secondSupported ? '' : secondBatch?.reason || 'not_captured',
    secondBatchSamples: secondSupported ? secondBatch.samples : [],
    finalCopies: captured.flatMap((batch) => batch.finalCopies || []),
    sceneClauses: captured.flatMap((batch) => batch.sceneClauses || []),
    cardDiagnostics: captured.flatMap((batch) => batch.cardDiagnostics || []),
    finalCardCount: captured.reduce((sum, batch) => sum + Number(batch.finalCardCount || 0), 0),
    uiCardCount: captured.reduce((sum, batch) => sum + Number(batch.uiCardCount || 0), 0),
    genericSceneFallbackCount: captured.reduce((sum, batch) => sum + Number(batch.genericSceneFallbackCount || 0), 0),
    lowValueFinalReasonCount: captured.reduce((sum, batch) => sum + Number(batch.lowValueFinalReasonCount || 0), 0),
    omittedLowValueClauseCount: captured.reduce((sum, batch) => sum + Number(batch.omittedLowValueClauseCount || 0), 0),
    factCorrectnessCount: captured.reduce((sum, batch) => sum + Number(batch.factCorrectnessCount || 0), 0),
    bindingCorrectnessCount: captured.reduce((sum, batch) => sum + Number(batch.bindingCorrectnessCount || 0), 0),
    naturalnessCount: captured.reduce((sum, batch) => sum + Number(batch.naturalnessCount || 0), 0),
    decisionValueCount: captured.reduce((sum, batch) => sum + Number(batch.decisionValueCount || 0), 0),
  };
}

function auditDetailSamples(samples) {
  const entries = Array.isArray(samples) ? samples : [];
  const failures = [];
  const sceneCounts = Object.fromEntries(SCENES.map((scene) => [scene, 0]));
  entries.forEach((sample, index) => {
    const scene = String(sample?.scene || '');
    if (Object.prototype.hasOwnProperty.call(sceneCounts, scene)) sceneCounts[scene] += 1;
    else failures.push(`unknown_scene:${index}`);
    const todayReason = String(sample?.todayReason || '').trim();
    const coreReason = String(sample?.coreReason || '').trim();
    const deterministicDetail = String(sample?.defaultDetail || '').trim();
    const paragraphs = Array.isArray(sample?.paragraphs)
      ? sample.paragraphs.map((value) => String(value || '').trim()).filter(Boolean)
      : [];
    const advice = String(sample?.advice || '').trim();
    const commentary = [...paragraphs, advice].filter(Boolean).join(' ');
    if (!todayReason || coreReason !== todayReason) failures.push(`today_detail_binding:${index}`);
    if (!deterministicDetail) failures.push(`deterministic_detail_empty:${index}`);
    if (deterministicDetail === todayReason) failures.push(`deterministic_detail_no_increment:${index}`);
    if (deterministicDetail && !inspectXiaodaPersonaCopy(deterministicDetail).passed) failures.push(`deterministic_detail_persona:${index}`);
    if (paragraphs.length === 0) failures.push(`ai_commentary_empty:${index}`);
    if (commentary === todayReason || commentary === deterministicDetail) {
      failures.push(`ai_commentary_no_increment:${index}`);
    }
    if (!inspectXiaodaPersonaCopy(commentary).passed) failures.push(`ai_commentary_persona:${index}`);
  });
  for (const scene of SCENES) {
    if (sceneCounts[scene] < 2) failures.push(`detail_scene_count:${scene}:${sceneCounts[scene]}`);
  }
  return {
    passed: failures.length === 0,
    failures: [...new Set(failures)],
    sampleCount: entries.length,
    sceneCounts,
  };
}

function buildBlackBoxEditorialReview(scenes, detailSamples) {
  const todayCards = (Array.isArray(scenes) ? scenes : []).flatMap((scene) => {
    const batches = Array.isArray(scene?.batches) ? scene.batches : [scene];
    return batches.flatMap((batch) => (Array.isArray(batch?.blackBoxCards) ? batch.blackBoxCards : []));
  });
  const threeLayerComparisons = (Array.isArray(detailSamples) ? detailSamples : []).map((sample) => ({
    scene: String(sample?.scene || ''),
    garments: uniqueVisibleStrings([sample?.title]),
    today: String(sample?.todayReason || '').trim(),
    detail: String(sample?.defaultDetail || '').trim(),
    aiCommentary: (Array.isArray(sample?.paragraphs) ? sample.paragraphs : [])
      .map((value) => String(value || '').trim()).filter(Boolean).join(' '),
    advice: String(sample?.advice || '').trim(),
  }));
  return { todayCards, threeLayerComparisons };
}

function auditBlackBoxEditorialReview(review) {
  const todayCards = Array.isArray(review?.todayCards) ? review.todayCards : [];
  const comparisons = Array.isArray(review?.threeLayerComparisons) ? review.threeLayerComparisons : [];
  const failures = [];
  const allowedTodayKeys = ['scene', 'garments', 'today'];
  const allowedComparisonKeys = ['scene', 'garments', 'today', 'detail', 'aiCommentary', 'advice'];
  if (todayCards.length < 64) failures.push(`today_black_box_count:${todayCards.length}`);
  if (comparisons.length < 8) failures.push(`three_layer_black_box_count:${comparisons.length}`);
  todayCards.forEach((card, index) => {
    if (!sameKeys(card, allowedTodayKeys)) failures.push(`today_hidden_context:${index}`);
    if (!Array.isArray(card.garments) || card.garments.length === 0) failures.push(`today_garments:${index}`);
    if (!card.today || !inspectXiaodaPersonaCopy(card.today).passed) failures.push(`today_persona:${index}`);
  });
  comparisons.forEach((sample, index) => {
    if (!sameKeys(sample, allowedComparisonKeys)) failures.push(`comparison_hidden_context:${index}`);
    if (!sample.today || !sample.detail || !sample.aiCommentary) failures.push(`comparison_incomplete:${index}`);
    if (sample.detail === sample.today) failures.push(`detail_repeats_today:${index}`);
    if (sample.aiCommentary === sample.today || sample.aiCommentary === sample.detail) failures.push(`ai_repeats_visible_copy:${index}`);
    for (const text of [sample.today, sample.detail, sample.aiCommentary, sample.advice].filter(Boolean)) {
      if (!inspectXiaodaPersonaCopy(text).passed) failures.push(`comparison_persona:${index}`);
    }
  });
  for (const scene of SCENES) {
    const count = comparisons.filter((sample) => sample.scene === scene).length;
    if (count < 2) failures.push(`comparison_scene_count:${scene}:${count}`);
  }
  return {
    passed: failures.length === 0,
    failures: [...new Set(failures)],
    todayCount: todayCards.length,
    comparisonCount: comparisons.length,
  };
}

function visibleGarments(outfit) {
  const contentPlanItems = Array.isArray(outfit?.contentPlan?.items) ? outfit.contentPlan.items : [];
  if (contentPlanItems.length > 0) return uniqueVisibleStrings(contentPlanItems.map((item) => item?.displayName));
  const items = [
    ...(Array.isArray(outfit?.snapshotItems) ? outfit.snapshotItems : []),
    ...(Array.isArray(outfit?.itemsSnapshot) ? outfit.itemsSnapshot : []),
    ...(Array.isArray(outfit?.items) ? outfit.items : []),
  ];
  return uniqueVisibleStrings(items.map((item) => item?.name || item?.subcategory || item?.subCategory || item?.category));
}

function uniqueVisibleStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || '').trim()).filter(Boolean))];
}

function sameKeys(value, expected) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify(expected.slice().sort()));
}

async function readDetailUiState(mini) {
  const page = await mini.currentPage();
  const paragraphElements = await page.$$('.ai-comment-reason');
  const paragraphs = [];
  for (const element of paragraphElements) {
    const value = await readText(element);
    if (value) paragraphs.push(value);
  }
  return {
    coreReason: await readText(await page.$('.core-reason-text')),
    defaultDetail: await readText(await page.$('.core-reason-detail')),
    paragraphs,
    advice: await readText(await page.$('.ai-comment-tip')),
    status: await readText(await page.$('.ai-comment-status')),
    buttonText: await readText(await page.$('.ai-comment-btn-text')),
  };
}

async function installAiReviewCapture(mini) {
  return mini.evaluate(() => {
    const globalObject = globalThis;
    const previous = globalObject.__d1dAiReviewCapture;
    if (previous?.targets && typeof previous.targets === 'object') {
      Object.values(previous.targets).forEach((entry) => {
        try {
          if (entry.target?.callFunction === entry.wrapper) entry.target.callFunction = entry.original;
        } catch {}
      });
    }
    const capture = { calls: [], targets: {} };
    const targets = [
      { target: globalObject.wx?.cloud, name: 'wx.cloud.callFunction' },
      { target: globalObject.Taro?.cloud, name: 'Taro.cloud.callFunction' },
      { target: globalObject.taro?.cloud, name: 'taro.cloud.callFunction' },
    ];
    const installed = new Set();
    const clone = (value) => {
      try { return JSON.parse(JSON.stringify(value)); } catch { return null; }
    };
    targets.forEach((entry) => {
      if (!entry.target || typeof entry.target.callFunction !== 'function' || installed.has(entry.target)) return;
      installed.add(entry.target);
      const original = entry.target.callFunction;
      const wrapper = function aiReviewCaptureCallFunction(callOptions = {}) {
        const action = callOptions?.data?.action;
        const observed = callOptions.name === 'generateOutfit' && ['getAiComment', 'aiComment'].includes(action);
        const record = observed ? { action, target: entry.name, status: 'pending', requestData: clone(callOptions.data) } : null;
        if (record) capture.calls.push(record);
        let result;
        try {
          result = original.apply(this, arguments);
        } catch (error) {
          if (record) {
            record.status = 'rejected';
            record.error = { message: String(error?.message || error), data: clone(error?.data), code: error?.code, errMsg: error?.errMsg };
          }
          throw error;
        }
        return Promise.resolve(result).then(
          (value) => {
            if (record) {
              record.status = 'fulfilled';
              record.rawResponse = clone(value);
            }
            return value;
          },
          (error) => {
            if (record) {
              record.status = 'rejected';
              record.error = { message: String(error?.message || error), data: clone(error?.data), code: error?.code, errMsg: error?.errMsg };
            }
            throw error;
          },
        );
      };
      entry.target.callFunction = wrapper;
      capture.targets[entry.name] = { target: entry.target, original, wrapper };
    });
    Object.defineProperty(globalObject, '__d1dAiReviewCapture', {
      configurable: true,
      enumerable: false,
      writable: true,
      value: capture,
    });
    return { installedTargets: Object.keys(capture.targets) };
  });
}

async function readAiReviewCapture(mini) {
  return mini.evaluate(() => {
    const calls = globalThis.__d1dAiReviewCapture?.calls;
    if (!Array.isArray(calls)) return [];
    return calls.map((call) => {
      const data = call.rawResponse?.result?.data;
      const aiComment = data?.aiComment;
      const review = data?.review;
      return {
        action: call.action,
        target: call.target,
        status: call.status,
        primaryInsightCode: call.requestData?.outfit?.contentPlan?.xiaodaStyleInsight?.primary?.code || '',
        ...(call.error ? { error: call.error } : {}),
        ...(data ? {
          response: {
            success: data.success === true,
            source: data.source || '',
            reviewSource: data.reviewSource || review?.reviewSource || '',
            errorCode: data.errorCode || '',
            message: data.message || '',
            saved: data.saved === true,
            stale: data.stale === true,
            inProgress: data.inProgress === true,
            cooldown: data.cooldown === true,
            aiComment: aiComment ? {
              reason: aiComment.reason || aiComment.overallComment || '',
              tip: aiComment.tip || aiComment.advice || '',
              source: aiComment.reviewSource || aiComment.source || '',
              inputDigest: aiComment.inputDigest || '',
            } : null,
            review: review ? {
              status: review.status || '',
              source: review.reviewSource || review.source || '',
              inputDigest: review.inputDigest || review.inputHash || '',
            } : null,
            aiReviewDebug: data.aiReviewDebug || null,
          },
        } : {}),
      };
    });
  });
}

async function moveToTodayCard(mini, index) {
  const page = await mini.currentPage();
  const swiper = await page.$('.outfit-swiper');
  if (!swiper) throw new Error('Today outfit swiper is unavailable');
  await swiper.swipeTo(index);
  await waitUntil(
    async () => {
      const currentPage = await mini.currentPage();
      const currentSwiper = await currentPage.$('.outfit-swiper');
      if (!currentSwiper) return null;
      return Number(await currentSwiper.property('current'));
    },
    (current) => current === index,
    12000,
    `TODAY_CARD_${index + 1}_ACTIVE`,
  );
  const cards = await (await mini.currentPage()).$$('.outfit-card');
  const card = cards[index];
  if (!card) throw new Error(`Today card ${index + 1} is unavailable`);
  return {
    title: await readText(await card.$('.outfit-title')),
    todayReason: await readText(await card.$('.reason-text')),
  };
}

async function captureSceneDetailSamples(session, scene) {
  await resetAcceptanceSingleRequestGuard(session.mini);
  const samples = [];
  for (const index of [0, 1]) {
    const today = await moveToTodayCard(session.mini, index);
    const page = await session.mini.currentPage();
    const detailButton = await page.$('.action-btn.detail');
    if (!detailButton) throw new Error(`${scene} card ${index + 1} detail action is unavailable`);
    await installAiReviewCapture(session.mini);
    await detailButton.tap();
    await waitUntil(
      async () => (await session.mini.currentPage()).path,
      (pathValue) => pathValue === 'pages/outfit-detail/index',
      12000,
      `${scene} card ${index + 1} detail page`,
    );
    let detail;
    try {
      detail = await waitUntil(
        () => readDetailUiState(session.mini),
        (value) => value.paragraphs.length > 0,
        5000,
        `${scene} card ${index + 1} cached AI commentary`,
      );
    } catch {
      const detailPage = await session.mini.currentPage();
      const generateButton = await detailPage.$('.ai-comment-btn');
      if (!generateButton) throw new Error(`${scene} card ${index + 1} AI commentary action is unavailable`);
      await generateButton.tap();
      detail = await waitUntil(
        () => readDetailUiState(session.mini),
        (value) => value.paragraphs.length > 0 || Boolean(value.status),
        120000,
        `${scene} card ${index + 1} AI commentary`,
        400,
      );
    }
    if (detail.paragraphs.length === 0) {
      const aiReviewCalls = await readAiReviewCapture(session.mini);
      throw Object.assign(new Error(`${scene} card ${index + 1} real AI commentary failed`), {
        detail: { ...detail, aiReviewCalls },
      });
    }
    const commentary = [...detail.paragraphs, detail.advice].filter(Boolean).join(' ');
    const persona = inspectXiaodaPersonaCopy(commentary);
    if (detail.coreReason !== today.todayReason) {
      throw Object.assign(new Error(`${scene} card ${index + 1} Today/Detail reason binding drift`), { today, detail });
    }
    if (!persona.passed) {
      throw Object.assign(new Error(`${scene} card ${index + 1} Detail commentary violates Xiaoda persona`), { today, detail, persona });
    }
    samples.push({
      scene,
      cardIndex: index + 1,
      title: today.title,
      todayReason: today.todayReason,
      ...detail,
      aiReviewCalls: await readAiReviewCapture(session.mini),
    });
    await session.mini.navigateBack();
    await waitUntil(
      async () => (await session.mini.currentPage()).path,
      (pathValue) => pathValue === 'pages/today/index',
      12000,
      `${scene} card ${index + 1} return Today`,
    );
  }
  return samples;
}

async function runAcceptance() {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const runId = `today-copy-naturalness-${stamp}`;
  const artifactDirectory = path.join(ARTIFACT_ROOT, runId);
  let session;
  try {
    session = await ensureDevToolsDirectSession();
    session.recommendationConsoleEvents = [];
    session.mini.on('console', (event) => {
      try {
        const serialized = JSON.stringify(event);
        if (/\[Recommend(?:Start|Response|Reject|Error|Done)\]/.test(serialized)) {
          session.recommendationConsoleEvents.push(JSON.parse(serialized));
        }
      } catch {}
    });
    await session.mini.reLaunch('/pages/today/index');
    await waitUntil(
      () => readBridge(session.mini),
      (bridge) => bridge?.marker === 'd1d-today-production-handler-v1'
        && bridge.copyAcceptanceBuild === 'today-copy-naturalness-v3'
        && bridge.ready === true,
      60000,
      'TODAY_FRESH_BUILD_READY',
    );
    await unicodeInputPreflight(session.mini);
    const scenes = [];
    const detailSamples = [];
    for (const scene of SCENES) {
      const result = await captureScene(session, scene, runId);
      scenes.push(result);
      process.stdout.write(`${scene.toUpperCase()}_TODAY_COPY_PASS ${JSON.stringify(result.samples)}\n`);
      process.stdout.write(`${scene.toUpperCase()}_TODAY_COPY_SECOND_BATCH ${result.secondBatchSupported ? JSON.stringify(result.secondBatchSamples) : result.secondBatchReason}\n`);
      const details = await captureSceneDetailSamples(session, scene);
      detailSamples.push(...details);
      process.stdout.write(`${scene.toUpperCase()}_DETAIL_XIAODA_PASS ${JSON.stringify(details)}\n`);
    }
    const detailAudit = auditDetailSamples(detailSamples);
    const blackBoxReview = buildBlackBoxEditorialReview(scenes, detailSamples);
    const blackBoxAudit = auditBlackBoxEditorialReview(blackBoxReview);
    const result = {
      version: 'today-copy-naturalness-acceptance-v1',
      runId,
      passed: scenes.every((scene) => scene.passed && scene.samples.length >= 8
        && scene.secondBatchSupported && scene.secondBatchSamples.length >= 8)
        && detailAudit.passed
        && blackBoxAudit.passed,
      scenes,
      detailSamples,
      detailAudit,
      blackBoxReview,
      blackBoxAudit,
      metrics: summarizeNaturalnessMetrics(scenes),
      crossSceneComparisons: buildCrossSceneComparisons(scenes),
    };
    fs.mkdirSync(artifactDirectory, { recursive: true });
    fs.writeFileSync(path.join(artifactDirectory, 'acceptance.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    if (!result.passed) throw Object.assign(new Error('COPY_NATURALNESS_ACCEPTANCE_FAILED'), { result });
    process.stdout.write(`COPY_NATURALNESS_REAL_TODAY_PASS ${artifactDirectory}\n`);
    return result;
  } finally {
    if (session?.mini) {
      try { await resetAcceptanceSingleRequestGuard(session.mini); } catch {}
      try {
        await session.mini.evaluate(() => globalThis.__d1dTodayDiagnostics?.releaseCaptureLock?.());
      } catch {}
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
    if (error.details) process.stderr.write(`${JSON.stringify(error.details, null, 2)}\n`);
    if (error.detail) process.stderr.write(`${JSON.stringify(error.detail, null, 2)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  GENERIC_SCENE_FALLBACK,
  OLD_EDITORIAL_COPY,
  SCENES,
  auditDetailSamples,
  auditFinalTodayCopy,
  auditBlackBoxEditorialReview,
  buildBlackBoxEditorialReview,
  buildCrossSceneComparisons,
  runAcceptance,
  summarizeNaturalnessMetrics,
};
