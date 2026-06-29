const WARDROBE_LIMITS = {
  free: 200,
  member: 500,
  premium: 1000,
};

const WARDROBE_RUNTIME_SIGNATURE = 'wardrobe-capacity-v1:free200-member500-premium1000';

function resolveWardrobeEntitlement() {
  return {
    plan: 'free',
    limit: WARDROBE_LIMITS.free,
  };
}

function normalizeCapacityTotal(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= WARDROBE_LIMITS.free) return WARDROBE_LIMITS.free;
  return Math.floor(number);
}

module.exports = {
  WARDROBE_LIMITS,
  WARDROBE_RUNTIME_SIGNATURE,
  normalizeCapacityTotal,
  resolveWardrobeEntitlement,
};
