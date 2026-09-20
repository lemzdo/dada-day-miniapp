import type { HomeLightCardV2, Outfit, RecommendationDetailResponseV2 } from '@starter-template/types';

export type OutfitDetailV2LoadState = 'LOADING' | 'READY' | 'NOT_FOUND' | 'REMOTE_ERROR';

export interface OutfitDetailV2Identity {
  batchId: string;
  outfitKey: string;
  referenceId: string;
}

export interface OutfitDetailV2State {
  batchId: string;
  outfitKey: string;
  referenceId: string;
  shell: HomeLightCardV2;
  detail: RecommendationDetailResponseV2['detail'] | null;
  outfit: Outfit | null;
  detailIdentityReady: true;
  persistedDetailDocumentReady: boolean;
  loading: boolean;
  loadState: OutfitDetailV2LoadState;
  errorCode?: string;
}

export function createOutfitDetailV2State(card: HomeLightCardV2): OutfitDetailV2State {
  return {
    batchId: '',
    outfitKey: card.outfitKey,
    referenceId: card.referenceId,
    shell: card,
    detail: null,
    outfit: null,
    detailIdentityReady: true,
    persistedDetailDocumentReady: false,
    loading: true,
    loadState: 'LOADING',
  };
}

export function beginOutfitDetailV2Load(state: OutfitDetailV2State, batchId: string): OutfitDetailV2State {
  return { ...state, batchId, loading: true, loadState: 'LOADING', errorCode: undefined };
}

export function applyOutfitDetailV2Load(
  state: OutfitDetailV2State,
  response: RecommendationDetailResponseV2,
): OutfitDetailV2State {
  if (response.batchId !== state.batchId
    || response.outfitKey !== state.outfitKey
    || response.referenceId !== state.referenceId) return state;
  const outfit = buildFormalOutfitV2(response, state.shell);
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
    outfit,
    detailIdentityReady: true,
    persistedDetailDocumentReady: response.persistedDetailDocumentReady,
    loading: false,
    loadState: 'READY',
    errorCode: undefined,
  };
}

export function failOutfitDetailV2Load(
  state: OutfitDetailV2State,
  errorCode: string,
): OutfitDetailV2State {
  return {
    ...state,
    loading: false,
    loadState: isOutfitDetailV2NotFoundCode(errorCode) ? 'NOT_FOUND' : 'REMOTE_ERROR',
    errorCode,
  };
}

export function patchOutfitDetailV2Status(
  state: OutfitDetailV2State,
  patch: { isFavorite?: boolean; isWornToday?: boolean },
): OutfitDetailV2State {
  return {
    ...state,
    shell: { ...state.shell, ...patch },
    outfit: state.outfit ? { ...state.outfit, ...patch } : state.outfit,
  };
}

export function buildFormalOutfitV2(
  response: RecommendationDetailResponseV2,
  shell?: HomeLightCardV2,
): Outfit {
  const detail = response.detail;
  const styleTags = detail.styleTags.length > 0 ? detail.styleTags : shell?.styleTags || [];
  const reason = detail.todayReason
    || shell?.todayReason
    || (styleTags[0]
      ? `${styleTags[0]}风格线索来自这套搭配的真实单品，整体组合清楚且适合当前场景。`
      : `这套搭配由${detail.items.length}件真实单品组成，详情保留当前推荐的完整组合。`);
  return {
    id: detail.referenceId,
    userId: '',
    ...(detail.outfitId ? { outfitId: detail.outfitId } : {}),
    title: detail.displayTitle || shell?.displayTitle || '',
    displayTitle: detail.displayTitle || shell?.displayTitle || '',
    ...(detail.userTitle ? { userTitle: detail.userTitle } : {}),
    clothingIds: [...detail.clothingIds],
    outfitKey: detail.outfitKey,
    outfitKind: 'recommendation',
    itemsSnapshot: detail.items.map((item) => ({ ...item })),
    incomplete: detail.incomplete,
    deletedItemCount: detail.deletedItemCount,
    ...(detail.scene ? { scene: detail.scene } : {}),
    ...(detail.targetDate ? { targetDate: detail.targetDate } : {}),
    ...(detail.timeOfDay ? { timeOfDay: detail.timeOfDay } : {}),
    ...(detail.weatherSnapshot ? { weatherSnapshot: detail.weatherSnapshot } : {}),
    ...(detail.weatherMode ? { weatherMode: detail.weatherMode } : {}),
    recommendationBatchId: detail.recommendationBatchId,
    styleTags: [...styleTags],
    isFavorite: detail.isFavorite,
    isWornToday: detail.isWornToday,
    source: 'recommend',
    reason,
    reasoning: reason,
    reasonVersion: 'recommendation-detail-v2-safe-v1',
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt,
  };
}

export function isOutfitDetailV2NotFoundCode(errorCode: string): boolean {
  return errorCode === 'V2_BATCH_ENVELOPE_INVALID'
    || errorCode === 'V2_OUTFIT_REFERENCE_NOT_FOUND';
}
