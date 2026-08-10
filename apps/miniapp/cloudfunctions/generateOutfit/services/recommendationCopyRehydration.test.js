const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { normalizeDefaultCopyAtResponseBoundary } = require('./recommendationCopyRehydration');

const CONTRACT_VERSION = 'recommendation-copy-contract-v4';
const VOICE_VERSION = 'xiaoda-fixed-claim-catalog-v2';

function staleWorkOutfit(extra = {}) {
  return {
    id: 'outfit-1',
    copyContractVersion: 'recommendation-copy-contract-v1',
    voiceBankVersion: 'xiaoda-voice-bank-v2',
    reason: '旧首页文案',
    reasoning: '旧详情文案',
    scene: 'work',
    weatherSnapshot: { temp: 22, weather: '晴' },
    clothingIds: ['top-1', 'bottom-1', 'shoes-1'],
    items: [
      {
        clothingId: 'top-1', category: 'top', subcategory: '衬衫', confidence: 0.95,
        fit: '宽松', styleComplexity: '简洁', productFacts: ['soft_material'],
      },
      {
        clothingId: 'bottom-1', category: 'bottom', subcategory: '直筒裤', confidence: 0.95,
        fit: '直筒', productFacts: ['flexible_fit'],
      },
      {
        clothingId: 'shoes-1', category: 'shoes', subcategory: '乐福鞋', confidence: 0.95,
        styleComplexity: '简洁',
      },
    ],
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...extra,
  };
}

test('stale recommendation favorite history and detail shapes rehydrate to current fixed Claims', () => {
  for (const kind of ['recommendation', 'favorite', 'history', 'detail']) {
    const source = staleWorkOutfit({ outfitKind: kind });
    const result = normalizeDefaultCopyAtResponseBoundary(source, {
      scene: 'work',
      weather: source.weatherSnapshot,
      mode: kind === 'recommendation' ? 'new_recommendation' : 'saved_snapshot',
    });
    assert.equal(result.copyContractVersion, CONTRACT_VERSION, kind);
    assert.equal(result.voiceBankVersion, VOICE_VERSION, kind);
    assert.equal(result.copyContract.gateResult, 'PASS', kind);
    assert.equal(result.reason, '衬衫配直筒裤，上班穿比较利落。', kind);
    assert.notEqual(result.reason, source.reason, kind);
    assert.equal(result.copyContract.todayReason, result.reason, kind);
  }
});

test('insufficient stale saved snapshots preserve the record and hide old copy', () => {
  const source = staleWorkOutfit({ items: [], clothingIds: [], reason: '旧句一', reasoning: '旧句二' });
  const result = normalizeDefaultCopyAtResponseBoundary(source, { scene: 'work', mode: 'saved_snapshot' });
  assert.equal(result.copyContractVersion, CONTRACT_VERSION);
  assert.equal(result.copyContract.gateResult, 'REJECT');
  assert.equal(result.id, source.id);
  assert.equal(result.createdAt, source.createdAt);
  assert.equal(result.defaultCopyHidden, true);
  assert.equal(result.reason, '');
  assert.equal(result.reasoning, undefined);
  assert.equal(JSON.stringify(result).includes('旧句一'), false);
  assert.equal(JSON.stringify(result).includes('旧句二'), false);
});

test('a current PASS Contract is returned by exact object identity', () => {
  const source = staleWorkOutfit();
  const compiled = normalizeDefaultCopyAtResponseBoundary(source, {
    scene: 'work', weather: source.weatherSnapshot, mode: 'new_recommendation',
  });
  assert.equal(compiled.copyContract.gateResult, 'PASS');
  assert.equal(normalizeDefaultCopyAtResponseBoundary(compiled, { mode: 'saved_snapshot' }), compiled);
});

test('current version with empty or rejected copy is not trusted', () => {
  const source = staleWorkOutfit({
    copyContractVersion: CONTRACT_VERSION,
    copyContract: { gateResult: 'REJECT', todayReason: '', riskFlags: ['NO_ACCEPTED_CORE_CLAIM'] },
  });
  const result = normalizeDefaultCopyAtResponseBoundary(source, { scene: 'work', mode: 'saved_snapshot' });
  assert.equal(result.copyContract.gateResult, 'PASS');
  assert.ok(result.copyContract.todayReason);
  assert.notEqual(result, source);
});

test('real AI review bytes survive default-copy rehydration unchanged', () => {
  const aiComment = {
    overallComment: '真实 AI 点评原文',
    advice: '真实 AI 建议原文',
    source: 'cached_ai',
    explanationV2: { schemaVersion: 3, source: 'ai', overallComment: '嵌套原文', advice: '' },
  };
  const source = staleWorkOutfit({ aiComment, reviewSource: 'cached_ai' });
  const before = JSON.stringify(aiComment);
  const result = normalizeDefaultCopyAtResponseBoundary(source, { scene: 'work', mode: 'saved_snapshot' });
  assert.equal(JSON.stringify(result.aiComment), before);
  assert.equal(result.reviewSource, 'cached_ai');
  assert.equal(result.copyContract.gateResult, 'PASS');
});

test('legacy favorite history detail and soft-deleted-item snapshots remain displayable with copy hidden', () => {
  const cases = [
    ['favorite', staleWorkOutfit({ items: [], clothingIds: [], isFavorite: true })],
    ['history', staleWorkOutfit({ items: [], clothingIds: [], isWornToday: true })],
    ['detail', staleWorkOutfit({ items: [], clothingIds: [], title: '旧详情标题' })],
    ['soft-deleted history', staleWorkOutfit({
      items: undefined,
      clothingIds: ['soft-deleted-item'],
      snapshotItems: [{ itemId: 'soft-deleted-item', name: '已删除衣物快照', imageUrl: 'snapshot.jpg' }],
      isWornToday: true,
    })],
  ];
  for (const [name, source] of cases) {
    const result = normalizeDefaultCopyAtResponseBoundary(source, {
      scene: 'work',
      mode: 'saved_snapshot',
    });
    assert.equal(result.id, source.id, name);
    assert.equal(result.copyContract.gateResult, 'REJECT', name);
    assert.equal(result.reason, '', name);
    assert.equal(result.reasoning, undefined, name);
    assert.equal(result.defaultCopyHidden, true, name);
    assert.equal(JSON.stringify(result).includes('旧首页文案'), false, name);
    assert.equal(JSON.stringify(result).includes('旧详情文案'), false, name);
    if (name === 'soft-deleted history') assert.deepEqual(result.snapshotItems, source.snapshotItems);
  }
});

test('rehydration performs pure in-memory compilation and imports no SDK or loader', () => {
  const source = fs.readFileSync(path.join(__dirname, 'recommendationCopyRehydration.js'), 'utf8');
  assert.equal(source.includes('wx-server-sdk'), false);
  assert.equal(source.includes('.collection('), false);
  assert.equal(source.includes('loadActiveWardrobe'), false);
  assert.equal(source.includes('compileRecommendationLanguageV3'), true);
});
