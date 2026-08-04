const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('detail presentation uses saved tags rather than re-deriving item tags', () => {
  const source = fs.readFileSync(path.join(__dirname, 'outfitContextText.ts'), 'utf8');
  assert.match(source, /return normalizeTags\(outfit\.styleTags \?\? \[\]\);/);
  assert.equal(source.includes('getPatternTags(outfit)'), false);
});
