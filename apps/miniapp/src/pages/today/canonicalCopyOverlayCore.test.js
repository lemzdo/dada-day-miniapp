'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  CANONICAL_COPY_REFRESH_OFFSETS_MS,
  applyCanonicalCopyOverlay,
  runBoundedCanonicalCopyRefresh,
} = require('./canonicalCopyOverlayCore');

function snapshot(batchId = 'batch-1') {
  return { batchId, cards: [
    { outfitKey: 'outfit-1', todayReason: 'safe-1' },
    { outfitKey: 'outfit-2', todayReason: 'safe-2' },
  ] };
}

test('overlay changes only matching reason text and rejects a stale batch', () => {
  const overlay = { batchId: 'batch-1', copies: [{ outfitKey: 'outfit-1', cardIndex: 0, text: 'ai-1', source: 'ai_cache', availableAt: 'now' }] };
  const result = applyCanonicalCopyOverlay(snapshot(), overlay);
  assert.equal(result.snapshot.cards[0].todayReason, 'ai-1');
  assert.equal(result.snapshot.cards[1].todayReason, 'safe-2');
  assert.equal(result.applied.length, 1);
  assert.equal(applyCanonicalCopyOverlay(snapshot('new-batch'), overlay).applied.length, 0);
});

test('bounded refresh polls fixed offsets, applies partial copies, and stops at ready', async () => {
  let clock = 0;
  let reads = 0;
  const applied = [];
  const result = await runBoundedCanonicalCopyRefresh({
    batchId: 'batch-1',
    isCurrent: () => true,
    now: () => clock,
    sleep: async (delay) => { clock += delay; },
    read: async () => {
      reads += 1;
      if (reads === 1) return { batchId: 'batch-1', status: 'pending', copies: [] };
      if (reads === 2) return { batchId: 'batch-1', status: 'partial', copies: [{ outfitKey: 'outfit-1', rendererVersion: 'v', text: 'ai-1' }] };
      return { batchId: 'batch-1', status: 'ready', copies: [{ outfitKey: 'outfit-1', rendererVersion: 'v', text: 'ai-1' }, { outfitKey: 'outfit-2', rendererVersion: 'v', text: 'ai-2' }] };
    },
    apply: (overlay) => applied.push(overlay.copies.map((copy) => copy.outfitKey)),
  });
  assert.deepEqual(CANONICAL_COPY_REFRESH_OFFSETS_MS, [0, 150, 350, 700, 1200]);
  assert.equal(result.status, 'ready');
  assert.equal(reads, 3);
  assert.deepEqual(applied, [['outfit-1'], ['outfit-1', 'outfit-2']]);
});

test('bounded refresh stops without applying when generation becomes stale', async () => {
  let current = true;
  let applied = false;
  const result = await runBoundedCanonicalCopyRefresh({
    batchId: 'batch-1',
    offsetsMs: [0, 1],
    sleep: async () => { current = false; },
    read: async () => ({ batchId: 'batch-1', status: 'pending', copies: [] }),
    isCurrent: () => current,
    apply: () => { applied = true; },
  });
  assert.equal(result.status, 'stale');
  assert.equal(applied, false);
});
