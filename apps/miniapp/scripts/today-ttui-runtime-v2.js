'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  ensureDevToolsDirectSession,
  TODAY_PERFORMANCE_LEDGER_KEY,
} = require('./devtools-direct-session');

const ARTIFACT_ROOT = path.resolve(__dirname, '../../artifacts/today-ttui-runtime-v2');

function nowId(prefix = 'ttui') {
  return `${prefix}-${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}-${crypto.randomBytes(4).toString('hex')}`;
}

function readLedger(mini) {
  return mini.evaluate((key) => globalThis.wx?.getStorageSync?.(key) || null, TODAY_PERFORMANCE_LEDGER_KEY);
}

function readSnapshot(mini) {
  return mini.evaluate(() => globalThis.wx?.getStorageSync?.('today:restore-snapshot:v1') || null);
}

function segmentDurations(record = {}) {
  const s = record.stages || {};
  const d = record.durations || {};
  const duration = (name, start, end) => Number(d[name]) || (Number(s[end]) - Number(s[start])) || 0;
  return {
    clientToCloudMs: duration('generateOutfitRequest', 'generateOutfitRequestStart', 'generateOutfitResponseEnd'),
    clientStateMs: duration('responseAdapt', 'responseAdaptStart', 'responseAdaptEnd'),
    firstCardPaintMs: duration('onShowToFirstCard', 'todayOnShow', 'firstCardMounted'),
    firstImagePaintMs: duration('onShowToFirstImage', 'todayOnShow', 'firstImageLoaded'),
    usablePaintMs: Number(s.firstImageLoaded || s.firstCardMounted) - Number(s.todayOnShow) || 0,
    snapshotReadMs: duration('snapshotRead', 'snapshotReadStart', 'snapshotReadEnd'),
    snapshotValidationMs: duration('snapshotValidation', 'snapshotValidationStart', 'snapshotValidationEnd'),
  };
}

function serverSegments(performance = {}) {
  const runtime = performance.runtimeV2 || {};
  const phases = new Map((performance.phases || []).map((phase) => [phase.phase, Number(phase.duration) || 0]));
  const read = Number(runtime.tReadServerProxyMs) || phases.get('userAndWardrobeRead') || 0;
  const core = Number(runtime.tCorePhaseProxyMs) || (phases.get('candidateGeneration') || 0) + (phases.get('cardCompilation') || 0);
  const safe = Number(runtime.tSafeMs) || 0;
  const total = Number(performance.serverTotalMs) || 0;
  const persistence = Number(performance.snapshotPersistence?.durationMs) || phases.get('snapshotPersistence') || 0;
  return { readMs: read, coreMs: core, safeMs: safe, criticalPersistenceMs: persistence, totalMs: total, aiMs: Number(runtime.tAiNecessaryCriticalPathMs) || 0 };
}

function summarize(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  const pick = (p) => sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] : 0;
  return { sampleCount: sorted.length, p50Ms: pick(0.5), p95Ms: pick(0.95), minMs: sorted[0] || 0, maxMs: sorted.at(-1) || 0 };
}

function summarizeArtifacts(artifacts) {
  const rows = artifacts.map((entry) => ({
    clientToCloudMs: Number(entry.clientToCloudMs) || 0,
    readMs: Number(entry.readMs) || 0,
    coreMs: Number(entry.coreMs) || 0,
    safeMs: Number(entry.safeMs) || 0,
    criticalPersistenceMs: Number(entry.criticalPersistenceMs) || 0,
    cloudToClientMs: Math.max(0, (Number(entry.clientTotalMs) || 0) - (Number(entry.serverTotalMs) || 0)),
    clientStateMs: Number(entry.clientStateMs) || 0,
    usablePaintMs: Number(entry.usablePaintMs) || 0,
  }));
  return Object.fromEntries(Object.keys(rows[0] || {}).map((key) => [key, summarize(rows.map((row) => row[key]))]));
}

function writeArtifact(scenario, artifact) {
  const directory = path.join(ARTIFACT_ROOT, scenario, artifact.runId || nowId(scenario));
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'measurement.json'), `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  return directory;
}

module.exports = { ARTIFACT_ROOT, readLedger, readSnapshot, segmentDurations, serverSegments, summarize, summarizeArtifacts, writeArtifact };
