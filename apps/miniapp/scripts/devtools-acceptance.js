'use strict';

// Direct DevTools acceptance. This entry point intentionally has no GUI/window
// dependency: TCP + miniprogram-automator are the only liveness signals.
const net = require('node:net');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const {
  SERVICE_PORT,
  AUTOMATOR_PORT,
  parseNetstatListeners,
  readListeners,
  ensureDevToolsDirectSession,
} = require('./devtools-direct-session');

const WS_ENDPOINT = process.env.AUTOMATOR_WS_ENDPOINT || `ws://127.0.0.1:${AUTOMATOR_PORT}`;
const LEDGER_KEY = 'today:performance-ledger:v1';
const CURRENT_LEDGER_SCHEMA_VERSION = 3;
const LEDGER_DIR = path.resolve(__dirname, '../../../artifacts/today-performance-ledger-20260807');

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function errorText(error) { return String(error?.stack || error?.message || error); }
function json(value) { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); }

function tcpProbe(port, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const finish = (result) => { socket.destroy(); resolve(result); };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish({ ok: true }));
    socket.once('timeout', () => finish({ ok: false, error: `TCP timeout ${port}` }));
    socket.once('error', (error) => finish({ ok: false, error: errorText(error) }));
  });
}

function listenerInfo(port) {
  const script = `$rows=@(Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,OwningProcess); $rows | ConvertTo-Json -Compress`;
  try {
    const raw = childProcess.execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: 4000 }).trim();
    const rows = raw ? JSON.parse(raw) : [];
    const normalized = (Array.isArray(rows) ? rows : [rows]).filter(Boolean);
    if (normalized.length === 0) {
      const fallback = childProcess.execFileSync('netstat.exe', ['-ano', '-p', 'TCP'], { encoding: 'utf8', timeout: 4000 });
      return parseNetstatListeners(fallback, port).map((row) => ({ ...row, processName: processNameForPid(row.pid) }));
    }
    return normalized.map((row) => {
      const pid = Number(row.OwningProcess);
      let processName = null;
      try { processName = childProcess.execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${pid} -ErrorAction Stop).ProcessName`], { encoding: 'utf8', timeout: 2000 }).trim(); } catch {}
      return { address: row.LocalAddress, port: Number(row.LocalPort), pid, processName };
    });
  } catch (error) {
    try {
      const raw = childProcess.execFileSync('netstat.exe', ['-ano', '-p', 'TCP'], { encoding: 'utf8', timeout: 4000 });
      return parseNetstatListeners(raw, port).map((row) => ({ ...row, processName: processNameForPid(row.pid) }));
    } catch (fallbackError) { return { error: `${errorText(error)}; netstat fallback: ${errorText(fallbackError)}` }; }
  }
}
function processNameForPid(pid) {
  try { return childProcess.execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${pid} -ErrorAction Stop).ProcessName`], { encoding: 'utf8', timeout: 2000 }).trim() || null; } catch { return null; }
}
function loadAutomator() {
  const packagePath = require.resolve('miniprogram-automator/package.json', { paths: [path.resolve(__dirname, '../..'), process.cwd()] });
  const packageRoot = path.dirname(packagePath);
  const automator = require(packageRoot);
  return { automator, packageRoot, version: JSON.parse(fs.readFileSync(packagePath, 'utf8')).version };
}

async function connectWithRetry() {
  const { automator, packageRoot, version } = loadAutomator();
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const mini = await automator.connect({ wsEndpoint: WS_ENDPOINT });
      return { mini, packageRoot, version, attempts: attempt };
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(700);
    }
  }
  const error = new Error(errorText(lastError));
  error.cause = lastError;
  throw error;
}

async function health() {
  let session;
  try {
    session = await ensureDevToolsDirectSession({ endpoint: WS_ENDPOINT });
    const stack = typeof session.mini.pageStack === 'function' ? await session.mini.pageStack() : [];
    const runtime = await session.mini.systemInfo();
    return { classification: 'AUTOMATOR_OK', service52849: 'LISTEN', automator9420: 'LISTEN', serviceListener: session.service.listeners, listener: session.automator.listeners, pid: session.automator.listeners?.[0]?.pid || null, processName: session.automator.listeners?.[0]?.processName || null, automatorConnect: 'OK', automatorPackage: `miniprogram-automator@${session.version}`, currentPage: session.page.path || null, route: session.route, pageStack: stack.map((item) => item.path || null), runtime: { SDKVersion: runtime?.SDKVersion || null } };
  } catch (error) {
    return { classification: error.code || 'AUTOMATOR_ATTACH_FAILED', service52849: 'UNKNOWN', automator9420: 'UNKNOWN', underlyingError: errorText(error), details: error.details || null };
  } finally { try { session?.mini.disconnect(); } catch {} }
}

async function connectHealth() {
  try {
    const session = await ensureDevToolsDirectSession({ endpoint: WS_ENDPOINT });
    json({ classification: 'AUTOMATOR_OK', service52849: 'LISTEN', automator9420: 'LISTEN', automatorPackage: `miniprogram-automator@${session.version}`, route: session.route });
    return session;
  } catch (error) {
    json({ classification: error.code || 'AUTOMATOR_ATTACH_FAILED', underlyingError: errorText(error), details: error.details || null });
    process.exitCode = 1;
    return null;
  }
}

async function readLedger(mini) {
  return mini.evaluate(() => wx.getStorageSync('today:performance-ledger:v1'));
}

function summarizeLedger(snapshot) {
  const active = snapshot?.active || null;
  const stages = active?.stages || {};
  const durations = active?.durations || {};
  const firstCard = durations.onShowToFirstCard ?? delta(stages.todayOnShow, stages.firstCardMounted);
  const firstImage = durations.onShowToFirstImage ?? delta(stages.todayOnShow, stages.firstImageLoaded);
  return { runId: active?.runId || null, ledgerSchemaVersion: active?.ledgerSchemaVersion ?? 'NOT_OBSERVED', restoreDispatchAttempt: active?.restoreDispatchAttempt ?? 'NOT_OBSERVED', restoreFunctionEntered: active?.restoreFunctionEntered ?? 'NOT_OBSERVED', authContextCurrentChecked: active?.authContextCurrentChecked ?? 'NOT_OBSERVED', authContextCurrentResult: active?.authContextCurrentResult ?? 'NOT_OBSERVED', restoreReturnReason: active?.restoreReturnReason ?? 'NOT_OBSERVED', snapshotReadStart: active?.snapshotReadStart ?? stages.snapshotReadStart ?? 'NOT_OBSERVED', restoreException: active?.restoreException ?? 'NOT_OBSERVED', snapshotFound: normalizeStageBoolean(stages.snapshotFound), snapshotValid: normalizeStageBoolean(stages.snapshotValid), snapshotRejectReason: normalizeObserved(stages.snapshotRejectReason) || '', snapshotCardCount: stages.snapshotCardCount ?? 'NOT_OBSERVED', finalCardCount: active?.finalCardCount ?? stages.finalCardCount ?? 'NOT_OBSERVED', generateOutfitRequestCount: active?.generateOutfitRequestCount ?? stages.generateOutfitRequestCount ?? 'NOT_OBSERVED', executionMode: active?.executionMode || stages.executionMode || 'UNKNOWN', complete: active?.complete || false, stages, durations, firstCardMs: firstCard, firstImageMs: firstImage };
}
function normalizeObserved(value) { return value === 'NOT_OBSERVED' ? undefined : value; }
function normalizeStageBoolean(value) {
  const observed = normalizeObserved(value);
  if (observed === undefined || observed === null) return 'NOT_OBSERVED';
  if (observed === false || observed === 'false') return false;
  return observed === true || observed === 'true' || typeof observed === 'number';
}
function delta(start, end) { return typeof start === 'number' && typeof end === 'number' ? Math.max(0, end - start) : 'NOT_OBSERVED'; }
function isHot(summary, expectedSchemaVersion = CURRENT_LEDGER_SCHEMA_VERSION) { return summary.ledgerSchemaVersion === expectedSchemaVersion && summary.snapshotFound === true && summary.snapshotValid === true && !summary.snapshotRejectReason && summary.snapshotCardCount === 8 && summary.finalCardCount === 8 && summary.generateOutfitRequestCount === 0; }
function classification(ms) { return typeof ms !== 'number' ? 'HOTLOAD_STILL_SLOW' : ms < 500 ? 'HOTLOAD_EXCELLENT' : ms <= 1000 ? 'SNAPSHOT_HOTLOAD_OPTIMIZED' : 'HOTLOAD_STILL_SLOW'; }
function persist(name, value) { fs.mkdirSync(LEDGER_DIR, { recursive: true }); fs.writeFileSync(path.join(LEDGER_DIR, name), `${JSON.stringify(value, null, 2)}\n`); }

async function triggerTodayDetailReturn(mini) {
  const page = await mini.currentPage();
  const cards = await page.$$('.outfit-card');
  if (cards.length === 0) return false;
  await cards[0].tap();
  await sleep(500);
  await mini.navigateBack();
  return true;
}

async function todayHot() {
  const session = await connectHealth();
  if (!session) return;
  try {
    let summary = summarizeLedger(await readLedger(session.mini));
    if (summary.ledgerSchemaVersion !== CURRENT_LEDGER_SCHEMA_VERSION) {
      const result = { ...summary, classification: 'BUNDLE_STALE', hot: false, expectedLedgerSchemaVersion: CURRENT_LEDGER_SCHEMA_VERSION };
      persist('hot-direct-acceptance.json', result);
      json(result);
      process.exitCode = 2;
      return;
    }
    if (!summary.complete) {
      const deadline = Date.now() + 15000;
      do { await sleep(500); summary = summarizeLedger(await readLedger(session.mini)); } while (!summary.complete && Date.now() < deadline);
      if (!summary.complete) {
        // The previous run can be a stale interrupted lifecycle. One normal
        // tab round-trip creates exactly one fresh Today run; never loop it.
        const previousRunId = summary.runId;
        await session.mini.switchTab('/pages/wardrobe/index');
        await session.mini.switchTab('/pages/today/index');
        const freshDeadline = Date.now() + 15000;
        do { await sleep(500); summary = summarizeLedger(await readLedger(session.mini)); } while ((summary.runId === previousRunId || !summary.complete) && Date.now() < freshDeadline);
      }
    }
    if (!isHot(summary) && summary.complete) {
      const before = summary.runId;
      const exercisedReturnPath = summary.finalCardCount === 8
        ? await triggerTodayDetailReturn(session.mini)
        : false;
      if (!exercisedReturnPath) {
        await session.mini.switchTab('/pages/wardrobe/index');
        await session.mini.switchTab('/pages/today/index');
      }
      const deadline = Date.now() + 15000;
      do { await sleep(500); summary = summarizeLedger(await readLedger(session.mini)); } while ((summary.runId === before || !summary.complete) && Date.now() < deadline);
    }
    const result = { ...summary, currentPage: (await session.mini.currentPage()).path, hot: isHot(summary), firstCardClassification: classification(summary.firstCardMs), firstImageClassification: classification(summary.firstImageMs) };
    persist('hot-direct-acceptance.json', result);
    json(result);
    if (!result.hot) process.exitCode = 2;
  } finally { try { session.mini.disconnect(); } catch {} }
}

async function main() {
  const command = process.argv[2] || 'health';
  if (command === 'health') { const result = await health(); json(result); if (result.classification !== 'AUTOMATOR_OK') process.exitCode = 1; return; }
  if (command === 'today-hot') return todayHot();
  throw new Error(`Unknown command: ${command}`);
}
if (require.main === module) main().catch((error) => { process.stderr.write(`${errorText(error)}\n`); process.exitCode = 1; });
module.exports = { parseNetstatListeners, summarizeLedger, isHot, classification, ensureDevToolsDirectSession };
