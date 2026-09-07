'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { compareReports, phaseTimeline, attachEvidence } = require('./compare');

function report(version, aiStart = 100, aiComplete = 300, visible = 400) {
  const auditId = version + '-miss';
  const stage = (name, status, time) => ({ auditId, stage: name, status, elapsedFromHandlerMs: time });
  const value = {
    runId: version, status: 'PASS', environmentId: 'env', userSha256: 'u'.repeat(64),
    input: { date: '2026-09-03', scene: '居家', weatherMode: 'disabled', timeOfDay: 'all_day' },
    // This remains false because the smoke tool does not deploy.
    deployed: false,
    deploymentEvidence: { verified: true, commit: version.repeat(40), artifactSha256: version.repeat(64),
      environmentId: 'env', evidenceRef: 'remote-artifact-verification.json' },
    requests: ['miss', 'hit'].map((mode) => ({
      phase: mode, mode, status: 'PASS', auditId: version + '-' + mode, batchId: version + '-' + mode,
      fingerprint: 'f'.repeat(64), providerStarts: mode === 'miss' ? 1 : 0, canonicalTextMatched: true,
      stages: mode === 'miss' ? [
        stage('PROVIDER_START', 'started', aiStart),
        stage('PROVIDER_COMPLETE', 'completed', aiStart + 10),
        stage('EXECUTION_COMPLETE', 'succeeded', aiComplete),
        stage('CANONICAL_PERSISTED', 'completed', aiComplete + 10),
      ] : [stage('CACHE_LOOKUP_DONE', 'hit', 20)],
      visibility: { status: 'observed', batchId: version + '-' + mode, auditId: version + '-' + mode,
        boundary: 'native_selector_bounding_rect', clock: 'client_request_date_now',
        elapsedFromRequestMs: mode === 'miss' ? visible : 80, evidenceRef: 'native-client-trace.jsonl' },
    })),
  };
  return value;
}

test('compares MISS/HIT, keeps HIT AI N/A, reports after-minus-before without mixing clocks', () => {
  const result = compareReports(report('a'), report('b', 50, 200, 250));
  assert.equal(result.comparable, true);
  assert.equal(result.before.miss.AI_COMPLETE, 300);
  assert.equal(result.after.miss.VISIBLE, 250);
  assert.deepEqual(result.deltaMs.miss, { AI_START: -50, AI_COMPLETE: -100, VISIBLE: -150 });
  assert.equal(result.deltaMs.hit.AI_START, null);
  assert.equal(result.fastPathImproved, true);
});

test('comparable samples do not imply an improvement', () => {
  assert.equal(compareReports(report('a'), report('b', 200, 500, 700)).fastPathImproved, false);
});

test('old failed nested audit preserves start but never substitutes provider Response for AI completion', () => {
  const old = { requests: [{ phase: 'miss', audit: { stages: [
    { stage: 'PROVIDER_START', status: 'started', elapsedFromHandlerMs: 3474.136 },
    { stage: 'PROVIDER_COMPLETE', status: 'completed', elapsedFromHandlerMs: 4000 },
    { stage: 'NARRATIVE_PLAN_READY', status: 'completed', elapsedFromHandlerMs: 2765 },
  ] } }] };
  assert.equal(phaseTimeline(old, 'miss').AI_START, 3474.136);
  assert.equal(phaseTimeline(old, 'miss').AI_COMPLETE, null);
  assert.equal(phaseTimeline(old, 'miss').PLAN0_READY, null);
  const result = compareReports(old, null);
  assert.equal(result.reason, 'BEFORE_AND_AFTER_REPORT_REQUIRED');
  assert.equal(result.fastPathImproved, null);
});

for (const [name, mutate, reason] of [
  ['failed invocation', (r) => { r.requests[0].status = 'FAIL'; }, 'REPORT_OR_REQUEST_NOT_PASS'],
  ['missing deployed proof', (r) => { delete r.deploymentEvidence; }, 'DEPLOYMENT_EVIDENCE_REQUIRED'],
  ['same deployed version', (r) => { r.deploymentEvidence.commit = 'a'.repeat(40); }, 'DEPLOYED_COMMITS_NOT_DISTINCT'],
  ['changed cohort', (r) => { r.input.date = '2026-09-04'; }, 'COMPARISON_COHORT_MISMATCH'],
  ['missing HIT', (r) => { r.requests.pop(); }, 'MISS_AND_HIT_REQUIRED'],
  ['missing fingerprint', (r) => { delete r.requests[0].fingerprint; }, 'FINGERPRINT_MISMATCH'],
  ['changed fingerprint', (r) => { r.requests[0].fingerprint = 'e'.repeat(64); }, 'FINGERPRINT_MISMATCH'],
  ['duplicate provider', (r) => { r.requests[0].providerStarts = 2; }, 'PROVIDER_COUNT_MISMATCH'],
  ['HIT called provider', (r) => { r.requests[1].providerStarts = 1; }, 'PROVIDER_COUNT_MISMATCH'],
  ['HIT fallback text', (r) => { r.requests[1].canonicalTextMatched = false; }, 'HIT_CANONICAL_NOT_VISIBLE'],
  ['HTTP proxy', (r) => { r.requests[0].visibility.boundary = 'http_complete'; }, 'CLIENT_VISIBILITY_EVIDENCE_REQUIRED'],
  ['stale UI batch', (r) => { r.requests[0].visibility.batchId = 'old'; }, 'CLIENT_VISIBILITY_EVIDENCE_REQUIRED'],
  ['negative visible time', (r) => { r.requests[0].visibility.elapsedFromRequestMs = -1; }, 'CLIENT_VISIBILITY_EVIDENCE_REQUIRED'],
  ['missing AI completion', (r) => { r.requests[0].stages.splice(2, 1); }, 'TIMELINE_POINT_MISSING'],
  ['wrong server order', (r) => { r.requests[0].stages[2].elapsedFromHandlerMs = 0; }, 'SERVER_TIMELINE_ORDER_INVALID'],
]) {
  test('rejects ' + name, () => {
    const after = report('b'); mutate(after);
    assert.equal(compareReports(report('a'), after).reason, reason);
  });
}

function sidecar(value) {
  return { schemaVersion: 'phase1a-production-evidence/v1', runId: value.runId,
    environmentId: value.environmentId, userSha256: value.userSha256,
    deploymentEvidence: value.deploymentEvidence,
    requests: value.requests.map((request) => ({ ...request.visibility, stage: 'FIRST_CARD_VISIBLE' })) };
}

test('sidecar binds run and requests and cannot overwrite server metrics or mutate the report', () => {
  const value = report('a');
  const evidence = sidecar(value);
  evidence.requests[0].AI_START = 0;
  evidence.requests[0].elapsedFromRequestMs = 450;
  const joined = attachEvidence(value, evidence);
  assert.equal(phaseTimeline(joined, 'miss').AI_START, 100);
  assert.equal(phaseTimeline(joined, 'miss').VISIBLE, 450);
  assert.equal(phaseTimeline(value, 'miss').VISIBLE, 400);
});

test('sidecar rejects unrelated runs, duplicate requests and receipt-time proxies', () => {
  const value = report('a');
  const wrongRun = sidecar(value); wrongRun.runId = 'old';
  assert.throws(() => attachEvidence(value, wrongRun), /SIDECAR_REPORT_MISMATCH/);
  const wrongBatch = sidecar(value); wrongBatch.requests[0].batchId = 'old';
  assert.throws(() => attachEvidence(value, wrongBatch), /SIDECAR_REQUEST_MISMATCH/);
  const duplicate = sidecar(value); duplicate.requests.push(duplicate.requests[0]);
  assert.throws(() => attachEvidence(value, duplicate), /SIDECAR_REQUEST_MISMATCH/);
  const proxy = sidecar(value); proxy.requests[0].boundary = 'sse_ready';
  assert.throws(() => attachEvidence(value, proxy), /SIDECAR_VISIBILITY_INVALID/);
});
