'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {run}=require('./runner');

(async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'max-targeted-run-')); const sizes=[];
  const completed=await run({artifactDir:dir,token:'test-token',invoke:async req=>{
    sizes.push(req.briefs.length);
    const providerResponse={model:'qwen3.7-max',choices:[{message:{content:JSON.stringify({items:req.briefs.map(b=>({id:b.id,reason:'已知衣物组合。'}))})}}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}};
    return {requestedModel:'qwen3.7-max',returnedModel:'qwen3.7-max',httpStatus:200,providerLatencyMs:5,retryCount:0,rawBody:JSON.stringify(providerResponse),providerResponse,usage:providerResponse.usage};
  }});
  assert.deepEqual(sizes,[8,4]); assert.equal(completed.status,'COMPLETED'); assert.equal(completed.calls.length,2); assert.ok(completed.calls.every(c=>c.rawBody&&c.parsedItems.length===c.ids.length));
  const failedDir=fs.mkdtempSync(path.join(os.tmpdir(),'max-targeted-fail-')); let count=0;
  await assert.rejects(run({artifactDir:failedDir,token:'test-token',invoke:async req=>{
    count+=1; const providerResponse={model:'qwen3.7-max',choices:[{message:{content:JSON.stringify({items:req.briefs.map(b=>({id:b.id,reason:'已知衣物组合。'}))})}}]};
    return count===1?{requestedModel:'qwen3.7-max',returnedModel:'qwen3.7-max',httpStatus:200,rawBody:JSON.stringify(providerResponse),providerResponse}:{requestedModel:'qwen3.7-max',returnedModel:'wrong',httpStatus:200,rawBody:'evidence'};
  }}),/MODEL_MISMATCH/);
  const failed=JSON.parse(fs.readFileSync(path.join(failedDir,'04-max-raw.json'),'utf8')); assert.equal(failed.status,'FAILED'); assert.equal(failed.calls.length,2); assert.equal(failed.calls[1].rawBody,'evidence');
  console.log('runner 8+4 and failure preservation PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
