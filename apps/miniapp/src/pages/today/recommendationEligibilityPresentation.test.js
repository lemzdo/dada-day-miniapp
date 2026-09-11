const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8');

test('Today admits only new recommendations with a non-empty core-backed reason', () => {
  assert.match(source, /hasCurrentNewRecommendationCopy/);
  assert.match(source, /buildOutfitCardViewModel/);
  assert.match(source, /HomeLightCardV2/);
});

test('refresh exhaustion preserves existing cards and shows the dedicated light notice', () => {
  const refreshBody = source.slice(source.indexOf('async function handleRefresh('), source.indexOf('async function handleToggleFavorite('));
  assert.match(source, /NO_MORE_NEW_OUTFITS_NOTICE/);
  assert.match(source, /next-exhausted/);
  assert.match(source, /acquireNextRecommendationForInput/);
});

test('Today offers the wardrobe action only for server-confirmed missing roles or sport facts', () => {
  assert.match(source, /getRecommendationEmptyStateCopy/);
  assert.match(source, /missingRoles/);
  assert.match(source, /missingFacts/);
});
