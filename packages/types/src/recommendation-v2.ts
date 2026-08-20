import type { ClothingCategory, SceneTag } from './clothes';
import type { TimeOfDay } from './outfit';
import type { WeatherSnapshot } from './weather';

export const RECOMMENDATION_V2_VERSION = 'recommendation-v2' as const;
export const RECOMMENDATION_V2_CARD_COUNT = 8 as const;

export interface HomeLightItemV2 {
  clothingId: string;
  thumbnailUrl: string;
  imageUrl?: string;
  isDeleted: boolean;
}

export interface HomeLightCardV2 {
  referenceId: string;
  outfitKey: string;
  position: number;
  displayTitle: string;
  todayReason: string;
  styleTags: string[];
  clothingIds: string[];
  items: HomeLightItemV2[];
  isFavorite: boolean;
  isWornToday: boolean;
}

export interface HomeLightPayloadV2 {
  version: typeof RECOMMENDATION_V2_VERSION;
  batchId: string;
  cards: HomeLightCardV2[];
}

export interface RecommendationBatchCoreV2 {
  version: typeof RECOMMENDATION_V2_VERSION;
  batchId: string;
  commitToken: string;
  contentHash: string;
  scene: SceneTag | string;
  date: string;
  timeOfDay: TimeOfDay;
  weather: WeatherSnapshot;
  inputIdentityHash: string;
  generatedAt: string;
  countContract: { expected: 8; actual: 8 };
  notice?: string;
  cardCount: 8;
  order: string[];
}

export interface RecommendationOutfitRefV2 {
  version: typeof RECOMMENDATION_V2_VERSION;
  batchId: string;
  outfitKey: string;
  referenceId: string;
  position: number;
  clothingIds: string[];
  category?: ClothingCategory | string;
}

export interface RecommendationHomeLightResponseV2 {
  kind: 'home-light';
  version: typeof RECOMMENDATION_V2_VERSION;
  batch: RecommendationBatchCoreV2;
  light: HomeLightPayloadV2;
}

export interface RecommendationDetailResponseV2 {
  kind: 'detail';
  version: typeof RECOMMENDATION_V2_VERSION;
  batchId: string;
  outfitKey: string;
  detailIdentityReady: true;
  persistedDetailDocumentReady: boolean;
  detail: Record<string, unknown>;
}

export type RecommendationV2Response = RecommendationHomeLightResponseV2 | RecommendationDetailResponseV2;
