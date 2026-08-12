'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const REQUIRE_MARKER = "const { isDeepStrictEqual } = require('node:util');";
const HANDLER_MARKER = '  const handlerStartedAt = Date.now();';

function stage({ sourceDirectory, targetDirectory, token }) {
  const source = path.resolve(sourceDirectory);
  const target = path.resolve(targetDirectory);
  if (!token || token.length < 32) throw new Error('token must contain at least 32 characters');
  if (source === target || target.startsWith(`${source}${path.sep}`)) {
    throw new Error('target must be an independent staging directory');
  }
  if (path.basename(target) !== 'generateOutfit') throw new Error('target basename must be generateOutfit');
  const sourceIndex = path.join(source, 'index.js');
  if (!fs.existsSync(sourceIndex)) throw new Error('source cloudfunction index.js is missing');
  if (fs.existsSync(target)) throw new Error('target staging directory already exists');

  const original = fs.readFileSync(sourceIndex, 'utf8');
  if (!original.includes(REQUIRE_MARKER) || !original.includes(HANDLER_MARKER)) {
    throw new Error('production entry markers are missing');
  }
  if (original.includes('xiaodaVoicePhase2Benchmark') || original.includes('benchmarkXiaodaVoicePhase2')) {
    throw new Error('source already contains phase2 benchmark integration');
  }

  fs.cpSync(source, target, {
    recursive: true,
    filter: (entry) => !entry.split(path.sep).includes('node_modules'),
  });
  try {
    const indexFile = path.join(target, 'index.js');
    let indexSource = fs.readFileSync(indexFile, 'utf8');
    indexSource = indexSource.replace(
      REQUIRE_MARKER,
      `${REQUIRE_MARKER}\nconst { runXiaodaVoicePhase2Benchmark } = require('./benchmarkXiaodaVoicePhase2');`,
    );
    indexSource = indexSource.replace(
      HANDLER_MARKER,
      `${HANDLER_MARKER}\n  if (action === 'xiaodaVoicePhase2Benchmark') {\n    try { return ok(await runXiaodaVoicePhase2Benchmark(event)); }\n    catch (error) { return fail(error); }\n  }`,
    );
    if (indexSource === fs.readFileSync(indexFile, 'utf8')) throw new Error('phase2 injection failed');
    fs.writeFileSync(indexFile, indexSource, 'utf8');
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const helper = fs.readFileSync(path.join(__dirname, 'benchmark-helper-template.js'), 'utf8')
      .replace('__PHASE2_TOKEN_SHA256__', hash);
    fs.writeFileSync(path.join(target, 'benchmarkXiaodaVoicePhase2.js'), helper, 'utf8');
    return {
      source,
      target,
      tokenHash: hash,
      originalIndexSha256: crypto.createHash('sha256').update(original).digest('hex'),
      stagedIndexSha256: crypto.createHash('sha256').update(indexSource).digest('hex'),
      productionSourceUnmodified: true,
    };
  } catch (error) {
    fs.rmSync(target, { recursive: true, force: true });
    throw error;
  }
}

module.exports = { stage };
