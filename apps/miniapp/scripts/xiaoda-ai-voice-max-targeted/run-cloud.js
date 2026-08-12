'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ensureDevToolsDirectSession } = require('../devtools-direct-session');
const { run } = require('./runner');

async function main() {
  const artifactDir = path.resolve(__dirname, '../../../../artifacts/xiaoda-ai-voice-max-targeted/20260812-171649');
  const token = fs.readFileSync(path.join(artifactDir, '.max-targeted-benchmark-token'), 'utf8').trim();
  const { mini } = await ensureDevToolsDirectSession();
  try {
    const result = await run({
      artifactDir,
      token,
      invoke: async payload => mini.evaluate(async (data) => globalThis.wx.cloud.callFunction({ name: 'generateOutfit', data: data }), payload),
    });
    process.stdout.write(`${JSON.stringify({ status: result.status, calls: result.calls.map(call => ({ batch: call.batch, requestedModel: call.requestedModel, returnedModel: call.returnedModel, httpStatus: call.httpStatus, providerLatencyMs: call.providerLatencyMs, usage: call.usage })) }, null, 2)}\n`);
  } finally {
    if (mini?.disconnect) mini.disconnect();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
