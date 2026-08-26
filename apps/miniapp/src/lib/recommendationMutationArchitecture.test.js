'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const read = (relative) => fs.readFileSync(path.join(__dirname, relative), 'utf8');
const cacheSource = read('cacheInvalidation.ts');
const coordinatorSource = read('recommendationMutationCoordinator.ts');
const preferenceSource = read('../pages/style-preferences/index.tsx');
const clothingFormSource = read('../pages/clothing-form/index.tsx');
const todaySource = read('../pages/today/index.tsx');

test('wardrobe and preference mutations publish one RecommendationInputChanged signal', () => {
  assert.match(cacheSource, /recommendationInputChanged\(\{/);
  assert.match(cacheSource, /source: options\.source \?\? 'wardrobe_edit'/);
  assert.match(cacheSource, /source: options\.source \?\? 'style_preference_save'/);
  assert.match(preferenceSource, /source: 'style_preference_save'/);
  assert.doesNotMatch(preferenceSource, /classifyRecommendationProfileInvalidation/);
});

test('identity owner includes real wardrobe and profile versions', () => {
  assert.match(coordinatorSource, /wardrobeVersion = readInputVersion/);
  assert.match(coordinatorSource, /profileVersion = readInputVersion/);
  assert.match(coordinatorSource, /buildRecommendationInputIdentity\(\{/);
  assert.doesNotMatch(todaySource, /wardrobeVersion: 'wardrobe-0'/);
  assert.doesNotMatch(todaySource, /profileVersion: 'profile-0'/);
});

test('prebuild is fire-and-forget and Today uses the same coordinator', () => {
  assert.match(coordinatorSource, /void prebuild\.promise\.catch/);
  assert.match(todaySource, /acquireRecommendationForInput\(\{/);
  assert.match(coordinatorSource, /run\.source !== 'prebuild-in-flight'/);
  assert.match(coordinatorSource, /mode: 'today'/);
});

test('snapshot and commit are bound to exact latest input identity', () => {
  assert.match(todaySource, /readTodayV2Snapshot\([\s\S]*effectiveInput\.identity/);
  assert.match(todaySource, /isRecommendationInputIdentityCurrent\(effectiveInput\.identity, authContext\)/);
  assert.match(coordinatorSource, /setUserStorageSync\(TODAY_V2_SNAPSHOT_KEY, null/);
});

test('style preference save publishes invalidation after the successful profile write', () => {
  const cloudWrite = preferenceSource.indexOf('await updateCloudUserProfile(nextProfile)');
  const invalidation = preferenceSource.indexOf('await invalidateAfterProfileMutation({');
  assert.ok(cloudWrite >= 0);
  assert.ok(invalidation > cloudWrite);
  assert.match(preferenceSource.slice(invalidation), /source: 'style_preference_save'/);
});

test('clothing edit publishes wardrobe invalidation after the successful clothing write', () => {
  const cloudWrite = clothingFormSource.indexOf('await updateCloudClothing(clothing.id, toUpdateInput(value))');
  const invalidation = clothingFormSource.indexOf("await invalidateAfterWardrobeMutation({ authContext, source: 'wardrobe_edit' })");
  assert.ok(cloudWrite >= 0);
  assert.ok(invalidation > cloudWrite);
});

test('Today resume consumes hard invalid input even when weather is disabled', () => {
  const didShow = todaySource.slice(
    todaySource.indexOf('useDidShow(() => {'),
    todaySource.indexOf('useEffect(() => {', todaySource.indexOf('useDidShow(() => {')),
  );
  assert.match(didShow, /hasTodayRecommendationHardInvalid/);
  assert.match(didShow, /refreshHardInvalidRecommendation/);
  assert.doesNotMatch(didShow, /readiness: 'deferred'/);
});
