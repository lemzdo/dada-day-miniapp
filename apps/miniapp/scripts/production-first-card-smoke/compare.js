'use strict';

const fs = require('node:fs');
const { isDeepStrictEqual } = require('node:util');
const { buildTimeline } = require('./evidence');

const MODES = ['miss', 'hit'];
const validTime = (value) => Number.isFinite(value) && value >= 0;
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;

function phaseRequest(report, mode) {
  const requests = Array.isArray(report?.requests) ? report.requests : [];
  // An explicit HIT check is stricter than the cache-locating baseline.
  return requests.find((entry) => entry.phase === mode)
    || requests.find((entry) => entry.mode === mode);
}

function phaseTimeline(report, mode) {
  const request = phaseRequest(report, mode);
  const timeline = buildTimeline({
    stages: request?.stages || request?.audit?.stages || [],
    performanceStages: request?.performanceStages || request?.audit?.performanceStages || [],
  });
  return { PLAN0_READY: timeline.PLAN0_READY, FULL_BATCH_READY: timeline.FULL_BATCH_READY, AI_START: timeline.AI_START,
    AI_COMPLETE: timeline.AI_COMPLETE, CANONICAL_READY: timeline.CANONICAL_READY,
    VISIBLE: validTime(request?.visibility?.elapsedFromRequestMs) ? request.visibility.elapsedFromRequestMs : null };
}

// Sidecars carry externally collected, request-correlated evidence. They can
// never override server timings, report status, provider counts or identity.
function attachEvidence(report, sidecar) {
  if (!sidecar) return report;
  if (!report || sidecar.schemaVersion !== 'phase1a-production-evidence/v1'
    || sidecar.runId !== report.runId || sidecar.environmentId !== report.environmentId
    || sidecar.userSha256 !== report.userSha256 || !Array.isArray(sidecar.requests)) {
    throw new Error('SIDECAR_REPORT_MISMATCH');
  }
  const observed = new Map();
  for (const entry of sidecar.requests) {
    const request = report.requests?.find((value) => value.auditId === entry.auditId && value.batchId === entry.batchId);
    if (!request || !nonempty(entry.auditId) || !nonempty(entry.batchId) || observed.has(entry.auditId)) {
      throw new Error('SIDECAR_REQUEST_MISMATCH');
    }
    if (entry.stage !== 'FIRST_CARD_VISIBLE' || entry.boundary !== 'native_selector_bounding_rect'
      || entry.clock !== 'client_request_date_now' || !validTime(entry.elapsedFromRequestMs)
      || !nonempty(entry.evidenceRef)) throw new Error('SIDECAR_VISIBILITY_INVALID');
    observed.set(entry.auditId, { status: 'observed', batchId: entry.batchId, auditId: entry.auditId,
      boundary: entry.boundary, clock: entry.clock, elapsedFromRequestMs: entry.elapsedFromRequestMs,
      evidenceRef: entry.evidenceRef });
  }
  return { ...report, deploymentEvidence: sidecar.deploymentEvidence,
    requests: report.requests.map((request) => ({ ...request,
      visibility: observed.get(request.auditId) || request.visibility })) };
}

function deploymentValid(report) {
  const evidence = report.deploymentEvidence;
  return evidence?.verified === true && /^[a-f0-9]{40}$/i.test(evidence.commit || '')
    && /^[a-f0-9]{64}$/i.test(evidence.artifactSha256 || '')
    && evidence.environmentId === report.environmentId && nonempty(evidence.evidenceRef);
}

function visibilityValid(request) {
  const visibility = request?.visibility;
  return visibility?.status === 'observed' && visibility.auditId === request.auditId
    && visibility.batchId === request.batchId && nonempty(request.auditId) && nonempty(request.batchId)
    && visibility.boundary === 'native_selector_bounding_rect' && visibility.clock === 'client_request_date_now'
    && nonempty(visibility.evidenceRef) && validTime(visibility.elapsedFromRequestMs);
}

function compareReports(before, after) {
  const result = {
    before: Object.fromEntries(MODES.map((mode) => [mode, phaseTimeline(before, mode)])),
    after: Object.fromEntries(MODES.map((mode) => [mode, phaseTimeline(after, mode)])),
    clocks: { server: 'runtime_handler_monotonic', VISIBLE: 'client_request_date_now' },
    comparable: false, reason: null, deltaMs: null, fastPathImproved: null,
  };
  const reject = (reason) => ({ ...result, reason });
  if (!before || !after) return reject('BEFORE_AND_AFTER_REPORT_REQUIRED');
  if ([before, after].some((report) => report.status !== 'PASS'
    || !Array.isArray(report.requests) || report.requests.some((request) => request.status !== 'PASS'))) {
    return reject('REPORT_OR_REQUEST_NOT_PASS');
  }
  if (![before, after].every(deploymentValid)) return reject('DEPLOYMENT_EVIDENCE_REQUIRED');
  if (before.deploymentEvidence.commit === after.deploymentEvidence.commit) return reject('DEPLOYED_COMMITS_NOT_DISTINCT');
  if (!nonempty(before.environmentId) || !nonempty(before.userSha256) || !before.input || !after.input
    || before.environmentId !== after.environmentId || before.userSha256 !== after.userSha256
    || !isDeepStrictEqual(before.input, after.input)) return reject('COMPARISON_COHORT_MISMATCH');
  const requests = [before, after].flatMap((report) => MODES.map((mode) => phaseRequest(report, mode)));
  if (requests.some((request) => !request || !MODES.includes(request.mode))) return reject('MISS_AND_HIT_REQUIRED');
  if (requests.some((request) => !/^[a-f0-9]{64}$/i.test(request.fingerprint || '')
    || request.fingerprint !== requests[0].fingerprint)) return reject('FINGERPRINT_MISMATCH');
  if (requests.some((request) => request.providerStarts !== (request.mode === 'miss' ? 1 : 0))) return reject('PROVIDER_COUNT_MISMATCH');
  if (requests.some((request) => request.mode === 'hit' && request.canonicalTextMatched !== true)) return reject('HIT_CANONICAL_NOT_VISIBLE');
  if (!requests.every(visibilityValid)) return reject('CLIENT_VISIBILITY_EVIDENCE_REQUIRED');
  for (const side of ['before', 'after']) {
    const { miss, hit } = result[side];
    if (!validTime(miss.AI_START) || !validTime(miss.AI_COMPLETE)
      || !validTime(miss.CANONICAL_READY) || !validTime(hit.CANONICAL_READY)) return reject('TIMELINE_POINT_MISSING');
    if (hit.AI_START !== null || hit.AI_COMPLETE !== null) return reject('HIT_HAS_AI_TIMELINE');
    if (miss.AI_COMPLETE < miss.AI_START || miss.CANONICAL_READY < miss.AI_COMPLETE
      || (validTime(miss.PLAN0_READY) && miss.PLAN0_READY > miss.AI_START)) return reject('SERVER_TIMELINE_ORDER_INVALID');
  }
  result.comparable = true;
  result.deltaMs = Object.fromEntries(MODES.map((mode) => [mode,
    Object.fromEntries(['AI_START', 'AI_COMPLETE', 'VISIBLE'].map((name) => [name,
      validTime(result.before[mode][name]) && validTime(result.after[mode][name])
        ? Math.round((result.after[mode][name] - result.before[mode][name]) * 1000) / 1000 : null]))]));
  result.fastPathImproved = result.deltaMs.miss.AI_START < 0 && result.deltaMs.miss.VISIBLE < 0;
  return result;
}

function main(args = process.argv.slice(2)) {
  if (![2, 4].includes(args.length)) {
    console.error('Usage: pnpm first-card:production-smoke:compare <before.json|-> <after.json|-> [before-evidence.json after-evidence.json]');
    return 2;
  }
  try {
    const read = (file) => file === '-' ? null : JSON.parse(fs.readFileSync(file, 'utf8'));
    const before = attachEvidence(read(args[0]), args[2] ? read(args[2]) : null);
    const after = attachEvidence(read(args[1]), args[3] ? read(args[3]) : null);
    const result = compareReports(before, after);
    console.log(JSON.stringify(result, null, 2));
    return result.comparable ? 0 : 1;
  } catch (error) {
    console.error(JSON.stringify({ comparable: false,
      reason: /^SIDECAR_[A-Z_]+$/.test(error.message || '') ? error.message : 'COMPARISON_INPUT_INVALID' }));
    return 2;
  }
}

if (require.main === module) process.exitCode = main();
module.exports = { compareReports, phaseTimeline, attachEvidence, main };
