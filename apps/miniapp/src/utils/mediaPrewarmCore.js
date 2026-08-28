'use strict';

/**
 * Best-effort media prewarm orchestration. Dependencies are injected so this
 * small core can be verified without a Taro runtime or a second cache.
 */
async function prewarmResolvedGarments(garments, resolveAsset, preload) {
  const sources = [...new Set((garments || [])
    .map((garment) => resolveAsset(garment))
    .filter((source) => typeof source === 'string' && source.trim()))];
  const results = await Promise.all(sources.map(async (source) => {
    try {
      return await preload(source);
    } catch {
      return false;
    }
  }));
  return {
    requested: sources.length,
    warmed: results.filter(Boolean).length,
  };
}

module.exports = { prewarmResolvedGarments };
