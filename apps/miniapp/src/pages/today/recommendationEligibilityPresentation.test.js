const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8');
const adapterSource = fs.readFileSync(path.join(__dirname, 'todayV2Adapter.ts'), 'utf8');

test('Today admits only new recommendations with a non-empty core-backed reason', () => {
  assert.match(adapterSource, /!card\.todayReason\.trim\(\)/);
  assert.match(adapterSource, /typeof card\.todayReason !== 'string'/);
  assert.match(source, /buildOutfitCardViewModel/);
  assert.match(source, /HomeLightCardV2/);
});

test('refresh exhaustion preserves existing cards and shows the dedicated light notice', () => {
  assert.match(source, /NO_MORE_NEW_OUTFITS_NOTICE/);
  assert.match(source, /next-exhausted/);
  assert.match(source, /acquireNextRecommendationForInput/);
});

test('Today offers the wardrobe action only for server-confirmed missing roles or sport facts', () => {
  assert.match(source, /getRecommendationEmptyStateCopy/);
  assert.match(source, /missingRoles/);
  assert.match(source, /missingFacts/);
});
