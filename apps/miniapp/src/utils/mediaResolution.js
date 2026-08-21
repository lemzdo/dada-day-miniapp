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
  const missing = fileIds.filter((fileId) => !resolvedMediaCache.has(fileId) && !pendingMediaCache.has(fileId));
  if (missing.length > 0) {
    const pending = Promise.resolve(resolveCloudFileIds(missing))
      .then((result) => {
        const values = result instanceof Map ? result : new Map(Object.entries(result || {}));
        return new Map(missing.map((id) => {
          const value = values.get(id);
          if (typeof value === 'string' && value.trim()) resolvedMediaCache.set(id, value);
          return [id, typeof value === 'string' && value.trim() ? value : ''];
        }));
      })
      .catch(() => new Map(missing.map((id) => [id, ''])))
      .finally(() => missing.forEach((id) => pendingMediaCache.delete(id)));
    missing.forEach((id) => pendingMediaCache.set(id, pending.then((values) => values.get(id) || '')));
  }
  const promises = fileIds.map((fileId) => resolvedMediaCache.has(fileId)
    ? Promise.resolve(resolvedMediaCache.get(fileId))
    : (pendingMediaCache.get(fileId) || Promise.resolve('')));
  return Promise.all(promises).then((values) => new Map(fileIds.map((id, index) => [id, values[index] || ''])));
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
