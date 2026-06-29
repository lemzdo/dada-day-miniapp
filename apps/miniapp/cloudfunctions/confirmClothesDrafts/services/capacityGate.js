const crypto = require('crypto');
const {
  buildWardrobeCapacity,
  isActiveClothing,
  resolveWardrobeEntitlement,
} = require('./wardrobeCapacity');

const WARDROBE_CAPACITY_BUSY = 'WARDROBE_CAPACITY_BUSY';
const WARDROBE_CAPACITY_EXCEEDED = 'WARDROBE_CAPACITY_EXCEEDED';
const LOCK_TTL_MS = 30 * 1000;

function getDraftsThatNeedNewClothes({ drafts, selectedIds, existingClothes }) {
  const selected = new Set(Array.isArray(selectedIds) ? selectedIds.filter(Boolean) : []);
  const existingIds = new Set();
  const existingSourceIds = new Set();
  for (const clothing of Array.isArray(existingClothes) ? existingClothes : []) {
    if (!isActiveClothing(clothing)) continue;
    if (clothing._id) existingIds.add(clothing._id);
    if (clothing.sourceItemId) existingSourceIds.add(clothing.sourceItemId);
  }

  return (Array.isArray(drafts) ? drafts : []).filter((draft) => {
    if (!draft || draft.status !== 'pending') return false;
    if (!selected.has(draft._id)) return false;
    if (existingIds.has(draft._id)) return false;
    if (existingSourceIds.has(draft._id)) return false;
    return true;
  });
}

function buildCapacityExceededResult({ capacity, requested }) {
  const safeRequested = Math.max(0, Math.floor(Number(requested) || 0));
  const message = capacity.used >= capacity.limit
    ? `当前衣橱已有 ${capacity.used} 件，已达到容量上限 ${capacity.limit} 件。已有衣服不会受影响，但暂时无法继续添加。`
    : `衣橱还可放入 ${capacity.remaining} 件，本次选择了 ${safeRequested} 件，请减少后再保存`;

  return {
    ok: false,
    code: WARDROBE_CAPACITY_EXCEEDED,
    message,
    capacity,
    requested: safeRequested,
  };
}

function createCapacityBusyError(message = '正在保存另一批衣服，请稍后再试') {
  const error = new Error(message);
  error.code = WARDROBE_CAPACITY_BUSY;
  error.businessCode = WARDROBE_CAPACITY_BUSY;
  return error;
}

function createCapacityExceededError(result) {
  const error = new Error(result.message);
  error.code = WARDROBE_CAPACITY_EXCEEDED;
  error.businessCode = WARDROBE_CAPACITY_EXCEEDED;
  error.capacityResult = result;
  return error;
}

function resolveLockState(userDoc = {}, owner, nowMs = Date.now()) {
  const currentOwner = typeof userDoc.wardrobeCapacityLockOwner === 'string'
    ? userDoc.wardrobeCapacityLockOwner
    : '';
  const expiresAtMs = Date.parse(userDoc.wardrobeCapacityLockExpiresAt || '');

  if (!currentOwner) return { action: 'acquire' };
  if (currentOwner === owner) return { action: 'renew' };
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) return { action: 'takeover' };
  return { action: 'busy' };
}

function buildLockPatch(owner, nowMs = Date.now(), ttlMs = LOCK_TTL_MS) {
  const now = new Date(nowMs).toISOString();
  return {
    wardrobeCapacityLockOwner: owner,
    wardrobeCapacityLockAcquiredAt: now,
    wardrobeCapacityLockHeartbeatAt: now,
    wardrobeCapacityLockExpiresAt: new Date(nowMs + ttlMs).toISOString(),
  };
}

function buildHeartbeatPatch(owner, nowMs = Date.now(), ttlMs = LOCK_TTL_MS) {
  return {
    wardrobeCapacityLockOwner: owner,
    wardrobeCapacityLockHeartbeatAt: new Date(nowMs).toISOString(),
    wardrobeCapacityLockExpiresAt: new Date(nowMs + ttlMs).toISOString(),
  };
}

function buildReleasePatch() {
  return {
    wardrobeCapacityLockOwner: '',
    wardrobeCapacityLockAcquiredAt: '',
    wardrobeCapacityLockHeartbeatAt: '',
    wardrobeCapacityLockExpiresAt: '',
  };
}

function shouldReleaseCapacityLock(userDoc = {}, owner) {
  return Boolean(owner && userDoc.wardrobeCapacityLockOwner === owner);
}

function createLockOwner() {
  return crypto.randomBytes(16).toString('hex');
}

function createInMemoryCapacityGate({ used = 0, limit = 200, nowMs = Date.now() } = {}) {
  let state = {
    used,
    limit,
    lock: {},
    nowMs,
  };

  return {
    advanceMs(ms) {
      state.nowMs += ms;
    },
    getUsed() {
      return state.used;
    },
    getLock() {
      return { ...state.lock };
    },
    acquire(owner) {
      const lockState = resolveLockState(state.lock, owner, state.nowMs);
      if (lockState.action === 'busy') return { ok: false, code: WARDROBE_CAPACITY_BUSY };
      state.lock = { ...state.lock, ...buildLockPatch(owner, state.nowMs) };
      return { ok: true, owner, action: lockState.action };
    },
    release(owner) {
      if (shouldReleaseCapacityLock(state.lock, owner)) {
        state.lock = { ...state.lock, ...buildReleasePatch() };
      }
    },
    async run({ owner, requested, work }) {
      const lease = this.acquire(owner);
      if (!lease.ok) throw createCapacityBusyError();
      try {
        const capacity = buildWardrobeCapacity({ used: state.used, ...resolveWardrobeEntitlement(), limit: state.limit });
        if (capacity.used + requested > capacity.limit) {
          throw createCapacityExceededError(buildCapacityExceededResult({ capacity, requested }));
        }
        const result = await work({
          heartbeat: () => {
            state.lock = { ...state.lock, ...buildHeartbeatPatch(owner, state.nowMs) };
          },
        });
        state.used += requested;
        return result;
      } finally {
        this.release(owner);
      }
    },
  };
}

module.exports = {
  LOCK_TTL_MS,
  WARDROBE_CAPACITY_BUSY,
  WARDROBE_CAPACITY_EXCEEDED,
  buildCapacityExceededResult,
  buildHeartbeatPatch,
  buildLockPatch,
  buildReleasePatch,
  createCapacityBusyError,
  createCapacityExceededError,
  createInMemoryCapacityGate,
  createLockOwner,
  getDraftsThatNeedNewClothes,
  resolveLockState,
  shouldReleaseCapacityLock,
};
