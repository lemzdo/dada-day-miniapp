const assert = require('node:assert/strict');
const test = require('node:test');

const {
  FACT_AUTHORIZATION_MATRIX,
  RELIABLE_ONLY_FACTS,
  VISIBLE_FACTS,
  factCanInformEligibility,
  factEvidenceLevel,
  factSourceMeetsMinimum,
} = require('./recommendationFactAuthorization');

test('authorization matrix contains every reviewed visible and strong fact exactly once', () => {
  assert.equal(Object.keys(FACT_AUTHORIZATION_MATRIX).length, VISIBLE_FACTS.length + RELIABLE_ONLY_FACTS.length);
  assert.equal(new Set([...VISIBLE_FACTS, ...RELIABLE_ONLY_FACTS]).size, Object.keys(FACT_AUTHORIZATION_MATRIX).length);
});

for (const fact of RELIABLE_ONLY_FACTS) {
  test(`${fact} accepts only reliable copy-evidence sources`, () => {
    for (const source of ['user', 'care_label', 'product_data']) {
      assert.equal(factEvidenceLevel({ fact, source, confidence: 0.8 }), 'A', `${fact}:${source}`);
      assert.equal(factSourceMeetsMinimum({ fact, source, confidence: 0.8 }, 'A'), true, `${fact}:${source}`);
    }
    for (const source of ['structured_ai', 'visual_inference']) {
      const record = { fact, source, confidence: 0.99 };
      assert.equal(factEvidenceLevel(record), 'C', `${fact}:${source}`);
      assert.equal(factSourceMeetsMinimum(record, 'A'), false, `${fact}:${source}`);
      assert.equal(factCanInformEligibility(record), true, `${fact}:${source}:risk`);
    }
  });
}

for (const fact of VISIBLE_FACTS) {
  test(`${fact} keeps reviewed structured and visual confidence thresholds`, () => {
    assert.equal(factEvidenceLevel({ fact, source: 'structured_ai', confidence: 0.85 }), 'B');
    assert.equal(factEvidenceLevel({ fact, source: 'structured_ai', confidence: 0.849 }), 'C');
    assert.equal(factEvidenceLevel({ fact, source: 'visual_inference', confidence: 0.8 }), 'B');
    assert.equal(factEvidenceLevel({ fact, source: 'visual_inference', confidence: 0.799 }), 'C');
    assert.equal(factEvidenceLevel({ fact, source: 'product_data', confidence: 0.5 }), 'A');
  });
}

test('confidence and authorized flags cannot bypass fact policy', () => {
  assert.equal(factEvidenceLevel({ fact: 'cushioning', source: 'structured_ai', confidence: 1 }), 'C');
  assert.equal(factEvidenceLevel({ fact: 'color', source: 'visual_inference', confidence: 1, authorized: false }), 'C');
  assert.equal(factCanInformEligibility({ fact: 'movement', source: 'visual_inference', confidence: 1, authorized: false }), false);
});
