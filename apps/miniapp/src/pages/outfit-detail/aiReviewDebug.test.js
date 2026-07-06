const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const pagePath = path.join(__dirname, 'index.tsx');
const typePath = path.join(__dirname, '../../../../../packages/types/src/outfit.ts');

test('outfit detail page reads and prints safe ai review debug fields', () => {
  const page = fs.readFileSync(pagePath, 'utf8');
  const types = fs.readFileSync(typePath, 'utf8');

  assert.match(types, /interface OutfitAiReviewDebug/);
  assert.match(types, /aiReviewDebug\?: OutfitAiReviewDebug/);
  assert.match(page, /console\.info\('\[xiaoda-review\]'/);
  assert.match(page, /result\.aiReviewDebug/);
  for (const field of [
    'requestId',
    'source',
    'reviewSource',
    'enhanced',
    'aiAttempted',
    'provider',
    'model',
    'cacheDecision',
    'fallbackReason',
    'errorCode',
    'validatorRejectReasons',
  ]) {
    assert.match(page, new RegExp(`${field}:`), field);
  }
});
