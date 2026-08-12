'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const REQUIRE_MARKER = "const { isDeepStrictEqual } = require('node:util');";
const HANDLER_MARKER = "  const handlerStartedAt = Date.now();";

function stageBenchmarkHelper({ sourceDirectory, targetDirectory, benchmarkToken }) {
  const source = path.resolve(sourceDirectory);
  const target = path.resolve(targetDirectory);
  if (!benchmarkToken || benchmarkToken.length < 32) throw new Error('benchmark token must contain at least 32 characters');
  if (source === target || target.startsWith(`${source}${path.sep}`)) throw new Error('target must be an independent staging directory');
  if (!fs.existsSync(path.join(source, 'index.js'))) throw new Error('source cloudfunction index.js is missing');
  if (fs.existsSync(target)) throw new Error('target staging directory already exists');
  fs.cpSync(source, target, {
    recursive: true,
    filter: (entry) => !entry.split(path.sep).includes('node_modules'),
  });
  const indexFile = path.join(target, 'index.js');
  let indexSource = fs.readFileSync(indexFile, 'utf8');
  if (!indexSource.includes(REQUIRE_MARKER) || !indexSource.includes(HANDLER_MARKER)) throw new Error('production entry markers are missing');
  if (indexSource.includes('xiaodaVoiceBenchmark') || indexSource.includes('benchmarkXiaodaVoice')) throw new Error('source already contains benchmark integration');
  indexSource = indexSource.replace(REQUIRE_MARKER, `${REQUIRE_MARKER}\nconst { runXiaodaVoiceBenchmark } = require('./benchmarkXiaodaVoice');`);
  indexSource = indexSource.replace(HANDLER_MARKER, `${HANDLER_MARKER}\n  if (action === 'xiaodaVoiceBenchmark') {\n    try { return ok(await runXiaodaVoiceBenchmark(event)); }\n    catch (error) { return fail(error); }\n  }`);
  fs.writeFileSync(indexFile, indexSource, 'utf8');
  const template = fs.readFileSync(path.join(__dirname, 'benchmark-helper-template.js'), 'utf8');
  const tokenHash = crypto.createHash('sha256').update(benchmarkToken).digest('hex');
  fs.writeFileSync(path.join(target, 'benchmarkXiaodaVoice.js'), template.replace('__BENCHMARK_TOKEN_SHA256__', tokenHash), 'utf8');
  return { source, target, tokenHash, productionSourceUnmodified: true };
}

if (require.main === module) {
  const result = stageBenchmarkHelper({
    sourceDirectory: process.argv[2],
    targetDirectory: process.argv[3],
    benchmarkToken: process.env.XIAODA_VOICE_BENCHMARK_TOKEN,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

module.exports = { stageBenchmarkHelper };
