'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const REQUIRE_MARKER = "const { isDeepStrictEqual } = require('node:util');";
const HANDLER_MARKER = '  const handlerStartedAt = Date.now();';
const ACTION = 'xiaodaVoiceMaxTargeted';

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

function stage({ sourceDirectory, targetDirectory, token }) {
  const source = path.resolve(sourceDirectory);
  const target = path.resolve(targetDirectory);
  if (!token || token.length < 43) throw new Error('HIGH_ENTROPY_TOKEN_REQUIRED');
  if (source === target || target.startsWith(`${source}${path.sep}`)) throw new Error('INDEPENDENT_STAGE_REQUIRED');
  if (path.basename(target) !== 'generateOutfit') throw new Error('TARGET_NAME_INVALID');
  if (fs.existsSync(target)) throw new Error('STAGE_EXISTS');
  const sourceIndex = path.join(source, 'index.js');
  const original = fs.readFileSync(sourceIndex, 'utf8');
  if (!original.includes(REQUIRE_MARKER) || !original.includes(HANDLER_MARKER)) throw new Error('ENTRY_MARKER_MISSING');
  if (original.includes(ACTION) || original.includes('benchmarkXiaodaVoiceMaxTargeted')) throw new Error('SOURCE_ALREADY_INJECTED');
  fs.cpSync(source, target, { recursive: true, filter: (entry) => !entry.split(path.sep).includes('node_modules') });
  try {
    const indexFile = path.join(target, 'index.js');
    let staged = fs.readFileSync(indexFile, 'utf8');
    staged = staged.replace(REQUIRE_MARKER, `${REQUIRE_MARKER}\nconst { runXiaodaVoiceMaxTargeted } = require('./benchmarkXiaodaVoiceMaxTargeted');`);
    staged = staged.replace(HANDLER_MARKER, `${HANDLER_MARKER}\n  if (action === '${ACTION}') {\n    try { return ok(await runXiaodaVoiceMaxTargeted(event)); }\n    catch (error) { return fail(error); }\n  }`);
    if (!staged.includes(`action === '${ACTION}'`)) throw new Error('ACTION_NOT_REACHABLE');
    fs.writeFileSync(indexFile, staged, 'utf8');
    const helper = fs.readFileSync(path.join(__dirname, 'benchmark-helper-template.js'), 'utf8')
      .replace('__MAX_TARGETED_TOKEN_SHA256__', sha256(token));
    fs.writeFileSync(path.join(target, 'benchmarkXiaodaVoiceMaxTargeted.js'), helper, 'utf8');
    return { source, target, tokenHash: sha256(token), originalIndexSha256: sha256(original), stagedIndexSha256: sha256(staged), productionSourceUnmodified: sha256(fs.readFileSync(sourceIndex, 'utf8')) === sha256(original), action: ACTION };
  } catch (error) {
    fs.rmSync(target, { recursive: true, force: true });
    throw error;
  }
}

module.exports = { ACTION, stage };
