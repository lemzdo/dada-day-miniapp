'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8');
const coordinatorSource = fs.readFileSync(
  path.join(__dirname, '../../lib/recommendationMutationCoordinator.ts'),
  'utf8',
);

test('Today prefetches only after restored/current commits and joins failed prefetch with refresh fallback', () => {
  assert.match(source, /commitCanonicalSnapshotForRender\(snapshot,[\s\S]*?\.then\(\(committed\) => \{[\s\S]*?prefetchNextBatch\(effectiveInput, committed\)/);
  assert.match(source, /prefetchNextBatch\(effectiveInput, nextSnapshot\)/);
  assert.match(source, /const fallbackRefresh = \(\) => acquireRecommendationForInput\(/);
  assert.match(source, /catch \{[\s\S]*?response = await fallbackRefresh\(\);/);
  assert.match(source, /\} else \{[\s\S]*?response = await fallbackRefresh\(\);/);
});

test('prefetch request uses refresh trigger and accumulated seen exclusions', () => {
  assert.match(source, /currentContentHash: snapshot\.core\.contentHash/);
  assert.match(source, /excludedOutfitKeys: \[\.\.\.seenOutfitKeysRef\.current\]/);
  assert.match(source, /trigger: 'refresh'/);
});

test('next identity and request contract bind effective input, current batch, hash, semantics, and exclusions', () => {
  const identityBody = coordinatorSource.slice(
    coordinatorSource.indexOf('export function buildNextBatchIdentity'),
    coordinatorSource.indexOf('export function prepareNextRecommendationForInput'),
  );
  assert.match(identityBody, /input\.identity/);
  assert.match(identityBody, /options\.currentBatchId/);
  assert.match(identityBody, /options\.currentContentHash/);
  assert.match(identityBody, /options\.refreshSemantics/);
  assert.match(identityBody, /exclusions\.join\(','\)/);

  const prepareBody = coordinatorSource.slice(
    coordinatorSource.indexOf('export function prepareNextRecommendationForInput'),
    coordinatorSource.indexOf('export function acquireNextRecommendationForInput'),
  );
  assert.match(prepareBody, /requestKind: 'refresh'/);
  assert.match(prepareBody, /\}, 'refresh'\)/);
  assert.match(prepareBody, /excludedOutfitKeys/);
  assert.match(prepareBody, /requestKey: buildNextBatchIdentity/);
});

test('exhausted displayed partial batches are recorded before compute is skipped', () => {
  const prefetchBody = source.slice(source.indexOf('function prefetchNextBatch'), source.indexOf('async function refreshHardInvalidRecommendation'));
  assert.ok(prefetchBody.indexOf('snapshot.cards.forEach') < prefetchBody.indexOf('snapshot.core.countContract.exhausted'));
  assert.match(prefetchBody, /seenOutfitKeysRef\.current\.add\(card\.outfitKey\)/);
  const refreshBody = source.slice(source.indexOf('async function handleV2Refresh'), source.indexOf('async function handleRefresh'));
  assert.ok(refreshBody.indexOf("setRecommendationNotice('这一轮暂时没有更多新搭配了')") < refreshBody.indexOf('acquireNextRecommendationForInput'));
  assert.match(refreshBody, /previous\?\.core\.countContract\.exhausted/);
});
