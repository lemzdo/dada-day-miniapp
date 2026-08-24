'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { COLLECTIONS } = require('./bootstrap-recommendation-v2-collections');

test('V2 bootstrap provisions the batch source and one canonical-copy worker/cache lifecycle', () => {
  assert.deepEqual(COLLECTIONS, [
    'recommendation_batches_v2',
    'recommendation_copy_jobs_v2',
    'recommendation_canonical_copy_cache_v2',
  ]);
});

test('production source has no separate ref collection or helper references', () => {
  const root = path.resolve(__dirname, '..');
  const forbidden = ['recommendation_' + 'outfit_refs_v2', 'findRef', 'findBatchRefs', 'RecommendationOutfitRefV2'];
  const files = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory() && entry.name !== 'node_modules') walk(target);
      else if (entry.isFile() && /\.(js|ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.test.js')) files.push(target);
    }
  };
  walk(root);
  const violations = files.flatMap((file) => forbidden.filter((token) => fs.readFileSync(file, 'utf8').includes(token)).map((token) => `${path.relative(root, file)}:${token}`));
  assert.deepEqual(violations, []);
});
