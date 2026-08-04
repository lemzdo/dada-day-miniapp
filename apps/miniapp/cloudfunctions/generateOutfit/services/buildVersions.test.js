const assert = require('node:assert/strict');
const test = require('node:test');
const {
  AI_REVIEW_VERSION,
  CLOUD_BUILD_VERSION,
  REASON_CATALOG_VERSION,
} = require('./buildVersions');

test('runtime build versions are fixed product identifiers', () => {
  assert.equal(CLOUD_BUILD_VERSION, 'generateOutfit-recommendation-count-contract-authority-20260803');
  assert.equal(REASON_CATALOG_VERSION, 'eligibility-reason-v6');
  assert.equal(AI_REVIEW_VERSION, 'stylist-review-v3');
});
