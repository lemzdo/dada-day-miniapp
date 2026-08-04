const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8');

test('Today admits only new recommendations with a non-empty core-backed reason', () => {
  assert.match(source, /data\.outfits\.filter\(hasCurrentNewRecommendationCopy\)/);
  assert.match(source, /\{currentOutfit && \(/);
  assert.match(source, /const todayReason = hasCurrentNewRecommendationCopy\(outfit\)/);
  assert.match(source, /<View className="outfit-tags">[\s\S]*<View className="outfit-reason">/);
  assert.doesNotMatch(source, /\{todayReason \? \(/);
});

test('refresh exhaustion preserves existing cards and shows the dedicated light notice', () => {
  const refreshBody = source.slice(source.indexOf('async function handleRefresh()'), source.indexOf('async function handleToggleFavorite()'));
  assert.match(refreshBody, /NO_MORE_NEW_OUTFITS_NOTICE/);
  assert.match(refreshBody, /if \(eligibleApiOutfits\.length > 0\)/);
  const emptyBranch = refreshBody.slice(refreshBody.indexOf('} else {'));
  assert.doesNotMatch(emptyBranch, /setOutfits\(\[\]\)/);
  assert.match(refreshBody, /if \(!isRecommendationIntentCurrent\(intent\) \|\| !isAuthContextCurrent\(authContext\)\) return/);
  assert.match(refreshBody, /validateSceneContract\(requestContext, data\)/);
});

test('Today offers the wardrobe action only for server-confirmed missing roles or sport facts', () => {
  assert.match(source, /missingRoles\.length > 0 \|\| missingFacts\.length > 0/);
  assert.match(source, /getRecommendationEmptyStateCopy\(missingRoles, missingFacts\)/);
  assert.doesNotMatch(source, /!hasRecommendations[\s\S]{0,500}先去衣橱放几件衣服/);
});
