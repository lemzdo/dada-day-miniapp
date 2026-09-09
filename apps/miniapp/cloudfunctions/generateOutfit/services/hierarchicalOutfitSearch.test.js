const assert = require('node:assert/strict');
const test = require('node:test');
const { hierarchicalOutfitSearch, deriveSearchBudget, buildRoleBuckets, rawCandidateKey, selectDiversityReservoir } = require('./hierarchicalOutfitSearch');
const { buildFullEnsembleExhaustiveOracle, buildLegacyCoreCandidates } = require('./recommendationOracle');
const { buildScalingWardrobe } = require('./recommendationScalingFixtures');

function item(id, category, subcategory = category, scoreHint = 0) {
  return { _id: id, category, subcategory, subCategory: subcategory, scoreHint, colorPalette: [{ name: id.includes('red') ? '红色' : '黑色' }] };
}

function wardrobe(size = 30) {
  return [
    ...Array.from({ length: Math.floor(size * 0.3) }, (_, i) => item(`top-${i}`, 'top', '衬衫', i)),
    ...Array.from({ length: Math.floor(size * 0.25) }, (_, i) => item(`bottom-${i}`, 'bottom', '长裤', i)),
    ...Array.from({ length: Math.floor(size * 0.15) }, (_, i) => item(`shoe-${i}`, 'shoes', '运动鞋', i)),
    ...Array.from({ length: Math.floor(size * 0.1) }, (_, i) => item(`coat-${i}`, 'outerwear', '薄外套', i)),
    ...Array.from({ length: size - Math.floor(size * 0.8) }, (_, i) => item(`bag-${i}`, 'accessory', '包', i)),
  ];
}

test('role buckets classify extensible structural and accessory roles', () => {
  const buckets = buildRoleBuckets([
    item('a', 'top', '上衣'), item('b', 'outerwear', '外套'), item('c', 'accessory', '帽子'),
    item('d', 'accessory', '项链'), item('e', 'accessory', '袜子'), item('f', 'dress', 'dress'),
    item('g', 'accessory', '保暖帽'), item('h', 'accessory', '运动袜'),
  ]);
  assert.equal(buckets.top.length, 1);
  assert.equal(buckets.outerwear.length, 1);
  assert.equal(buckets.hat.length, 2);
  assert.equal(buckets.necklace.length, 1);
  assert.equal(buckets.socks.length, 2);
  assert.equal(buckets.dress.length, 1);
  assert.equal(buckets.hat.find((entry) => entry._id === 'c').outfitRole, 'optional');
  assert.equal(buckets.hat.find((entry) => entry._id === 'g').outfitRole, 'functional');
  assert.equal(buckets.socks.find((entry) => entry._id === 'e').outfitRole, 'optional');
  assert.equal(buckets.socks.find((entry) => entry._id === 'h').outfitRole, 'functional');
});

test('bounded search keeps 30/100/300/500 expansions under hard budgets', () => {
  for (const size of [30, 100, 300, 500]) {
    const result = hierarchicalOutfitSearch({ clothes: wardrobe(size), scene: 'work', weather: { temp: 20 }, targetBatchSize: 8, targetQualifiedBatches: 3 });
    assert.ok(result.diagnostics.rawSkeletonCount <= result.diagnostics.budget.skeletonExpansionBudget);
    assert.ok(result.diagnostics.structuralExpansionCount <= result.diagnostics.budget.structuralExpansionBudget);
    assert.ok(result.diagnostics.structuralExpansionCount <= result.diagnostics.budget.structuralExpansionBudget);
    assert.ok(result.diagnostics.accessoryBeamExpansionCount <= result.diagnostics.budget.accessoryExpansionBudget);
    assert.ok(result.diagnostics.actualCandidateCount <= result.diagnostics.budget.hardCandidateLimit);
    assert.equal(result.candidates.every((candidate) => [2, 3, 4, 5, 6, 7].includes(candidate.items.length)), true);
    assert.equal(result.candidates.every((candidate) => candidate.items.every((entry) => ['core', 'functional', 'optional'].includes(entry.outfitRole))), true);
  }
});

test('all returned candidates are complete legal skeletons, never partial beam states', () => {
  const result = hierarchicalOutfitSearch({ clothes: [item('top', 'top'), item('bottom', 'bottom'), item('shoe', 'shoes')], scene: 'work' });
  assert.ok(result.diagnostics.fullSkeletonCount > 0);
  assert.equal(result.diagnostics.partialSkeletonExpansionCount >= result.diagnostics.fullSkeletonCount, true);
  assert.equal(result.candidates.every((candidate) => {
    const slots = new Set(candidate.items.map((entry) => entry.outfitSlot));
    return (slots.has('dress') || slots.has('onepiece') || (slots.has('top') && (slots.has('bottom') || slots.has('skirt')))) && slots.has('shoes');
  }), true);
});

test('outfit role contract maps core, structural and accessory refs', () => {
  const result = hierarchicalOutfitSearch({ clothes: [item('top', 'top'), item('bottom', 'bottom'), item('shoe', 'shoes'), item('coat', 'outerwear', '外套'), item('bag', 'accessory', '包')], scene: 'work', weather: { temp: 20 } });
  const bySlot = new Map(result.candidates.flatMap((candidate) => candidate.items.map((entry) => [entry.outfitSlot, entry.outfitRole])));
  assert.equal(bySlot.get('top'), 'core');
  assert.equal(bySlot.get('outerwear') || 'functional', 'functional');
  assert.equal(bySlot.get('bag') || 'optional', 'optional');
});

test('mild work weather recommends outerwear while hot weather forbids it', () => {
  const clothes = [item('top', 'top'), item('bottom', 'bottom'), item('shoe', 'shoes'), item('coat', 'outerwear', '薄外套')];
  const mild = hierarchicalOutfitSearch({ clothes, scene: 'work', weather: { temp: 24 } });
  const hot = hierarchicalOutfitSearch({ clothes, scene: 'work', weather: { temp: 30 } });
  assert.equal(mild.candidates.some((candidate) => candidate.items.some((entry) => entry._id === 'coat')), true);
  assert.equal(hot.candidates.every((candidate) => !candidate.items.some((entry) => entry._id === 'coat')), true);
});

test('cold weather structural completion includes compatible outerwear before validation', () => {
  const result = hierarchicalOutfitSearch({ clothes: [item('top', 'top', '衬衫'), item('bottom', 'bottom', '长裤'), item('shoe', 'shoes', '皮鞋'), item('coat', 'outerwear', '外套')], scene: 'work', weather: { temp: 5 }, targetBatchSize: 8 });
  assert.ok(result.candidates.some((candidate) => candidate.items.some((entry) => entry.outfitSlot === 'outerwear')));
});

test('accessory beam permits NONE and does not force available accessories', () => {
  const result = hierarchicalOutfitSearch({ clothes: [item('top', 'top', '衬衫'), item('bottom', 'bottom', '长裤'), item('shoe', 'shoes', '皮鞋'), item('bag', 'accessory', '包')], scene: 'work', weather: {}, targetBatchSize: 8 });
  assert.ok(result.candidates.some((candidate) => !candidate.items.some((entry) => entry.outfitSlot === 'bag')));
  assert.ok(result.diagnostics.colorMemoHits >= 0);
});

test('color compatibility memo is request-local and does not mutate returned refs', () => {
  const result = hierarchicalOutfitSearch({ clothes: [item('top', 'top'), item('bottom', 'bottom'), item('shoe', 'shoes')], scene: 'work' });
  assert.ok(result.diagnostics.colorMemoHits > 0);
  assert.equal(result.candidates.flatMap((candidate) => candidate.items).every((entry) => !Object.hasOwn(entry, '_colorMemo')), true);
});

test('injected eligibility and score preserve a unique best full ensemble', () => {
  const result = hierarchicalOutfitSearch({
    clothes: [item('top-best', 'top', '衬衫', 100), item('top-other', 'top', '衬衫', 1), item('bottom', 'bottom', '长裤', 1), item('shoe', 'shoes', '皮鞋', 1)],
    scene: 'work', weather: {}, targetBatchSize: 1, targetQualifiedBatches: 1,
    evaluateEligibility: (candidate) => ({ eligible: candidate.items.some((entry) => entry._id === 'top-best') }),
    scoreCandidate: (candidate) => candidate.items.reduce((sum, entry) => sum + entry._scoreHint, 0),
  });
  assert.equal(result.candidates.length, 1);
  assert.ok(rawCandidateKey(result.candidates[0]).includes('top-best'));
});

test('small core-only search is set-equivalent to the frozen legacy oracle', () => {
  const clothes = [
    item('top-a', 'top'), item('top-b', 'top'),
    item('bottom-a', 'bottom'), item('bottom-b', 'bottom'),
    item('shoe-a', 'shoes'), item('shoe-b', 'shoes'),
  ];
  const bounded = hierarchicalOutfitSearch({ clothes, scene: 'work', weather: {}, targetBatchSize: 8 });
  const legacy = buildLegacyCoreCandidates({ clothes, scene: 'work' });
  assert.deepEqual(
    bounded.candidates.map(rawCandidateKey).sort(),
    legacy.map((candidate) => candidate.items.map((entry) => entry._id).sort().join('_')).sort(),
  );
});

test('small full-ensemble search chooses the same unique best result as exhaustive oracle', () => {
  const scoredItem = (id, category, score) => ({ ...item(id, category, category, score), score });
  const clothes = [
    scoredItem('top-best', 'top', 100), scoredItem('top-other', 'top', 1),
    scoredItem('bottom', 'bottom', 10), scoredItem('shoe', 'shoes', 10),
    scoredItem('coat', 'outerwear', 8), scoredItem('hat', 'hat', 7), scoredItem('bag', 'bag', 6),
  ];
  const score = (candidate) => candidate.items.reduce((sum, entry) => sum + Number(entry.sourceItem?.score ?? entry.score ?? 0), 0);
  const bounded = hierarchicalOutfitSearch({
    clothes, scene: 'work', weather: { temp: 20 }, targetBatchSize: 8, targetQualifiedBatches: 2,
    evaluateEligibility: () => ({ eligible: true }), scoreCandidate: score,
  });
  const exhaustive = buildFullEnsembleExhaustiveOracle({
    clothes, scene: 'work', weather: { temp: 20 }, optionalRoles: ['outerwear', 'hat', 'bag'],
  });
  assert.deepEqual(
    bounded.candidates[0].items.map((entry) => entry._id).sort(),
    exhaustive[0].items.map((entry) => entry._id).sort(),
  );
});

test('scored reservoir favors quality while preserving item-level diversity', () => {
  const candidate = (top, score) => ({ score, items: [
    { _id: top, outfitSlot: 'top', outfitRole: 'core' },
    { _id: 'bottom', outfitSlot: 'bottom', outfitRole: 'core' },
    { _id: 'shoe', outfitSlot: 'shoes', outfitRole: 'core' },
  ] });
  const selected = selectDiversityReservoir([candidate('top-a', 10), candidate('top-a', 9), candidate('top-b', 8)], 2, {});
  assert.deepEqual(selected.map((entry) => entry.items[0]._id), ['top-a', 'top-b']);
});

test('budget is derived from request targets and has a hard cap', () => {
  const budget = deriveSearchBudget({ buckets: { top: Array(500), bottom: Array(500), shoes: Array(500), skirt: [], dress: [], onepiece: [], outerwear: [], socks: [], gloves: [], scarf: [], hat: [], bag: [], belt: [], necklace: [], bracelet: [], watch: [], accessory: [] }, targetBatchSize: 8, targetQualifiedBatches: 100 });
  assert.ok(budget.skeletonExpansionBudget <= 4096);
  assert.ok(budget.accessoryExpansionBudget <= 2048);
  assert.ok(budget.reservoirCapacity <= 512);
});

test('real scaling fixtures retain bounded complete candidates at qualified-batch target six', () => {
  for (const size of [30, 100, 300, 500]) {
    const result = hierarchicalOutfitSearch({
      clothes: buildScalingWardrobe(size), scene: 'work', weather: { temp: 20 },
      targetBatchSize: 8, targetQualifiedBatches: 6,
    });
    assert.ok(result.candidates.length >= 8);
    assert.ok(result.diagnostics.fullSkeletonCount > 0);
    assert.ok(result.diagnostics.actualCandidateCount <= result.diagnostics.budget.hardCandidateLimit);
    assert.equal(result.candidates.every((candidate) => candidate.items.some((item) => item.outfitSlot === 'shoes')), true);
  }
});
