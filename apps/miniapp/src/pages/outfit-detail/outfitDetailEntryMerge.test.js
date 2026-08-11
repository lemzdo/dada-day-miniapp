const assert = require('node:assert/strict');
const test = require('node:test');
const { mergeRecommendationEntryDraft } = require('./outfitDetailEntryMerge');

function outfit(overrides = {}) {
  return {
    id: 'same-id',
    outfitKey: 'same-key',
    scene: '居家',
    copyContractVersion: 'recommendation-copy-contract-v7',
    copyContract: {
      copyContractVersion: 'recommendation-copy-contract-v7',
      todayReason: '居家入口文案。',
    },
    ...overrides,
  };
}

test('recommendation detail keeps the current entry scene and canonical copy while applying remote status', () => {
  const remote = outfit({
    scene: '运动',
    copyContract: {
      copyContractVersion: 'recommendation-copy-contract-v7',
      todayReason: '服务端最近一次运动文案。',
    },
    isFavorite: true,
    userTitle: '晨间散步',
    updatedAt: '2026-08-11T03:00:00.000Z',
  });
  const entry = outfit();
  const merged = mergeRecommendationEntryDraft(remote, entry);
  assert.equal(merged.scene, '居家');
  assert.equal(merged.copyContract.todayReason, '居家入口文案。');
  assert.equal(merged.isFavorite, true);
  assert.equal(merged.userTitle, '晨间散步');
  assert.equal(merged.updatedAt, '2026-08-11T03:00:00.000Z');
  assert.notEqual(merged, remote);
  assert.equal(entry.isFavorite, undefined);
});

test('stale or different-outfit drafts cannot override the remote detail', () => {
  const remote = outfit({ scene: '运动' });
  assert.equal(mergeRecommendationEntryDraft(remote, outfit({ outfitKey: 'other-key' })), remote);
  assert.equal(mergeRecommendationEntryDraft(remote, outfit({
    copyContractVersion: 'recommendation-copy-contract-v6',
  })), remote);
});
