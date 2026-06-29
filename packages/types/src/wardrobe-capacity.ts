export type WardrobePlan = 'free' | 'member' | 'premium';

export const WARDROBE_LIMITS = {
  free: 200,
  member: 500,
  premium: 1000,
} as const;

export interface WardrobeCapacity {
  plan: WardrobePlan;
  used: number;
  limit: number;
  remaining: number;
  canAdd: boolean;
}

export interface WardrobeCapacityExceededDetails {
  code: 'WARDROBE_CAPACITY_EXCEEDED';
  capacity: WardrobeCapacity;
  requested: number;
}
