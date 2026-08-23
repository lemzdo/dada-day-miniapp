// The recommendation DTO has one image field: displayImageUrl. This module
// resolves that field once, before state/persistence, and keeps the renderer
// free of cloud-file resolution work.
const resolvedMediaCache = new Map();
const pendingMediaCache = new Map();

function isCloudFileId(value) {
  return typeof value === 'string' && value.trim().startsWith('cloud://');
}

function isRenderableUrl(value) {
  return typeof value === 'string' && /^https:\/\//i.test(value.trim());
}

function resolveHomeLight(canonicalLight, resolveCloudFileIds = resolveCloudFileIdsWithWx, traceContext) {
  const response = { light: canonicalLight };
  const cards = response?.light?.cards;
  if (!Array.isArray(cards)) return Promise.resolve(response);
  const fileIds = [...new Set(cards.flatMap((card) => (Array.isArray(card?.items) ? card.items : []))
    .map((item) => item?.displayImageUrl)
    .filter(isCloudFileId))];
  if (fileIds.length === 0) {
    traceContext?.trace('media:start', { count: 0, firstSource: undefined, source: 'none' });
    traceContext?.trace('media:done', { count: 0, returnedCount: 0, firstStatus: undefined, firstResolvedProtocol: undefined, error: undefined, source: 'none' });
    return Promise.resolve(response);
  }
  return resolveMediaBatch(fileIds, resolveCloudFileIds, traceContext).then((resolved) => ({
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

// Canonical snapshots retain cloud file IDs. This is the single conversion
// boundary used before a light enters React render state.
function hydrateHomeLightForRender(canonicalLight, resolveCloudFileIds = resolveCloudFileIdsWithWx, traceContext) {
  return resolveHomeLight(canonicalLight, resolveCloudFileIds, traceContext).then((resolved) => {
    const light = resolved?.light;
    const hasUnresolvedCloud = light?.cards?.some((card) => (card.items || [])
      .some((item) => isCloudFileId(item?.displayImageUrl) || !isRenderableUrl(item?.displayImageUrl)));
    return hasUnresolvedCloud ? null : light;
  });
}

function resolveMediaBatch(fileIds, resolveCloudFileIds, traceContext) {
  const missing = fileIds.filter((fileId) => !resolvedMediaCache.has(fileId) && !pendingMediaCache.has(fileId));
  const pending = missing.length === 0;
  const nonWxSource = fileIds.some((id) => pendingMediaCache.has(id)) ? 'pending' : 'cache';
  traceContext?.trace('media:start', {
    count: missing.length,
    firstSource: missing[0],
    source: pending ? nonWxSource : 'wx',
  });
  if (missing.length > 0) {
    const pending = Promise.resolve(resolveCloudFileIds(missing, traceContext))
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
  return Promise.all(promises).then((values) => {
    if (pending) traceContext?.trace('media:done', { count: 0, returnedCount: 0, firstStatus: undefined, firstResolvedProtocol: undefined, error: undefined, source: nonWxSource });
    return new Map(fileIds.map((id, index) => [id, values[index] || '']));
  });
}

function resolveCloudFileIdsWithWx(fileIds, traceContext) {
  const wxCloud = globalThis.wx?.cloud;
  if (!wxCloud || typeof wxCloud.getTempFileURL !== 'function') {
    traceContext?.trace('media:error', { count: fileIds.length, returnedCount: 0, firstStatus: undefined, firstResolvedProtocol: undefined, error: 'wx.cloud.getTempFileURL unavailable' });
    return Promise.resolve(new Map());
  }
  return Promise.resolve(wxCloud.getTempFileURL({ fileList: fileIds })).then((result) => {
    const first = result?.fileList?.[0];
    traceContext?.trace('media:done', {
      count: fileIds.length,
      returnedCount: result?.fileList?.length || 0,
      firstStatus: first?.status,
      firstResolvedProtocol: typeof first?.tempFileURL === 'string' ? first.tempFileURL.split(':')[0] : undefined,
      error: undefined,
    });
    const output = new Map();
    (result?.fileList || []).forEach((entry) => {
      if (entry?.fileID && entry.status === 0 && isRenderableUrl(entry.tempFileURL)) {
        output.set(entry.fileID, entry.tempFileURL);
      }
    });
    return output;
  }, (error) => {
    traceContext?.trace('media:error', { count: fileIds.length, returnedCount: 0, firstStatus: undefined, firstResolvedProtocol: undefined, error: String(error) });
    throw error;
  });
}

function clearMediaResolutionCache() {
  resolvedMediaCache.clear();
  pendingMediaCache.clear();
}

module.exports = {
  clearMediaResolutionCache,
  hydrateHomeLightForRender,
};
