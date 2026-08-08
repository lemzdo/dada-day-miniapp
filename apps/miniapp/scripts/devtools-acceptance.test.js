'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { parseNetstatListeners, summarizeLedger, isHot, classification } = require('./devtools-acceptance');
const {
  ensureDevToolsDirectSession,
  extractPerformanceLedger,
  summarizeCloudResponse,
  unicodeInputPreflight,
} = require('./devtools-direct-session');

test('accepts IPv4 wildcard and IPv6 listeners', () => {
  const rows = parseNetstatListeners('TCP    0.0.0.0:9420    0.0.0.0:0    LISTENING    123\nTCP    [::]:9420    [::]:0    LISTENING    456', 9420);
  assert.deepEqual(rows.map((row) => [row.address, row.pid]), [['0.0.0.0', 123], ['::', 456]]);
});

test('classifies a live snapshot as automator hot path', () => {
  const summary = summarizeLedger({ active: { runId: 'run', ledgerSchemaVersion: 3, executionMode: 'HOT', finalCardCount: 8, generateOutfitRequestCount: 0, complete: true, stages: { snapshotFound: true, snapshotValid: true, snapshotCardCount: 8 }, durations: { onShowToFirstCard: 400, onShowToFirstImage: 800 } } });
  assert.equal(isHot(summary), true);
  assert.equal(classification(summary.firstCardMs), 'HOTLOAD_EXCELLENT');
  assert.equal(classification(summary.firstImageMs), 'SNAPSHOT_HOTLOAD_OPTIMIZED');
});

test('preserves a real snapshot rejection', () => {
  const summary = summarizeLedger({ active: { runId: 'run', ledgerSchemaVersion: 3, finalCardCount: 8, generateOutfitRequestCount: 1, stages: { snapshotFound: false, snapshotValid: false, snapshotRejectReason: 'FINGERPRINT' }, durations: {} } });
  assert.equal(isHot(summary), false);
  assert.equal(summary.snapshotRejectReason, 'FINGERPRINT');
});

function directDeps({ service = true, automator = true, mini, connectError, spawn } = {}) {
  const listeners = {
    52849: service ? [{ address: '127.0.0.1', port: 52849, pid: 11 }] : [],
    9420: automator ? [{ address: '0.0.0.0', port: 9420, pid: 22 }] : [],
  };
  return {
    readListeners: (port) => listeners[port],
    tcpProbe: async () => ({ ok: true }),
    spawn: spawn || (() => ({ unref() {} })),
    automator: {
      version: '0.12.1',
      packageRoot: 'fake-automator',
      module: {
        connect: async () => {
          if (connectError) throw new Error(connectError);
          return mini || {
            currentPage: async () => ({ path: 'pages/today/index' }),
            disconnect() {},
          };
        },
      },
    },
  };
}

test('LISTENING on 0.0.0.0 is ready without requiring ESTABLISHED', async () => {
  const session = await ensureDevToolsDirectSession({ deps: directDeps() });
  assert.equal(session.route, 'pages/today/index');
  session.mini.disconnect();
});

test('LISTENING on :: is accepted and actively attaches', async () => {
  const deps = directDeps();
  deps.readListeners = (port) => port === 9420
    ? [{ address: '::', port: 9420, pid: 22 }]
    : [{ address: '127.0.0.1', port: 52849, pid: 11 }];
  const session = await ensureDevToolsDirectSession({ deps });
  assert.equal(session.state, 'DEVTOOLS_RUNNING_AUTOMATOR_SERVER_LISTENING_AUTOMATOR_ATTACHED');
  session.mini.disconnect();
});

test('existing DevTools ports never start cli auto again', async () => {
  let spawnCount = 0;
  const session = await ensureDevToolsDirectSession({ deps: directDeps({ spawn: () => { spawnCount += 1; return { unref() {} }; } }) });
  assert.equal(spawnCount, 0);
  session.mini.disconnect();
});

test('only-down ports start cli once and then attach', async () => {
  let spawnCount = 0;
  const deps = directDeps({ service: false, automator: false, spawn: () => {
    spawnCount += 1;
    deps.readListeners = (port) => [{ address: port === 9420 ? '::' : '0.0.0.0', port, pid: 99 }];
    return { unref() {} };
  } });
  const session = await ensureDevToolsDirectSession({ deps, pollMs: 1, waitMs: 50 });
  assert.equal(spawnCount, 1);
  session.mini.disconnect();
});

test('attach failure reports the concrete classification and underlying message', async () => {
  await assert.rejects(
    ensureDevToolsDirectSession({ deps: directDeps({ connectError: 'websocket handshake refused' }) }),
    (error) => error.code === 'AUTOMATOR_ATTACH_FAILED' && error.message.includes('websocket handshake refused'),
  );
});

test('extracts the ledger from the real wx.cloud.callFunction envelope', () => {
  const raw = {
    result: {
      code: 0,
      data: {
        debug: { auditId: 'audit-envelope' },
        outfits: [{ id: 'one' }],
        diagnostics: { performance: { serverTotalMs: 123, phases: [{ phase: 'handlerEnd', duration: 123 }] } },
      },
      message: 'ok',
    },
  };
  const ledger = extractPerformanceLedger(raw);
  const summary = summarizeCloudResponse(raw);
  assert.equal(ledger.serverTotalMs, 123);
  assert.equal(summary.auditId, 'audit-envelope');
  assert.deepEqual(summary.responseTopLevelKeys, ['code', 'data', 'message']);
  assert.ok(summary.rawResponseBytes > summary.businessDataBytes);
});

test('missing ledger reports concrete code and visible keys', () => {
  assert.throws(
    () => extractPerformanceLedger({ code: 0, data: { outfits: [] }, message: 'ok' }),
    (error) => error.code === 'PERFORMANCE_LEDGER_MISSING'
      && error.details.dataTopLevelKeys.includes('outfits'),
  );
});

test('Unicode input round-trip preserves Chinese fields and punctuation', async () => {
  const mini = { evaluate: async (fn, value) => fn(value) };
  const result = await unicodeInputPreflight(mini);
  assert.equal(result.status, 'UNICODE_INPUT_PREFLIGHT_PASS');
  assert.equal(result.input.weather.condition, '晴');
  assert.equal(result.input.weather.temperature, '31℃');
  assert.equal(result.input.weather.wind, '东南风');
  assert.equal(result.input.scene, '居家');
  assert.match(result.input.text, /“大衣”/);
});
