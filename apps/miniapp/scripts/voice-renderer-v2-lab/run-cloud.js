'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ensureDevToolsDirectSession } = require('../devtools-direct-session');
const { createCloudInvoke } = require('./cloud-client');
const { run } = require('./run');

async function runCloud({
  artifactDirectory = path.resolve(__dirname, '../../../../artifacts/voice-renderer-v2-lab'),
  repetitions = 2,
  deps = {},
} = {}) {
  const token = fs.readFileSync(path.join(artifactDirectory, '.cloud-benchmark-token'), 'utf8').trim();
  const session = deps.mini ? null : await ensureDevToolsDirectSession({ deps });
  const mini = deps.mini || session.mini;
  try {
    return await run({
      outputDir: artifactDirectory,
      repetitions,
      invoke: createCloudInvoke(mini, token),
    });
  } finally {
    if (!deps.mini && mini?.disconnect) mini.disconnect();
  }
}

if (require.main === module) {
  runCloud().then((artifact) => {
    process.stdout.write(`${JSON.stringify({ status: artifact.status, summary: artifact.summary }, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { runCloud };
