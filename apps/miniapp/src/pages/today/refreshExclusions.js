function getCurrentBatchOutfitKeys(outfits) {
  const keys = new Set();
  for (const outfit of Array.isArray(outfits) ? outfits : []) {
    const key = typeof outfit?.outfitKey === 'string' ? outfit.outfitKey.trim() : '';
    if (key) keys.add(key);
  }
  return [...keys].sort();
}

function buildSceneIdentityKey(sceneKey, identityHash) {
  const scene = typeof sceneKey === 'string' ? sceneKey.trim() : '';
  const identity = typeof identityHash === 'string' ? identityHash.trim() : '';
  return `${scene || 'unknown'}|${identity || 'unknown'}`;
}

function mergeSeenOutfitKeys(previousKeys, nextOutfitsOrKeys) {
  const nextKeys = Array.isArray(nextOutfitsOrKeys)
    ? nextOutfitsOrKeys.flatMap((value) => typeof value === 'string' ? [value] : [value?.outfitKey])
    : [];
  return [...new Set([
    ...(Array.isArray(previousKeys) ? previousKeys : []),
    ...nextKeys,
  ].filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))].sort();
}

module.exports = {
  buildSceneIdentityKey,
  getCurrentBatchOutfitKeys,
  mergeSeenOutfitKeys,
};
