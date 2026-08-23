const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const cardSource = fs.readFileSync(path.join(__dirname, 'HomeLightCardV2.tsx'), 'utf8');
const styleSource = fs.readFileSync(path.join(__dirname, 'index.scss'), 'utf8');

test('HomeLightCardV2 renders the canonical display image field directly', () => {
  assert.match(cardSource, /<View className="collage-item" key=\{item\.clothingId\}>[\s\S]*<Image className="item-image" src=\{item\.displayImageUrl\} mode="aspectFit" \/>/);
  assert.doesNotMatch(cardSource, /imageUrl|thumbnailUrl/);
});

test('Today item images are visible without unreachable loaded state', () => {
  const imageRule = styleSource.slice(styleSource.indexOf('.item-image {'), styleSource.indexOf('}', styleSource.indexOf('.item-image {')));
  assert.match(imageRule, /opacity:\s*1/);
  assert.match(styleSource, /\.collage-item[\s\S]*grid-row: span 2/);
  assert.match(styleSource, /\.outfit-collage[\s\S]*grid-template-columns: 1\.4fr 0\.8fr/);
});

test('two-item layout uses the first item as the spanning left subject and second as right auto-placement', () => {
  assert.match(cardSource, /card\.items\.map\(\(item\) => \([\s\S]*collage-item/);
  assert.match(styleSource, /\.outfit-collage[\s\S]*grid-auto-rows: 168rpx[\s\S]*gap: 16rpx/);
  assert.match(styleSource, /&:first-child \{[\s\S]*grid-row: span 2/);
});

test('three-item layout keeps the spanning first subject and auto-places two right cells', () => {
  assert.match(cardSource, /card\.items\.map\(\(item\) => \([\s\S]*collage-item/);
  assert.match(styleSource, /grid-template-columns: 1\.4fr 0\.8fr/);
  assert.match(styleSource, /grid-auto-rows: 168rpx/);
  assert.doesNotMatch(cardSource, /positioning|layoutVariant/);
});
