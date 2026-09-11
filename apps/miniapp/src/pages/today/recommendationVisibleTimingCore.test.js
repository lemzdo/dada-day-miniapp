'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  FAILURE_REASONS,
  buildVisibleTimingSelectorClass,
  classifyVisibleNode,
  createRecommendationVisibleTimingRecorder,
  findVisibleNode,
} = require('./recommendationVisibleTimingCore');
const { commitCanonicalSnapshotForRender } = require('./todayRenderCommit');

function fixture() {
  let current = 100;
  const events = [];
  const timers = [];
  const recorder = createRecommendationVisibleTimingRecorder({
    now: () => current,
    emit: (label, payload) => events.push({ label, payload }),
    schedule: (callback) => { timers.push(callback); return callback; },
    cancel: (callback) => { const index = timers.indexOf(callback); if (index >= 0) timers.splice(index, 1); },
    imageLoadTimeoutMs: 5000,
  });
  return {
    recorder,
    events,
    timers,
    at(value) { current = value; },
  };
}

test('timing lifecycle emits every stage and one complete record', () => {
  const run = fixture();
  const identity = { batchId: 'batch-1', outfitKey: 'outfit-1' };
  run.recorder.create({ auditId: 'audit-1', seq: 1, sceneKey: 'home', trigger: 'initial', requestStart: 100 });
  run.at(180); run.recorder.response({ auditId: 'audit-1', ...identity });
  run.at(190); run.recorder.commit(identity);
  run.at(200); run.recorder.content(identity);
  run.at(210); run.recorder.imageLoad(identity);
  run.at(220); run.recorder.imageVisible(identity);

  assert.deepEqual(run.events.map((event) => event.label), [
    '[RecommendationVisibleTiming:create]',
    '[RecommendationVisibleTiming:response]',
    '[RecommendationVisibleTiming:commit]',
    '[RecommendationVisibleTiming:content]',
    '[RecommendationVisibleTiming:image-load]',
    '[RecommendationVisibleTiming:image-visible]',
    '[RecommendationVisibleTiming:complete]',
    '[RecommendationVisibleTiming]',
  ]);
  assert.deepEqual(run.recorder.read()[0], {
    auditId: 'audit-1', seq: 1, sceneKey: 'home', trigger: 'initial', batchId: 'batch-1', outfitKey: 'outfit-1',
    requestStart: 100, clientResponseReceivedMs: 80, stateCommitMs: 90, contentVisibleMs: 100,
    imageLoadMs: 110, imageVisibleMs: 120, complete: true,
  });
});

test('a real response and recommendation commit create a readable timing before paint', async () => {
  const run = fixture();
  const identity = { batchId: 'batch-commit', outfitKey: 'outfit-commit' };
  run.recorder.create({ auditId: 'audit-commit', seq: 2, sceneKey: 'work', requestStart: 100 });
  run.at(150); run.recorder.response({ auditId: 'audit-commit', ...identity });
  run.at(160);
  const committed = await commitCanonicalSnapshotForRender({
    canonicalSnapshot: { batchId: identity.batchId, cards: [{ outfitKey: identity.outfitKey }] },
    isOwner: () => true,
    hydrate: async (snapshot) => snapshot,
    setCanonicalRef: () => undefined,
    setRenderState: () => run.recorder.commit(identity),
  });
  const record = run.recorder.read()[0];
  assert.equal(committed.batchId, identity.batchId);
  assert.equal(record.batchId, identity.batchId);
  assert.equal(record.stateCommitMs, 60);
  assert.equal(record.complete, false);
});

test('stale seq and stale batch never mutate the active timing', () => {
  const run = fixture();
  run.recorder.create({ auditId: 'old', seq: 1, sceneKey: 'home', requestStart: 100 });
  run.recorder.create({ auditId: 'new-a', seq: 2, sceneKey: 'home', requestStart: 100 });
  assert.equal(run.recorder.response({ auditId: 'old', batchId: 'old-batch', outfitKey: 'old-outfit' }), false);
  run.recorder.response({ auditId: 'new-a', batchId: 'batch-a', outfitKey: 'outfit-a' });
  run.recorder.create({ auditId: 'new-b', seq: 2, sceneKey: 'home', requestStart: 100 });
  run.recorder.response({ auditId: 'new-b', batchId: 'batch-b', outfitKey: 'outfit-b' });
  assert.equal(run.recorder.commit({ batchId: 'batch-a', outfitKey: 'outfit-a' }), false);
  assert.deepEqual(run.events.filter((event) => event.label === '[RecommendationVisibleTiming:failure]')
    .map((event) => event.payload.reason), [FAILURE_REASONS.STALE_SEQ, FAILURE_REASONS.STALE_BATCH]);
});

test('selector diagnostics distinguish empty, zero-size, and identity mismatch', () => {
  const expected = { batchId: 'batch-1', outfitKey: 'outfit-1' };
  const current = { ...expected };
  assert.equal(classifyVisibleNode({ stage: 'content', node: null, expected, current }).reason, FAILURE_REASONS.CONTENT_SELECTOR_EMPTY);
  assert.equal(classifyVisibleNode({ stage: 'image', node: null, expected, current }).reason, FAILURE_REASONS.IMAGE_SELECTOR_EMPTY);
  assert.equal(classifyVisibleNode({ stage: 'content', node: { width: 0, height: 20 }, expected, current }).reason, FAILURE_REASONS.CONTENT_ZERO_SIZE);
  assert.equal(classifyVisibleNode({ stage: 'image', node: { width: 20, height: 0 }, expected, current }).reason, FAILURE_REASONS.IMAGE_ZERO_SIZE);
  assert.equal(classifyVisibleNode({ stage: 'content', node: { width: 20, height: 20, dataset: {} }, expected, current }).reason, FAILURE_REASONS.CONTENT_IDENTITY_MISMATCH);
  assert.deepEqual(classifyVisibleNode({ stage: 'image', node: { width: 20, height: 20, dataset: { recommendationBatchId: 'batch-1', outfitKey: 'outfit-1' } }, expected, current }), { ok: true });
});

test('identity-scoped selector skips stale batch nodes during render replacement', () => {
  const expected = { batchId: 'batch-new', outfitKey: 'outfit-new' };
  const current = { ...expected };
  const selectorClass = buildVisibleTimingSelectorClass(expected, 'content');
  assert.match(selectorClass, /^qa-visible-timing-content-[a-z0-9]+$/);
  assert.notEqual(selectorClass, buildVisibleTimingSelectorClass({ batchId: 'batch-old', outfitKey: 'outfit-old' }, 'content'));

  const selection = findVisibleNode({
    stage: 'content',
    nodes: [
      { width: 20, height: 20, dataset: { recommendationBatchId: 'batch-old', outfitKey: 'outfit-old' } },
      { width: 20, height: 20, dataset: { recommendationBatchId: 'batch-new', outfitKey: 'outfit-new' } },
    ],
    expected,
    current,
  });
  assert.equal(selection.ok, true);
  assert.equal(selection.nodeCount, 2);
});

test('identity-scoped selector remains valid when Taro omits dataset fields', () => {
  const expected = { batchId: 'batch-new', outfitKey: 'outfit-new' };
  assert.deepEqual(findVisibleNode({
    stage: 'image',
    nodes: [{ width: 20, height: 20, dataset: {} }],
    expected,
    current: expected,
    selectorIdentityMatched: true,
  }), {
    ok: true,
    node: { width: 20, height: 20, dataset: {} },
    nodeCount: 1,
  });
});

test('image load lifecycle cancels timeout and missing onLoad is diagnostic', () => {
  const complete = fixture();
  const identity = { batchId: 'batch-image', outfitKey: 'outfit-image' };
  complete.recorder.create({ auditId: 'audit-image', seq: 1, sceneKey: 'date', requestStart: 100 });
  complete.recorder.response({ auditId: 'audit-image', ...identity });
  complete.recorder.commit(identity);
  assert.equal(complete.timers.length, 1);
  complete.recorder.imageLoad(identity);
  assert.equal(complete.timers.length, 0);

  const missing = fixture();
  missing.recorder.create({ auditId: 'audit-missing', seq: 1, sceneKey: 'sport', requestStart: 100 });
  missing.recorder.response({ auditId: 'audit-missing', ...identity });
  missing.recorder.commit(identity);
  missing.timers[0]();
  assert.equal(missing.events.at(-1).payload.reason, FAILURE_REASONS.IMAGE_ONLOAD_NOT_FIRED);
});

test('a newer request cancels the superseded image timeout without a failure', () => {
  const run = fixture();
  const oldIdentity = { batchId: 'batch-old', outfitKey: 'outfit-old' };
  run.recorder.create({ auditId: 'audit-old', seq: 1, sceneKey: 'home', requestStart: 100 });
  run.recorder.response({ auditId: 'audit-old', ...oldIdentity });
  run.recorder.commit(oldIdentity);
  assert.equal(run.timers.length, 1);

  run.recorder.create({ auditId: 'audit-new', seq: 2, sceneKey: 'home', requestStart: 120 });

  assert.equal(run.timers.length, 0);
  assert.equal(
    run.events.some((event) => event.label === '[RecommendationVisibleTiming:failure]'),
    false,
  );
});

test('missing audit id is never silently ignored', () => {
  const run = fixture();
  assert.equal(run.recorder.create({ auditId: '', seq: 1, sceneKey: 'home', requestStart: 100 }), null);
  assert.equal(run.events[0].payload.reason, FAILURE_REASONS.MISSING_AUDIT_ID);
});
