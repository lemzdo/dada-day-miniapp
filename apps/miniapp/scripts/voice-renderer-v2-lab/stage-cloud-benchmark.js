'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  GENERATION_PARAMETERS,
  INPUT_VERSION,
  MODEL_ALLOWLIST,
  PERSONA_VERSION,
  PROMPT_VERSION,
  buildSystemPrompt,
} = require('./core');

const ACTION = 'voiceRendererV2Benchmark';
const REQUIRE_MARKER = "const { isDeepStrictEqual } = require('node:util');";
const HANDLER_MARKER = '  const handlerStartedAt = Date.now();';

function stageCloudBenchmark({ sourceDirectory, targetDirectory, token }) {
  const source = path.resolve(sourceDirectory);
  const target = path.resolve(targetDirectory);
  if (typeof token !== 'string' || token.length < 32) throw new Error('TOKEN_LENGTH');
  if (source === target || target.startsWith(`${source}${path.sep}`)) throw new Error('STAGE_MUST_BE_INDEPENDENT');
  if (path.basename(target) !== 'generateOutfit') throw new Error('STAGE_BASENAME');
  if (fs.existsSync(target)) throw new Error('STAGE_EXISTS');
  const sourceIndex = path.join(source, 'index.js');
  const original = fs.readFileSync(sourceIndex, 'utf8');
  if (!original.includes(REQUIRE_MARKER) || !original.includes(HANDLER_MARKER)) throw new Error('ENTRY_MARKERS');
  if (original.includes(ACTION) || original.includes('benchmarkVoiceRendererV2')) throw new Error('SOURCE_ALREADY_INJECTED');

  fs.cpSync(source, target, {
    recursive: true,
    filter: (entry) => {
      if (entry.split(path.sep).includes('node_modules')) return false;
      return !/\.(?:test|fixtures|harness|report)(?:\.test)?\.js$/i.test(path.basename(entry));
    },
  });
  try {
    const indexFile = path.join(target, 'index.js');
    let stagedIndex = fs.readFileSync(indexFile, 'utf8');
    stagedIndex = stagedIndex.replace(
      REQUIRE_MARKER,
      `${REQUIRE_MARKER}\nconst { runVoiceRendererV2Benchmark } = require('./benchmarkVoiceRendererV2');`,
    );
    stagedIndex = stagedIndex.replace(
      HANDLER_MARKER,
      `${HANDLER_MARKER}\n  if (action === '${ACTION}') {\n    try { return ok(await runVoiceRendererV2Benchmark(event)); }\n    catch (error) { return fail(error); }\n  }`,
    );
    if (!stagedIndex.includes(ACTION)) throw new Error('INJECTION_FAILED');
    fs.writeFileSync(indexFile, stagedIndex, 'utf8');
    const helper = renderHelper(token);
    fs.writeFileSync(path.join(target, 'benchmarkVoiceRendererV2.js'), helper, 'utf8');
    return {
      source,
      target,
      action: ACTION,
      tokenHash: sha256(token),
      originalIndexSha256: sha256(original),
      stagedIndexSha256: sha256(stagedIndex),
      helperSha256: sha256(helper),
      promptSha256: sha256(buildSystemPrompt()),
      productionSourceUnmodified: fs.readFileSync(sourceIndex, 'utf8') === original,
    };
  } catch (error) {
    fs.rmSync(target, { recursive: true, force: true });
    throw error;
  }
}

function renderHelper(token) {
  const template = fs.readFileSync(path.join(__dirname, 'cloud-helper-template.js'), 'utf8');
  const replacements = new Map([
    ['__VOICE_RENDERER_V2_TOKEN_HASH__', sha256(token)],
    ['__VOICE_RENDERER_V2_PROMPT_VERSION__', JSON.stringify(PROMPT_VERSION)],
    ['__VOICE_RENDERER_V2_INPUT_VERSION__', JSON.stringify(INPUT_VERSION)],
    ['__VOICE_RENDERER_V2_PERSONA_VERSION__', JSON.stringify(PERSONA_VERSION)],
    ['__VOICE_RENDERER_V2_SYSTEM_PROMPT__', JSON.stringify(buildSystemPrompt())],
    ['__VOICE_RENDERER_V2_MODEL_ALLOWLIST__', JSON.stringify(MODEL_ALLOWLIST)],
    ['__VOICE_RENDERER_V2_GENERATION_PARAMETERS__', JSON.stringify(GENERATION_PARAMETERS)],
  ]);
  let rendered = template;
  for (const [placeholder, value] of replacements) rendered = rendered.replaceAll(placeholder, value);
  if (/__VOICE_RENDERER_V2_[A-Z_]+__/.test(rendered)) throw new Error('HELPER_PLACEHOLDER');
  return rendered;
}

function sha256(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }

module.exports = { ACTION, renderHelper, stageCloudBenchmark };
