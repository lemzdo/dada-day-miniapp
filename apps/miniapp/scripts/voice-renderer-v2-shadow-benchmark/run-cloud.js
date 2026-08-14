'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { ensureDevToolsDirectSession } = require('../devtools-direct-session');
const { callGenerateOutfit } = require('../voice-renderer-v2-lab/cloud-client');

const SCENES = Object.freeze(['home', 'work', 'date', 'sport']);

function hash(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16); }
function anonymize(data = {}, scene, mode) {
  const samples = Array.isArray(data.reviewSamples) ? data.reviewSamples : [];
  return {
    scene, mode, status: data.status || 'failed_open',
    contractVersion: data.contractVersion || null, modelRouteVersion: data.modelRouteVersion || null,
    requestCount: Number(data.requestCount || 0), latencyMs: Number(data.latencyMs || 0), providerLatencyMs: Number(data.providerLatencyMs || 0),
    usage: data.usage || {}, cacheHitCount: Number(data.cacheHitCount || 0), cacheMissCount: Number(data.cacheMissCount || 0),
    planCount: Number(data.planCount || samples.length), renderedCount: Number(data.renderedCount || samples.length),
    automatedContract: data.automatedContract || { passCount: 0, failCount: 0, failureCounts: {} },
    failureCodes: data.failureCodes || {},
    reviewCases: samples.map((sample) => ({
      anonymousCaseId: sample.anonymousCaseId,
      planHash: sample.planHash,
      expressionMode: sample.expressionMode,
      primaryInsightCode: sample.primaryInsightCode,
      sceneCategory: sample.sceneCategory,
      authorizedMeaning: sample.authorizedMeaning,
      garments: Array.isArray(sample.garments) ? sample.garments.slice() : [],
      allowedClaims: Array.isArray(sample.allowedClaims) ? sample.allowedClaims.slice() : [],
      text: sample.text,
      outputHash: hash({ planHash: sample.planHash, text: sample.text }),
    })),
    planHashes: Array.isArray(data.planIdentities) ? data.planIdentities.map((entry) => entry.planHash).filter(Boolean) : [],
  };
}

async function runCloud({ artifactDirectory = path.resolve(__dirname, '../../../../artifacts/voice-renderer-v2-shadow-benchmark'), tokenFile, deps = {}, repetitions = 1, scenes = SCENES } = {}) {
  const file = tokenFile || path.resolve(__dirname, '../../../../artifacts/voice-renderer-v2-lab/.cloud-benchmark-token');
  const token = fs.readFileSync(file, 'utf8').trim();
  const session = deps.mini ? null : await ensureDevToolsDirectSession({ deps });
  const mini = deps.mini || session.mini;
  const records = [];
  try {
    for (const scene of scenes) for (let repetition = 1; repetition <= repetitions; repetition += 1) {
      const result = await callGenerateOutfit(mini, {
        action: 'generate', benchmarkToken: token, voiceRendererRealPlanBenchmark: true,
        diagnostics: true, scene, maxResults: 4,
      });
      if (result.code !== 0) throw new Error(`REAL_PLAN_BENCHMARK:${result.message || 'unknown'}`);
      const benchmark = result.data?.diagnostics?.voiceRendererShadowBenchmark;
      if (!benchmark?.benchmark) throw new Error('REAL_PLAN_BENCHMARK_DIAGNOSTICS_MISSING');
      for (const mode of ['single', 'batch', 'flash']) {
        records.push({
          scene, repetition, mode,
          samePlanSet: benchmark.samePlanSet === true,
          qualityNotDegraded: benchmark.qualityNotDegraded === true,
          exactTextAgreementCount: Number(benchmark.exactTextAgreementCount || 0),
          ...anonymize(benchmark[mode] || {}, scene, mode),
        });
      }
      records.push({ scene, repetition, mode: 'cache_probe', ...anonymize(benchmark.cacheProbe || {}, scene, 'cache_probe') });
    }
  } finally { if (!deps.mini && mini?.disconnect) mini.disconnect(); }
  const artifact = { version: 'voice-renderer-v2-shadow-benchmark-v1', status: 'complete', scenes: scenes.slice(), repetitions, records };
  fs.mkdirSync(artifactDirectory, { recursive: true });
  fs.writeFileSync(path.join(artifactDirectory, 'raw-runs.json'), `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  return artifact;
}

if (require.main === module) runCloud().then((artifact) => process.stdout.write(`${JSON.stringify({ status: artifact.status, records: artifact.records.length }, null, 2)}\n`)).catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
module.exports = { SCENES, anonymize, runCloud };
