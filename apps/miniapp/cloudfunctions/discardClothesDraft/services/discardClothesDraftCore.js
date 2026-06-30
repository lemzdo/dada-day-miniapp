const ACTIVE_IMAGE_STATUSES = new Set(['pending', 'detecting', 'processing']);

function summarizeBatchAfterDraftDiscard({ targetDraftId, drafts = [], images = [] } = {}) {
  const nextDrafts = drafts.map((draft) => (
    getId(draft) === targetDraftId
      ? { ...draft, selected: false, status: 'discarded' }
      : draft
  ));
  const pendingDraftCount = nextDrafts.filter((draft) => draft.status === 'pending').length;
  const confirmingDraftCount = nextDrafts.filter((draft) => draft.status === 'confirming').length;
  const confirmedDraftCount = nextDrafts.filter((draft) => draft.status === 'confirmed').length;
  const processingImageCount = images.filter((image) => ACTIVE_IMAGE_STATUSES.has(image.status)).length;
  const batchTerminal = pendingDraftCount === 0 && confirmingDraftCount === 0 && processingImageCount === 0;

  return {
    batchTerminal,
    batchStatus: batchTerminal ? 'discarded' : undefined,
    pendingDraftCount,
    confirmingDraftCount,
    confirmedDraftCount,
    processingImageCount,
  };
}

function getId(item) {
  return item && (item._id || item.id);
}

module.exports = {
  summarizeBatchAfterDraftDiscard,
};
