export interface RecommendationInputIdentityParts {
  userRuntimeKey?: string;
  sceneKey?: string;
  date?: string;
  timeOfDay?: string;
  weatherFingerprint?: string;
  wardrobeVersion?: string | number;
  profileVersion?: string | number;
  recommendationBatchId?: string;
  excludedOutfitKeys?: string[];
  requestKind?: string;
}

export function buildRecommendationInputIdentity(input?: RecommendationInputIdentityParts): string;
