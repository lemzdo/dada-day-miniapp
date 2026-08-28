'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const primary = fs.readFileSync(path.join(ROOT, 'processUploadImage', 'services', 'wardrobeAssetPipeline.js'), 'utf8');
const reprocess = fs.readFileSync(path.join(ROOT, 'segmentClothImage', 'index.js'), 'utf8');

test('primary VIAPI and AITRYON durable results use the shared integrity gate', () => {
  assert.match(primary, /require\('\.\.\/shared\/segmentationIntegrity'\)/);
  assert.equal((primary.match(/validateIntegrity:\s*true/g) || []).length, 2);
  assert.match(primary, /const integrity = await checkSegmentationIntegrity\(buffer\)/);
  assert.match(primary, /segmentation_integrity_\$\{integrity\.status\.toLowerCase\(\)\}/);
});

test('manual reprocess validates VIAPI output before cloud upload', () => {
  assert.match(reprocess, /require\('\.\/shared\/segmentationIntegrity'\)/);
  assert.match(reprocess, /const integrity = await checkSegmentationIntegrity\(buffer\)/);
  const validationOffset = reprocess.indexOf('const integrity = await checkSegmentationIntegrity(buffer)');
  const uploadOffset = reprocess.indexOf('const uploadRes = await cloud.uploadFile', validationOffset);
  assert.ok(validationOffset >= 0 && uploadOffset > validationOffset);
});

test('primary failure path keeps crop/original fallback and clears clean output', () => {
  assert.match(primary, /asset\.cleanImageUrl = ''[\s\S]*asset\.aiSegmentImageUrl = ''/);
  assert.match(primary, /asset\.displayImageUrl = asset\.cropImageUrl \|\| asset\.originalImageUrl/);
  assert.match(primary, /asset\.imageSourceType = asset\.cropImageUrl \? 'crop' : 'original'/);
});

test('manual failure path does not clear durable clean or display image', () => {
  const failureStart = reprocess.indexOf('async function finishClothingSegmentFailure');
  const failureEnd = reprocess.indexOf('\nasync function updateClothingSegmentWithToken', failureStart);
  assert.ok(failureStart >= 0 && failureEnd > failureStart);
  const failureBody = reprocess.slice(failureStart, failureEnd);
  assert.doesNotMatch(failureBody, /cleanImageUrl:\s*['"]['"]/);
  assert.doesNotMatch(failureBody, /displayImageUrl:/);
  assert.match(failureBody, /segmentStatus:\s*'failed'/);
});
