const {
  adaptLegacyVisibleFactItem,
  composeLegacyVisibleFacts,
} = require('./recommendationEligibilityFacts');
const { prepareCopyItemFacts } = require('./outfitCopyFacts');
const {
  classifyWearabilityItem,
  deriveSceneEligibilityFacts,
  itemText,
  normalizeCategory,
  normalizeType,
} = require('./itemWearabilityFacts');

function buildItemFactsContext({ items = [], createCompositionFacts, instrumentation } = {}) {
  if (typeof createCompositionFacts !== 'function') {
    throw new Error('createCompositionFacts is required');
  }

  const byId = new Map();
  const sourceItems = Array.isArray(items) ? items : [];
  for (let index = 0; index < sourceItems.length; index += 1) {
    const sourceItem = sourceItems[index];
    const itemId = readItemId(sourceItem);
    if (!itemId) throw new Error('item facts require a stable item id');
    if (byId.has(itemId)) throw new Error(`duplicate item id in item facts context: ${itemId}`);

    increment(instrumentation, 'buildCanonicalItemFacts');
    const text = itemText(sourceItem, { instrumentation });
    const normalizedType = normalizeType(sourceItem);
    const normalizedCategory = normalizeCategory(sourceItem, text, { instrumentation });
    const visibleFactItem = adaptLegacyVisibleFactItem(sourceItem, index, { instrumentation });
    const compositionFacts = createCompositionFacts(sourceItem, instrumentation);
    const capabilities = Array.isArray(compositionFacts?.capabilities) ? compositionFacts.capabilities : [];
    const wearabilityClassification = classifyWearabilityItem(sourceItem, {
      itemText: text,
      normalizedType,
      normalizedCategory,
      instrumentation,
    });
    const sceneEligibilityItemFacts = deriveSceneEligibilityFacts(sourceItem, visibleFactItem, {
      itemText: text,
      normalizedType,
      normalizedCategory,
      wearabilityClassification,
      capabilities,
      instrumentation,
    });
    const copyItemFacts = prepareCopyItemFacts(sourceItem, index, instrumentation);

    byId.set(itemId, {
      itemId,
      sourceItem,
      normalizedCategoryFacts: { normalizedCategory, normalizedType },
      visibleFactItem,
      copyItemFacts,
      wearabilityClassification,
      sceneEligibilityItemFacts,
      capabilities,
      itemText: text,
      compositionFacts,
    });
  }

  return {
    byId,
    resolveItemFacts(item) {
      const itemId = readItemId(item);
      const facts = itemId ? byId.get(itemId) : null;
      if (!facts) throw new Error(`item facts context miss: ${itemId || 'missing-item-id'}`);
      return facts;
    },
    buildVisibleFacts(candidateItems) {
      const visibleItems = (Array.isArray(candidateItems) ? candidateItems : [])
        .map((item) => this.resolveItemFacts(item).visibleFactItem);
      return composeLegacyVisibleFacts(visibleItems);
    },
  };
}

function readItemId(item) {
  const value = item?._id || item?.id || item?.clothingId || item?.itemId;
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function increment(instrumentation, name) {
  if (!instrumentation || typeof instrumentation !== 'object') return;
  const counters = instrumentation.counters && typeof instrumentation.counters === 'object'
    ? instrumentation.counters
    : instrumentation;
  counters[name] = (Number(counters[name]) || 0) + 1;
}

module.exports = {
  buildItemFactsContext,
};
