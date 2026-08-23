const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8');
const boundarySource = fs.readFileSync(path.join(__dirname, 'todayRenderCommit.js'), 'utf8');
const mediaSource = fs.readFileSync(path.join(__dirname, '../../utils/mediaResolution.js'), 'utf8');
const allSource = `${source}\n${boundarySource}\n${mediaSource}`;

test('Today runtime trace is development-only and covers all lifecycle stages', () => {
  assert.match(source, /function traceTodayRuntime[\s\S]*?process\.env\.NODE_ENV === 'production'\) return/);
  assert.match(source, /\[TodayRuntime\] \$\{stage\}/);
  for (const stage of ['recommendation:start', 'recommendation:done', 'recommendation:error', 'media:start', 'media:done', 'media:error', 'commit:start', 'commit:done', 'commit:rejected', 'render']) {
    assert.match(allSource, new RegExp(stage.replace(':', '\\:')));
  }
  assert.match(allSource, /generation/);
  assert.match(allSource, /batchId/);
});

test('recommendation done is logged after server await and before media/commit', () => {
  const done = source.indexOf("traceTodayRuntime('recommendation:done'");
  const commit = source.indexOf('commitCanonicalSnapshotForRender(', done);
  assert.ok(done >= 0 && commit > done);
  assert.match(source.slice(done - 1200, done), /await generateCloudOutfitV2/);
});
