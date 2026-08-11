const assert = require('node:assert/strict');
const test = require('node:test');
const {
  AI_REVIEW_VERSION,
  CLOUD_BUILD_VERSION,
  REASON_CATALOG_VERSION,
  SCENE_EVIDENCE_FINGERPRINT,
  SCENE_EVIDENCE_VERSION,
} = require('./buildVersions');

test('runtime build versions are fixed product identifiers', () => {
  assert.equal(CLOUD_BUILD_VERSION, 'generateOutfit-copy-natural-language-v4-20260811');
  assert.equal(REASON_CATALOG_VERSION, 'eligibility-reason-v6');
  assert.equal(AI_REVIEW_VERSION, 'stylist-review-v3');
  assert.equal(SCENE_EVIDENCE_VERSION, 'scene-evidence-v4');
  assert.match(SCENE_EVIDENCE_FINGERPRINT, /^[0-9a-f]{20}$/);
});
