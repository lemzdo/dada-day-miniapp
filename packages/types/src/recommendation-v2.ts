import type { SceneTag } from './clothes';
import type { TimeOfDay } from './outfit';
import type { WeatherMode, WeatherSnapshot } from './weather';

export const RECOMMENDATION_V2_RUNTIME_VERSION = 'today-runtime-v2' as const;
export const RECOMMENDATION_V2_SCHEMA_VERSION = 'today-v2' as const;
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
  runtimeVersion: typeof RECOMMENDATION_V2_RUNTIME_VERSION;
  schemaVersion: typeof RECOMMENDATION_V2_SCHEMA_VERSION;
  batchId: string;
  cards: HomeLightCardV2[];
}

export interface RecommendationBatchCoreV2 {
  runtimeVersion: typeof RECOMMENDATION_V2_RUNTIME_VERSION;
  schemaVersion: typeof RECOMMENDATION_V2_SCHEMA_VERSION;
  batchId: string;
  commitToken: string;
  contentHash: string;
  sceneKey: string;
  scene: SceneTag | string;
  targetDate: string;
  timeOfDay: TimeOfDay;
  weatherMode: WeatherMode | string;
  weatherSnapshot: WeatherSnapshot;
  weatherFingerprint: string;
  inputIdentityHash: string;
  generatedAt: string;
  countContract: { requestedCardCount: 8; returnedCardCount: 8; limited: boolean; exhausted: boolean };
  notice?: string;
  cardCount: 8;
  order: string[];
}

export interface RecommendationOutfitRefV2 {
  runtimeVersion: typeof RECOMMENDATION_V2_RUNTIME_VERSION;
  schemaVersion: typeof RECOMMENDATION_V2_SCHEMA_VERSION;
  latestBatchId: string;
  outfitKey: string;
  referenceId: string;
  latestPosition: number;
  clothingIds: string[];
}

export interface RecommendationHomeLightResponseV2 {
  runtimeVersion: typeof RECOMMENDATION_V2_RUNTIME_VERSION;
  schemaVersion: typeof RECOMMENDATION_V2_SCHEMA_VERSION;
  batch: RecommendationBatchCoreV2;
  light: HomeLightPayloadV2;
}

export interface RecommendationDetailResponseV2 {
  runtimeVersion: typeof RECOMMENDATION_V2_RUNTIME_VERSION;
  schemaVersion: typeof RECOMMENDATION_V2_SCHEMA_VERSION;
  batchId: string;
  outfitKey: string;
  detailIdentityReady: true;
  persistedDetailDocumentReady: boolean;
  detail: Record<string, unknown>;
}

export type RecommendationV2Response = RecommendationHomeLightResponseV2 | RecommendationDetailResponseV2;
