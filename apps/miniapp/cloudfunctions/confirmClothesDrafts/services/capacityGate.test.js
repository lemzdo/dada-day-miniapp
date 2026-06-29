const assert = require('node:assert/strict');
const test = require('node:test');

const {
  WARDROBE_CAPACITY_BUSY,
  WARDROBE_CAPACITY_EXCEEDED,
  buildCapacityExceededResult,
  createInMemoryCapacityGate,
  getDraftsThatNeedNewClothes,
  resolveLockState,
  shouldReleaseCapacityLock,
} = require('./capacityGate');

test('requested excludes confirmed drafts and existing sourceItemId clothes', () => {
  const drafts = [
    { _id: 'draft-1', status: 'pending' },
    { _id: 'draft-2', status: 'confirmed' },
    { _id: 'draft-3', status: 'pending' },
    { _id: 'draft-4', status: 'pending' },
  ];
  const existingClothes = [
    { _id: 'cloth-3', sourceItemId: 'draft-3', status: 'active' },
    { _id: 'draft-4', sourceItemId: 'legacy', status: 'active' },
  ];

  const result = getDraftsThatNeedNewClothes({
    drafts,
    selectedIds: ['draft-1', 'draft-2', 'draft-3', 'draft-4', 'missing'],
    existingClothes,
  });

  assert.deepEqual(result.map((draft) => draft._id), ['draft-1']);
});

test('capacity exceeded response preserves drafts by failing before writes', () => {
  const result = buildCapacityExceededResult({
    capacity: { plan: 'free', used: 199, limit: 200, remaining: 1, canAdd: true },
    requested: 2,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, WARDROBE_CAPACITY_EXCEEDED);
  assert.equal(result.requested, 2);
  assert.equal(result.capacity.remaining, 1);
  assert.match(result.message, /衣橱还可放入 1 件/);
});

test('capacity exceeded message handles already-over-limit users', () => {
  const result = buildCapacityExceededResult({
    capacity: { plan: 'free', used: 250, limit: 200, remaining: 0, canAdd: false },
    requested: 1,
  });

  assert.match(result.message, /当前衣橱已有 250 件/);
  assert.match(result.message, /容量上限 200 件/);
});

test('active locks are busy, stale locks are takeover candidates, own locks are renewable', () => {
  const nowMs = Date.parse('2026-06-29T08:00:00.000Z');
  assert.equal(resolveLockState({}, 'owner-a', nowMs).action, 'acquire');
  assert.equal(resolveLockState({ wardrobeCapacityLockOwner: 'owner-a', wardrobeCapacityLockExpiresAt: '2026-06-29T08:01:00.000Z' }, 'owner-a', nowMs).action, 'renew');
  assert.equal(resolveLockState({ wardrobeCapacityLockOwner: 'owner-b', wardrobeCapacityLockExpiresAt: '2026-06-29T08:01:00.000Z' }, 'owner-a', nowMs).action, 'busy');
  assert.equal(resolveLockState({ wardrobeCapacityLockOwner: 'owner-b', wardrobeCapacityLockExpiresAt: '2026-06-29T07:59:59.000Z' }, 'owner-a', nowMs).action, 'takeover');
});

test('old owners cannot release a newer owner lock', () => {
  assert.equal(shouldReleaseCapacityLock({ wardrobeCapacityLockOwner: 'new-owner' }, 'old-owner'), false);
  assert.equal(shouldReleaseCapacityLock({ wardrobeCapacityLockOwner: 'same-owner' }, 'same-owner'), true);
});

test('in-memory gate serializes concurrent batches without exceeding 200', async () => {
  const gate = createInMemoryCapacityGate({ used: 199, limit: 200 });
  const [a, b] = await Promise.allSettled([
    gate.run({ owner: 'a', requested: 1, work: async () => 'a-ok' }),
    gate.run({ owner: 'b', requested: 1, work: async () => 'b-ok' }),
  ]);

  const fulfilled = [a, b].filter((item) => item.status === 'fulfilled');
  const rejected = [a, b].filter((item) => item.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(gate.getUsed(), 200);
});

test('busy gate returns retryable busy code and does not bypass capacity', async () => {
  const gate = createInMemoryCapacityGate({ used: 198, limit: 200 });
  const lease = gate.acquire('a');
  assert.equal(lease.ok, true);

  const result = await assert.rejects(
    () => gate.run({ owner: 'b', requested: 2, work: async () => 'b-ok' }),
    (error) => {
      assert.equal(error.code, WARDROBE_CAPACITY_BUSY);
      return true;
    },
  );
  assert.equal(result, undefined);
  assert.equal(gate.getUsed(), 198);
});

test('heartbeat extends expiry and finally releases own lock after ordinary failures', async () => {
  const gate = createInMemoryCapacityGate({ used: 0, limit: 200, nowMs: Date.parse('2026-06-29T08:00:00.000Z') });
  await assert.rejects(
    () => gate.run({
      owner: 'a',
      requested: 1,
      work: async ({ heartbeat }) => {
        const before = gate.getLock().wardrobeCapacityLockExpiresAt;
        gate.advanceMs(20_000);
        heartbeat();
        assert.notEqual(gate.getLock().wardrobeCapacityLockExpiresAt, before);
        throw new Error('boom');
      },
    }),
    /boom/,
  );
  assert.equal(gate.getLock().wardrobeCapacityLockOwner, '');
});
