import type { Outfit, RecommendationCountContract, WeatherMode } from '@starter-template/types';

export const TODAY_SCENE_COPY_VERSION: 'recommendation-copy-contract-v3';
export const TODAY_SCENE_VOICE_VERSION: 'xiaoda-fixed-claim-catalog-v2';
export const TODAY_SCENE_SNAPSHOT_TTL_MS: number;

export interface SceneSnapshotKeyInput {
  userRuntimeKey?: string;
  date?: string;
  timeOfDay?: string;
  scene?: string;
  weatherFingerprint?: string;
  wardrobeVersion?: string;
  profileVersion?: string;
  reasonVersion?: string;
  copyVersion?: string;
}

export interface SceneSnapshot {
  key: string;
  outfits: Outfit[];
  currentIndex?: number;
  hasRecommendations?: boolean;
  recommendationBatchId?: string;
  batchLimited?: boolean;
  batchExhausted?: boolean;
  noMoreRecommendations?: boolean;
  countContract?: RecommendationCountContract;
  lastVisibleBatch?: {
    recommendationBatchId: string;
    outfitKeys: string[];
    returnedCardCount: number;
  } | null;
  recommendationNotice?: string;
  generatedAt?: number;
  weatherMode?: WeatherMode;
}

export function buildSceneSnapshotKey(input?: SceneSnapshotKeyInput): string;
export function buildExhaustedSnapshotState(input?: {
  outfits?: Outfit[];
  currentIndex?: number;
  recommendationBatchId?: string;
  countContract?: RecommendationCountContract | null;
  recommendationNotice?: string;
}): {
  outfits: Outfit[];
  currentIndex: number;
  hasRecommendations: boolean;
  recommendationBatchId: string;
  batchLimited: boolean;
  batchExhausted: boolean;
  noMoreRecommendations: boolean;
  countContract: RecommendationCountContract;
  lastVisibleBatch: SceneSnapshot['lastVisibleBatch'];
  recommendationNotice: string;
} | null;
export function isValidSceneSnapshotCountState(snapshot: Pick<SceneSnapshot,
  'outfits' | 'hasRecommendations' | 'batchExhausted' | 'noMoreRecommendations'
  | 'countContract' | 'lastVisibleBatch' | 'recommendationBatchId'>): boolean;
export function isNoMoreRecommendationState(value: Pick<SceneSnapshot, 'batchExhausted' | 'countContract'>): boolean;
export function shouldUseSceneSnapshot(snapshot: SceneSnapshot | null | undefined, expected: {
  key: string;
  now?: number;
  ttlMs?: number;
} | null | undefined): boolean;
export function chooseSceneTransitionState(input?: {
  currentOutfits?: Outfit[];
  snapshot?: SceneSnapshot | null;
  nextSceneKey?: string;
}): {
  selectedSceneKey: string;
  outfits: Outfit[];
  currentIndex: number;
  hasRecommendations: boolean;
  keepPreviousWhileLoading: boolean;
  recommendationBatchId: string;
  batchLimited: boolean;
  batchExhausted: boolean;
  noMoreRecommendations: boolean;
  countContract?: RecommendationCountContract;
  lastVisibleBatch: SceneSnapshot['lastVisibleBatch'];
  recommendationNotice: string;
};
