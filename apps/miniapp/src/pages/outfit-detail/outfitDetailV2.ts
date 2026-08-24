import type { HomeLightCardV2, RecommendationDetailResponseV2 } from '@starter-template/types';

export interface OutfitDetailV2State {
  batchId: string;
  outfitKey: string;
  referenceId: string;
  shell: HomeLightCardV2;
  detail: RecommendationDetailResponseV2['detail'] | null;
  detailIdentityReady: true;
  persistedDetailDocumentReady: boolean;
  loading: boolean;
}

export function createOutfitDetailV2State(card: HomeLightCardV2): OutfitDetailV2State {
  return {
    batchId: '',
    outfitKey: card.outfitKey,
    referenceId: card.referenceId,
    shell: card,
    detail: null,
    detailIdentityReady: true,
    persistedDetailDocumentReady: false,
    loading: false,
  };
}

export function beginOutfitDetailV2Load(state: OutfitDetailV2State, batchId: string): OutfitDetailV2State {
  return { ...state, batchId, loading: true };
}

export function applyOutfitDetailV2Load(
  state: OutfitDetailV2State,
  response: RecommendationDetailResponseV2,
): OutfitDetailV2State {
  if (response.batchId !== state.batchId || response.outfitKey !== state.outfitKey) return state;
  return {
    ...state,
    shell: response.canonicalCopy
      && response.canonicalCopy.outfitKey === state.outfitKey
      ? {
        ...state.shell,
        todayReason: response.canonicalCopy.text,
        copySource: 'ai_cache',
        aiState: 'ready',
        canonicalAvailableAt: response.canonicalCopy.availableAt,
      }
      : state.shell,
    detail: response.detail,
    detailIdentityReady: true,
    persistedDetailDocumentReady: response.persistedDetailDocumentReady,
    loading: false,
  };
}
