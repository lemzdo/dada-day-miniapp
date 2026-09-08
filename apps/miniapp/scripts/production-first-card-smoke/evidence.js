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
    stages: audit.stages, performanceStages: audit.performanceStages || [],
    summary, unparsedLogRecords: audit.unparsed };
}

module.exports = { parseObject, extractAudit, verifyInvocation, buildTimeline };
