'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Jimp = require('jimp');
const { checkSegmentationIntegrity } = require('./segmentationIntegrity');

async function png(build) {
  const image = new Jimp(100, 100, 0xffffffff);
  build(image);
  return image.getBufferAsync(Jimp.MIME_PNG);
}

test('accepts a decoded image with a substantial subject', async () => {
  const result = await checkSegmentationIntegrity(await png((image) => image.scan(20, 20, 60, 60, function set(x, y, idx) {
    this.bitmap.data[idx] = 20;
    this.bitmap.data[idx + 1] = 80;
    this.bitmap.data[idx + 2] = 160;
    this.bitmap.data[idx + 3] = 255;
  })));
  assert.equal(result.status, 'VALID');
  assert.equal(result.checks.decode, 'PASS');
});

test('rejects blank and transparent output', async () => {
  const result = await checkSegmentationIntegrity(await png((image) => image.scan(0, 0, 100, 100, function clear(x, y, idx) {
    this.bitmap.data[idx + 3] = 0;
  })));
  assert.equal(result.status, 'INVALID');
  assert.ok(result.reasons.includes('blank_or_transparent'));
});

test('flags a tiny subject for review', async () => {
  const result = await checkSegmentationIntegrity(await png((image) => image.scan(49, 49, 2, 2, function mark(x, y, idx) {
    this.bitmap.data[idx] = 0;
    this.bitmap.data[idx + 1] = 0;
    this.bitmap.data[idx + 2] = 0;
    this.bitmap.data[idx + 3] = 255;
  })));
  assert.equal(result.status, 'NEEDS_REVIEW');
  assert.ok(result.reasons.includes('tiny_subject'));
});

test('rejects malformed bytes before any upload', async () => {
  const result = await checkSegmentationIntegrity(Buffer.from('not-an-image'));
  assert.equal(result.status, 'INVALID');
  assert.match(result.reasons[0], /^decode_failed:/);
});
