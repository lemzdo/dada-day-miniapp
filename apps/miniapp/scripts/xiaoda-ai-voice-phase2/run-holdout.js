'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { fileHash } = require('./freeze');
const { PROMPT_VERSION, BRIEF_SCHEMA_VERSION, VOICE_INSIGHT_VERSION, PERSONA_VERSION, MODEL_ALLOWLIST, buildPrompt, validateGeneratedOutput, validateModelBrief } = require('./core');
const { parseProviderContent, usageFrom } = require('./run-development');
const { ensureDevToolsDirectSession } = require('../devtools-direct-session');

const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
async function runHoldout(options) {
  const dir = path.resolve(options.artifactDir);
  const freeze = read(path.join(dir, '08-prompt-freeze.json'));
  const sealedFile = path.join(dir, '04-holdout-sealed.json');
  const sealed = read(sealedFile);
  if (freeze.immutable !== true || freeze.holdoutOpened === true) throw new Error('FREEZE_INVALID');
  if (freeze.promptVersion !== PROMPT_VERSION || freeze.briefSchemaVersion !== BRIEF_SCHEMA_VERSION || freeze.voiceInsightVersion !== VOICE_INSIGHT_VERSION || freeze.modelAllowlist?.plus !== MODEL_ALLOWLIST.plus) throw new Error('FREEZE_VERSION_MISMATCH');
  if (freeze.promptSha256 !== fileHash(path.join(dir, '01-prompt.md')) || freeze.briefSchemaSha256 !== fileHash(path.join(dir, '02-brief-schema.json')) || freeze.holdoutSealedSha256 !== fileHash(sealedFile)) throw new Error('FREEZE_HASH_MISMATCH');
  if (sealed.opened === true || sealed.sealed !== true || sealed.count !== 16) throw new Error('HOLDOUT_ALREADY_OPENED');
  const ids = sealed.ids || [];
  if (ids.length !== 16 || ids.some((id) => /^dev-/.test(id))) throw new Error('HOLDOUT_ID_INVALID');
  const briefs = sealed.fixtures.map((entry) => entry.modelBrief || entry.internalBrief);
  if (briefs.length !== 16 || briefs.some((brief) => /^dev-/.test(brief.id))) throw new Error('HOLDOUT_BRIEF_INVALID');
  const token = process.env.XIAODA_VOICE_BENCHMARK_TOKEN;
  if (!token) throw new Error('XIAODA_VOICE_BENCHMARK_TOKEN is required');
  const session = options.deps?.mini ? null : await ensureDevToolsDirectSession({ deps: options.deps });
  const mini = options.deps?.mini || session.mini;
  if (!mini?.evaluate) throw new Error('MINI_REQUIRED');
  const prompt = fs.readFileSync(path.join(dir, '01-prompt.md'), 'utf8').trim();
  if (prompt !== buildPrompt() || freeze.personaVersion !== PERSONA_VERSION) throw new Error('PROMPT_OR_PERSONA_MISMATCH');
  if (freeze.personaSha256 !== require('./freeze').sha256(PERSONA_VERSION) || freeze.voiceInsightSha256 !== require('./freeze').sha256(VOICE_INSIGHT_VERSION) || freeze.modelAllowlistSha256 !== require('./freeze').sha256(JSON.stringify(MODEL_ALLOWLIST))) throw new Error('FREEZE_HASH_MISMATCH');
  if (MODEL_ALLOWLIST.plus !== 'qwen3.7-plus' || briefs.some((brief) => !validateModelBrief(brief).pass)) throw new Error('MODEL_BRIEF_INVALID');
  const openedAt = new Date().toISOString();
  const calls = [];
  const runFile = path.join(dir, '09-holdout-run.json');
  fs.writeFileSync(sealedFile, `${JSON.stringify({ ...sealed, opened: true, openedAt }, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, '08-prompt-freeze.json'), `${JSON.stringify({ ...freeze, holdoutOpened: true, holdoutOpenedAt: openedAt }, null, 2)}\n`);
  fs.writeFileSync(runFile, `${JSON.stringify({ version: 'xiaoda-ai-voice-phase2-holdout-v1', status: 'IN_PROGRESS', openedAt, fixtureCount: 16, modelAlias: 'plus', calls: [] }, null, 2)}\n`);
  try { for (let i = 0; i < 2; i += 1) {
    const batch = briefs.slice(i * 8, i * 8 + 8);
    const started = Date.now();
    const envelope = await mini.evaluate(async (payload) => globalThis.wx.cloud.callFunction({ name: 'generateOutfit', data: { action: payload.action, benchmarkToken: payload.token, modelAlias: payload.modelAlias, promptVersion: payload.promptVersion, briefSchemaVersion: payload.briefSchemaVersion, systemPrompt: payload.systemPrompt, briefs: payload.briefs } }), { action: 'xiaodaVoicePhase2Benchmark', token, modelAlias: 'plus', promptVersion: PROMPT_VERSION, briefSchemaVersion: BRIEF_SCHEMA_VERSION, systemPrompt: prompt, briefs: batch });
    const result = envelope?.result?.data || envelope?.result || envelope;
    const rawContent = parseProviderContent(result); let parsed = null; try { parsed = JSON.parse(String(rawContent).replace(/^```json\s*/i, '').replace(/\s*```$/i, '')); } catch {}
    calls.push({ label: `holdout-${i + 1}`, ids: batch.map((b) => b.id), modelAlias: 'plus', action: 'xiaodaVoicePhase2Benchmark', openedAt, clientLatencyMs: Date.now() - started, providerLatencyMs: result.wallLatencyMs || null, requestedModel: result.requestedModel || null, returnedModel: result.returnedModel || result.providerResponse?.model || null, usage: usageFrom(result), httpStatus: result.httpStatus || null, parseStatus: rawContent && parsed ? 'PASS' : 'FAIL', validation: validateGeneratedOutput(parsed || { items: [] }, batch.map((b) => b.id), batch), parsedItems: parsed?.items || [], rawResponse: result.providerResponse || null, rawBody: result.rawBody || null });
  } } catch (error) {
    fs.writeFileSync(runFile, `${JSON.stringify({ version: 'xiaoda-ai-voice-phase2-holdout-v1', status: 'FAILED', openedAt, fixtureCount: 16, modelAlias: 'plus', calls, failure: String(error?.message || error) }, null, 2)}\n`);
    if (session?.mini?.disconnect) session.mini.disconnect();
    throw error;
  }
  if (session?.mini?.disconnect) session.mini.disconnect();
  const output = { version: 'xiaoda-ai-voice-phase2-holdout-v1', openedAt, fixtureCount: 16, promptVersion: PROMPT_VERSION, briefSchemaVersion: BRIEF_SCHEMA_VERSION, voiceInsightVersion: VOICE_INSIGHT_VERSION, modelAlias: 'plus', calls, objectiveChecksPass: calls.every((call) => call.parseStatus === 'PASS' && call.validation.pass && call.requestedModel === MODEL_ALLOWLIST.plus && call.returnedModel === MODEL_ALLOWLIST.plus), editorialReviewRequired: true };
  fs.writeFileSync(runFile, `${JSON.stringify({ ...output, status: 'COMPLETED' }, null, 2)}\n`);
  fs.writeFileSync(sealedFile, `${JSON.stringify({ ...sealed, opened: true, openedAt }, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, '08-prompt-freeze.json'), `${JSON.stringify({ ...freeze, holdoutOpened: true, holdoutOpenedAt: openedAt }, null, 2)}\n`);
  return output;
}
if (require.main === module) runHoldout({ artifactDir: process.argv[2] }).catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
module.exports = { runHoldout };
