import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WARDROBE_CAPACITY_EXCEEDED,
  buildWardrobeCapacity,
  createWardrobeCapacityExceeded,
  resolveWardrobeEntitlement,
} from './wardrobe-capacity.ts';

function toCapacityApi(capacity) {
  return {
    ...capacity,
    total: capacity.limit,
  };
}

class MockWardrobeStore {
  constructor(items = []) {
    this.items = items.map((status, index) => ({ id: `item-${index}`, status }));
    this.queue = Promise.resolve();
  }

  countActive() {
    return this.items.filter((item) => item.status === 'active').length;
  }

  archiveFirstActive() {
    const item = this.items.find((current) => current.status === 'active');
    if (!item) return;
    item.status = 'archived';
  }

  async transaction(callback) {
    const previous = this.queue;
    let release;
    this.queue = new Promise((resolve) => {
      release = resolve;
    });
    await previous;

    const snapshot = this.items.map((item) => ({ ...item }));
    const tx = {
      countActive: () => this.countActive(),
      insertActive: () => {
        this.items.push({ id: `item-${this.items.length}`, status: 'active' });
      },
      archiveFirstActive: () => this.archiveFirstActive(),
    };

    try {
      return await callback(tx);
    } catch (error) {
      this.items = snapshot;
      throw error;
    } finally {
      release();
    }
  }
}

async function createClothingWithGate(store, options = {}) {
  return store.transaction(async (tx) => {
    const entitlement = resolveWardrobeEntitlement(options.source);
    const before = buildWardrobeCapacity({
      ...entitlement,
      used: tx.countActive(),
    });
    const requested = options.requested ?? 1;

    if (before.used + requested > before.limit) {
      throw createWardrobeCapacityExceeded({ capacity: before, requested });
    }
    if (options.failAfterGate) {
      throw new Error('insert failed');
    }

    for (let index = 0; index < requested; index += 1) {
      tx.insertActive();
    }

    return toCapacityApi(buildWardrobeCapacity({
      ...entitlement,
      used: tx.countActive(),
    }));
  });
}

test('web runtime gate allows item 200 and blocks item 201', async () => {
  const store = new MockWardrobeStore(Array.from({ length: 199 }, () => 'active'));

  const capacity = await createClothingWithGate(store);

  assert.equal(capacity.used, 200);
  assert.equal(capacity.remaining, 0);
  assert.equal(capacity.canAdd, false);
  await assert.rejects(
    () => createClothingWithGate(store),
    (error) => {
      assert.equal(error.code, WARDROBE_CAPACITY_EXCEEDED);
      assert.equal(error.details.requested, 1);
      assert.equal(error.details.capacity.used, 200);
      return true;
    },
  );
  assert.equal(store.countActive(), 200);
});

test('web runtime gate rolls back when insert fails after capacity check', async () => {
  const store = new MockWardrobeStore(Array.from({ length: 199 }, () => 'active'));

  await assert.rejects(() => createClothingWithGate(store, { failAfterGate: true }), /insert failed/);

  assert.equal(store.countActive(), 199);
});

test('web runtime gate serializes concurrent creates against the active count', async () => {
  const store = new MockWardrobeStore(Array.from({ length: 199 }, () => 'active'));

  const results = await Promise.allSettled([
    createClothingWithGate(store),
    createClothingWithGate(store),
  ]);

  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  assert.equal(store.countActive(), 200);
});

test('web runtime capacity counts only active clothes and archive releases capacity', async () => {
  const store = new MockWardrobeStore(['active', 'archived', 'deleted', 'draft']);
  const before = toCapacityApi(buildWardrobeCapacity({
    ...resolveWardrobeEntitlement(),
    used: store.countActive(),
  }));

  await store.transaction(async (tx) => {
    tx.archiveFirstActive();
  });
  const after = toCapacityApi(buildWardrobeCapacity({
    ...resolveWardrobeEntitlement(),
    used: store.countActive(),
  }));

  assert.deepEqual(before, {
    plan: 'free',
    used: 1,
    limit: 200,
    remaining: 199,
    canAdd: true,
    total: 200,
  });
  assert.deepEqual(after, {
    plan: 'free',
    used: 0,
    limit: 200,
    remaining: 200,
    canAdd: true,
    total: 200,
  });
});

test('web runtime capacity API shape preserves legacy total and clamps remaining', () => {
  assert.deepEqual(toCapacityApi(buildWardrobeCapacity({ used: 250, plan: 'free', limit: 200 })), {
    plan: 'free',
    used: 250,
    limit: 200,
    remaining: 0,
    canAdd: false,
    total: 200,
  });
});
