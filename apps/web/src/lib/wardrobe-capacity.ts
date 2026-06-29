import type { WardrobeCapacity, WardrobePlan } from '@starter-template/types';

export const WARDROBE_LIMITS = {
  free: 200,
  member: 500,
  premium: 1000,
} as const;

export const WARDROBE_CAPACITY_EXCEEDED = 'WARDROBE_CAPACITY_EXCEEDED';

export interface WardrobeCapacityExceededDetails {
  code: typeof WARDROBE_CAPACITY_EXCEEDED;
  capacity: WardrobeCapacity;
  requested: number;
}

export class WardrobeCapacityError extends Error {
  code = WARDROBE_CAPACITY_EXCEEDED;
  details: WardrobeCapacityExceededDetails;

  constructor(details: WardrobeCapacityExceededDetails, message: string) {
    super(message);
    this.name = 'WardrobeCapacityError';
    this.details = details;
  }
}

export function resolveWardrobeEntitlement(source?: unknown): { plan: WardrobePlan; limit: number } {
  void source;
  return {
    plan: 'free',
    limit: WARDROBE_LIMITS.free,
  };
}

export function buildWardrobeCapacity(input: {
  plan?: WardrobePlan;
  used?: number;
  limit?: number;
}): WardrobeCapacity {
  const plan = input.plan === 'member' || input.plan === 'premium' ? input.plan : 'free';
  const fallbackLimit = WARDROBE_LIMITS[plan];
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

export function createWardrobeCapacityExceeded(input: {
  capacity: WardrobeCapacity;
  requested: number;
}) {
  const requested = normalizeNonNegativeInteger(input.requested, 0);
  const message = input.capacity.used >= input.capacity.limit
    ? `当前衣橱已有 ${input.capacity.used} 件，已达到容量上限 ${input.capacity.limit} 件。已有衣服不会受影响，但暂时无法继续添加。`
    : `衣橱还可放入 ${input.capacity.remaining} 件，本次选择了 ${requested} 件，请减少后再保存`;
  return new WardrobeCapacityError(
    {
      code: WARDROBE_CAPACITY_EXCEEDED,
      capacity: input.capacity,
      requested,
    },
    message,
  );
}

function normalizeNonNegativeInteger(value: unknown, fallback: number) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return Math.floor(number);
}
