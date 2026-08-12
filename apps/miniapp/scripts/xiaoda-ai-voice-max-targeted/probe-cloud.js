'use strict';
const { ensureDevToolsDirectSession } = require('../devtools-direct-session');
(async () => {
  const { mini } = await ensureDevToolsDirectSession();
  try {
    const result = await mini.evaluate(async (data) => globalThis.wx.cloud.callFunction({ name: 'generateOutfit', data: data }), { action: 'transport_probe_small', diagnostic: true });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally { if (mini?.disconnect) mini.disconnect(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
