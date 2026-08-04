const assert = require('node:assert/strict');
const test = require('node:test');

const {
  appendBatchCopySelection,
  buildBatchCopyConstraints,
  copyConstraints,
  createBatchCopyConstraints,
  hasValidConstraints,
} = require('./batchCopyDiversity');

const H01 = { claimId: 'H01-04' };

test('empty batch constraints contain only fixed Claim usage', () => {
  const value = createBatchCopyConstraints();
  assert.equal(hasValidConstraints(value), true);
  assert.deepEqual(value, { usedClaimIds: [], claimUsage: {} });
  assert.equal(JSON.stringify(value).includes('text'), false);
  assert.equal(JSON.stringify(value).includes('todayReason'), false);
});

test('accepted Claim ids are appended immutably', () => {
  const source = createBatchCopyConstraints();
  const result = appendBatchCopySelection(source, H01);
  assert.deepEqual(source, createBatchCopyConstraints());
  assert.deepEqual(result.usedClaimIds, ['H01-04']);
  assert.equal(result.claimUsage['H01-04'], 1);
});

test('correct repeated Claims remain valid and are counted rather than rejected', () => {
  const first = appendBatchCopySelection(createBatchCopyConstraints(), H01);
  const second = appendBatchCopySelection(first, H01);
  assert.equal(hasValidConstraints(second), true);
  assert.deepEqual(second.usedClaimIds, ['H01-04']);
  assert.equal(second.claimUsage['H01-04'], 2);
});

test('unknown ids and legacy selection metadata cannot enter constraints', () => {
  const source = createBatchCopyConstraints();
  for (const selection of [
    { claimId: 'legacy-voice-001' },
    { sentenceClusterId: 'H01-04' },
    { speechAction: 'home_rest', dimension: 'comfort' },
    null,
  ]) {
    assert.deepEqual(appendBatchCopySelection(source, selection), source);
  }
});

test('copy-owned fields are ignored and cannot influence structural tracking', () => {
  const plain = appendBatchCopySelection(createBatchCopyConstraints(), H01);
  const injected = appendBatchCopySelection(createBatchCopyConstraints(), {
    ...H01,
    text: 'COPY_OWNED_FIELD',
    todayReason: 'COPY_OWNED_FIELD',
    replacement: 'COPY_OWNED_FIELD',
  });
  assert.deepEqual(injected, plain);
  assert.equal(JSON.stringify(injected).includes('COPY_OWNED_FIELD'), false);
});

test('builder and copier keep dense valid immutable structures', () => {
  const built = buildBatchCopyConstraints([
    H01,
    { claimId: 'W01-01' },
  ]);
  assert.equal(hasValidConstraints(built), true);
  const copied = copyConstraints(built);
  assert.deepEqual(copied, built);
  copied.usedClaimIds.push('D01-01');
  assert.deepEqual(built.usedClaimIds, ['H01-04', 'W01-01']);
});
