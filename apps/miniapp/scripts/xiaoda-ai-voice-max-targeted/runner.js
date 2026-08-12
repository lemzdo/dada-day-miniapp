'use strict';

const fs = require('node:fs');
const path = require('node:path');
const core = require('./core');

function atomicJson(file, value) {
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, file);
}
function parseContent(result) {
  const response = result?.providerResponse || result?.data?.providerResponse || result?.data || result;
  const content = response?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('PARSE_ERROR:NO_CONTENT');
  return JSON.parse(content.trim().replace(/^```json\s*/i, '').replace(/\s*```$/i, ''));
}
async function run({ invoke, artifactDir, token = process.env.XIAODA_VOICE_MAX_BENCHMARK_TOKEN }) {
  if (typeof invoke !== 'function') throw new Error('INVOKE_REQUIRED');
  if (!token) throw new Error('TOKEN_REQUIRED');
  const { byId } = core.load();
  const prompt = fs.readFileSync(path.resolve(__dirname, '../../../../artifacts/xiaoda-ai-voice-max-targeted/20260812-171649/03-prompt.md'), 'utf8');
  const briefs = core.IDS.map(id => byId.get(id));
  fs.mkdirSync(artifactDir, { recursive: true });
  const outputFile = path.join(artifactDir, '04-max-raw.json');
  const progress = { version: 'xiaoda-ai-voice-max-targeted-v1', status: 'IN_PROGRESS', startedAt: new Date().toISOString(), model: 'qwen3.7-max', batchShape: [8,4], calls: [] };
  atomicJson(outputFile, progress);
  const calls = [];
  try {
    for (const [index, batch] of [briefs.slice(0,8), briefs.slice(8)].entries()) {
      atomicJson(outputFile, { ...progress, calls, activeBatch: index + 1 });
      const started = Date.now();
      const envelope = await invoke({ action: 'xiaodaVoiceMaxTargeted', benchmarkToken: token, modelAlias: 'max', promptVersion: 'xiaoda-today-voice-v2-dev4', briefSchemaVersion: 'xiaoda-styling-brief-v2', systemPrompt: prompt, briefs: batch });
      const result = envelope?.result?.data || envelope?.result || envelope;
      const call = { batch: index + 1, ids: batch.map(x=>x.id), clientLatencyMs: Date.now()-started, ...result };
      calls.push(call);
      atomicJson(outputFile, { ...progress, calls });
      if (result.requestedModel !== 'qwen3.7-max' || result.returnedModel !== 'qwen3.7-max') throw new Error(`MODEL_MISMATCH:BATCH_${index+1}`);
      if (Number(result.httpStatus) !== 200) throw new Error(`HTTP_ERROR:BATCH_${index+1}`);
      const parsed = parseContent(result);
      const returnedIds = parsed?.items?.map(item=>item.id) || [];
      if (returnedIds.length !== batch.length || new Set(returnedIds).size !== batch.length || batch.some(item=>!returnedIds.includes(item.id))) throw new Error(`ID_COMPLETENESS:BATCH_${index+1}`);
      call.parsedItems = parsed.items;
      call.objectiveSafety = batch.map(brief=>({ id: brief.id, failures: core.validateObjective(parsed, brief) }));
      atomicJson(outputFile, { ...progress, calls });
    }
    const completed = { ...progress, status: 'COMPLETED', completedAt: new Date().toISOString(), calls };
    atomicJson(outputFile, completed);
    return completed;
  } catch (error) {
    const failed = { ...progress, status: 'FAILED', completedAt: new Date().toISOString(), calls, error: String(error?.stack || error) };
    atomicJson(outputFile, failed);
    throw error;
  }
}
module.exports = { atomicJson, parseContent, run };
