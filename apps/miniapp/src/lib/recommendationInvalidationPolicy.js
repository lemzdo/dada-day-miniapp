'use strict';

const ITEM_CONSTRAINT_TEXT_FIELDS = Object.freeze([
  'name', 'customName', 'category', 'type', 'subcategory', 'subCategory', 'material',
  'materialGuess', 'fit', 'silhouette', 'shoulderFit', 'patternType', 'styleComplexity',
  'thickness', 'neckline', 'collar', 'shoeType', 'style', 'color',
]);

function classifyRecommendationProfileInvalidationPolicy(previous = {}, next = {}, currentOutfits = []) {
  const previousAvoidTags = new Set(normalizeTags(previous.avoidTags));
  const newlyAddedAvoidTags = normalizeTags(next.avoidTags)
    .filter((tag) => !previousAvoidTags.has(tag));
  if (newlyAddedAvoidTags.length === 0) return 'soft';
  return readArray(currentOutfits).some((outfit) => {
    const itemText = [
      ...readArray(outfit?.items),
      ...readArray(outfit?.itemsSnapshot),
      ...readArray(outfit?.snapshotItems),
    ].map(buildItemConstraintText).join(' ');
    return newlyAddedAvoidTags.some((tag) => itemText.includes(tag));
  }) ? 'hard' : 'soft';
}

function getRecommendationMutationBehavior(kind, impact) {
  if (impact === 'hard') {
    return {
      keepVisibleBatch: false,
      clearTodayCache: true,
      backgroundRefresh: false,
      message: '正在重新搭配…',
    };
  }
  return {
    keepVisibleBatch: true,
    clearTodayCache: false,
    backgroundRefresh: true,
    message: kind === 'preference_changed'
      ? '偏好已保存，正在重新搭配'
      : '新衣服已加入，正在更新搭配',
  };
}

function buildItemConstraintText(item) {
  if (!item || typeof item !== 'object') return '';
  return [
    ...ITEM_CONSTRAINT_TEXT_FIELDS.map((field) => item[field]),
    ...readArray(item.styleTags),
    ...readArray(item.sceneTags),
    ...readArray(item.colors),
    ...readArray(item.colorPalette).flatMap((color) => [color?.name, color?.hex]),
    ...Object.values(item.aestheticFeatures || {}),
    ...Object.values(item.functionalFeatures || {}),
  ].flatMap((value) => (
    value && typeof value === 'object' ? Object.values(value) : [value]
  )).filter((value) => typeof value === 'string').join(' ').toLocaleLowerCase('zh-CN');
}

function normalizeTags(value) {
  return [...new Set(readArray(value)
    .filter((tag) => typeof tag === 'string')
    .map((tag) => tag.trim().toLocaleLowerCase('zh-CN'))
    .filter(Boolean))];
}

function readArray(value) { return Array.isArray(value) ? value : []; }

module.exports = {
  classifyRecommendationProfileInvalidationPolicy,
  getRecommendationMutationBehavior,
};
