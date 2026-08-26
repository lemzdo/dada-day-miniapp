'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { resolveRecommendationHttpTransport } = require('./recommendationHttpTransport');

test('native wx cloud HTTP transport wins and preserves its receiver', () => {
  const calls = [];
  const nativeCloud = {
    marker: 'native',
    callHTTPFunction(options) {
      calls.push({ receiver: this.marker, options });
      return 'native-result';
    },
  };
  const frameworkCloud = {
    callHTTPFunction() {
      throw new Error('framework transport must not run');
    },
  };

  const transport = resolveRecommendationHttpTransport({ nativeCloud, frameworkCloud });

  assert.equal(transport.source, 'wx.cloud');
  assert.equal(transport.call({ name: 'recommendationStream' }), 'native-result');
  assert.deepEqual(calls, [{ receiver: 'native', options: { name: 'recommendationStream' } }]);
});

test('framework cloud is a compatibility fallback when native HTTP is unavailable', () => {
  const frameworkCloud = {
    marker: 'framework',
    callHTTPFunction() {
      return this.marker;
    },
  };

  const transport = resolveRecommendationHttpTransport({ nativeCloud: {}, frameworkCloud });

  assert.equal(transport.source, 'taro.cloud');
  assert.equal(transport.call({}), 'framework');
});

test('missing HTTP capability is explicit so the caller can fail open', () => {
  assert.equal(resolveRecommendationHttpTransport({ nativeCloud: {}, frameworkCloud: {} }), null);
});

test('production stream integrates native selection and an explicit callFunction fail-open', () => {
  const cloudSource = fs.readFileSync(path.join(__dirname, 'cloud.ts'), 'utf8');
  const streamSource = cloudSource.slice(
    cloudSource.indexOf('export function generateCloudOutfitStreamV2'),
    cloudSource.indexOf('export async function getCloudOutfitDetailV2'),
  );
  assert.match(streamSource, /globalThis[\s\S]*\.wx\?\.cloud/);
  assert.match(streamSource, /resolveRecommendationHttpTransport\(\{ nativeCloud, frameworkCloud: taroCloud \}\)/);
  assert.match(streamSource, /lifecycle\.onFailure\?\.\(\{[\s\S]*phase: 'before_ready'[\s\S]*fallback: 'callFunction'/);
  assert.match(streamSource, /generateCloudOutfitV2\(params\)/);
});
