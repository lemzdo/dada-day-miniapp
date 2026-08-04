import type { Outfit, RecommendationCountContract } from '@starter-template/types';

export interface SceneItem {
  key: string;
  label: string;
}

export interface RecommendationRequestContextLike {
  requestSeq: number;
  sceneKey: string;
  sceneLabel: string;
  weatherMode: string;
  requestedAt: number;
}

export type SceneContractValidation =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'STALE_REQUEST_SEQ'
        | 'ACTIVE_SCENE_CHANGED'
        | 'MISSING_RESPONSE_SCENE_KEY'
        | 'UNKNOWN_RESPONSE_SCENE_KEY'
        | 'RESPONSE_SCENE_MISMATCH';
      requestSeq: number;
      currentSeq: number;
      requestSceneKey: string;
      currentSceneKey: string;
      responseSceneKey: unknown;
      responseScene: unknown;
    };

export declare const DEFAULT_SCENES: SceneItem[];

export declare function normalizeScene(scene: string | undefined, scenes?: readonly SceneItem[]): string | null;

export declare function validateSceneContract(
  requestContext: RecommendationRequestContextLike,
  data: { sceneKey?: unknown; scene?: unknown },
  currentRequestSeq: number,
  currentSceneKey: string,
): SceneContractValidation;

export type RecommendationCountContractValidation =
  | { ok: true }
  | { ok: false; reason: 'MISSING_COUNT_CONTRACT' | 'INVALID_COUNT_CONTRACT' | 'COUNT_CONTRACT_MISMATCH'; contract?: RecommendationCountContract; returnedCardCount: number };

export declare function validateRecommendationCountContract(
  data: { outfits?: Outfit[]; countContract?: RecommendationCountContract },
): RecommendationCountContractValidation;
