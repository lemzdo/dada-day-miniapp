import type {
  HomeLightCardV2,
  RecommendationBatchCoreV2,
  RecommendationHomeLightResponseV2,
} from '@starter-template/types';
import { TODAY_V2_SNAPSHOT_KEY } from '@/lib/recommendationInputKeys';

export { TODAY_V2_SNAPSHOT_KEY } from '@/lib/recommendationInputKeys';

export interface TodayV2Snapshot {
  runtimeVersion: 'today-runtime-v2';
  schemaVersion: 'today-v2';
  inputIdentity: string;
  batchId: string;
  core: RecommendationBatchCoreV2;
  cards: HomeLightCardV2[];
  savedAt: string;
}

export function toTodayV2Snapshot(
  response: RecommendationHomeLightResponseV2,
  inputIdentity: string,
): TodayV2Snapshot {
  response.light.cards.forEach((card) => {
    if (card.items.length === 0 || card.items.some((item) => item.isDeleted || !item.displayImageUrl.trim())) {
      throw new Error('V2 home light image contract invalid');
    }
  });
  return {
    runtimeVersion: response.runtimeVersion,
    schemaVersion: response.schemaVersion,
    inputIdentity,
    batchId: response.batch.batchId,
    core: response.batch,
    cards: response.light.cards.map((card) => ({
      referenceId: card.referenceId,
      outfitKey: card.outfitKey,
      position: card.position,
      displayTitle: card.displayTitle,
      todayReason: card.todayReason,
      styleTags: [...card.styleTags],
      clothingIds: [...card.clothingIds],
      items: card.items.map((item) => ({
        clothingId: item.clothingId,
        displayImageUrl: item.displayImageUrl,
        isDeleted: item.isDeleted,
      })),
      isFavorite: card.isFavorite,
      isWornToday: card.isWornToday,
      copySource: card.copySource,
      aiState: card.aiState,
      canonicalAvailableAt: card.canonicalAvailableAt,
    })),
    savedAt: new Date().toISOString(),
  };
}

export function readTodayV2Snapshot(
  read: (key: string) => unknown,
  expectedInputIdentity?: string,
): TodayV2Snapshot | null {
  const value = read(TODAY_V2_SNAPSHOT_KEY);
  if (!value || typeof value !== 'object') return null;
  const snapshot = value as Partial<TodayV2Snapshot>;
  if (snapshot.runtimeVersion !== 'today-runtime-v2'
    || snapshot.schemaVersion !== 'today-v2'
    || typeof snapshot.inputIdentity !== 'string'
    || !snapshot.inputIdentity
    || (expectedInputIdentity !== undefined && snapshot.inputIdentity !== expectedInputIdentity)
    || typeof snapshot.batchId !== 'string'
    || !snapshot.core || snapshot.core.batchId !== snapshot.batchId
    || !Number.isInteger(snapshot.core.cardCount) || snapshot.core.cardCount < 1 || snapshot.core.cardCount > 8
    || snapshot.core.countContract?.requestedCardCount !== 8
    || snapshot.core.countContract?.returnedCardCount !== snapshot.core.cardCount
    || typeof snapshot.core.countContract?.limited !== 'boolean'
    || typeof snapshot.core.countContract?.exhausted !== 'boolean'
    || snapshot.core.countContract.limited !== (snapshot.core.cardCount < 8)
    || (snapshot.core.cardCount < 8 && snapshot.core.countContract.exhausted !== true)
    || !Array.isArray(snapshot.core.order)
    || snapshot.core.order.length !== snapshot.core.cardCount
    || new Set(snapshot.core.order).size !== snapshot.core.cardCount
    || snapshot.core.order.some((key, index) => key !== snapshot.cards?.[index]?.outfitKey)
    || !Array.isArray(snapshot.cards)
    || snapshot.cards.length !== snapshot.core.cardCount
    || snapshot.cards.some((card) => !Array.isArray(card.items) || card.items.length === 0
      || card.items.some((item) => item.isDeleted || typeof item.displayImageUrl !== 'string' || !item.displayImageUrl.trim()))) return null;
  const forbidden = ['snapshotItems', 'itemsSnapshot', 'scores', 'eligibility', 'copyContract', 'debug', 'evidence', 'thumbnailUrl', 'imageUrl'];
  const scan = (entry: unknown): boolean => {
    if (!entry || typeof entry !== 'object') return false;
    return Object.entries(entry).some(([key, value]) => forbidden.includes(key) || scan(value));
  };
  if (scan(snapshot)) return null;
  return snapshot as TodayV2Snapshot;
}

export function writeTodayV2Snapshot(
  response: RecommendationHomeLightResponseV2,
  inputIdentity: string,
  write: (key: string, value: TodayV2Snapshot) => void,
) {
  const snapshot = toTodayV2Snapshot(response, inputIdentity);
  if (snapshot.cards.length === 0) return null;
  write(TODAY_V2_SNAPSHOT_KEY, snapshot);
  return snapshot;
}

export function patchTodayV2CardStatus(
  snapshot: TodayV2Snapshot,
  patch: { batchId: string; outfitKey: string; isFavorite?: boolean; isWornToday?: boolean },
): TodayV2Snapshot {
  if (snapshot.batchId !== patch.batchId) return snapshot;
  return {
    ...snapshot,
    cards: snapshot.cards.map((card) => card.outfitKey === patch.outfitKey
      ? {
        ...card,
        ...(patch.isFavorite === undefined ? {} : { isFavorite: patch.isFavorite }),
        ...(patch.isWornToday === undefined ? {} : { isWornToday: patch.isWornToday }),
      }
      : card),
  };
}
