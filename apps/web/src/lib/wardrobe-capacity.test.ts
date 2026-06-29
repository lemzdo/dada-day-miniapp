import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WARDROBE_CAPACITY_EXCEEDED,
  buildWardrobeCapacity,
  createWardrobeCapacityExceeded,
  resolveWardrobeEntitlement,
} from './wardrobe-capacity';

test('web resolver enforces free 200 and ignores untrusted fields', () => {
  assert.deepEqual(resolveWardrobeEntitlement({ membershipTier: 'premium', limit: 1000 }), {
    plan: 'free',
    limit: 200,
  });
});

test('web capacity clamps remaining and canAdd', () => {
  assert.deepEqual(buildWardrobeCapacity({ used: 250, plan: 'free', limit: 200 }), {
    plan: 'free',
    used: 250,
    limit: 200,
    remaining: 0,
    canAdd: false,
  });
});

test('web capacity exceeded error is structured', () => {
  const capacity = buildWardrobeCapacity({ used: 200, plan: 'free', limit: 200 });
  const error = createWardrobeCapacityExceeded({ capacity, requested: 1 });

  assert.equal(error.code, WARDROBE_CAPACITY_EXCEEDED);
  assert.equal(error.details.requested, 1);
  assert.equal(error.details.capacity.remaining, 0);
});
