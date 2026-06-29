const WARDROBE_LIMITS = {
  free: 200,
  member: 500,
  premium: 1000,
};

const WARDROBE_RUNTIME_SIGNATURE = 'wardrobe-capacity-v1:free200-member500-premium1000';

function normalizeWardrobePlan(value) {
  return value === 'member' || value === 'premium' || value === 'free' ? value : 'free';
}

function normalizeNonNegativeInteger(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return Math.floor(number);
}

function resolveWardrobeEntitlement() {
  return {
    plan: 'free',
    limit: WARDROBE_LIMITS.free,
  };
}

function buildWardrobeCapacity(input = {}) {
  const plan = normalizeWardrobePlan(input.plan);
  const fallbackLimit = WARDROBE_LIMITS[plan] || WARDROBE_LIMITS.free;
  const limit = normalizeNonNegativeInteger(input.limit, fallbackLimit) || fallbackLimit;
  const used = normalizeNonNegativeInteger(input.used, 0);
  const remaining = Math.max(0, limit - used);
  return {
    plan,
    used,
    limit,
    remaining,
    canAdd: used < limit,
  };
}

function isActiveClothing(item) {
  if (!item || typeof item !== 'object') return false;
  const status = item.status;
  return status === undefined || status === null || status === '' || status === 'active';
}

module.exports = {
  WARDROBE_LIMITS,
  WARDROBE_RUNTIME_SIGNATURE,
  buildWardrobeCapacity,
  isActiveClothing,
  normalizeNonNegativeInteger,
  normalizeWardrobePlan,
  resolveWardrobeEntitlement,
};
