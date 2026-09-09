const assert = require('node:assert/strict');
const test = require('node:test');

const {
  ROLE_ORDER,
  buildScalingWardrobe,
  buildWorstCaseWardrobe,
  countRoleDistribution,
  rawCombinationCount,
} = require('./recommendationScalingFixtures');

for (const size of [30, 100, 300, 500]) {
  test(`scaling fixture ${size} has deterministic size and role counts`, () => {
    const clothes = buildScalingWardrobe(size);
    assert.equal(clothes.length, size);
    assert.deepEqual(Object.keys(countRoleDistribution(clothes)), [...ROLE_ORDER]);
    assert.equal(rawCombinationCount(countRoleDistribution(clothes), 'work') > 0, true);
    assert.equal(new Set(clothes.map((item) => item._id)).size, size);
  });
}

test('worst-case fixtures concentrate items in Cartesian-product roles', () => {
  for (const size of [30, 100, 300, 500]) {
    const counts = countRoleDistribution(buildWorstCaseWardrobe(size));
    assert.equal(counts.outerwear, 0);
    assert.equal(counts.accessory, 0);
    assert.equal(counts.top + counts.bottom + counts.shoes, size);
    assert.ok(rawCombinationCount(counts) >= rawCombinationCount(countRoleDistribution(buildScalingWardrobe(size))));
  }
});
