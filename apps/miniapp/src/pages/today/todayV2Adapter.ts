import type {
  HomeLightCardV2,
  RecommendationHomeLightResponseV2,
} from '@starter-template/types';

export const TODAY_V2_SNAPSHOT_KEY = 'd1d:today:v2:home-light';

export interface TodayV2Snapshot {
  runtimeVersion: 'today-runtime-v2';
  schemaVersion: 'today-v2';
  batchId: string;
  cards: HomeLightCardV2[];
  savedAt: string;
}

export function toTodayV2Snapshot(response: RecommendationHomeLightResponseV2): TodayV2Snapshot {
  return {
    runtimeVersion: response.runtimeVersion,
    schemaVersion: response.schemaVersion,
    batchId: response.batch.batchId,
    cards: response.light.cards.map((card) => ({
      referenceId: card.referenceId,
      outfitKey: card.outfitKey,
      position: card.position,
      displayTitle: card.displayTitle,
      todayReason: card.todayReason,
      styleTags: [...card.styleTags],
      clothingIds: [...card.clothingIds],
      items: card.items.map((item) => ({ ...item })),
      isFavorite: card.isFavorite,
      isWornToday: card.isWornToday,
    })),
    savedAt: new Date().toISOString(),
  };
}

export function readTodayV2Snapshot(read: (key: string) => unknown): TodayV2Snapshot | null {
  const value = read(TODAY_V2_SNAPSHOT_KEY);
  if (!value || typeof value !== 'object') return null;
  const snapshot = value as Partial<TodayV2Snapshot>;
  if (snapshot.runtimeVersion !== 'today-runtime-v2'
    || snapshot.schemaVersion !== 'today-v2'
    || typeof snapshot.batchId !== 'string'
    || !Array.isArray(snapshot.cards)
    || snapshot.cards.length !== 8) return null;
  return snapshot as TodayV2Snapshot;
}

export function writeTodayV2Snapshot(
  response: RecommendationHomeLightResponseV2,
  write: (key: string, value: TodayV2Snapshot) => void,
) {
  const snapshot = toTodayV2Snapshot(response);
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
