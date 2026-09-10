'use strict';

const ts = require('typescript');
const { hash } = require('./safety');
const { buildJobIdentity, buildCacheIdentity } = require('../../cloudfunctions/generateOutfit/services/recommendationCopyProductionJobV2');

// Cloud logs may contain JSON or Node's console object notation. Parse only
// literal AST nodes; never execute/eval text received from a log service.
function literal(node) {
  if (ts.isParenthesizedExpression(node)) return literal(node.expression);
  if (ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return ts.isNumericLiteral(node) ? Number(node.text) : node.text;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(literal);
  if (ts.isObjectLiteralExpression(node)) {
    const result = Object.create(null);
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property) || !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) throw new Error('LOG_NOT_LITERAL');
      result[property.name.text] = literal(property.initializer);
    }
    return result;
  }
  throw new Error('LOG_NOT_LITERAL');
}

function parseObject(value) {
  const source = ts.createSourceFile('audit.js', `const audit = (${value});`, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if (source.parseDiagnostics.length || source.statements.length !== 1) throw new Error('LOG_NOT_LITERAL');
  return literal(source.statements[0].declarationList.declarations[0].initializer);
}

function extractAudit(logs, auditId) {
  const stages = [];
  const performanceStages = [];
  const summaries = [];
  const seen = new Set();
  let unparsed = 0;
  function visit(value) {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (value && typeof value === 'object') { Object.values(value).forEach(visit); return; }
    if (typeof value !== 'string') return;
    const marker = /\[(RecommendationAuditSummary|RecommendationAudit|RecommendationStage)\]/g;
    const matches = [...value.matchAll(marker)];
    for (let i = 0; i < matches.length; i += 1) {
      const match = matches[i];
      const fragment = value.slice(match.index + match[0].length, matches[i + 1]?.index);
      const start = fragment.indexOf('{');
      let end = -1;
      if (start >= 0) {
        const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, fragment.slice(start));
        let depth = 0;
        for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
          if (token === ts.SyntaxKind.OpenBraceToken) depth += 1;
          if (token === ts.SyntaxKind.CloseBraceToken && --depth === 0) { end = start + scanner.getTextPos() - 1; break; }
        }
      }
      if (start < 0 || end < start) { unparsed += 1; continue; }
      try {
        const entry = parseObject(fragment.slice(start, end + 1));
        if (entry.auditId !== auditId) continue;
        const key = match[1] + JSON.stringify(entry);
        if (seen.has(key)) continue;
        seen.add(key);
        if (match[1] === 'RecommendationStage') {
          performanceStages.push({ ...entry });
        } else if (match[1] === 'RecommendationAudit') stages.push(entry);
        else summaries.push(entry);
      } catch { unparsed += 1; }
    }
  }
  visit(logs);
  stages.sort((a, b) => a.elapsedFromHandlerMs - b.elapsedFromHandlerMs);
  return { stages, performanceStages, summaries, unparsed };
}

function buildTimeline(audit = {}) {
  const validTime = (value) => Number.isFinite(value) && value >= 0;
  const auditTime = (name, statuses) => (audit.stages || []).find((entry) => entry.stage === name
    && statuses.includes(entry.status) && validTime(entry.elapsedFromHandlerMs))?.elapsedFromHandlerMs;
  const performanceTime = (name) => (audit.performanceStages || []).find((entry) => entry.stage === name
    && validTime(entry.elapsedMs))?.elapsedMs;
  return {
    PLAN0_READY: performanceTime('PLAN0_READY') ?? null,
    FULL_BATCH_READY: auditTime('FULL_BATCH_READY', ['completed'])
      ?? performanceTime('FULL_BATCH_READY') ?? null,
    AI_START: auditTime('PROVIDER_START', ['started']) ?? performanceTime('AI_START') ?? null,
    // execute returning a streaming Response is not completion of AI work.
    AI_COMPLETE: auditTime('EXECUTION_COMPLETE', ['succeeded', 'failed']) ?? performanceTime('AI_COMPLETE') ?? null,
    CANONICAL_READY: performanceTime('CANONICAL_READY')
      ?? auditTime('CANONICAL_PERSISTED', ['completed', 'tail'])
      ?? auditTime('CACHE_LOOKUP_DONE', ['hit']) ?? null,
    // Server logs cannot prove a client painted anything.
    FIRST_CARD_VISIBLE: null,
  };
}

function buildAttribution(audit = {}) {
  const stages = Array.isArray(audit.performanceStages) ? audit.performanceStages : [];
  const time = (name, after = -Infinity) => stages.find((entry) => entry.stage === name
    && Number.isFinite(entry.elapsedMs) && entry.elapsedMs >= after)?.elapsedMs;
  const span = (name, startName = `${name}_START`, doneName = `${name}_DONE`) => {
    const startMs = time(startName);
    const endMs = time(doneName, startMs);
    return Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs
      ? { name, startMs, endMs, durationMs: round(endMs - startMs) }
      : null;
  };
  const readyMs = time('SERVER_RESPONSE_READY');
  const raw = Object.fromEntries([
    'INPUT_SNAPSHOT', 'CACHE_COORDINATOR', 'CANDIDATE_POOL_LOOKUP', 'CANDIDATE_POOL_HYDRATE',
    'CORE', 'ITEM_FACTS', 'GENERATION', 'SKELETON_GENERATION', 'STRUCTURAL_COMPLETION',
    'ACCESSORY_COMPLETION', 'CANDIDATE_CORE_BUILD', 'FULL_ELIGIBILITY', 'SCORING_PASS',
    'RESERVOIR', 'FULL_MATERIALIZATION', 'CANONICAL_CACHE_LOOKUP', 'COPY_JOB_RESERVATION',
    'CANONICAL_CORRECTNESS_JOIN', 'FAVORITE_WORN', 'FAVORITE_DB', 'WORN_DB',
    'HOME_LIGHT_PROJECTION', 'BATCH_PERSIST', 'POOL_SERIALIZE', 'POOL_SAVE',
    'PREPARE_WORK', 'RESPONSE_ASSEMBLY',
  ].map((name) => [name, span(name, name === 'BATCH_PERSIST' ? 'runtime:batchPersistenceStart' : undefined,
    name === 'BATCH_PERSIST' ? 'runtime:batchPersistenceDone' : undefined)]));
  const topLevel = [raw.INPUT_SNAPSHOT, raw.CACHE_COORDINATOR, raw.CORE, raw.PREPARE_WORK,
    raw.RESPONSE_ASSEMBLY, raw.CANONICAL_CORRECTNESS_JOIN].filter(Boolean);
  const accountedMs = Number.isFinite(readyMs) ? intervalUnionMs(topLevel, 0, readyMs) : 0;
  const canonicalSpans = [raw.CANONICAL_CACHE_LOOKUP, raw.COPY_JOB_RESERVATION].filter(Boolean);
  const canonicalOverlapWithCoreMs = raw.CORE
    ? intervalUnionMs(canonicalSpans.map((value) => ({
      ...value,
      startMs: Math.max(value.startMs, raw.CORE.startMs),
      endMs: Math.min(value.endMs, raw.CORE.endMs),
    })).filter((value) => value.endMs >= value.startMs), raw.CORE.startMs, raw.CORE.endMs)
    : 0;
  const exclusive = mutuallyExclusive([
    ['CANONICAL_CACHE_LOOKUP', raw.CANONICAL_CACHE_LOOKUP, 100],
    ['COPY_JOB_RESERVATION', raw.COPY_JOB_RESERVATION, 100],
    ['POOL_SAVE', raw.POOL_SAVE, 95],
    ['POOL_SERIALIZE', raw.POOL_SERIALIZE, 95],
    ['FAVORITE_WORN', raw.FAVORITE_WORN, 90],
    ['BATCH_PERSIST', raw.BATCH_PERSIST, 90],
    ['CANONICAL_CORRECTNESS_JOIN', raw.CANONICAL_CORRECTNESS_JOIN, 80],
    ['INPUT_SNAPSHOT', raw.INPUT_SNAPSHOT, 70],
    ['CACHE_COORDINATOR', raw.CACHE_COORDINATOR, 70],
    ['CORE', raw.CORE, 60],
    ['PREPARE_WORK', raw.PREPARE_WORK, 60],
    ['RESPONSE_ASSEMBLY', raw.RESPONSE_ASSEMBLY, 50],
  ].filter(([, value]) => value), readyMs);
  return {
    serverResponseReadyMs: Number.isFinite(readyMs) ? readyMs : null,
    rawSpans: raw,
    mutuallyExclusiveMs: exclusive,
    pureCoreProdMs: raw.CORE ? round(Math.max(0, raw.CORE.durationMs - canonicalOverlapWithCoreMs)) : null,
    canonicalOverlapWithCoreMs: round(canonicalOverlapWithCoreMs),
    accountedWallTimeMs: round(accountedMs),
    unaccountedMs: Number.isFinite(readyMs) ? round(Math.max(0, readyMs - accountedMs)) : null,
    accountedWallTimePercent: Number.isFinite(readyMs) && readyMs > 0 ? round(accountedMs / readyMs * 100) : null,
  };
}

function intervalUnionMs(spans, lower = -Infinity, upper = Infinity) {
  const ordered = spans.map((value) => ({
    startMs: Math.max(lower, value.startMs),
    endMs: Math.min(upper, value.endMs),
  })).filter((value) => value.endMs > value.startMs).sort((left, right) => left.startMs - right.startMs);
  let total = 0;
  let current;
  for (const value of ordered) {
    if (!current || value.startMs > current.endMs) {
      total += current ? current.endMs - current.startMs : 0;
      current = { ...value };
    } else current.endMs = Math.max(current.endMs, value.endMs);
  }
  return total + (current ? current.endMs - current.startMs : 0);
}

function mutuallyExclusive(entries, upper) {
  if (!Number.isFinite(upper)) return {};
  const boundaries = [...new Set(entries.flatMap(([, value]) => [value.startMs, value.endMs])
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= upper))].sort((a, b) => a - b);
  const result = {};
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index];
    const end = boundaries[index + 1];
    const owner = entries.filter(([, value]) => value.startMs <= start && value.endMs >= end)
      .sort((left, right) => right[2] - left[2])[0];
    if (owner) result[owner[0]] = (result[owner[0]] || 0) + end - start;
  }
  return Object.fromEntries(Object.entries(result).map(([key, value]) => [key, round(value)]));
}

function round(value) { return Math.round(Number(value) * 1000) / 1000; }

function verifyInvocation({ audit, result, job, cache, openid, expectedFingerprint, mode, requireCanonicalText = true }) {
  if (result.statusCode !== 200) throw new Error('SMOKE_HTTP_NOT_SUCCESSFUL');
  if (!['miss', 'hit'].includes(mode)) throw new Error('SMOKE_MODE_INVALID');
  const entry = job?.entries?.find((value) => value.position === 0);
  if (!entry || job._openid !== openid || job.batchId !== result.batchId || entry.outfitKey !== result.firstCard.outfitKey) throw new Error('SMOKE_JOB_MISMATCH');
  if (job.jobId !== buildJobIdentity({ openid, batchId: result.batchId, rendererVersion: job.rendererVersion })
    || entry.cacheId !== buildCacheIdentity({ openid, rendererVersion: job.rendererVersion, renderInputFingerprint: entry.renderInputFingerprint })) throw new Error('SMOKE_STORAGE_IDENTITY_MISMATCH');
  if (expectedFingerprint && entry.renderInputFingerprint !== expectedFingerprint) throw new Error('SMOKE_FINGERPRINT_CHANGED');
  if (!cache || cache._openid !== openid || cache.cacheId !== entry.cacheId || cache.renderInputFingerprint !== entry.renderInputFingerprint || cache.rendererVersion !== job.rendererVersion || cache.source !== 'ai_cache' || !cache.text?.trim()) throw new Error('SMOKE_CANONICAL_MISSING');
  const has = (stage, status) => audit.stages.some((value) => value.stage === stage && value.status === status);
  const starts = audit.stages.filter((value) => value.stage === 'PROVIDER_START' && value.status === 'started');
  if (!has('CACHE_LOOKUP_DONE', mode === 'miss' ? 'miss' : 'hit')) throw new Error('SMOKE_CACHE_STAGE_MISSING');
  const summary = audit.summaries.at(-1);
  if (!summary || summary.failure !== null || audit.stages.some((value) => value.failure)) throw new Error('SMOKE_AUDIT_FAILED_OR_MISSING');
  if (mode === 'miss') {
    const timeline = buildTimeline(audit);
    if (starts.length !== 1 || !has('FIRST_CARD_AI_ADMITTED', 'admitted') || !has('PROVIDER_COMPLETE', 'completed')
      || !has('VALIDATOR_COMPLETE', 'accepted') || !(has('CANONICAL_PERSISTED', 'completed') || has('CANONICAL_PERSISTED', 'tail'))
      || summary.executionOutcome !== 'succeeded' || summary.validated !== true || summary.persisted !== true) throw new Error('SMOKE_AI_NOT_SUCCESSFUL');
    if (!Number.isFinite(timeline.FULL_BATCH_READY)
      || !(timeline.AI_START < timeline.FULL_BATCH_READY)) throw new Error('SMOKE_PROVIDER_NOT_BEFORE_FULL_BATCH');
  } else {
    if (starts.length || summary.providerCalled !== false || summary.firstCardAiStarted !== false) throw new Error('SMOKE_HIT_CALLED_PROVIDER');
    if (requireCanonicalText && hash(result.firstCard.todayReason || '') !== hash(cache.text)) throw new Error('SMOKE_HIT_TEXT_MISMATCH');
  }
  return { batchId: result.batchId, jobId: job.jobId, fingerprint: entry.renderInputFingerprint,
    cacheId: entry.cacheId, cacheTextSha256: hash(cache.text), providerStarts: starts.length,
    canonicalTextMatched: hash(result.firstCard.todayReason || '') === hash(cache.text),
    mode, completeReason: result.completeReason, httpStatus: result.statusCode,
    timeline: buildTimeline(audit),
    attribution: buildAttribution(audit),
    stages: audit.stages, performanceStages: audit.performanceStages || [],
    summary, unparsedLogRecords: audit.unparsed };
}

module.exports = { parseObject, extractAudit, verifyInvocation, buildTimeline, buildAttribution };
