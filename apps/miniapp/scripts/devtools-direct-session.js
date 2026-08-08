'use strict';

const net = require('node:net');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const SERVICE_PORT = 52849;
const AUTOMATOR_PORT = 9420;
const TODAY_ROUTE = 'pages/today/index';
const TODAY_URL = '/pages/today/index';
const DEFAULT_ENDPOINT = `ws://127.0.0.1:${AUTOMATOR_PORT}`;
const DEFAULT_CLI = 'D:\\soft\\Tecent\\微信web开发者工具\\cli.bat';
const DEFAULT_PROJECT = path.resolve(__dirname, '..');

function errorText(error) { return String(error?.stack || error?.message || error); }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function jsonByteLength(value) {
  return Buffer.byteLength(JSON.stringify(value === undefined ? null : value), 'utf8');
}

function unwrapCloudResponse(rawResponse) {
  if (rawResponse?.result && typeof rawResponse.result === 'object') return rawResponse.result;
  return rawResponse && typeof rawResponse === 'object' ? rawResponse : null;
}

function extractPerformanceLedger(rawResponse) {
  const response = unwrapCloudResponse(rawResponse);
  const data = response?.data && typeof response.data === 'object' && !Array.isArray(response.data)
    ? response.data
    : null;
  const performance = data?.diagnostics?.performance;
  if (!performance || typeof performance !== 'object' || Array.isArray(performance)) {
    throw classifyFailure('PERFORMANCE_LEDGER_MISSING', 'response does not contain data.diagnostics.performance', {
      responseTopLevelKeys: Object.keys(response || {}),
      dataTopLevelKeys: Object.keys(data || {}),
    });
  }
  return performance;
}

function summarizeCloudResponse(rawResponse) {
  const response = unwrapCloudResponse(rawResponse);
  const data = response?.data && typeof response.data === 'object' && !Array.isArray(response.data)
    ? response.data
    : null;
  return {
    rawResponseBytes: jsonByteLength(response),
    businessDataBytes: jsonByteLength(data),
    responseTopLevelKeys: Object.keys(response || {}),
    dataTopLevelKeys: Object.keys(data || {}),
    auditId: data?.debug?.auditId || data?.meta?.auditId || null,
    performanceLedger: data?.diagnostics?.performance || null,
  };
}

async function unicodeInputPreflight(mini, input = {
  weather: { condition: '\u6674', temperature: '31\u2103', wind: '\u4e1c\u5357\u98ce' },
  scene: '\u5c45\u5bb6',
  text: '\u7a7a\u683c\uff0c\u987f\u53f7\u3001\u5206\u53f7\uff1b\u5546\u54c1\u201c\u5927\u8863\u201d',
}) {
  if (!mini || typeof mini.evaluate !== 'function') {
    throw classifyFailure('UNICODE_INPUT_PREFLIGHT_FAILED', 'automator session has no evaluate()');
  }
  const echoed = await mini.evaluate((value) => value, input);
  if (JSON.stringify(echoed) !== JSON.stringify(input)) {
    throw classifyFailure('UNICODE_INPUT_PREFLIGHT_FAILED', 'automator argument round-trip changed Unicode input', { input, echoed });
  }
  return { status: 'UNICODE_INPUT_PREFLIGHT_PASS', input: echoed };
}

function parseNetstatListeners(output, port) {
  const rows = [];
  for (const line of String(output).split(/\r?\n/)) {
    const match = line.trim().match(/^TCP\s+([^\s]+)\s+[^\s]+\s+LISTENING\s+(\d+)$/i);
    if (!match) continue;
    const address = match[1];
    const localPort = Number(address.slice(address.lastIndexOf(':') + 1));
    if (localPort !== port) continue;
    rows.push({
      address: address.slice(0, address.lastIndexOf(':')).replace(/^\[|\]$/g, ''),
      port: localPort,
      pid: Number(match[2]),
    });
  }
  return rows;
}

function readListeners(port, execFileSync = childProcess.execFileSync) {
  const script = `$rows=@(Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,OwningProcess); $rows | ConvertTo-Json -Compress`;
  try {
    const raw = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: 4000 }).trim();
    const rows = raw ? JSON.parse(raw) : [];
    const normalized = (Array.isArray(rows) ? rows : [rows]).filter(Boolean);
    if (normalized.length === 0) {
      const fallback = execFileSync('netstat.exe', ['-ano', '-p', 'TCP'], { encoding: 'utf8', timeout: 4000 });
      return parseNetstatListeners(fallback, port);
    }
    return normalized.map((row) => ({ address: row.LocalAddress, port: Number(row.LocalPort), pid: Number(row.OwningProcess) }));
  } catch {
    try {
      const raw = execFileSync('netstat.exe', ['-ano', '-p', 'TCP'], { encoding: 'utf8', timeout: 4000 });
      return parseNetstatListeners(raw, port);
    } catch (error) {
      return { error: errorText(error) };
    }
  }
}

function tcpProbe(port, timeoutMs = 1200, connect = net.createConnection) {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port });
    const finish = (result) => { socket.destroy(); resolve(result); };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish({ ok: true }));
    socket.once('timeout', () => finish({ ok: false, error: `TCP timeout ${port}` }));
    socket.once('error', (error) => finish({ ok: false, error: errorText(error) }));
  });
}

function portState(port, deps = {}) {
  const listeners = (deps.readListeners || readListeners)(port, deps.execFileSync);
  return { port, listeners, listening: Array.isArray(listeners) && listeners.length > 0 };
}

function classifyFailure(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details });
}

const ACCEPTANCE_GUARD_KEY = '__d1dAcceptanceSingleRequestGuard';
const TODAY_PERFORMANCE_LEDGER_KEY = 'today:performance-ledger:v1';
const ACCEPTANCE_WRAPPER_MARKER = '__d1dAcceptanceWrapper';
const ACCEPTANCE_ORIGINAL_MARKER = '__d1dOriginalCallFunction';

function assertAcceptanceSingleRequest({ baselineCumulativeRequestCount, finalCumulativeRequestCount, capturedRequestCount }) {
  const baseline = Number(baselineCumulativeRequestCount) || 0;
  const final = Number(finalCumulativeRequestCount) || 0;
  const captured = Number(capturedRequestCount) || 0;
  if (captured !== 1 || final - baseline !== 1) {
    throw classifyFailure(
      'FINAL_SINGLE_REQUEST_VIOLATION',
      'acceptance run must capture exactly one request and increase cumulative count by one',
      { baselineCumulativeRequestCount: baseline, finalCumulativeRequestCount: final, capturedRequestCount: captured },
    );
  }
  return { baselineCumulativeRequestCount: baseline, finalCumulativeRequestCount: final, capturedRequestCount: captured };
}

async function readAcceptanceCumulativeRequestCount(mini) {
  if (!mini || typeof mini.evaluate !== 'function') {
    throw classifyFailure('ACCEPTANCE_LEDGER_READ_FAILED', 'automator session has no evaluate()');
  }
  return mini.evaluate(() => {
    const ledger = globalThis.wx?.getStorageSync?.('today:performance-ledger:v1');
    const count = (record) => Math.max(0, Number(record?.generateOutfitRequestCount) || 0);
    return count(ledger?.active) + (Array.isArray(ledger?.history) ? ledger.history.reduce((total, record) => total + count(record), 0) : 0);
  });
}

async function installAcceptanceSingleRequestGuard(mini, { acceptanceRunId, baselineCumulativeRequestCount } = {}) {
  if (!mini || typeof mini.evaluate !== 'function') {
    throw classifyFailure('ACCEPTANCE_GUARD_INSTALL_FAILED', 'automator session has no evaluate()');
  }
  if (!acceptanceRunId) throw classifyFailure('ACCEPTANCE_GUARD_INSTALL_FAILED', 'acceptanceRunId is required');
  return mini.evaluate((options) => {
    const globalObject = typeof globalThis === 'object' ? globalThis : {};
    const unwrap = (target) => {
      let changed = false;
      for (let attempt = 0; attempt < 16; attempt += 1) {
        const fn = target?.callFunction;
        if (typeof fn !== 'function') break;
        if (fn.__d1dAcceptanceWrapper === true && typeof fn.__d1dOriginalCallFunction === 'function') {
          target.callFunction = fn.__d1dOriginalCallFunction;
          changed = true;
          continue;
        }
        const tracker = target.__recommendationV61RunnerCapture;
        if (tracker?.wrapper === fn && typeof tracker.originalCallFunction === 'function') {
          target.callFunction = tracker.originalCallFunction;
          try { delete target.__recommendationV61RunnerCapture; } catch {}
          changed = true;
          continue;
        }
        const blocker = globalObject.__recommendationV61RunnerResetBlocker;
        const entry = blocker?.targets && Object.values(blocker.targets).find((item) => item?.target === target && item?.blocker === fn);
        if (entry?.original && typeof entry.original === 'function') {
          target.callFunction = entry.original;
          changed = true;
          continue;
        }
        break;
      }
      return changed;
    };
    const previous = globalObject.__d1dAcceptanceSingleRequestGuard;
    if (previous?.targets && typeof previous.targets === 'object') {
      Object.values(previous.targets).forEach((entry) => {
        try {
          if (entry.target && entry.target.callFunction === entry.wrapper) entry.target.callFunction = entry.original;
        } catch {}
      });
    }
    const targets = [
      { target: globalObject.wx?.cloud, name: 'wx.cloud.callFunction' },
      { target: globalObject.Taro?.cloud, name: 'Taro.cloud.callFunction' },
      { target: globalObject.taro?.cloud, name: 'taro.cloud.callFunction' },
      { target: globalObject.cloudHelper, name: 'cloudHelper.callFunction' },
    ];
    targets.forEach((entry) => unwrap(entry.target));
    try { delete globalObject.__d1dFinalFullCompute; } catch {}
    const registry = {
      marker: 'd1d-acceptance-single-request-observer-v3',
      acceptanceRunId: options.acceptanceRunId,
      baselineCumulativeRequestCount: Number(options.baselineCumulativeRequestCount) || 0,
      capturedRequestCount: 0,
      explicitRequestCount: 0,
      ordinaryRequestCount: 0,
      contaminated: false,
      targets: {},
    };
    targets.forEach((entry) => {
      if (!entry.target || typeof entry.target.callFunction !== 'function') return;
      const original = entry.target.callFunction;
      const wrapper = function acceptanceSingleRequestCallFunction(callOptions = {}) {
        if (callOptions.name !== 'generateOutfit') return original.apply(this, arguments);
        registry.capturedRequestCount += 1;
        const requestData = callOptions.data && typeof callOptions.data === 'object' ? callOptions.data : {};
        const isExplicitAcceptanceRequest = requestData.acceptanceRunId === registry.acceptanceRunId;
        if (isExplicitAcceptanceRequest) registry.explicitRequestCount += 1;
        else {
          registry.ordinaryRequestCount += 1;
          registry.contaminated = true;
        }
        // Observing and annotating an explicit acceptance request must never
        // alter or reject ordinary product requests.
        const data = isExplicitAcceptanceRequest
          ? { ...requestData, performanceDiagnostics: true }
          : requestData;
        return Promise.resolve(original.call(this, { ...callOptions, data }));
      };
      try {
        Object.defineProperty(wrapper, '__d1dAcceptanceWrapper', { configurable: false, value: true });
        Object.defineProperty(wrapper, '__d1dOriginalCallFunction', { configurable: false, value: original });
        entry.target.callFunction = wrapper;
        registry.targets[entry.name] = { target: entry.target, original, wrapper };
      } catch {}
    });
    Object.defineProperty(globalObject, '__d1dAcceptanceSingleRequestGuard', {
      configurable: true,
      enumerable: false,
      writable: true,
      value: registry,
    });
    return {
      marker: registry.marker,
      acceptanceRunId: registry.acceptanceRunId,
      baselineCumulativeRequestCount: registry.baselineCumulativeRequestCount,
      capturedRequestCount: registry.capturedRequestCount,
      explicitRequestCount: registry.explicitRequestCount,
      ordinaryRequestCount: registry.ordinaryRequestCount,
      contaminated: registry.contaminated,
      installedTargets: Object.keys(registry.targets),
    };
  }, { acceptanceRunId, baselineCumulativeRequestCount: Number(baselineCumulativeRequestCount) || 0 });
}

async function readAcceptanceSingleRequestGuard(mini) {
  if (!mini || typeof mini.evaluate !== 'function') {
    throw classifyFailure('ACCEPTANCE_GUARD_READ_FAILED', 'automator session has no evaluate()');
  }
  return mini.evaluate(() => {
    const guard = globalThis.__d1dAcceptanceSingleRequestGuard;
    if (!guard || typeof guard !== 'object') return null;
    return {
      marker: guard.marker,
      acceptanceRunId: guard.acceptanceRunId,
      baselineCumulativeRequestCount: guard.baselineCumulativeRequestCount,
      capturedRequestCount: guard.capturedRequestCount,
      explicitRequestCount: guard.explicitRequestCount,
      ordinaryRequestCount: guard.ordinaryRequestCount,
      contaminated: guard.contaminated === true,
      installedTargets: Object.keys(guard.targets || {}),
    };
  });
}

async function resetAcceptanceSingleRequestGuard(mini) {
  if (!mini || typeof mini.evaluate !== 'function') {
    throw classifyFailure('ACCEPTANCE_GUARD_RESET_FAILED', 'automator session has no evaluate()');
  }
  return mini.evaluate(() => {
    const globalObject = typeof globalThis === 'object' ? globalThis : {};
    let restoredTargetCount = 0;
    const targets = [
      { target: globalObject.wx?.cloud, name: 'wx.cloud.callFunction' },
      { target: globalObject.Taro?.cloud, name: 'Taro.cloud.callFunction' },
      { target: globalObject.taro?.cloud, name: 'taro.cloud.callFunction' },
      { target: globalObject.cloudHelper, name: 'cloudHelper.callFunction' },
    ];
    targets.forEach((entry) => {
      const target = entry.target;
      if (!target) return;
      for (let attempt = 0; attempt < 16; attempt += 1) {
        const fn = target?.callFunction;
        if (typeof fn !== 'function') break;
        if (fn.__d1dAcceptanceWrapper === true && typeof fn.__d1dOriginalCallFunction === 'function') {
          target.callFunction = fn.__d1dOriginalCallFunction;
          restoredTargetCount += 1;
          continue;
        }
        const tracker = target.__recommendationV61RunnerCapture;
        if (tracker?.wrapper === fn && typeof tracker.originalCallFunction === 'function') {
          target.callFunction = tracker.originalCallFunction;
          try { delete target.__recommendationV61RunnerCapture; } catch {}
          restoredTargetCount += 1;
          continue;
        }
        break;
      }
    });
    try { delete globalObject.__d1dFinalFullCompute; } catch {}
    try { delete globalObject.__d1dAcceptanceSingleRequestGuard; } catch {}
    return { reset: true, restoredTargetCount, businessStorageTouched: false, legacyDiagnosticKeyRemoved: true };
  });
}

function loadAutomator(deps = {}) {
  if (deps.automator) return deps.automator;
  const packagePath = require.resolve('miniprogram-automator/package.json', { paths: [path.resolve(__dirname, '../..'), process.cwd()] });
  const packageRoot = path.dirname(packagePath);
  return {
    module: require(packageRoot),
    version: JSON.parse(fs.readFileSync(packagePath, 'utf8')).version,
    packageRoot,
  };
}

async function attachAutomator({ endpoint = process.env.AUTOMATOR_WS_ENDPOINT || DEFAULT_ENDPOINT, deps = {} } = {}) {
  const loaded = loadAutomator(deps);
  if (typeof loaded.module?.connect !== 'function') {
    throw classifyFailure('AUTOMATOR_ATTACH_FAILED', 'miniprogram-automator does not export connect()', { version: loaded.version });
  }
  try {
    const mini = await loaded.module.connect({ wsEndpoint: endpoint });
    return { mini, version: loaded.version, packageRoot: loaded.packageRoot, endpoint };
  } catch (error) {
    throw classifyFailure('AUTOMATOR_ATTACH_FAILED', errorText(error), { endpoint, automatorVersion: loaded.version });
  }
}

async function acquireTodayPage(session) {
  if (!session?.mini || typeof session.mini.currentPage !== 'function') {
    throw classifyFailure('MINIPROGRAM_OBJECT_FAILED', 'connected automator session has no currentPage()');
  }
  let page;
  try { page = await session.mini.currentPage(); } catch (error) {
    throw classifyFailure('CURRENT_PAGE_UNAVAILABLE', errorText(error));
  }
  if (!page) throw classifyFailure('CURRENT_PAGE_UNAVAILABLE', 'currentPage() returned null');
  const route = String(page.path || '').replace(/^\//, '');
  if (route !== TODAY_ROUTE) {
    if (typeof session.mini.reLaunch !== 'function') {
      throw classifyFailure('CURRENT_PAGE_UNAVAILABLE', `current route is ${route || 'unknown'} and reLaunch() is unavailable`, { route });
    }
    try {
      await session.mini.reLaunch(TODAY_URL);
      page = await session.mini.currentPage();
    } catch (error) {
      throw classifyFailure('CURRENT_PAGE_UNAVAILABLE', errorText(error), { route, target: TODAY_ROUTE });
    }
  }
  const finalRoute = String(page?.path || '').replace(/^\//, '');
  if (!page || finalRoute !== TODAY_ROUTE) {
    throw classifyFailure('CURRENT_PAGE_UNAVAILABLE', `expected ${TODAY_ROUTE}, got ${finalRoute || 'unknown'}`, { route: finalRoute });
  }
  return { page, route: finalRoute };
}

function startKnownDevTools({ spawn = childProcess.spawn, cliPath = DEFAULT_CLI, project = DEFAULT_PROJECT, servicePort = SERVICE_PORT, automatorPort = AUTOMATOR_PORT } = {}) {
  const child = spawn(cliPath, ['auto', '--project', project, '--port', String(servicePort), '--auto-port', String(automatorPort)], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref?.();
  return { cliPath, project, servicePort, automatorPort };
}

async function ensureDevToolsDirectSession({ deps = {}, endpoint, waitMs = 30000, pollMs = 500 } = {}) {
  const probe = deps.tcpProbe || tcpProbe;
  const inspect = (port) => portState(port, deps);
  let service = inspect(SERVICE_PORT);
  let automator = inspect(AUTOMATOR_PORT);
  let started = false;
  if (!service.listening && !automator.listening) {
    startKnownDevTools(deps);
    started = true;
    const deadline = Date.now() + waitMs;
    do {
      await sleep(pollMs);
      service = inspect(SERVICE_PORT);
      automator = inspect(AUTOMATOR_PORT);
    } while ((!service.listening || !automator.listening) && Date.now() < deadline);
  }
  if (!service.listening) {
    throw classifyFailure('DEVTOOLS_SERVICE_UNAVAILABLE', '52849 is not LISTENING', { service, automator, started });
  }
  if (!automator.listening) {
    throw classifyFailure('AUTOMATOR_PORT_UNAVAILABLE', '9420 is not LISTENING', { service, automator, started });
  }
  const automatorTcp = await probe(AUTOMATOR_PORT);
  if (!automatorTcp.ok) {
    throw classifyFailure('AUTOMATOR_PORT_UNAVAILABLE', automatorTcp.error, { service, automator, started });
  }
  const session = await attachAutomator({ endpoint, deps });
  try {
    const acquired = await acquireTodayPage(session);
    return { ...session, ...acquired, service, automator, started, state: 'DEVTOOLS_RUNNING_AUTOMATOR_SERVER_LISTENING_AUTOMATOR_ATTACHED' };
  } catch (error) {
    try { session.mini.disconnect(); } catch {}
    throw error;
  }
}

module.exports = {
  SERVICE_PORT,
  AUTOMATOR_PORT,
  TODAY_ROUTE,
  parseNetstatListeners,
  readListeners,
  tcpProbe,
  attachAutomator,
  acquireTodayPage,
  ensureDevToolsDirectSession,
  classifyFailure,
  DEFAULT_CLI,
  jsonByteLength,
  unwrapCloudResponse,
  extractPerformanceLedger,
  summarizeCloudResponse,
  ACCEPTANCE_GUARD_KEY,
  TODAY_PERFORMANCE_LEDGER_KEY,
  assertAcceptanceSingleRequest,
  readAcceptanceCumulativeRequestCount,
  installAcceptanceSingleRequestGuard,
  readAcceptanceSingleRequestGuard,
  resetAcceptanceSingleRequestGuard,
  unicodeInputPreflight,
};
