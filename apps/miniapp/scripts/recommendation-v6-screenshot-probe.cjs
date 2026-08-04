'use strict';

// Read-only protocol probe for the DevTools screenshot path. It must not call
// any business API or mutate the miniapp. The probe intentionally records both
// the miniprogram-automator wrapper and the underlying WebSocket protocol.

const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const EVIDENCE_DIR = process.env.EVIDENCE_DIR;
const AUTOMATOR_MODULE_PATH = process.env.MINIPROGRAM_AUTOMATOR_PATH;
const WS_ENDPOINT = process.env.AUTOMATOR_WS_ENDPOINT || 'ws://127.0.0.1:9420';
const VARIANT = process.env.PROBE_VARIANT || 'A';
const CAPTURE_TIMEOUT_MS = Number(process.env.PROBE_CAPTURE_TIMEOUT_MS || 25000);
const DEVTOOLS_EXE = process.env.DEVTOOLS_EXE || 'D:\\soft\\Tecent\\微信web开发者工具\\微信开发者工具.exe';

if (!EVIDENCE_DIR) throw new Error('EVIDENCE_DIR is required');
if (!AUTOMATOR_MODULE_PATH) throw new Error('MINIPROGRAM_AUTOMATOR_PATH is required');

const trace = [];
const operations = [];
const sockets = [];
let connectionGeneration = 0;
let sequence = 0;

function now() { return new Date().toISOString(); }
function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function safeJson(value) {
  try { return JSON.stringify(value); } catch { return null; }
}
function parseJson(value) {
  try { return JSON.parse(Buffer.isBuffer(value) ? value.toString('utf8') : String(value)); } catch { return null; }
}
function fileRelative(file) { return path.relative(EVIDENCE_DIR, file).replace(/\\/g, '/'); }
function compactError(caught) {
  return {
    name: caught?.name || 'Error',
    message: String(caught?.message || caught).slice(0, 512),
    code: caught?.code || null,
  };
}
function summarizeParams(params) {
  if (!params || typeof params !== 'object') return null;
  return {
    keys: Object.keys(params),
    pageIdPresent: typeof params.pageId === 'string',
    selector: typeof params.selector === 'string' ? params.selector : null,
    method: typeof params.method === 'string' ? params.method : null,
    names: Array.isArray(params.names) ? params.names : null,
  };
}
function summarizeResponse(message) {
  if (!message || typeof message !== 'object') return { invalid: true };
  return {
    keys: Object.keys(message),
    resultKeys: message.result && typeof message.result === 'object' ? Object.keys(message.result) : [],
    screenshotDataBytes: typeof message.result?.data === 'string' ? Buffer.byteLength(message.result.data, 'base64') : null,
    error: message.error ? {
      keys: Object.keys(message.error),
      code: message.error.code ?? null,
      message: String(message.error.message || '').slice(0, 512),
    } : null,
  };
}
function addTrace(entry) {
  trace.push({ sequence: ++sequence, timestamp: now(), connectionGeneration, ...entry });
}

function attachAutomatorTrace(connection, generation) {
  const transport = connection.transport;
  const socket = transport.ws;
  const originalSend = transport.send.bind(transport);
  const pending = new Map();
  connectionGeneration = generation;
  transport.send = (serialized) => {
    const message = parseJson(serialized);
    const sent = {
      direction: 'client_to_server',
      protocol: 'automator',
      requestId: message?.id || null,
      method: message?.method || null,
      params: summarizeParams(message?.params),
      writeAttemptedAt: now(),
      writeSucceeded: false,
    };
    addTrace(sent);
    const record = trace[trace.length - 1];
    pending.set(record.requestId, record);
    try {
      const result = originalSend(serialized);
      record.writeSucceeded = true;
      record.writeCompletedAt = now();
      return result;
    } catch (caught) {
      record.writeError = compactError(caught);
      throw caught;
    }
  };
  socket.on('message', (raw) => {
    const message = parseJson(raw);
    const request = message?.id ? pending.get(message.id) : null;
    addTrace({
      direction: 'server_to_client',
      protocol: 'automator',
      requestId: message?.id || null,
      method: message?.method || null,
      responseToMethod: request?.method || null,
      response: summarizeResponse(message),
      matchedRequestId: Boolean(request),
    });
    if (request) {
      request.responseObserved = true;
      request.responseObservedAt = now();
      request.response = summarizeResponse(message);
    }
  });
  socket.on('error', (caught) => addTrace({ direction: 'socket', protocol: 'automator', event: 'error', error: compactError(caught) }));
  socket.on('close', (code, reason) => addTrace({ direction: 'socket', protocol: 'automator', event: 'close', code, reason: String(reason || '') }));
  addTrace({
    direction: 'socket',
    protocol: 'automator',
    event: 'attached',
    readyState: socket.readyState,
    url: socket.url || WS_ENDPOINT,
  });
  sockets.push({ protocol: 'automator', socket, connection });
}

function openWebSocket(WebSocket, endpoint) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(endpoint);
    const onError = (caught) => reject(caught);
    socket.once('open', () => {
      socket.removeListener('error', onError);
      resolve(socket);
    });
    socket.once('error', onError);
  });
}

function attachRawTrace(socket, generation) {
  connectionGeneration = generation;
  const pending = new Map();
  socket.on('message', (raw) => {
    const message = parseJson(raw);
    const request = message?.id ? pending.get(message.id) : null;
    addTrace({
      direction: 'server_to_client',
      protocol: 'raw_websocket',
      requestId: message?.id || null,
      method: message?.method || null,
      responseToMethod: request?.method || null,
      response: summarizeResponse(message),
      matchedRequestId: Boolean(request),
    });
    if (request) {
      request.resolve(message);
      pending.delete(message.id);
    }
  });
  socket.on('error', (caught) => {
    addTrace({ direction: 'socket', protocol: 'raw_websocket', event: 'error', error: compactError(caught) });
    for (const request of pending.values()) request.reject(caught);
    pending.clear();
  });
  socket.on('close', (code, reason) => {
    addTrace({ direction: 'socket', protocol: 'raw_websocket', event: 'close', code, reason: String(reason || '') });
    const caught = new Error('raw WebSocket closed');
    for (const request of pending.values()) request.reject(caught);
    pending.clear();
  });
  sockets.push({ protocol: 'raw_websocket', socket, pending, generation });
  return pending;
}

function rawRequest(pending, socket, method, params = {}) {
  const requestId = crypto.randomUUID();
  const frame = JSON.stringify({ id: requestId, method, params });
  return new Promise((resolve, reject) => {
    const record = { method, requestId, resolve, reject };
    pending.set(requestId, record);
    const traceRecord = { direction: 'client_to_server', protocol: 'raw_websocket', requestId, method, params: summarizeParams(params), writeAttemptedAt: now(), writeSucceeded: false };
    addTrace(traceRecord);
    const traceEntry = trace[trace.length - 1];
    try {
      socket.send(frame);
      traceEntry.writeSucceeded = true;
      traceEntry.writeCompletedAt = now();
    } catch (caught) {
      traceEntry.writeError = compactError(caught);
      pending.delete(requestId);
      reject(caught);
    }
  });
}

function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
  });
  return Promise.race([promise.then((value) => ({ value }), (error) => ({ error })), timeout])
    .finally(() => clearTimeout(timer));
}

async function observeOperation(label, fn) {
  const startedAt = Date.now();
  const traceStart = trace.length;
  const result = await withTimeout(Promise.resolve().then(fn), CAPTURE_TIMEOUT_MS);
  const operation = {
    label,
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: now(),
    waitMs: Date.now() - startedAt,
    outcome: result.timedOut ? 'timed_out' : result.error ? 'rejected' : 'resolved',
    protocolEntries: trace.slice(traceStart).map((entry) => entry.sequence),
  };
  if (result.timedOut) operation.error = { name: 'ProbeTimeout', message: `probe wait exceeded ${CAPTURE_TIMEOUT_MS}ms` };
  if (result.error) operation.error = compactError(result.error);
  operation.result = result.value === undefined ? null : result.value;
  operations.push(operation);
  return operation;
}

function summarizePageData(data) {
  if (!data || typeof data !== 'object') return { type: typeof data, keys: [] };
  return { type: Array.isArray(data) ? 'array' : 'object', keys: Object.keys(data).slice(0, 80), keyCount: Object.keys(data).length };
}
function summarizePage(pageInstance) {
  return pageInstance ? { path: pageInstance.path || null, queryKeys: Object.keys(pageInstance.query || {}) } : null;
}
function pngInfo(file) {
  if (!fs.existsSync(file)) return { exists: false, bytes: null, width: null, height: null };
  const bytes = fs.readFileSync(file);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return {
    exists: true,
    bytes: bytes.length,
    isPng: bytes.length >= 24 && bytes.subarray(0, 8).equals(signature),
    width: bytes.length >= 24 ? bytes.readUInt32BE(16) : null,
    height: bytes.length >= 24 ? bytes.readUInt32BE(20) : null,
  };
}
function hostSnapshot() {
  const snapshot = { nodeVersion: process.version, pid: process.pid, devToolsExe: DEVTOOLS_EXE, devToolsVersion: null, processRows: null, netstatRows: null };
  try {
    const packageJson = path.join(path.dirname(DEVTOOLS_EXE), 'resources', 'app.asar.unpacked', 'package.json');
    const packageInfo = JSON.parse(fs.readFileSync(packageJson, 'utf8'));
    snapshot.devToolsVersion = { version: packageInfo.version || null, name: packageInfo.name || null, source: packageJson };
  } catch (caught) { snapshot.devToolsVersionError = compactError(caught); }
  try {
    const command = `$p=Get-Item -LiteralPath '${DEVTOOLS_EXE.replace(/'/g, "''")}' -ErrorAction SilentlyContinue; if($p){$p.VersionInfo | Select-Object FileVersion,ProductVersion | ConvertTo-Json -Compress}`;
    snapshot.devToolsFileVersion = parseJson(childProcess.execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', timeout: 5000 }).trim());
  } catch (caught) { snapshot.devToolsFileVersionError = compactError(caught); }
  try {
    const output = childProcess.execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-Process | Select-Object Id,ProcessName,MainWindowTitle | ConvertTo-Json -Compress'], { encoding: 'utf8', timeout: 5000 }).trim();
    snapshot.processRows = parseJson(output);
  } catch (caught) { snapshot.processRowsError = compactError(caught); }
  try {
    const output = childProcess.execFileSync('netstat.exe', ['-ano', '-p', 'TCP'], { encoding: 'utf8', timeout: 5000 });
    snapshot.netstatRows = output.split(/\r?\n/).filter((line) => /:9420\b|:9421\b/.test(line));
  } catch (caught) { snapshot.netstatError = compactError(caught); }
  return snapshot;
}

async function connectAutomator(Connection, MiniProgram, generation) {
  const connection = await Connection.create(WS_ENDPOINT);
  attachAutomatorTrace(connection, generation);
  const mini = new MiniProgram(connection);
  const version = await observeOperation(`generation-${generation}:Tool.getInfo`, () => mini.checkVersion());
  if (version.outcome !== 'resolved') throw new Error(`automator connection generation ${generation} did not pass Tool.getInfo`);
  return { connection, mini, version };
}

async function automatorPageChecks(mini, prefix) {
  const pageOp = await observeOperation(`${prefix}:mini.currentPage`, async () => summarizePage(await mini.currentPage()));
  let pageInstance = null;
  if (pageOp.outcome === 'resolved') {
    pageInstance = await mini.currentPage();
    await observeOperation(`${prefix}:page.size`, async () => pageInstance.size());
    await observeOperation(`${prefix}:page.data`, async () => summarizePageData(await pageInstance.data()));
    await observeOperation(`${prefix}:page.$`, async () => Boolean(await pageInstance.$('.outfit-swiper')));
  }
  return pageOp.result;
}

async function captureWithAutomator(mini, screenshotPath) {
  await observeOperation('mini.screenshot -> App.captureScreenshot', async () => {
    if (fs.existsSync(screenshotPath)) throw new Error(`refusing to overwrite ${screenshotPath}`);
    await mini.screenshot({ path: screenshotPath });
    return pngInfo(screenshotPath);
  });
}

async function runAutomatorProbe(Connection, MiniProgram, screenshotPath, reconnect) {
  let session = await connectAutomator(Connection, MiniProgram, 1);
  if (reconnect) {
    session.connection.dispose();
    await new Promise((resolve) => setTimeout(resolve, 250));
    session = await connectAutomator(Connection, MiniProgram, 2);
  }
  const before = await automatorPageChecks(session.mini, 'before');
  await captureWithAutomator(session.mini, screenshotPath);
  const after = await automatorPageChecks(session.mini, 'after');
  return { connectionGeneration, before, after, mini: session.mini };
}

async function runRawProbe(WebSocket, screenshotPath) {
  connectionGeneration = 1;
  const socket = await openWebSocket(WebSocket, WS_ENDPOINT);
  const pending = attachRawTrace(socket, 1);
  const request = async (method, params = {}) => {
    const result = await observeOperation(`raw:${method}`, async () => {
      const response = await rawRequest(pending, socket, method, params);
      if (response.error) throw new Error(response.error.message || 'raw protocol error');
      return response.result || null;
    });
    return result.result;
  };
  const current = await request('App.getCurrentPage');
  const pageId = current?.pageId || null;
  if (pageId) {
    await request('Page.getWindowProperties', { pageId, names: ['document.documentElement.scrollWidth', 'document.documentElement.scrollHeight'] });
    await request('Page.getData', { pageId });
    await request('Page.getElement', { pageId, selector: '.outfit-swiper' });
  }
  await observeOperation('raw:App.captureScreenshot', async () => {
    if (fs.existsSync(screenshotPath)) throw new Error(`refusing to overwrite ${screenshotPath}`);
    const result = await request('App.captureScreenshot');
    if (!result?.data) throw new Error('raw screenshot response did not contain base64 data');
    fs.writeFileSync(screenshotPath, Buffer.from(result.data, 'base64'));
    return pngInfo(screenshotPath);
  });
  const after = await request('App.getCurrentPage');
  return { connectionGeneration, after: { path: after?.path || null } };
}

async function main() {
  ensureDir(EVIDENCE_DIR);
  const screenshotPath = process.env.PROBE_SCREENSHOT_PATH || path.join(EVIDENCE_DIR, `screenshot-${VARIANT.toLowerCase()}.png`);
  ensureDir(path.dirname(screenshotPath));
  const modulePath = path.join(AUTOMATOR_MODULE_PATH, 'out');
  const Connection = require(path.join(modulePath, 'Connection')).default;
  const MiniProgram = require(path.join(modulePath, 'MiniProgram')).default;
  const automatorPackage = JSON.parse(fs.readFileSync(path.join(AUTOMATOR_MODULE_PATH, 'package.json'), 'utf8'));
  const WebSocket = require(require.resolve('ws', { paths: [AUTOMATOR_MODULE_PATH] }));

  const result = {
    startedAt: now(),
    variant: VARIANT,
    wsEndpoint: WS_ENDPOINT,
    connectionGeneration: null,
    nodeVersion: process.version,
    automatorPackage: `${automatorPackage.name}@${automatorPackage.version}`,
    automatorModulePath: AUTOMATOR_MODULE_PATH,
    screenshotPath: fileRelative(screenshotPath),
    captureTimeoutMs: CAPTURE_TIMEOUT_MS,
    host: hostSnapshot(),
    screenshot: null,
    pageBefore: null,
    pageAfter: null,
    operations,
    protocolTraceFile: 'protocol-trace.jsonl',
    errors: [],
  };
  try {
    const useRaw = process.env.PROBE_PROTOCOL === 'raw';
    const useBoth = process.env.PROBE_PROTOCOL === 'both';
    if (useRaw || useBoth) result.raw = await runRawProbe(WebSocket, screenshotPath);
    if (!useRaw) {
      const automatorResult = await runAutomatorProbe(Connection, MiniProgram, screenshotPath, VARIANT === 'B');
      result.connectionGeneration = automatorResult.connectionGeneration;
      result.pageBefore = automatorResult.before;
      result.pageAfter = automatorResult.after;
    }
    result.screenshot = pngInfo(screenshotPath);
    result.status = result.screenshot.exists && result.screenshot.bytes > 0 ? 'completed' : 'failed';
  } catch (caught) {
    result.status = 'failed';
    result.errors.push(compactError(caught));
  } finally {
    for (const entry of sockets) {
      try { entry.connection?.disconnect?.(); } catch {}
      try { if (entry.socket?.readyState === 1) entry.socket.close(); } catch {}
    }
    result.finishedAt = now();
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'protocol-trace.jsonl'), trace.map((entry) => JSON.stringify(entry)).join('\n') + (trace.length ? '\n' : ''), 'utf8');
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'operations.json'), JSON.stringify(operations, null, 2) + '\n', 'utf8');
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'probe.json'), JSON.stringify(result, null, 2) + '\n', 'utf8');
  }
  process.exitCode = result.status === 'completed' ? 0 : 1;
}

main().catch((caught) => { process.stderr.write(`${caught.stack || caught}\n`); process.exitCode = 1; });
