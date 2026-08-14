'use strict';

const HARD_PROFILE_FIELDS = Object.freeze(['genderPreference', 'fitPreference', 'avoidTags']);

function classifyRecommendationProfileInvalidationPolicy(previous = {}, next = {}) {
  return HARD_PROFILE_FIELDS.some((field) => stableSerialize(previous[field]) !== stableSerialize(next[field]))
    ? 'hard'
    : 'soft';
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

function stableSerialize(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

module.exports = {
  HARD_PROFILE_FIELDS,
  classifyRecommendationProfileInvalidationPolicy,
  getRecommendationMutationBehavior,
};
