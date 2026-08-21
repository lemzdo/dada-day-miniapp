// The recommendation DTO has one image field: displayImageUrl. This module
// resolves that field once, before state/persistence, and keeps the renderer
// free of cloud-file resolution work.
const resolvedMediaCache = new Map();
const pendingMediaCache = new Map();

function isCloudFileId(value) {
  return typeof value === 'string' && value.trim().startsWith('cloud://');
}

function resolveRecommendationMedia(response, resolveCloudFileIds = resolveCloudFileIdsWithWx) {
  const cards = response?.light?.cards;
  if (!Array.isArray(cards)) return Promise.resolve(response);
  const fileIds = [...new Set(cards.flatMap((card) => (Array.isArray(card?.items) ? card.items : []))
    .map((item) => item?.displayImageUrl)
    .filter(isCloudFileId))];
  if (fileIds.length === 0) return Promise.resolve(response);
  return resolveMediaBatch(fileIds, resolveCloudFileIds).then((resolved) => ({
    ...response,
    light: {
      ...response.light,
      cards: cards.map((card) => ({
        ...card,
        items: (card.items || []).map((item) => ({
          ...item,
          displayImageUrl: isCloudFileId(item.displayImageUrl)
            ? (resolved.get(item.displayImageUrl) || '')
            : item.displayImageUrl,
        })),
      })),
    },
  }));
}

function resolveMediaBatch(fileIds, resolveCloudFileIds) {
  const unresolved = fileIds.filter((fileId) => !resolvedMediaCache.has(fileId));
  if (unresolved.length === 0) return Promise.resolve(new Map(fileIds.map((id) => [id, resolvedMediaCache.get(id) || ''])));
  const pendingKey = unresolved.slice().sort().join('|');
  let pending = pendingMediaCache.get(pendingKey);
  if (!pending) {
    pending = Promise.resolve(resolveCloudFileIds(unresolved))
      .then((result) => {
        const values = result instanceof Map ? result : new Map(Object.entries(result || {}));
        unresolved.forEach((id) => resolvedMediaCache.set(id, typeof values.get(id) === 'string' ? values.get(id) : ''));
        return values;
      })
      .catch(() => {
        unresolved.forEach((id) => resolvedMediaCache.set(id, ''));
        return new Map();
      })
      .finally(() => pendingMediaCache.delete(pendingKey));
    pendingMediaCache.set(pendingKey, pending);
  }
  return pending.then(() => new Map(fileIds.map((id) => [id, resolvedMediaCache.get(id) || ''])));
}

function resolveCloudFileIdsWithWx(fileIds) {
  const wxCloud = globalThis.wx?.cloud;
  if (!wxCloud || typeof wxCloud.getTempFileURL !== 'function') return Promise.resolve(new Map());
  return Promise.resolve(wxCloud.getTempFileURL({ fileList: fileIds })).then((result) => {
    const output = new Map();
    (result?.fileList || []).forEach((entry) => {
      if (entry?.fileID && typeof entry.tempFileURL === 'string' && entry.status !== 1) output.set(entry.fileID, entry.tempFileURL);
    });
    return output;
  });
}

function clearMediaResolutionCache() {
  resolvedMediaCache.clear();
  pendingMediaCache.clear();
}

module.exports = {
  clearMediaResolutionCache,
  isCloudFileId,
  resolveMediaBatch,
  resolveRecommendationMedia,
};
