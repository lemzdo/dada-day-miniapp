import type { WardrobePlan } from '@starter-template/types';

export const WARDROBE_LIMITS: Record<WardrobePlan, number> = {
  free: 200,
  member: 500,
  premium: 1000,
};

export const DEFAULT_WARDROBE_LIMIT = WARDROBE_LIMITS.free;
