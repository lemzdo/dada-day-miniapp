import type { SceneTag } from './clothes';
import type { TimeOfDay } from './outfit';
import type { WeatherMode, WeatherSnapshot } from './weather';

export const RECOMMENDATION_V2_RUNTIME_VERSION = 'today-runtime-v2' as const;
export const RECOMMENDATION_V2_SCHEMA_VERSION = 'today-v2' as const;
export const RECOMMENDATION_V2_CARD_COUNT = 8 as const;

export interface HomeLightItemV2 {
  clothingId: string;
  displayImageUrl: string;
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
  copySource?: 'safe' | 'ai_cache';
  aiState?: 'materializing' | 'ready' | 'failed';
  canonicalAvailableAt?: string;
}

export interface RecommendationCanonicalOverlayCopyV2 {
  outfitKey: string;
  cardIndex: number;
  text: string;
  source: 'ai_cache';
  availableAt: string;
  rendererVersion: string;
}

export interface RecommendationCanonicalOverlayV2 {
  version: string;
  rendererVersion: string;
  batchId: string;
  status: 'not_found' | 'pending' | 'partial' | 'ready';
  expectedCount?: number;
  readyCount?: number;
  jobStage?: string;
  copies: RecommendationCanonicalOverlayCopyV2[];
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
  countContract: { requestedCardCount: 8; returnedCardCount: number; limited: boolean; exhausted: boolean };
  notice?: string;
  cardCount: number;
  order: string[];
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
  canonicalCopy?: RecommendationCanonicalOverlayCopyV2;
}

export type RecommendationV2Response = RecommendationHomeLightResponseV2 | RecommendationDetailResponseV2;
