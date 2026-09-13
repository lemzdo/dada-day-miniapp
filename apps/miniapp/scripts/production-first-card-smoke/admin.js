'use strict';

const { execFileSync } = require('node:child_process');
const path = require('node:path');

const CACHE = 'recommendation_canonical_copy_cache_v2';
const JOBS = 'recommendation_copy_jobs_v2';
const AUDIT_FUNCTIONS = new Set(['recommendationStream', 'generateOutfit']);

function createAdmin({ envId, cliPath, runCli = defaultRunCli } = {}) {
  if (!envId) throw new Error('CLOUDBASE_ENV_ID_REQUIRED');
  const invoke = (command, options = {}) => runCli(command, { envId, cliPath, ...options });
  return {
    async getJob({ openid, batchId }) {
      requireValue(openid, 'OPENID_REQUIRED');
      requireValue(batchId, 'BATCH_ID_REQUIRED');
      const docs = await query(invoke, JOBS, { _openid: openid, batchId }, 2);
      if (docs.length > 1) throw new Error('JOB_RENDERER_AMBIGUOUS');
      return docs[0] || null;
    },
    async getCache({ openid, cacheId }) {
      requireValue(openid, 'OPENID_REQUIRED');
      requireValue(cacheId, 'CACHE_ID_REQUIRED');
      const docs = await query(invoke, CACHE, { _id: cacheId, cacheId, _openid: openid }, 1);
      return docs[0] || null;
    },
    async listRelatedJobs({ openid, cacheId, pageSize = 100, maxPages = 10 }) {
      requireValue(openid, 'OPENID_REQUIRED');
      requireValue(cacheId, 'CACHE_ID_REQUIRED');
      const docs = [];
      for (let page = 0; page < maxPages; page += 1) {
        const batch = await query(invoke, JOBS, { _openid: openid, 'entries.cacheId': cacheId }, pageSize, page * pageSize);
        docs.push(...batch);
        if (batch.length < pageSize) return docs;
      }
      throw new Error('RELATED_JOBS_PAGE_LIMIT_EXCEEDED');
    },
    async removeSingleCache({ openid, cacheId, expectedDoc }) {
      requireValue(openid, 'OPENID_REQUIRED');
      requireValue(cacheId, 'CACHE_ID_REQUIRED');
      assertExpectedDoc(expectedDoc, { openid, cacheId });
      const current = await this.getCache({ openid, cacheId });
      if (!current || !sameDocument(current, expectedDoc)) return 0;
      const q = expectedDoc;
      const result = await invoke({ TableName: CACHE, CommandType: 'DELETE', Command: JSON.stringify({ delete: CACHE, deletes: [{ q, limit: 1 }] }) });
      return deleteCount(result);
    },
    async getAuditLogs({ auditId, startTime, endTime, limit = 100, maxPages = 30,
      functionName = 'recommendationStream' }) {
      if (!/^[A-Za-z0-9_.:-]+$/.test(auditId || '')) throw new Error('AUDIT_ID_INVALID');
      if (!AUDIT_FUNCTIONS.has(functionName)) throw new Error('AUDIT_FUNCTION_INVALID');
      const search = async (queryString) => {
        const logs = [];
        let context;
        for (let page = 0; page < maxPages; page += 1) {
          const result = await invoke({ type: 'logs', queryString, startTime, endTime, limit, context });
          logs.push(...normalizeLogs(result));
          const next = result?.meta?.context;
          if (result?.meta?.listOver === true) return logs;
          if (!next || next === context) throw new Error('AUDIT_LOG_PAGINATION_INCOMPLETE');
          context = next;
        }
        throw new Error('AUDIT_LOG_PAGE_LIMIT_EXCEEDED');
      };
      // CloudBase splits console objects into individual CLS lines. Searching
      // for auditId alone returns only identifier lines, not their objects.
      const matches = await search(`"${auditId}"`);
      const requestIds = [...new Set(matches.filter((row) => row.content?.function_name === functionName)
        .map((row) => row.content?.request_id).filter(Boolean))];
      if (requestIds.length === 0) return [];
      if (requestIds.length !== 1 || !/^[\w-]+$/.test(requestIds[0])) throw new Error('AUDIT_REQUEST_ID_AMBIGUOUS');
      const requestId = requestIds[0];
      const lines = await search(`request_id:"${requestId}"`);
      if (lines.some((row) => row.content?.request_id !== requestId || row.content?.function_name !== functionName)) throw new Error('AUDIT_REQUEST_ID_MISMATCH');
      // search uses ASC and pagination preserves equal-timestamp line order.
      return [{ requestId, log: lines.map((row) => row.content.log || '').join('\n') }];
    },
  };
}

async function query(invoke, table, filter, limit, skip = 0) {
  const result = await invoke({ TableName: table, CommandType: 'QUERY', Command: JSON.stringify({ find: table, filter, sort: { _id: 1 }, limit, ...(skip ? { skip } : {}) }) });
  return extractDocuments(result);
}

function defaultRunCli(command, { envId, cliPath = defaultCliPath() } = {}) {
  if (command.type === 'logs') {
    const args = ['logs', 'search', '--query', command.queryString, '--timeRange', `${formatDateTime(command.startTime)},${formatDateTime(command.endTime)}`, '--sort', 'asc', '--limit', String(command.limit), '--json', '--env-id', envId];
    if (command.context) args.push('--context', command.context);
    return runCliProcess(cliPath, args, 'AUDIT_LOG_QUERY_FAILED');
  }
  const args = ['db', 'nosql', 'execute', '--command', JSON.stringify([command]), '--json', '--env-id', envId];
  return runCliProcess(cliPath, args, 'DATABASE_QUERY_FAILED');
}

function runCliProcess(cliPath, args, code) {
  try {
    const stdout = execFileSync(process.execPath, [cliPath, ...args], { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
    const json = stdout.slice(stdout.indexOf('{'));
    const result = JSON.parse(json);
    if (result?.success === false) throw new Error(code);
    return result;
  } catch (error) {
    if (error?.message === code) throw error;
    throw Object.assign(new Error(code), { cause: undefined });
  }
}

function extractDocuments(result) {
  const data = result?.data?.results ? result.data : result?.data?.[0] || result?.Data?.[0];
  if (!data) throw new Error('DATABASE_RESPONSE_INVALID');
  const results = data.results;
  if (!Array.isArray(results) || results.length !== 1 || !Array.isArray(results[0])
    || results[0].some((item) => !item || typeof item !== 'object' || Array.isArray(item))) throw new Error('DATABASE_RESPONSE_INVALID');
  return results[0].map(decodeNumbers);
}

function deleteCount(result) {
  const rows = result?.data?.results;
  const acknowledgements = Array.isArray(rows) ? rows.flat().map(decodeNumbers) : [];
  if (acknowledgements.length > 1) throw new Error('DELETE_COUNT_UNKNOWN');
  const acknowledgement = acknowledgements[0];
  if (acknowledgement?.ok === 0 || acknowledgement?.writeErrors?.length || acknowledgement?.writeConcernError) throw new Error('CACHE_DELETE_FAILED');
  const value = acknowledgement?.deletedCount ?? acknowledgement?.n ?? result?.data?.[0]?.deletedCount ?? result?.Data?.[0]?.deletedCount;
  if (value === undefined || value === null) throw new Error('DELETE_COUNT_UNKNOWN');
  const count = Number(value?.$numberInt ?? value);
  if (!Number.isInteger(count) || count < 0) throw new Error('DELETE_COUNT_UNKNOWN');
  return count;
}

function assertExpectedDoc(doc, { openid, cacheId }) {
  const allowed = ['_id', 'version', 'rendererVersion', 'cacheId', '_openid', 'renderInputFingerprint', 'planId', 'planHash', 'text', 'source', 'availableAt'];
  if (Object.keys(doc || {}).some((key) => !allowed.includes(key)) || Object.keys(doc || {}).length !== allowed.length) throw new Error('CACHE_EXPECTED_DOCUMENT_INCOMPLETE');
  if (!doc || doc._openid !== openid || doc._id !== cacheId || doc.cacheId !== cacheId
    || doc.source !== 'ai_cache' || !doc.version || !doc.rendererVersion
    || !doc.renderInputFingerprint || !doc.availableAt || !doc.planId || !doc.planHash
    || typeof doc.text !== 'string') throw new Error('CACHE_EXPECTED_DOCUMENT_INVALID');
}

function sameDocument(left, right) {
  if (Object.keys(left || {}).length !== Object.keys(right || {}).length) return false;
  return ['_id', 'version', 'rendererVersion', 'cacheId', '_openid', 'renderInputFingerprint', 'planId', 'planHash', 'text', 'source', 'availableAt']
    .every((key) => left?.[key] === right?.[key]);
}

function requireValue(value, error) { if (!value) throw new Error(error); }
function decodeNumbers(value) {
  if (Array.isArray(value)) return value.map(decodeNumbers);
  if (!value || typeof value !== 'object') return value;
  if (Object.keys(value).length === 1 && ['$numberInt', '$numberLong', '$numberDouble'].some((key) => key in value)) return Number(Object.values(value)[0]);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decodeNumbers(item)]));
}
function normalizeLogs(result) {
  const raw = Array.isArray(result) ? result : result?.data?.results || result?.data || result?.results || [];
  if (!Array.isArray(raw)) throw new Error('AUDIT_LOG_RESPONSE_INVALID');
  return raw.map((entry) => typeof entry === 'string' ? JSON.parse(entry) : entry);
}
function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('AUDIT_LOG_TIMESTAMP_INVALID');
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}
function defaultCliPath() { return path.resolve(__dirname, '../../../../node_modules/@cloudbase/cli/bin/tcb'); }

module.exports = { AUDIT_FUNCTIONS, CACHE, JOBS, createAdmin, decodeNumbers, extractDocuments, formatDateTime, normalizeLogs, sameDocument };
