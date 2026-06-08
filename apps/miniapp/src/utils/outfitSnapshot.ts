import Taro from '@tarojs/taro';
import type { ClothingCategory, Outfit, OutfitSnapshotItem } from '@starter-template/types';
import { getOutfitDisplayTitle } from './outfitTitle';

const DETAIL_DRAFT_PREFIX = 'outfitDetailDraft:';
const OUTFIT_STATE_SYNC_KEY = 'outfitStateSync';

export function normalizeOutfitSnapshot(outfit: Outfit): Outfit {
  const clothingIds = outfit.clothingIds ?? [];
  const snapshots = buildSnapshots(outfit);
  const snapshotMap = new Map(snapshots.map((item) => [item.clothingId ?? item.itemId, item]));
  const itemsSnapshot = clothingIds.map((id) => normalizeSnapshotItem(snapshotMap.get(id), id));

  return {
    ...outfit,
    clothingIds,
    outfitKey: outfit.outfitKey ?? getOutfitKey(clothingIds),
    displayTitle: getOutfitDisplayTitle(outfit),
    itemsSnapshot,
    snapshotItems: itemsSnapshot,
    items: itemsSnapshot.map((item) => ({
      clothingId: item.clothingId ?? item.itemId,
      category: item.category as ClothingCategory,
      subcategory: item.name || item.type || item.category,
      imageUrl: item.imageUrl || item.displayImageUrl || item.thumbnailUrl || '',
      displayImageUrl: item.displayImageUrl || item.imageUrl || item.thumbnailUrl || '',
      thumbnailUrl: item.thumbnailUrl || item.displayImageUrl || item.imageUrl || '',
      colorPalette: item.color ? [{ name: item.color, hex: '' }] : [],
      isDeleted: Boolean(item.deletedAt || item.isDeleted),
    })),
  };
}

export function getOutfitKey(clothingIds: string[]) {
  return clothingIds.slice().sort().join('_');
}

export function getRecommendationOutfitId(outfit: Outfit) {
  return `recommend:${getOutfitKey(outfit.clothingIds ?? [])}`;
}

export function storeOutfitDetailDraft(outfit: Outfit) {
  const normalized = normalizeOutfitSnapshot(outfit);
  Taro.setStorageSync(getOutfitStorageKey(normalized.id), normalized);
}

export function storeOutfitStateSync(outfit: Outfit) {
  Taro.setStorageSync(OUTFIT_STATE_SYNC_KEY, normalizeOutfitSnapshot(outfit));
}

export function consumeOutfitStateSync() {
  try {
    const value = Taro.getStorageSync(OUTFIT_STATE_SYNC_KEY) as Outfit | '';
    Taro.removeStorageSync(OUTFIT_STATE_SYNC_KEY);
    return value && typeof value === 'object' ? normalizeOutfitSnapshot(value) : null;
  } catch {
    return null;
  }
}

export function readOutfitDetailDraft(id: string) {
  try {
    const value = Taro.getStorageSync(getOutfitStorageKey(id)) as Outfit | '';
    return value && typeof value === 'object' ? normalizeOutfitSnapshot(value) : null;
  } catch {
    return null;
  }
}

function getOutfitStorageKey(id: string) {
  return `${DETAIL_DRAFT_PREFIX}${id}`;
}

function buildSnapshots(outfit: Outfit): OutfitSnapshotItem[] {
  return [
    ...(outfit.itemsSnapshot ?? []),
    ...(outfit.snapshotItems ?? []),
    ...(outfit.items ?? []).map((item) => {
      const imageItem = item as typeof item & {
        thumbnailUrl?: string;
        displayImageUrl?: string;
      };
      return {
        itemId: item.clothingId,
        clothingId: item.clothingId,
        type: item.subcategory || item.category,
        name: item.subcategory || item.category,
        category: item.category,
        color: item.colorPalette?.map((color) => color.name).filter(Boolean).join(' / ') ?? '',
        imageUrl: item.imageUrl || imageItem.displayImageUrl || imageItem.thumbnailUrl || '',
        displayImageUrl: imageItem.displayImageUrl || item.imageUrl || imageItem.thumbnailUrl || '',
        thumbnailUrl: imageItem.thumbnailUrl || imageItem.displayImageUrl || item.imageUrl || '',
        isDeleted: Boolean(item.isDeleted),
        deletedAt: item.isDeleted ? new Date().toISOString() : null,
      };
    }),
  ];
}

function normalizeSnapshotItem(item: OutfitSnapshotItem | undefined, clothingId: string): OutfitSnapshotItem {
  const displayImageUrl = item?.displayImageUrl || item?.imageUrl || item?.thumbnailUrl || '';
  const thumbnailUrl = item?.thumbnailUrl || displayImageUrl || item?.imageUrl || '';

  return {
    itemId: clothingId,
    clothingId,
    type: item?.type || item?.name || item?.category || 'other',
    name: item?.name || item?.type || item?.category || '衣服',
    category: item?.category || 'other',
    color: item?.color || '',
    style: item?.style || '',
    thickness: item?.thickness || '',
    material: item?.material || '',
    imageUrl: item?.imageUrl || displayImageUrl || thumbnailUrl,
    displayImageUrl,
    thumbnailUrl,
    deletedAt: item?.deletedAt ?? (item?.isDeleted ? new Date().toISOString() : null),
    isDeleted: Boolean(item?.isDeleted || item?.deletedAt),
  };
}
