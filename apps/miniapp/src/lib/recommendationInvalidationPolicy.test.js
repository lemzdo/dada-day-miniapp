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

test('ranking-only profile fields never invalidate the visible batch by field change alone', () => {
  const currentOutfits = [{
    items: [{ category: 'top', fit: 'regular', styleTags: ['中性'] }],
  }];
  assert.equal(classifyRecommendationProfileInvalidationPolicy(
    profile,
    { ...profile, genderPreference: 'female_style', fitPreference: 'loose' },
    currentOutfits,
  ), 'soft');
});

test('a newly added avoid tag is hard only when it matches the current visible batch', () => {
  const currentOutfits = [{
    items: [{ category: 'top', material: '羊毛混纺', styleTags: ['通勤'] }],
  }];
  assert.equal(classifyRecommendationProfileInvalidationPolicy(
    profile,
    { ...profile, avoidTags: ['羊毛'] },
    currentOutfits,
  ), 'hard');
  assert.equal(classifyRecommendationProfileInvalidationPolicy(
    profile,
    { ...profile, avoidTags: ['皮革'] },
    currentOutfits,
  ), 'soft');
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

test('existing avoid-tag order changes and removals are soft', () => {
  const previous = { ...profile, avoidTags: ['羊毛', '皮革'] };
  assert.equal(classifyRecommendationProfileInvalidationPolicy(previous, {
    ...previous,
    avoidTags: ['皮革', '羊毛'],
  }), 'soft');
  assert.equal(classifyRecommendationProfileInvalidationPolicy(previous, {
    ...previous,
    avoidTags: ['羊毛'],
  }), 'soft');
});
