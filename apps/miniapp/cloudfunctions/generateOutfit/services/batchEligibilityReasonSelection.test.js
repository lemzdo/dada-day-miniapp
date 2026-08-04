const assert = require('node:assert/strict');
const test = require('node:test');

const { selectBatchEligibilityReasons } = require('./batchEligibilityReasonSelection');

function candidate(code, family, qualityTier, catalogOrder = 0) {
  return {
    code,
    family,
    qualityTier,
    catalogOrder,
    text: `${code}文案`,
    subjectItemIds: ['item'],
    supportingFactIds: ['fact'],
    relationFactIds: [],
    sourceRule: 'sceneEligibilityV3',
    sourceRuleReasons: ['eligible'],
    evidence: [],
  };
}

test('never lowers an outfit quality tier and preserves order and count', () => {
  const input = [
    { outfitKey: 'a', reasonCandidates: [candidate('GENERIC', 'fallback', 6), candidate('SPECIFIC', 'category', 2)] },
    { outfitKey: 'b', reasonCandidates: [candidate('OTHER', 'fit', 4), candidate('LOW', 'fallback', 6)] },
  ];
  const result = selectBatchEligibilityReasons(input);
  assert.deepEqual(result.map((entry) => entry.outfitKey), ['a', 'b']);
  assert.deepEqual(result.map((entry) => entry.selectedReason.qualityTier), [2, 4]);
  assert.equal(result.length, input.length);
});

test('uses same-quality alternatives to reduce repeated code and family deterministically', () => {
  const input = [
    { outfitKey: 'a', reasonCandidates: [candidate('A', 'category', 2, 0), candidate('B', 'fit', 2, 1)] },
    { outfitKey: 'b', reasonCandidates: [candidate('A', 'category', 2, 0), candidate('C', 'color', 2, 1)] },
  ];
  const first = selectBatchEligibilityReasons(input);
  const second = selectBatchEligibilityReasons(input);
  assert.deepEqual(first, second);
  assert.equal(new Set(first.map((entry) => entry.selectedReason.code)).size, 2);
});

test('allows repeated code when no same-quality alternative exists', () => {
  const input = [
    { outfitKey: 'a', reasonCandidates: [candidate('A', 'category', 2)] },
    { outfitKey: 'b', reasonCandidates: [candidate('A', 'category', 2)] },
  ];
  const result = selectBatchEligibilityReasons(input);
  assert.deepEqual(result.map((entry) => entry.selectedReason.code), ['A', 'A']);
  assert.deepEqual(result.map((entry) => entry.selectionDebug.batchRepeatCount), [2, 2]);
});
