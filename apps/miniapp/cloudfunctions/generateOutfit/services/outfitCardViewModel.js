function buildOutfitCardViewModel(outfit = {}) {
  const source = outfit.cardViewModel && typeof outfit.cardViewModel === 'object'
    ? outfit.cardViewModel
    : null;
  const items = Array.isArray(outfit.items) ? outfit.items : [];
  const sourcePreview = Array.isArray(source?.previewItems) ? source.previewItems : null;
  const previewItems = (sourcePreview || items).slice(0, 3);
  const total = sourcePreview
    ? Math.max(previewItems.length + normalizeHiddenCount(source.hiddenItemCount), items.length)
    : items.length;
  const hiddenItemCount = sourcePreview
    ? normalizeHiddenCount(source.hiddenItemCount)
    : Math.max(0, items.length - previewItems.length);

  return {
    previewItems,
    hiddenItemCount,
    layoutVariant: hiddenItemCount > 0 ? 'preview-3-plus' : `preview-${previewItems.length}`,
    totalItemCount: total,
  };
}

function normalizeHiddenCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

module.exports = {
  buildOutfitCardViewModel,
};
