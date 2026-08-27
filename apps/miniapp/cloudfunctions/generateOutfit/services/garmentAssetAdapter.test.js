'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { applySnapshotAsset, resolveAsset, temporaryUrl } = require('./garmentAssetAdapter');

test('snapshot asset adapter preserves durable references and legacy reader fields', () => {
  const result = applySnapshotAsset({ itemId: 'g1', imageUrl: 'https://cdn.example/display.jpg' }, {
    originalImageUrl: 'https://cdn.example/original.jpg',
    cleanImageUrl: 'https://cdn.example/fact.png',
    displayImageUrl: 'https://cdn.example/display.jpg',
    thumbnailUrl: 'https://cdn.example/thumb.jpg',
    assetVersion: 'v2',
  });
  assert.equal(result.originalImageUrl, 'https://cdn.example/original.jpg');
  assert.equal(result.factImageUrl, 'https://cdn.example/original.jpg');
  assert.equal(result.displayImageUrl, 'https://cdn.example/display.jpg');
  assert.equal(result.thumbnailUrl, 'https://cdn.example/thumb.jpg');
  assert.equal(result.assetVersion, 'v2');
  assert.equal(result.imageUrl, 'https://cdn.example/display.jpg');
});

test('temporary signed HTTPS cannot become a durable fact/original reference', () => {
  const signed = 'https://cdn.example/item.png?X-Amz-Signature=abc';
  assert.equal(temporaryUrl(signed), true);
  const result = resolveAsset({ imageUrl: signed, cleanImageUrl: signed, displayImageUrl: signed });
  assert.equal(result.originalImageUrl, '');
  assert.equal(result.factImageUrl, '');
  assert.equal(result.displayImageUrl, signed);
});

test('presentation-only aliases do not create durable snapshot references', () => {
  const result = resolveAsset({
    imageUrl: 'https://cdn.example/presentation.jpg',
    displayImageUrl: 'https://cdn.example/display.jpg',
    thumbnailUrl: 'https://cdn.example/thumb.jpg',
  });
  assert.equal(result.originalImageUrl, '');
  assert.equal(result.originalAssetRef, '');
  assert.equal(result.factImageUrl, '');
  assert.equal(result.factReference, '');
  assert.equal(result.displayImageUrl, 'https://cdn.example/display.jpg');
});

test('cloud and original references remain durable snapshot facts', () => {
  const result = resolveAsset({
    cloudFileId: 'cloud://wardrobe/original',
    originalImageUrl: 'https://cdn.example/original.jpg',
    normalizedImageUrl: 'https://cdn.example/normalized.png',
    displayImageUrl: 'https://cdn.example/display.jpg',
  });
  assert.equal(result.originalImageUrl, 'cloud://wardrobe/original');
  assert.equal(result.originalAssetRef, 'cloud://wardrobe/original');
  assert.equal(result.factImageUrl, 'cloud://wardrobe/original');
  assert.equal(result.factReference, 'cloud://wardrobe/original');
});

test('clean-only garment keeps fact reference without inventing an original', () => {
  const result = resolveAsset({
    cleanImageUrl: 'https://cdn.example/clean.png',
    displayImageUrl: 'https://cdn.example/display.jpg',
  });
  assert.equal(result.originalImageUrl, '');
  assert.equal(result.originalAssetRef, '');
  assert.equal(result.factImageUrl, 'https://cdn.example/clean.png');
  assert.equal(result.factReference, 'https://cdn.example/clean.png');
  assert.equal(result.displayImageUrl, 'https://cdn.example/display.jpg');
});
