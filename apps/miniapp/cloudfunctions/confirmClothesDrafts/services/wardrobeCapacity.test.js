const assert = require('node:assert/strict');
const test = require('node:test');

const {
  WARDROBE_LIMITS,
  buildWardrobeCapacity,
  normalizeWardrobePlan,
  resolveWardrobeEntitlement,
} = require('./wardrobeCapacity');

test('current resolver always enforces free 200 and ignores forged client/user fields', () => {
  assert.deepEqual(WARDROBE_LIMITS, { free: 200, member: 500, premium: 1000 });
  assert.deepEqual(resolveWardrobeEntitlement({ plan: 'premium', limit: 1000, membershipTier: 'premium' }), {
    plan: 'free',
    limit: 200,
  });
  assert.deepEqual(resolveWardrobeEntitlement({ isVip: true, capacityTotal: 1000 }), {
    plan: 'free',
    limit: 200,
  });
});

test('normalizes future plan names without using them as current entitlement', () => {
  assert.equal(normalizeWardrobePlan('member'), 'member');
  assert.equal(normalizeWardrobePlan('premium'), 'premium');
  assert.equal(normalizeWardrobePlan('enterprise'), 'free');
  assert.equal(WARDROBE_LIMITS.member, 500);
  assert.equal(WARDROBE_LIMITS.premium, 1000);
});

test('buildWardrobeCapacity clamps invalid values and never returns negative remaining', () => {
  assert.deepEqual(buildWardrobeCapacity({ used: 0, plan: 'free', limit: 200 }), {
    plan: 'free',
    used: 0,
    limit: 200,
    remaining: 200,
    canAdd: true,
  });
  assert.deepEqual(buildWardrobeCapacity({ used: 199, plan: 'free', limit: 200 }).remaining, 1);
  assert.deepEqual(buildWardrobeCapacity({ used: 200, plan: 'free', limit: 200 }), {
    plan: 'free',
    used: 200,
    limit: 200,
    remaining: 0,
    canAdd: false,
  });
  assert.deepEqual(buildWardrobeCapacity({ used: 250, plan: 'free', limit: 200 }).remaining, 0);
  assert.deepEqual(buildWardrobeCapacity({ used: Number.NaN, plan: 'premium', limit: Infinity }), {
    plan: 'premium',
    used: 0,
    limit: 1000,
    remaining: 1000,
    canAdd: true,
  });
});

test('buildWardrobeCapacity does not mutate input', () => {
  const input = { used: 199, plan: 'free', limit: 200 };
  const before = JSON.stringify(input);
  buildWardrobeCapacity(input);
  assert.equal(JSON.stringify(input), before);
});
