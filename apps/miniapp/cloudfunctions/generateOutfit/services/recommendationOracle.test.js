'use strict';


const assert = require('node:assert/strict');
const test = require('node:test');
const {
  assertCompleteIdentity,
  buildFullEnsembleExhaustiveOracle,
  buildLegacyCoreCandidates,
} = require('./recommendationOracle');

function item(_id, category, extra = {}) {
  return { _id, category, ...extra };
}

const CORE = [
  item('top-a', 'top', { score: 4 }), item('top-b', 'top', { score: 2 }),
  item('bottom-a', 'bottom', { score: 3 }), item('skirt-a', 'bottom', { subcategory: 'skirt', score: 5 }),
  item('dress-a', 'dress', { score: 6 }), item('shoe-a', 'shoes', { score: 1 }),
];

test('legacy core oracle is deterministic and excludes optional structural/accessory items', () => {
  const first = buildLegacyCoreCandidates({ clothes: [...CORE, item('coat-a', 'outerwear'), item('bag-a', 'bag')] });
  const second = buildLegacyCoreCandidates({ clothes: [...CORE, item('coat-a', 'outerwear'), item('bag-a', 'bag')] });
  assert.deepEqual(first.map((candidate) => candidate.outfitKey), second.map((candidate) => candidate.outfitKey));
  assert.equal(first.length, 5);
  assert.ok(first.every((candidate) => candidate.items.every((entry) => ['top', 'bottom', 'dress', 'shoes'].includes(entry.category))));
  assert.equal(first[0].outfitKey, 'outerwear=NONE|socks=NONE|hat=NONE|necklace=NONE|bracelet=NONE|bag=NONE|top=top-a|bottom=NONE|skirt=skirt-a|dress=NONE|shoes=shoe-a');
});

test('legacy oracle preserves core skeleton families for home/work/date/sport', () => {
  for (const scene of ['home', 'work', 'date', 'sport']) {
    const candidates = buildLegacyCoreCandidates({ clothes: CORE, scene });
    assert.deepEqual([...new Set(candidates.map((candidate) => candidate.roles.join('+')))].sort(), ['top+bottom+shoes', 'dress+shoes', 'top+skirt+shoes'].sort(), scene);
    assert.ok(candidates.every((candidate) => candidate.scene === scene));
  }
});

test('full ensemble exhaustive oracle includes every real optional item in identity', () => {
  const clothes = [
    item('top', 'top'), item('bottom', 'bottom'), item('shoe', 'shoes'),
    item('coat', 'outerwear'), item('sock', 'socks'), item('hat', 'hat'),
    item('necklace', 'necklace'), item('bracelet', 'bracelet'), item('bag', 'bag'),
  ];
  const candidates = buildFullEnsembleExhaustiveOracle({ clothes, score: ({ items }) => items.length });
  assert.equal(candidates.length, 64);
  const full = candidates.find((candidate) => candidate.itemIds.length === 9);
  assert.ok(full);
  assertCompleteIdentity(full);
  for (const id of ['coat', 'sock', 'hat', 'necklace', 'bracelet', 'bag']) assert.match(full.outfitKey, new RegExp(`=${id}(?:\\||$)`));
});

test('full oracle accepts eligibility and optional policy callbacks', () => {
  const clothes = [item('top', 'top'), item('bottom', 'bottom'), item('shoe', 'shoes'), item('bag', 'bag')];
  const candidates = buildFullEnsembleExhaustiveOracle({
    clothes,
    optionalRoles: ['bag'],
    allowOptional: ({ itemsByRole }) => !itemsByRole.bag || itemsByRole.bag._id === 'bag',
    isEligible: ({ itemsByRole }) => !itemsByRole.bag,
  });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].itemIds.includes('bag'), false);
  assertCompleteIdentity(candidates[0]);
});
