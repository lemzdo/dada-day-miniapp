const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildWardrobeCapacity,
  resolveWardrobeEntitlement,
} = require('./wardrobeCapacity');

test('getWardrobe capacity helper returns free 200 with legacy total fields', () => {
  const entitlement = resolveWardrobeEntitlement({ membershipTier: 'premium', capacityTotal: 1000 });
  const capacity = buildWardrobeCapacity({ used: 201, ...entitlement });

  assert.deepEqual(capacity, {
    plan: 'free',
    used: 201,
    limit: 200,
    total: 200,
    remaining: 0,
    canAdd: false,
  });
});
