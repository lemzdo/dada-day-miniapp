import type { ClothingCategory, Outfit, OutfitSnapshotItem } from '@starter-template/types';
import {
  buildUserStorageBusinessKey,
  getUserStorageSync,
  removeUserStorageSync,
  setUserStorageSync,
  type ActiveAuthContext,
} from '@/lib/userStorage';
import { getOutfitDisplayTitle } from './outfitTitle';

const DETAIL_DRAFT_KEY = 'outfitDetailDraft';
const OUTFIT_STATE_SYNC_KEY = 'outfitStateSync';

interface OutfitSnapshotStorageOptions {
  authContext?: ActiveAuthContext | null;
}

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

export function storeOutfitDetailDraft(outfit: Outfit, options: OutfitSnapshotStorageOptions = {}) {
  const normalized = normalizeOutfitSnapshot(outfit);
  setUserStorageSync(getOutfitStorageKey(normalized.id), normalized, options);
}

export function storeOutfitStateSync(outfit: Outfit, options: OutfitSnapshotStorageOptions = {}) {
  setUserStorageSync(OUTFIT_STATE_SYNC_KEY, normalizeOutfitSnapshot(outfit), options);
}

export function consumeOutfitStateSync(options: OutfitSnapshotStorageOptions = {}) {
  try {
    const value = getUserStorageSync<Outfit>(OUTFIT_STATE_SYNC_KEY, options);
    removeUserStorageSync(OUTFIT_STATE_SYNC_KEY, options);
    return value && typeof value === 'object' ? normalizeOutfitSnapshot(value) : null;
  } catch {
    return null;
  }
}

export function readOutfitDetailDraft(id: string, options: OutfitSnapshotStorageOptions = {}) {
  try {
    const value = getUserStorageSync<Outfit>(getOutfitStorageKey(id), options);
    return value && typeof value === 'object' ? normalizeOutfitSnapshot(value) : null;
  } catch {
    return null;
  }
}

function getOutfitStorageKey(id: string) {
  return buildUserStorageBusinessKey(DETAIL_DRAFT_KEY, id);
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
