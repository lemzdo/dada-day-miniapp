const assert = require('node:assert/strict');
const test = require('node:test');

const acceptanceGate = require('./recommendationCopyAcceptanceGate');
const copyQualityGate = require('./copyQualityGate');

test('re-exports the binary acceptance gate', () => {
  assert.equal(copyQualityGate.COPY_ACCEPTANCE_PASS, acceptanceGate.COPY_ACCEPTANCE_PASS);
  assert.equal(copyQualityGate.COPY_ACCEPTANCE_REJECT, acceptanceGate.COPY_ACCEPTANCE_REJECT);
  assert.equal(copyQualityGate.evaluateRecommendationCopy, acceptanceGate.evaluateRecommendationCopy);
  assert.equal(copyQualityGate.evaluateRecommendationPair, acceptanceGate.evaluateRecommendationPair);
});

test('deprecated string shim is byte-for-byte identity and creates no fallback', () => {
  const legacy = '更有层次，不至于太淡';

  assert.strictEqual(
    copyQualityGate.sanitizeUserFacingCopy(legacy, {
      fallback: '不得返回这句。',
      items: [{ name: '白衬衫' }, { name: '蓝长裤' }],
      scene: 'work',
    }),
    legacy,
  );
  assert.strictEqual(copyQualityGate.sanitizeUserFacingCopy('', { fallback: '不得创建兜底。' }), '');
});

test('deprecated object shim returns the exact object without repair or fallback fields', () => {
  const source = {
    todayReason: '穿起来不绕。',
    detailExplanation: '',
    usedPhrases: ['常见单品'],
  };
  const before = structuredClone(source);
  const result = copyQualityGate.sanitizeCopyObject(source, {
    todayFallback: '不得替换。',
    detailFallback: '不得补写。',
  });

  assert.strictEqual(result, source);
  assert.deepEqual(result, before);
  assert.equal('aiExtraDefault' in result, false);
});

test('migration removes the old rewrite and fallback helper API', () => {
  for (const name of [
    'LOW_QUALITY_COPY_PHRASES',
    'applyFactualRewrites',
    'containsLowQualityCopy',
    'requiresGroundedFallback',
  ]) {
    assert.equal(name in copyQualityGate, false, name);
  }
});
