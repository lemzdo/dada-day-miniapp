const assert = require('node:assert/strict');
const test = require('node:test');

const {
  summarizeBatchAfterDraftDiscard,
} = require('./discardClothesDraftCore');

function draft(overrides = {}) {
  return {
    _id: overrides._id || 'draft-1',
    status: 'pending',
    selected: true,
    displayImageUrl: 'cloud://image',
    ...overrides,
  };
}

function image(overrides = {}) {
  return {
    _id: overrides._id || 'image-1',
    status: 'detected',
    ...overrides,
  };
}

test('does not terminal batch when another pending draft remains', () => {
  const result = summarizeBatchAfterDraftDiscard({
    targetDraftId: 'draft-1',
    drafts: [draft({ _id: 'draft-1' }), draft({ _id: 'draft-2' })],
    images: [image()],
  });

  assert.equal(result.batchTerminal, false);
  assert.equal(result.pendingDraftCount, 1);
});

test('terminals batch after last pending draft when no processing image remains', () => {
  const result = summarizeBatchAfterDraftDiscard({
    targetDraftId: 'draft-1',
    drafts: [draft({ _id: 'draft-1' })],
    images: [image()],
  });

  assert.equal(result.batchTerminal, true);
  assert.equal(result.batchStatus, 'discarded');
});

test('does not terminal batch while image processing can still create drafts', () => {
  const result = summarizeBatchAfterDraftDiscard({
    targetDraftId: 'draft-1',
    drafts: [draft({ _id: 'draft-1' })],
    images: [image({ status: 'processing' })],
  });

  assert.equal(result.batchTerminal, false);
  assert.equal(result.processingImageCount, 1);
});

test('does not terminal batch while confirming draft exists', () => {
  const result = summarizeBatchAfterDraftDiscard({
    targetDraftId: 'draft-1',
    drafts: [draft({ _id: 'draft-1' }), draft({ _id: 'draft-2', status: 'confirming' })],
    images: [image()],
  });

  assert.equal(result.batchTerminal, false);
  assert.equal(result.confirmingDraftCount, 1);
});

test('ignores already confirmed drafts when deciding discard terminal', () => {
  const result = summarizeBatchAfterDraftDiscard({
    targetDraftId: 'draft-1',
    drafts: [draft({ _id: 'draft-1' }), draft({ _id: 'draft-2', status: 'confirmed' })],
    images: [image()],
  });

  assert.equal(result.batchTerminal, true);
  assert.equal(result.confirmedDraftCount, 1);
});

test('repeated discard of same draft remains idempotent', () => {
  const result = summarizeBatchAfterDraftDiscard({
    targetDraftId: 'draft-1',
    drafts: [draft({ _id: 'draft-1', status: 'discarded', selected: false })],
    images: [image()],
  });

  assert.equal(result.batchTerminal, true);
  assert.equal(result.batchStatus, 'discarded');
});

test('unselected pending draft still prevents terminal batch', () => {
  const result = summarizeBatchAfterDraftDiscard({
    targetDraftId: 'draft-1',
    drafts: [draft({ _id: 'draft-1' }), draft({ _id: 'draft-2', selected: false })],
    images: [image()],
  });

  assert.equal(result.batchTerminal, false);
  assert.equal(result.pendingDraftCount, 1);
});

test('pending and detecting images both prevent terminal batch', () => {
  for (const status of ['pending', 'detecting']) {
    const result = summarizeBatchAfterDraftDiscard({
      targetDraftId: 'draft-1',
      drafts: [draft({ _id: 'draft-1' })],
      images: [image({ status })],
    });

    assert.equal(result.batchTerminal, false);
    assert.equal(result.processingImageCount, 1);
  }
});

test('failed and empty images do not prevent terminal batch', () => {
  for (const status of ['failed', 'empty']) {
    const result = summarizeBatchAfterDraftDiscard({
      targetDraftId: 'draft-1',
      drafts: [draft({ _id: 'draft-1' })],
      images: [image({ status })],
    });

    assert.equal(result.batchTerminal, true);
  }
});

test('missing target does not discard unrelated pending drafts', () => {
  const result = summarizeBatchAfterDraftDiscard({
    targetDraftId: 'missing',
    drafts: [draft({ _id: 'draft-1' })],
    images: [image()],
  });

  assert.equal(result.batchTerminal, false);
  assert.equal(result.pendingDraftCount, 1);
});
