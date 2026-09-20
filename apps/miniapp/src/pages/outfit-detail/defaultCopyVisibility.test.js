const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('detail renders no empty default-copy content container', () => {
  const source = fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8');
  assert.match(source, /const hasAiReviewContent = Boolean\(/);
  assert.match(source, /hasAiReviewContent && aiReviewPresentation \? \(\s*<View className="ai-comment-content">/s);
  assert.match(source, /<\/View>\s*\) : null}/s);
});

test('detail prefers the canonical Today reason and falls back when historical copy is empty', () => {
  const source = fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8');
  assert.match(source, /const normalizedRecommendationReason = hasCurrentCopy[\s\S]*outfit\.copyContract\?\.todayReason \|\| outfit\.reasoning \|\| outfit\.reason/);
  assert.match(source, /normalizedRecommendationReason[\s\S]*v2DetailState\?\.loadState === 'READY'/);
  assert.match(source, /\{coreRecommendationReason && \(\s*<View className="detail-card core-reason-card">/s);
  assert.match(source, /hasAiReviewContent && aiReviewPresentation \? \(/);
});
