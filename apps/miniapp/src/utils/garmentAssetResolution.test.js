const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { resolveGarmentAsset: packageResolver } = require('@d1d/garment-assets');

const root = path.join(__dirname, '..');
const surfaces = [
  ['pages/today/HomeLightCardV2.tsx', 'CARD'],
  ['pages/favorite-outfits/index.tsx', 'CARD'],
  ['pages/outfit-history/index.tsx', 'CARD'],
  ['pages/outfit-detail/index.tsx', 'DETAIL'],
];

test('outfit image surfaces use the shared resolver with stable usage policies', () => {
  for (const [relativePath, usage] of surfaces) {
    const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
    assert.match(source, /resolveGarmentAsset/);
    assert.match(source, new RegExp(`resolveGarmentAsset[\\s\\S]{0,220}'${usage}'`));
  }
});

test('P3 prewarm boundary reuses canonical resolution and image-session preload', () => {
  const source = fs.readFileSync(path.join(__dirname, 'garmentAssetResolution.ts'), 'utf8');
  assert.match(source, /export async function prewarmGarmentAssets/);
  assert.match(source, /preloadImageSession/);
  assert.match(source, /prewarmResolvedGarments\(/);
});

test('compat fixture preserves the prior visible source choices', () => {
  const fixture = {
    displayImageUrl: 'https://cdn.example/display.png',
    thumbnailUrl: 'https://cdn.example/thumb.png',
    imageUrl: 'https://cdn.example/image.png',
  };
  // These are the package contracts consumed by the client profiles:
  // CARD is display-first and LIST is thumbnail-first.
  assert.equal(packageResolver(fixture, 'CARD').url, fixture.displayImageUrl);
  assert.equal(packageResolver(fixture, 'LIST').url, fixture.thumbnailUrl);
  const source = fs.readFileSync(path.join(__dirname, 'garmentAssetResolution.ts'), 'utf8');
  const surfaceSource = surfaces.map(([relativePath]) => fs.readFileSync(path.join(root, relativePath), 'utf8')).join('\n');
  assert.match(source, /compatProfile: options\.compatProfile/);
  assert.match(source, /compatPolicy: 'compat'/);
  for (const profile of ['TODAY_CARD', 'SAVED_CARD', 'DETAIL_THUMBNAIL', 'DETAIL_DISPLAY']) {
    assert.match(surfaceSource, new RegExp(`compatProfile: '${profile}'`));
  }
  assert.match(source, /profile === 'TODAY_CARD'[\s\S]*garment\.displayImageUrl, garment\.thumbnailUrl, garment\.imageUrl/);
  assert.match(source, /profile === 'SAVED_CARD'[\s\S]*garment\.thumbnailUrl, garment\.imageUrl, garment\.displayImageUrl/);
  assert.match(source, /profile === 'DETAIL_THUMBNAIL'[\s\S]*garment\.thumbnailUrl, garment\.displayImageUrl, garment\.imageUrl/);
  assert.match(source, /profile === 'DETAIL_DISPLAY'[\s\S]*garment\.displayImageUrl, garment\.imageUrl, garment\.thumbnailUrl/);
});
