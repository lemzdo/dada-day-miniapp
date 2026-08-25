'use strict';

const CANONICAL_COPY_REFRESH_OFFSETS_MS = Object.freeze([0, 150, 350, 700, 1200]);

function applyCanonicalCopyOverlay(snapshot, overlay) {
  if (!snapshot || !overlay || snapshot.batchId !== overlay.batchId || !Array.isArray(overlay.copies)) {
    return { snapshot, applied: [] };
  }
  const byOutfitKey = new Map(overlay.copies
    .filter((copy) => copy?.source === 'ai_cache' && typeof copy.text === 'string' && copy.text.trim())
    .map((copy) => [copy.outfitKey, copy]));
  const applied = [];
  const cards = snapshot.cards.map((card, cardIndex) => {
    const copy = byOutfitKey.get(card.outfitKey);
    if (!copy || copy.cardIndex !== cardIndex || card.todayReason === copy.text) return card;
    applied.push(copy);
    return {
      ...card,
      todayReason: copy.text,
      copySource: 'ai_cache',
      aiState: 'ready',
      canonicalAvailableAt: copy.availableAt,
    };
  });
  return applied.length > 0 ? { snapshot: { ...snapshot, cards }, applied } : { snapshot, applied };
}

async function runBoundedCanonicalCopyRefresh({
  batchId,
  read,
  isCurrent,
  apply,
  onAvailable = () => {},
  onAttempt = () => {},
  offsetsMs = CANONICAL_COPY_REFRESH_OFFSETS_MS,
  sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
  now = () => Date.now(),
} = {}) {
  const startedAt = now();
  let observedCopyKeys = new Set();
  for (const [offsetIndex, offset] of offsetsMs.entries()) {
    const remaining = Math.max(0, offset - (now() - startedAt));
    if (remaining > 0) await sleep(remaining);
    if (!isCurrent()) return { status: 'stale', attempts: offsetIndex };
    let overlay;
    try {
      overlay = await read(batchId);
    } catch {
      onAttempt({ attempt: offsetIndex + 1, delayMs: offset, batchId, canonicalFound: false, jobStage: 'overlay_read_failed' });
      continue;
    }
    if (!isCurrent() || overlay?.batchId !== batchId) return { status: 'stale', attempts: offsetIndex + 1 };
    onAttempt({
      attempt: offsetIndex + 1,
      delayMs: offset,
      batchId,
      canonicalFound: Array.isArray(overlay.copies) && overlay.copies.length > 0,
      jobStage: overlay.jobStage || overlay.status || 'unknown',
    });
    const fresh = (Array.isArray(overlay.copies) ? overlay.copies : []).filter((copy) => {
      const key = `${copy.outfitKey}|${copy.rendererVersion}|${copy.text}`;
      if (observedCopyKeys.has(key)) return false;
      observedCopyKeys.add(key);
      return true;
    });
    if (fresh.length > 0) {
      onAvailable({ ...overlay, copies: fresh });
      apply(overlay);
    }
    if (overlay.status === 'ready') {
      return { status: 'ready', attempts: offsetIndex + 1, observedCount: observedCopyKeys.size };
    }
  }
  return { status: 'bounded_complete', attempts: offsetsMs.length, observedCount: observedCopyKeys.size };
}

module.exports = {
  CANONICAL_COPY_REFRESH_OFFSETS_MS,
  applyCanonicalCopyOverlay,
  runBoundedCanonicalCopyRefresh,
};
