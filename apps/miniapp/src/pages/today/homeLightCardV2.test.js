const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const cardSource = fs.readFileSync(path.join(__dirname, 'HomeLightCardV2.tsx'), 'utf8');
const styleSource = fs.readFileSync(path.join(__dirname, 'index.scss'), 'utf8');

test('HomeLightCardV2 renders the canonical display image field directly', () => {
  assert.match(cardSource, /<Image className="item-image" key=\{item\.clothingId\} src=\{item\.displayImageUrl\}/);
  assert.doesNotMatch(cardSource, /imageUrl|thumbnailUrl/);
});

test('Today item images are visible without unreachable loaded state', () => {
  const imageRule = styleSource.slice(styleSource.indexOf('.item-image {'), styleSource.indexOf('}', styleSource.indexOf('.item-image {')));
  assert.match(imageRule, /opacity:\s*1/);
});
