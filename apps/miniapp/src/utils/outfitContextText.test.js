const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const sourcePath = path.join(__dirname, 'outfitContextText.ts');

test('outfit tags are no longer inferred from reason or reasoning keywords', () => {
  const source = fs.readFileSync(sourcePath, 'utf8');
  assert.doesNotMatch(source, /getKeywordTags/);
  assert.doesNotMatch(source, /KEYWORD_TAGS/);
  assert.doesNotMatch(source, /outfit\.reason\s*\?\?/);
  assert.doesNotMatch(source, /outfit\.reasoning\s*\?\?/);
});

test('outfit tags do not generate banned marketing or tactile labels', () => {
  const source = fs.readFileSync(sourcePath, 'utf8');
  for (const label of ['轻盈气质', '软糯舒服', '轻便好活动', '高级感', '耐看', '氛围感']) {
    assert.equal(source.includes(label), false, label);
  }
});
