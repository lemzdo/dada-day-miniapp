'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  classifyRecommendationProfileInvalidationPolicy,
  getRecommendationMutationBehavior,
} = require('./recommendationInvalidationPolicy');

const profile = {
  genderPreference: 'unknown',
  fitPreference: 'regular',
  avoidTags: [],
  styleTags: ['简约'],
  colorPreference: ['黑色'],
  temperatureSensitivity: 'normal',
};

test('hard profile constraints invalidate the visible batch', () => {
  for (const next of [
    { ...profile, genderPreference: 'female' },
    { ...profile, fitPreference: 'loose' },
    { ...profile, avoidTags: ['羊毛'] },
  ]) {
    assert.equal(classifyRecommendationProfileInvalidationPolicy(profile, next), 'hard');
  }
  assert.deepEqual(getRecommendationMutationBehavior('preference_changed', 'hard'), {
    keepVisibleBatch: false,
    clearTodayCache: true,
    backgroundRefresh: false,
    message: '正在重新搭配…',
  });
});

test('soft preference and new-clothing changes keep the correct batch visible', () => {
  assert.equal(classifyRecommendationProfileInvalidationPolicy(profile, {
    ...profile,
    styleTags: ['通勤'],
  }), 'soft');
  assert.equal(getRecommendationMutationBehavior('preference_changed', 'soft').keepVisibleBatch, true);
  assert.equal(getRecommendationMutationBehavior('preference_changed', 'soft').message, '偏好已保存，正在重新搭配');
  assert.equal(getRecommendationMutationBehavior('wardrobe_added', 'soft').message, '新衣服已加入，正在更新搭配');
});

test('array order is semantic for preference constraints', () => {
  assert.equal(classifyRecommendationProfileInvalidationPolicy(profile, {
    ...profile,
    avoidTags: ['羊毛', '皮革'],
  }), 'hard');
});
