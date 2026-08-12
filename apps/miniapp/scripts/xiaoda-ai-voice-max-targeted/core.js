'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '../../../..');
const IDS = ['dev-sparse-facts','dev-ordinary-home-basic','dev-ordinary-work-basic','dev-onepiece-shoes','dev-onepiece-layer','dev-upper-complex-lower-simple','dev-strong-color-focus','dev-competing-insights','dev-top-shoe-echo','dev-same-color-core','dev-weather-relevant','dev-sport-complete'];
const stable = v => Array.isArray(v) ? `[${v.map(stable).join(',')}]` : (!v || typeof v !== 'object') ? JSON.stringify(v) : `{${Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')}}`;
const hash = v => crypto.createHash('sha256').update(stable(v)).digest('hex');
const bytesHash = b => crypto.createHash('sha256').update(b).digest('hex');
function load(){ const d=JSON.parse(fs.readFileSync(path.join(ROOT,'artifacts/xiaoda-ai-voice-phase2/phase2-development-gate/03-development.json'),'utf8')); const a=JSON.parse(fs.readFileSync(path.join(ROOT,'artifacts/xiaoda-ai-voice-phase2/phase2-development-gate/06-development-attempt-4.json'),'utf8')); const byId=new Map(d.fixtures.map(x=>[x.id,x.modelBrief])); const refs={}; for(const c of a.calls) for(const id of c.ids) refs[id]={call:c.label, parsed:c.parsedItems.find(x=>x.id===id), raw:c.rawResponse?.choices?.[0]?.message?.content, rawBody:c.rawBody, requestedModel:c.requestedModel, returnedModel:c.returnedModel, usage:c.usage, latency:{client:c.clientLatencyMs,provider:c.providerLatencyMs}, httpStatus:c.httpStatus, parseStatus:c.parseStatus, validation:c.validation}; return {byId,refs}; }
const GARMENT_TERMS = ['T恤','衬衫','针织衫','Polo衫','上衣','短裤','长裤','直筒裤','阔腿裤','运动裤','半身裙','连衣裙','外套','风衣','开衫','运动鞋','乐福鞋','单鞋'];
const ATTRIBUTE_TERMS = ['红色','蓝色','绿色','白色','黑色','灰色','米色','棕色','藏青色','印花','纯色','修身','宽松','高腰','短款','长款'];
const ATTRIBUTE_ALIASES = Object.freeze({ graphic: ['印花'], fitted: ['修身'], wideLeg: ['阔腿'], red: ['红色'], blue: ['蓝色'], green: ['绿色'], white: ['白色'], black: ['黑色'], gray: ['灰色'], grey: ['灰色'], beige: ['米色'], brown: ['棕色'], navy: ['藏青色'] });
function validateObjective(output, brief){
  let parsed; try{parsed=typeof output==='string'?JSON.parse(output):output;}catch{return ['PARSE_ERROR'];}
  const item=parsed?.items?.find(x=>x.id===brief.id); if(!item||!String(item.reason||'').trim()) return ['EMPTY_OUTPUT'];
  const reason=String(item.reason); const failures=[]; const garments=brief.garments||[];
  const names=garments.map(g=>g.name).filter(Boolean); const rawAttrs=garments.flatMap(g=>[g.color,g.pattern,g.fit,g.shape]).filter(Boolean);
  const authorizedRelationAttrs = [brief.primaryStylingPoint, brief.supportingPoint]
    .flatMap(point => point?.relationType === 'PATTERN_SOLID_BALANCE' ? ['纯色'] : []);
  const attrs=rawAttrs.flatMap(attr=>[String(attr),...(ATTRIBUTE_ALIASES[String(attr)]||[])]).concat(authorizedRelationAttrs);
  const mentionedGarments=GARMENT_TERMS.filter(term=>reason.includes(term));
  if (/(?:加上|加入|再配|换成|搭一件|外搭)/.test(reason) && mentionedGarments.some(term=>!names.some(name=>name.includes(term)||term.includes(name)))) failures.push('INVENTED_GARMENT');
  if (ATTRIBUTE_TERMS.some(term=>reason.includes(term)&&!attrs.some(attr=>String(attr).includes(term)||term.includes(String(attr))))) failures.push('INVENTED_ATTRIBUTE');
  if (mentionedGarments.some(term=>!names.some(name=>name.includes(term)||term.includes(name)))) failures.push('WRONG_ITEM');
  if (/(?:高级|显瘦|轻盈|温和|舒服|舒适|有型|干练|时髦|清爽)/.test(reason)) failures.push('UNSUPPORTED_EFFECT');
  if (/(?:适合|用于|去|通勤去)?(?:上班|工作日|工作场合)/.test(reason)&&brief.scene!=='work' || /(?:适合|用于|去)约会/.test(reason)&&brief.scene!=='date' || /(?:适合|用于|去|做)运动/.test(reason)&&brief.scene!=='sport') failures.push('SCENE_CONTRADICTION');
  if (/(?:天气|降温|偏冷|有风|下雨|保暖|防风|凉快)/.test(reason)&&!brief.meaningfulWeather) failures.push('WEATHER_HALLUCINATION');
  return [...new Set(failures)];
}
function buildRequest(briefs,prompt){ return {model:'qwen3.7-max',temperature:.3,top_p:.8,max_tokens:900,stream:false,enable_thinking:false,action:'xiaodaVoiceMaxTargeted',promptVersion:'xiaoda-today-voice-v2-dev4',briefSchemaVersion:'xiaoda-styling-brief-v2',briefs,prompt}; }
function assertRequest(req){ if(req.model!=='qwen3.7-max'||req.action!=='xiaodaVoiceMaxTargeted'||req.temperature!==.3||req.top_p!==.8||req.max_tokens!==900||req.stream!==false||req.enable_thinking!==false) throw Error('invalid max request'); if(!Array.isArray(req.briefs)||req.briefs.length<1||req.briefs.length>8) throw Error('batch must be 1..8'); if(req.promptVersion!=='xiaoda-today-voice-v2-dev4'||req.briefSchemaVersion!=='xiaoda-styling-brief-v2') throw Error('version mismatch'); return req; }
function maxHelper({briefs,prompt,invoke}){ const req=assertRequest(buildRequest(briefs,prompt)); const started=Date.now(); let response; let error=null; try{response=invoke(req);}catch(e){error=String(e.message||e);} return {requestedModel:req.model,returnedModel:response?.model||null,httpStatus:response?.httpStatus||null,rawBody:response?.rawBody||null,providerResponse:response||null,usage:response?.usage||null,latencyMs:Date.now()-started,retryCount:response?.retryCount||0,error,tokenHash:bytesHash(Buffer.from(JSON.stringify(req)))}; }
module.exports={IDS,stable,hash,bytesHash,load,validateObjective,buildRequest,assertRequest,maxHelper};
