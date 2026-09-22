'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const automator = require('miniprogram-automator');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const OUTPUT_ROOT = path.join(ROOT, 'artifacts', 'pb18-detail-v2-smoke');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(read, predicate, timeoutMs, label, intervalMs = 200) {
  const deadline = Date.now() + timeoutMs;
  let value;
  do {
    try {
      value = await read();
    } catch (error) {
      if (!/page destroyed/i.test(String(error?.message || error))) throw error;
      await sleep(intervalMs);
      continue;
    }
    if (predicate(value)) return value;
    await sleep(intervalMs);
  } while (Date.now() < deadline);
  throw Object.assign(new Error(`${label} timed out`), { lastValue: value });
}

async function readText(element) {
  if (!element) return '';
  return String(await element.text() || '').trim();
}

async function launchAutomatorSession() {
  const cliPath = process.env.D1D_DEVTOOLS_CLI || 'D:\\soft\\Tecent\\微信web开发者工具\\cli.bat';
  const projectPath = path.join(ROOT, 'apps', 'miniapp');
  const command = `""${cliPath}" auto --project "${projectPath}" --auto-port 9420"`;
  const child = spawn('cmd.exe', ['/d', '/s', '/c', command], {
    windowsHide: true,
    windowsVerbatimArguments: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let cliOutput = '';
  let childExited = false;
  let childExitCode = null;
  child.stdout.on('data', (chunk) => { cliOutput += String(chunk); });
  child.stderr.on('data', (chunk) => { cliOutput += String(chunk); });
  child.on('exit', (code) => {
    childExited = true;
    childExitCode = code;
  });
  const deadline = Date.now() + 30000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const mini = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
      await sleep(20000);
      return { mini, cliOutput: () => cliOutput };
    } catch (error) {
      lastError = error;
      if (childExited && childExitCode !== 0) {
        throw Object.assign(new Error(`DevTools CLI exited before automator attach (code ${childExitCode})`), { cliOutput });
      }
      await sleep(100);
    }
  }
  throw Object.assign(new Error(`Failed to attach DevTools automator: ${lastError?.message || lastError}`), { cliOutput });
}

async function readTexts(elements) {
  const values = [];
  for (const element of elements) {
    const value = await readText(element);
    if (value) values.push(value);
  }
  return values;
}

async function readStorage(mini) {
  return mini.evaluate(() => {
    const info = globalThis.wx?.getStorageInfoSync?.() || { keys: [], currentSize: 0, limitSize: 0 };
    const keys = Array.isArray(info.keys) ? info.keys.map(String).sort() : [];
    const legacyDetailKeys = keys.filter((key) => (
      key.startsWith('d1d:pageCache:')
      || key === 'outfitStateSync'
      || key === 'detailNeedsRefresh'
      || key.includes('outfitDetailDraft%3A')
      || key.includes('outfitDetailDraft:')
    ));
    return {
      currentSizeKiB: Number(info.currentSize) || 0,
      limitSizeKiB: Number(info.limitSize) || 0,
      keyCount: keys.length,
      keys,
      legacyDetailKeys,
    };
  });
}

async function readRoute(mini) {
  return mini.evaluate(() => {
    // `getCurrentPages` is injected by the WeChat mini-program runtime.
    // eslint-disable-next-line no-undef
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
    const current = pages[pages.length - 1];
    return {
      route: current?.route || '',
      options: current?.options || {},
    };
  });
}

async function readTodayActions(mini) {
  const page = await mini.currentPage();
  return {
    route: page.path,
    actions: await readTexts(await page.$$('.outfit-actions .action-text')),
  };
}

async function chooseUnwornCard(mini) {
  const page = await mini.currentPage();
  const swiper = await page.$('.outfit-swiper');
  if (!swiper) throw new Error('Today outfit swiper is unavailable');
  const cards = await page.$$('.outfit-card');
  if (cards.length === 0) throw new Error('Today has no outfit cards');
  for (let index = 0; index < cards.length; index += 1) {
    await swiper.swipeTo(index);
    await waitUntil(
      async () => Number(await (await mini.currentPage()).$('.outfit-swiper').then((item) => item.property('current'))),
      (current) => current === index,
      12000,
      `Today card ${index + 1} activation`,
    );
    const actions = await readTodayActions(mini);
    if (actions.actions.includes('穿他')) return { index, actions: actions.actions };
  }
  return { index: 0, actions: (await readTodayActions(mini)).actions, alreadyWorn: true };
}

async function readDetail(mini) {
  const page = await mini.currentPage();
  return {
    route: page.path,
    title: await readText(await page.$('.hero-title')),
    chips: await readTexts(await page.$$('.fact-chip')),
    styleTags: await readTexts(await page.$$('.style-tag')),
    reason: await readText(await page.$('.core-reason-text')),
    weatherTitle: await readText(await page.$('.weather-title')),
    aiButton: await readText(await page.$('.ai-comment-btn-text')),
    aiParagraphs: await readTexts(await page.$$('.ai-comment-reason')),
    aiAdvice: await readText(await page.$('.ai-comment-tip')),
    aiStatus: await readText(await page.$('.ai-comment-status')),
    itemRows: (await page.$$('.outfit-item-row')).length,
    itemCountLabel: await readText(await page.$('.item-list-card .card-title')),
    favoriteAction: await readText(await page.$('.action-btn.favorite .btn-text')),
    wornAction: await readText(await page.$('.action-btn.wear .btn-text')),
    notFound: await readText(await page.$('.empty-title')),
  };
}

async function waitForFormalDetail(mini, label) {
  return waitUntil(
    () => readDetail(mini),
    (state) => state.route === 'pages/outfit-detail/index'
      && Boolean(state.title)
      && Boolean(state.reason)
      && state.itemRows > 0
      && Boolean(state.favoriteAction)
      && Boolean(state.wornAction),
    30000,
    label,
  );
}

async function tapAndWaitText(mini, selector, expected, label, timeoutMs = 30000) {
  const page = await mini.currentPage();
  const element = await page.$(selector);
  if (!element) throw new Error(`${label} action is unavailable`);
  await element.tap();
  return waitUntil(
    async () => readText(await (await mini.currentPage()).$(selector)),
    (text) => expected.includes(text),
    timeoutMs,
    label,
  );
}

async function ensureFavorite(mini) {
  let state = await readDetail(mini);
  const transitions = [];
  if (state.favoriteAction === '取消收藏') {
    transitions.push(await tapAndWaitText(mini, '.action-btn.favorite .btn-text', ['收藏'], 'cancel favorite'));
    state = await readDetail(mini);
  }
  if (state.favoriteAction !== '收藏') throw new Error(`Unexpected favorite action: ${state.favoriteAction}`);
  transitions.push(await tapAndWaitText(mini, '.action-btn.favorite .btn-text', ['取消收藏'], 'favorite outfit'));
  return transitions;
}

async function ensureWorn(mini) {
  const state = await readDetail(mini);
  if (state.wornAction === '今天穿过啦') return { alreadyWorn: true, final: state.wornAction };
  const final = await tapAndWaitText(mini, '.action-btn.wear .btn-text', ['今天穿过啦'], 'wear outfit');
  return { alreadyWorn: false, final };
}

async function exerciseAiCommentary(mini) {
  let detail = await readDetail(mini);
  if (detail.aiParagraphs.length > 0) return { source: 'cached', detail };
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const page = await mini.currentPage();
    const button = await page.$('.ai-comment-btn');
    if (!button) throw new Error('AI commentary action is unavailable');
    await button.tap();
    detail = await waitUntil(
      () => readDetail(mini),
      (state) => state.aiParagraphs.length > 0 || Boolean(state.aiStatus),
      120000,
      `AI commentary attempt ${attempt}`,
      400,
    );
    if (detail.aiParagraphs.length > 0) return { source: 'generated', attempts: attempt, detail };
    if (attempt < 2) await sleep(1200);
  }
  throw Object.assign(new Error('AI commentary did not produce visible content'), { detail });
}

async function exerciseItemNavigation(mini) {
  const page = await mini.currentPage();
  const row = await page.$('.outfit-item-row');
  if (!row) throw new Error('Detail item row is unavailable');
  const route = await readRoute(mini);
  const identity = {
    batchId: decodeURIComponent(String(route.options.batchId || '')),
    outfitKey: decodeURIComponent(String(route.options.outfitKey || '')),
    referenceId: decodeURIComponent(String(route.options.referenceId || '')),
  };
  const clothingId = await mini.evaluate(async (input) => {
    const response = await globalThis.wx.cloud.callFunction({
      name: 'generateOutfit',
      data: {
        action: 'detailV2',
        runtimeVersion: 'recommendation-runtime-v2',
        ...input,
      },
    });
    const body = response?.result?.data || response?.result;
    return body?.detail?.clothingIds?.[0] || '';
  }, identity);
  if (!clothingId) throw new Error('Detail canonical clothing id is unavailable');
  await mini.navigateTo(`/pages/clothing-detail/index?id=${encodeURIComponent(clothingId)}`);
  const clothingRoute = await waitUntil(
    async () => (await mini.currentPage()).path,
    (route) => route === 'pages/clothing-detail/index',
    12000,
    'clothing detail navigation',
  );
  try {
    await mini.navigateBack();
  } catch (error) {
    const route = await mini.currentPage().then((current) => current.path).catch(() => '');
    if (route !== 'pages/outfit-detail/index') throw error;
  }
  await waitForFormalDetail(mini, 'return from clothing detail');
  return { route: clothingRoute, clothingId, trigger: 'canonical-detail-item-route' };
}

function buildDetailUrl(options) {
  const keys = ['refVersion', 'source', 'outfitKey', 'batchId', 'referenceId'];
  const query = keys.map((key) => {
    const raw = String(options[key] || '');
    let decoded = raw;
    try { decoded = decodeURIComponent(raw); } catch {}
    return `${key}=${encodeURIComponent(decoded)}`;
  }).join('&');
  return `/pages/outfit-detail/index?${query}`;
}

async function run() {
  const startedAt = new Date().toISOString();
  const report = { schemaVersion: 'pb18-detail-v2-smoke/v1', startedAt };
  let session;
  try {
    session = await launchAutomatorSession();
    report.devtoolsCli = session.cliOutput();
    const launchPage = await session.mini.currentPage();
    if (launchPage?.path !== 'pages/today/index') {
      await session.mini.reLaunch('/pages/today/index');
    }
    await waitUntil(
      async () => (await (await session.mini.currentPage()).$$('.outfit-card')).length,
      (count) => count > 0,
      60000,
      'Today cards',
    );
    report.storageBefore = await readStorage(session.mini);
    report.selectedCard = await chooseUnwornCard(session.mini);
    report.todayBefore = await readTodayActions(session.mini);

    const todayPage = await session.mini.currentPage();
    const detailButton = await todayPage.$('.action-btn.detail');
    if (!detailButton) throw new Error('Today detail action is unavailable');
    await detailButton.tap();
    report.detailInitial = await waitForFormalDetail(session.mini, 'initial formal Detail');
    report.outfitRef = await readRoute(session.mini);
    const options = report.outfitRef.options;
    for (const key of ['batchId', 'outfitKey', 'referenceId']) {
      if (!String(options[key] || '').trim()) throw new Error(`OutfitRef ${key} is missing`);
    }

    report.favoriteTransitions = await ensureFavorite(session.mini);
    report.worn = await ensureWorn(session.mini);
    report.aiCommentary = await exerciseAiCommentary(session.mini);
    report.itemNavigation = await exerciseItemNavigation(session.mini);
    report.detailAfterActions = await readDetail(session.mini);

    await session.mini.navigateBack();
    report.todayAfterReturn = await waitUntil(
      () => readTodayActions(session.mini),
      (state) => state.route === 'pages/today/index'
        && state.actions.includes('已收藏')
        && state.actions.includes('今天穿过'),
      30000,
      'Today status reconciliation',
    );

    const reentryButton = await (await session.mini.currentPage()).$('.action-btn.detail');
    if (!reentryButton) throw new Error('Today detail re-entry action is unavailable');
    await reentryButton.tap();
    report.detailReentry = await waitForFormalDetail(session.mini, 'Detail re-entry');
    report.outfitRefReentry = await readRoute(session.mini);

    const directDetailUrl = buildDetailUrl(options);
    await session.mini.evaluate((url) => {
      globalThis.setTimeout(() => globalThis.wx.reLaunch({ url }), 500);
      return true;
    }, directDetailUrl);
    await sleep(1000);
    report.detailReload = await waitForFormalDetail(session.mini, 'Detail direct reload');
    report.outfitRefReload = await readRoute(session.mini);
    report.storageAfter = await readStorage(session.mini);

    if (report.detailReload.favoriteAction !== '取消收藏') throw new Error('Favorite state did not survive reload');
    if (report.detailReload.wornAction !== '今天穿过啦') throw new Error('Worn state did not survive reload');
    if (report.storageAfter.legacyDetailKeys.length > 0) throw new Error('Legacy Detail storage dependency returned');

    report.status = 'PASS';
    report.completedAt = new Date().toISOString();
    return report;
  } catch (error) {
    report.status = 'FAIL';
    report.completedAt = new Date().toISOString();
    report.error = String(error?.stack || error?.message || error);
    if (error?.cliOutput) report.devtoolsCli = error.cliOutput;
    if (error?.lastValue !== undefined) report.lastValue = error.lastValue;
    if (error?.detail !== undefined) report.errorDetail = error.detail;
    throw Object.assign(error, { report });
  } finally {
    try { session?.mini?.disconnect?.(); } catch {}
  }
}

async function main() {
  let report;
  try {
    report = await run();
  } catch (error) {
    report = error.report || { status: 'FAIL', error: String(error?.stack || error) };
  }
  fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
  const target = path.join(OUTPUT_ROOT, 'latest.json');
  fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ evidence: target, ...report }, null, 2)}\n`);
  if (report.status !== 'PASS') process.exitCode = 1;
}

if (require.main === module) void main();

module.exports = { buildDetailUrl, readStorage };
