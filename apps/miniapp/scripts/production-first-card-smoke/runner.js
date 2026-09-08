'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { readContext, requestInput, requestFirstCard } = require('./wechat');
const { createCleanupPlan, validateCleanupPlan, hash, TERMINAL_STATUSES } = require('./safety');
const { extractAudit, verifyInvocation } = require('./evidence');

const ENV_ID = 'cloud1-d8gl3k1vkdf0b7f05';
const ROOT = path.resolve(__dirname, '../../../..');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function writeJson(directory, name, value) {
  fs.writeFileSync(path.join(directory, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}

async function waitForInvocation(admin, context, result, auditId, startTime, progress) {
  const deadline = Date.now() + 90000;
  let audit = { stages: [], summaries: [], unparsed: 0 };
  let job;
  do {
    job = await admin.getJob({ openid: context.openid, batchId: result.batchId });
    const logs = await admin.getAuditLogs({ auditId, startTime: startTime - 5000, endTime: Date.now() + 1000 });
    audit = extractAudit(logs, auditId);
    const final = audit.summaries.at(-1);
    if (job && TERMINAL_STATUSES.has(job.status) && final
      && (final.executionOutcome === 'succeeded' || final.executionOutcome === 'failed'
        || audit.stages.some((stage) => stage.stage === 'CACHE_LOOKUP_DONE' && stage.status === 'hit'))) {
      const entry = job.entries?.find((value) => value.position === 0);
      const cache = entry ? await admin.getCache({ openid: context.openid, cacheId: entry.cacheId }) : null;
      return { job, cache, audit };
    }
    progress('waiting_for_cloud_audit');
    await sleep(4000);
  } while (Date.now() < deadline);
  throw Object.assign(new Error('CLOUD_AUDIT_OR_TAIL_NOT_READY'), { smokeEvidence: {
    audit, jobStatus: job?.status || null,
    cacheLookup: audit.stages.find((stage) => stage.stage === 'CACHE_LOOKUP_DONE')?.status || null,
  } });
}

async function runProductionSmoke({ admin, mini, directory, progress = () => {}, invoke = requestFirstCard,
  wait = waitForInvocation, date = new Date().toISOString().slice(0, 10), hitSamples = 0 }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))
    || new Date(date).toISOString().slice(0, 10) !== date) throw new Error('SMOKE_DATE_INVALID');
  if (!Number.isInteger(hitSamples) || hitSamples < 0 || hitSamples > 5) throw new Error('SMOKE_HIT_SAMPLE_COUNT_INVALID');
  const context = await readContext(mini, ENV_ID);
  const runId = `production-smoke-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const report = { schemaVersion: 'production-first-card-smoke/v1', runId, environmentId: ENV_ID,
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
    toolSha256: Object.fromEntries(['runner.js', 'admin.js', 'wechat.js', 'safety.js', 'evidence.js'].map((name) => [name, hash(fs.readFileSync(path.join(__dirname, name)))])),
    userSha256: hash(context.openid), appId: context.appId, input: { date, scene: '居家', weatherMode: 'disabled', timeOfDay: 'all_day' },
    transport: 'wx.cloud.callHTTPFunction/recommendationStream', deployed: false, deletedCacheDocuments: 0,
    protectedDataDeleted: false, requests: [], status: 'RUNNING' };
  let backup;
  try {
    async function request(phase, expectedFingerprint) {
      const auditId = `${runId}-${phase}`;
      const record = { phase, auditId, status: 'RUNNING' };
      report.requests.push(record);
      progress(phase);
      const startTime = Date.now();
      const result = await invoke(mini, context, requestInput(date, auditId));
      Object.assign(record, { batchId: result.batchId, httpStatus: result.statusCode, events: result.events });
      const observed = await wait(admin, context, result, auditId, startTime, progress);
      Object.assign(record, { stages: observed.audit.stages, summary: observed.audit.summaries.at(-1) });
      const mode = observed.audit.stages.some((stage) => stage.stage === 'CACHE_LOOKUP_DONE' && stage.status === 'miss') ? 'miss' : 'hit';
      const evidence = verifyInvocation({ ...observed, result, openid: context.openid, expectedFingerprint, mode, requireCanonicalText: phase !== 'baseline' });
      Object.assign(record, { ...evidence,
        visibility: { status: 'unavailable', reason: 'SMOKE_HAS_NO_PAGE_RENDER_OBSERVER' }, status: 'PASS' });
      writeJson(directory, `${phase}.json`, record);
      return { ...observed, result, mode, evidence };
    }

    if (hitSamples > 0) {
      let expectedFingerprint;
      let expectedTextHash;
      for (let index = 0; index < hitSamples; index += 1) {
        const sample = await request(`hit-${index + 1}`, expectedFingerprint);
        if (sample.mode !== 'hit') throw new Error('SMOKE_EXPECTED_HIT');
        expectedFingerprint ||= sample.evidence.fingerprint;
        expectedTextHash ||= sample.evidence.cacheTextSha256;
        if (sample.evidence.cacheTextSha256 !== expectedTextHash) throw new Error('SMOKE_CANONICAL_CHANGED');
      }
      report.status = 'PASS';
      report.sampleMode = 'canonical_hit_only';
      report.sampleCount = hitSamples;
      report.manualSteps = 1;
      report.timelineComparison = {
        before: null,
        after: report.requests.map((requestRecord) => requestRecord.timeline || {}),
        comparable: false,
        reason: 'ATTRIBUTION_SAMPLE_ONLY',
      };
    } else {
      // A real, bounded WeChat request establishes the deployed fingerprint. If
      // it naturally misses, it is already the desired smoke; no reset is needed.
      const baseline = await request('baseline');
      const fingerprint = baseline.evidence.fingerprint;
      if (baseline.mode === 'hit') {
        progress('prepare_single_cache_reset');
        const jobs = await admin.listRelatedJobs({ openid: context.openid, cacheId: baseline.evidence.cacheId });
        const plan = createCleanupPlan({ openid: context.openid, batchId: baseline.result.batchId,
          rendererVersion: baseline.job.rendererVersion, firstOutfitKey: baseline.result.firstCard.outfitKey,
          job: baseline.job, cache: baseline.cache, jobs });
        // Write the complete recovery document before any mutation. This file is
        // private local evidence in the git-ignored artifacts directory.
        backup = { environmentId: ENV_ID, plan, document: baseline.cache };
        writeJson(directory, 'cache-backup.private.json', backup);
        const currentContext = await readContext(mini, ENV_ID);
        if (currentContext.openid !== context.openid) throw new Error('WECHAT_USER_CHANGED');
        const current = await admin.getCache({ openid: context.openid, cacheId: plan.target._id });
        const freshJobs = await admin.listRelatedJobs({ openid: context.openid, cacheId: plan.target._id });
        createCleanupPlan({ openid: context.openid, batchId: baseline.result.batchId,
          rendererVersion: baseline.job.rendererVersion, firstOutfitKey: baseline.result.firstCard.outfitKey,
          job: await admin.getJob({ openid: context.openid, batchId: baseline.result.batchId }), cache: current, jobs: freshJobs });
        const validation = validateCleanupPlan(plan, { cache: current });
        if (validation.remove) {
          progress('delete_exact_cache_document');
          report.cacheResetAttempted = true;
          report.deletedCacheDocuments = null;
          report.deletedCacheDocuments = await admin.removeSingleCache({ openid: context.openid, cacheId: plan.target._id,
            rendererVersion: plan.target.rendererVersion, renderInputFingerprint: fingerprint, expectedDoc: current });
          if (report.deletedCacheDocuments !== 1) throw new Error('CACHE_DELETE_NOT_EXACTLY_ONE');
        }
        if (await admin.getCache({ openid: context.openid, cacheId: plan.target._id })) throw new Error('CACHE_REAPPEARED_BEFORE_SMOKE');
        writeJson(directory, 'reset-receipt.json', { cacheId: plan.target._id, fingerprint,
          deleted: report.deletedCacheDocuments, backupSha256: hash(JSON.stringify(backup)), verifiedAbsent: true });
        const miss = await request('miss', fingerprint);
        if (miss.mode !== 'miss') throw new Error('SMOKE_EXPECTED_MISS');
      }
      const hit = await request('hit', fingerprint);
      if (hit.mode !== 'hit') throw new Error('SMOKE_EXPECTED_HIT');
      const miss = report.requests.find((requestRecord) => requestRecord.mode === 'miss');
      if (!miss || miss.cacheTextSha256 !== hit.evidence.cacheTextSha256) throw new Error('SMOKE_CANONICAL_CHANGED');
      report.status = 'PASS';
      report.manualSteps = 1;
      report.timelineComparison = {
        before: null,
        after: Object.fromEntries(report.requests.filter((requestRecord) => requestRecord.mode === 'miss' || requestRecord.mode === 'hit')
          .map((requestRecord) => [requestRecord.mode, requestRecord.timeline || {}])),
        comparable: false,
        reason: 'NO_PHASE1A_BEFORE_REPORT',
      };
    }
  } catch (error) {
    report.status = 'FAIL';
    // Avoid leaking raw CLI responses, credentials, text or user identity.
    report.errorCode = /^[A-Z][A-Z0-9_:.-]+$/.test(error?.message || '') ? error.message : 'PRODUCTION_SMOKE_FAILED';
    const lastRequest = report.requests.at(-1);
    if (lastRequest?.status === 'RUNNING') Object.assign(lastRequest, { status: 'FAIL', ...(error.smokeEvidence || {}) });
    report.recovery = backup ? 'cache-backup.private.json; no automatic overwrite of newly generated canonical copy' : 'no cache reset performed';
  }
  writeJson(directory, 'report.json', report);
  return report;
}

async function main() {
  const args = process.argv.slice(2);
  let date;
  let hitSamples = 0;
  let valid = args.shift() === '--live';
  while (valid && args.length > 0) {
    const option = args.shift();
    const value = args.shift();
    if (option === '--date' && value && !date) date = value;
    else if (option === '--hit-samples' && /^[1-5]$/.test(value || '') && hitSamples === 0) hitSamples = Number(value);
    else valid = false;
  }
  if (!valid) {
    console.log('Usage: pnpm first-card:production-smoke [--date YYYY-MM-DD] [--hit-samples 1..5] (hit-only mode never deletes canonical cache or calls Provider).');
    process.exitCode = 2;
    return;
  }
  const base = path.join(ROOT, 'artifacts/production-first-card-smoke');
  fs.mkdirSync(base, { recursive: true });
  const lockPath = path.join(base, 'run.lock');
  const lock = fs.openSync(lockPath, 'wx');
  let mini;
  try {
    const directory = path.join(base, new Date().toISOString().replace(/[:.]/g, '-'));
    fs.mkdirSync(directory);
    const { createAdmin } = require('./admin');
    const admin = createAdmin({ envId: ENV_ID });
    const automator = require('miniprogram-automator');
    mini = await automator.connect({ wsEndpoint: process.env.AUTOMATOR_WS_ENDPOINT || 'ws://127.0.0.1:9420' });
    const report = await runProductionSmoke({ admin, mini, directory, date, hitSamples,
      progress: (phase) => console.log(JSON.stringify({ phase })) });
    console.log(JSON.stringify({ status: report.status, errorCode: report.errorCode, deletedCacheDocuments: report.deletedCacheDocuments,
      requests: report.requests.map(({ phase, mode, providerStarts, fingerprint }) => ({ phase, mode, providerStarts, fingerprint })),
      timelineComparison: report.timelineComparison,
      evidence: path.join(directory, 'report.json') }, null, 2));
    if (report.status !== 'PASS') process.exitCode = 1;
  } finally {
    mini?.disconnect();
    fs.closeSync(lock);
    fs.unlinkSync(lockPath);
  }
}

if (require.main === module) main().catch(() => { console.error('PRODUCTION_SMOKE_SETUP_FAILED'); process.exitCode = 1; });

module.exports = { runProductionSmoke, waitForInvocation };
