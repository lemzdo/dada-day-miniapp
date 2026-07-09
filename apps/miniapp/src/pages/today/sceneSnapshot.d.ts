import type { Outfit } from '@starter-template/types';

export const TODAY_SCENE_COPY_VERSION: string;

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
  recommendationNotice?: string;
  generatedAt?: number;
}

export function buildSceneSnapshotKey(input?: SceneSnapshotKeyInput): string;
export function shouldUseSceneSnapshot(snapshot: SceneSnapshot | null | undefined, expected: { key: string } | null | undefined): boolean;
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
  recommendationNotice: string;
};
