'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAdmin, decodeNumbers, formatDateTime, normalizeLogs, extractDocuments } = require('./admin');

const doc = { _id: 'rcc-x', version: 'v', rendererVersion: 'r', cacheId: 'rcc-x', _openid: 'u', renderInputFingerprint: 'f', planId: 'p', planHash: 'h', text: 'copy', source: 'ai_cache', availableAt: '2026-09-02T00:00:00.000Z' };

test('decodes CloudBase extended JSON numbers recursively', () => {
  assert.deepEqual(decodeNumbers({ position: { $numberInt: '0' }, nested: [{ $numberLong: '2' }] }), { position: 0, nested: [2] });
});

test('formatDateTime normalizes numeric timestamps', () => {
  assert.match(formatDateTime(Date.parse('2026-09-02T14:35:29Z')), /^2026-09-02 \d{2}:\d{2}:\d{2}$/);
});

test('removeSingleCache returns exact affected count and sends full CAS filter', async () => {
  const calls = [];
  const admin = createAdmin({ envId: 'e', runCli: async (command) => {
    calls.push(command);
    if (command.CommandType === 'QUERY') return { data: [{ results: [[doc]] }] };
    return { data: [{ deletedCount: { $numberInt: '1' } }] };
  } });
  assert.equal(await admin.removeSingleCache({ openid: 'u', cacheId: 'rcc-x', expectedDoc: doc }), 1);
  const deletion = calls[1];
  assert.equal(JSON.parse(deletion.Command).deletes[0].limit, 1);
  assert.deepEqual(JSON.parse(deletion.Command).deletes[0].q, doc);
});

test('removeSingleCache rejects incomplete expected documents', async () => {
  const admin = createAdmin({ envId: 'e', runCli: async () => ({}) });
  await assert.rejects(() => admin.removeSingleCache({ openid: 'u', cacheId: 'rcc-x', expectedDoc: { ...doc, text: undefined } }), /CACHE_EXPECTED_DOCUMENT/);
});

test('getJob rejects multiple renderer records', async () => {
  const admin = createAdmin({ envId: 'e', runCli: async () => ({ data: [{ results: [[{ rendererVersion: 'a' }, { rendererVersion: 'b' }]] }] }) });
  await assert.rejects(() => admin.getJob({ openid: 'u', batchId: 'b' }), /JOB_RENDERER_AMBIGUOUS/);
});

test('audit discovery fetches complete request lines across CLS cursor pages', async () => {
  let page = 0;
  const admin = createAdmin({ envId: 'e', runCli: async (command) => {
    if (command.type !== 'logs') throw new Error('unexpected');
    page += 1;
    const row = (log) => ({ content: { request_id: 'request-1', function_name: 'recommendationStream', log } });
    if (page === 1) {
      assert.equal(command.queryString, '"audit-1"');
      return { data: { results: [row("auditId: 'audit-1',")] }, meta: { listOver: true } };
    }
    assert.equal(command.queryString, 'request_id:"request-1"');
    if (page === 3) assert.equal(command.context, 'next');
    return page === 2 ? { data: { results: [row('[RecommendationAudit] {')] }, meta: { context: 'next', listOver: false } } : { data: { results: [row("auditId: 'audit-1'"), row('}')] }, meta: { listOver: true } };
  } });
  const logs = await admin.getAuditLogs({ auditId: 'audit-1', startTime: '2026-09-02 14:00:00', endTime: '2026-09-02 15:00:00', limit: 1 });
  assert.equal(page, 3);
  assert.deepEqual(logs, [{ requestId: 'request-1', log: "[RecommendationAudit] {\nauditId: 'audit-1'\n}" }]);
});

test('audit discovery can target the generateOutfit background tail explicitly', async () => {
  let calls = 0;
  const admin = createAdmin({ envId: 'e', runCli: async (command) => {
    calls += 1;
    const row = (functionName, log) => ({ content: {
      request_id: 'tail-request-1',
      function_name: functionName,
      log,
    } });
    return calls === 1
      ? { data: { results: [
        row('recommendationStream', "auditId: 'audit-tail',"),
        row('generateOutfit', "auditId: 'audit-tail',"),
      ] }, meta: { listOver: true } }
      : { data: { results: [row('generateOutfit', '[RecommendationAudit] {}')] }, meta: { listOver: true } };
  } });
  const logs = await admin.getAuditLogs({
    auditId: 'audit-tail',
    startTime: '2026-09-13 10:00:00',
    endTime: '2026-09-13 10:10:00',
    functionName: 'generateOutfit',
  });
  assert.deepEqual(logs, [{ requestId: 'tail-request-1', log: '[RecommendationAudit] {}' }]);
  await assert.rejects(() => admin.getAuditLogs({
    auditId: 'audit-tail',
    startTime: 0,
    endTime: 1,
    functionName: 'otherFunction',
  }), /AUDIT_FUNCTION_INVALID/);
});

test('normalizeLogs preserves only parsed entries', () => {
  assert.equal(normalizeLogs({ data: [{ timestamp: 1788359729000 }] })[0].timestamp, 1788359729000);
});

test('real CLI data.results shape preserves documents and extended numbers', () => {
  assert.deepEqual(extractDocuments({ data: { results: [[{ ...doc, count: { $numberInt: '0' } }]], requestId: 'r' } }), [{ ...doc, count: 0 }]);
  assert.deepEqual(extractDocuments({ data: { results: [[]] } }), []);
  assert.throws(() => extractDocuments({ success: true }), /DATABASE_RESPONSE_INVALID/);
  assert.throws(() => extractDocuments({ data: { results: [{ error: 'query failed' }] } }), /DATABASE_RESPONSE_INVALID/);
});

test('Mongo deletion acknowledgement must contain an explicit affected count', async () => {
  for (const [acknowledgement, expected] of [[{ n: { $numberInt: '1' }, ok: 1 }, 1], [{ n: 0, ok: 1 }, 0], [{ ok: 1 }, null]]) {
    const admin = createAdmin({ envId: 'e', runCli: async (command) => ({ data: { results: command.CommandType === 'QUERY' ? [[doc]] : [acknowledgement] } }) });
    const remove = () => admin.removeSingleCache({ openid: 'u', cacheId: 'rcc-x', expectedDoc: doc });
    if (expected === null) await assert.rejects(remove, /DELETE_COUNT_UNKNOWN/);
    else assert.equal(await remove(), expected);
  }
});
