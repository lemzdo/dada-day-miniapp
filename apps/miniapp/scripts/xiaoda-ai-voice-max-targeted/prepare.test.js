'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const core = require('./core');
const { stage } = require('./stage-helper');

const {byId,refs}=core.load();
assert.equal(core.IDS.length,12);
for(const id of core.IDS){assert.ok(byId.get(id)); assert.ok(refs[id]);}
const req=core.buildRequest(core.IDS.slice(0,8).map(id=>byId.get(id)),'prompt');
assert.doesNotThrow(()=>core.assertRequest(req));
for (const bad of [{model:'qwen3.7-plus'},{action:'other'},{promptVersion:'other'},{briefSchemaVersion:'other'}]) assert.throws(()=>core.assertRequest({...req,...bad}));
assert.throws(()=>core.assertRequest({...req,briefs:core.IDS.map(id=>byId.get(id))}),/batch/);
const sourcePrompt=fs.readFileSync(path.resolve(__dirname,'../../../../artifacts/xiaoda-ai-voice-phase2/phase2-development-gate/01-prompt.md'));
const selectedPrompt=fs.readFileSync(path.resolve(__dirname,'../../../../artifacts/xiaoda-ai-voice-max-targeted/20260812-171649/03-prompt.md'));
assert.equal(core.bytesHash(sourcePrompt),core.bytesHash(selectedPrompt));
const selected=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../../../artifacts/xiaoda-ai-voice-max-targeted/20260812-171649/01-selected-cases.json')));
for (const brief of selected.briefs) assert.equal(core.hash(brief),core.hash(byId.get(brief.id)));
const equivalence=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../../../artifacts/xiaoda-ai-voice-max-targeted/20260812-171649/02-input-equivalence.json')));
assert.equal(equivalence.comparisonClass,'MODEL_CAPABILITY_COMPARISON'); assert.equal(equivalence.promptCleanup,'NONE'); assert.equal(equivalence.cases.length,12); assert.ok(equivalence.cases.every(entry=>entry.status==='PASS'));

const objectiveCases = [
  ['{bad','PARSE_ERROR'],
  ['{"items":[{"id":"x","reason":""}]}','EMPTY_OUTPUT'],
  ['{"items":[{"id":"x","reason":"再配一件风衣。"}]}','INVENTED_GARMENT'],
  ['{"items":[{"id":"x","reason":"红色T恤很醒目。"}]}','INVENTED_ATTRIBUTE'],
  ['{"items":[{"id":"x","reason":"这身很高级。"}]}','UNSUPPORTED_EFFECT'],
  ['{"items":[{"id":"x","reason":"整身看着清爽。"}]}','UNSUPPORTED_EFFECT'],
  ['{"items":[{"id":"x","reason":"连衣裙很简单。"}]}','WRONG_ITEM'],
  ['{"items":[{"id":"x","reason":"适合约会。"}]}','SCENE_CONTRADICTION'],
  ['{"items":[{"id":"x","reason":"今天有风。"}]}','WEATHER_HALLUCINATION'],
];
const minimal={id:'x',scene:'home',garments:[{name:'T恤',color:'白色'}]};
for (const [output,code] of objectiveCases) assert.ok(core.validateObjective(output,minimal).includes(code),code);
assert.deepEqual(core.validateObjective('{"items":[{"id":"x","reason":"印花T恤配运动鞋。"}]}',{id:'x',scene:'home',garments:[{name:'T恤',pattern:'graphic'},{name:'运动鞋'}]}),[]);

const temp=fs.mkdtempSync(path.join(os.tmpdir(),'max-stage-'));
const source=path.join(temp,'source'); fs.mkdirSync(source);
const productionIndex="const { isDeepStrictEqual } = require('node:util');\nasync function main(event){\n  const action=event.action;\n  const handlerStartedAt = Date.now();\n  return action;\n}";
fs.writeFileSync(path.join(source,'index.js'),productionIndex); fs.writeFileSync(path.join(source,'package.json'),'{}');
const target=path.join(temp,'stage','generateOutfit'); const token=crypto.randomBytes(32).toString('base64url');
const audit=stage({sourceDirectory:source,targetDirectory:target,token});
assert.equal(audit.productionSourceUnmodified,true); assert.match(fs.readFileSync(path.join(target,'index.js'),'utf8'),/xiaodaVoiceMaxTargeted/); assert.ok(fs.existsSync(path.join(target,'benchmarkXiaodaVoiceMaxTargeted.js'))); assert.equal(fs.readFileSync(path.join(source,'index.js'),'utf8'),productionIndex);
const productionReal=fs.readFileSync(path.resolve(__dirname,'../../cloudfunctions/generateOutfit/index.js'),'utf8'); assert.doesNotMatch(productionReal,/xiaodaVoiceMaxTargeted|benchmarkXiaodaVoiceMaxTargeted/);
console.log('max-targeted tests PASS');
