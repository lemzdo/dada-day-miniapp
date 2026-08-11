import type {
  ClothingCategory,
  Outfit,
  OutfitSnapshotItem,
  RecommendationCopyEvidenceCarrier,
} from '@starter-template/types';
import {
  buildUserStorageBusinessKey,
  getUserStorageSync,
  removeUserStorageSync,
  setUserStorageSync,
  type ActiveAuthContext,
} from '@/lib/userStorage';
import { getOutfitDisplayTitle } from './outfitTitle';
import { stripStaleDefaultCopy } from './recommendationCopyContract';

const DETAIL_DRAFT_KEY = 'outfitDetailDraft:recommendation-copy-contract-v8';
const OUTFIT_STATE_SYNC_KEY = 'outfitStateSync';
const TODAY_RESTORE_SNAPSHOT_KEY = 'today:outfitReturnSnapshot:recommendation-copy-contract-v8';

interface OutfitSnapshotStorageOptions {
  authContext?: ActiveAuthContext | null;
}

interface TodayRestoreSnapshotStorage {
  outfits?: Outfit[];
}

export function normalizeOutfitSnapshot(outfit: Outfit): Outfit {
  const safeOutfit = stripStaleDefaultCopy(outfit);
  const clothingIds = safeOutfit.clothingIds ?? [];
  const snapshots = buildSnapshots(safeOutfit);
  const snapshotMap = new Map<string, OutfitSnapshotItem>();
  for (const item of snapshots) {
    const itemId = item.clothingId ?? item.itemId;
    const existing = snapshotMap.get(itemId);
    snapshotMap.set(itemId, existing ? { ...existing, ...item } : item);
  }
  const itemsSnapshot = clothingIds.map((id) => normalizeSnapshotItem(snapshotMap.get(id), id));

  return {
    ...safeOutfit,
    clothingIds,
    outfitKey: outfit.outfitKey ?? getOutfitKey(clothingIds),
    displayTitle: getOutfitDisplayTitle(safeOutfit),
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
      ...pickCopyEvidenceFields(item),
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
  for (const id of getOutfitDraftStorageIds(normalized)) {
    setUserStorageSync(getOutfitStorageKey(id), normalized, options);
  }
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

export function clearTodayRestoreSnapshot(options: OutfitSnapshotStorageOptions = {}) {
  removeUserStorageSync(TODAY_RESTORE_SNAPSHOT_KEY, options);
}

export function updateTodayRestoreSnapshotOutfit(outfit: Outfit, options: OutfitSnapshotStorageOptions = {}) {
  try {
    const value = getUserStorageSync<TodayRestoreSnapshotStorage>(TODAY_RESTORE_SNAPSHOT_KEY, options);
    if (!value || typeof value !== 'object' || !Array.isArray(value.outfits)) return false;

    const patch = normalizeOutfitSnapshot(outfit);
    let changed = false;
    const outfits = value.outfits.map((item) => {
      if (!isSameOutfitIdentity(item, patch)) return item;
      changed = true;
      return normalizeOutfitSnapshot({
        ...item,
        userTitle: patch.userTitle,
        displayTitle: patch.displayTitle,
        title: patch.title,
        updatedAt: patch.updatedAt,
      });
    });

    if (!changed) return false;
    setUserStorageSync(TODAY_RESTORE_SNAPSHOT_KEY, { ...value, outfits }, options);
    return true;
  } catch {
    return false;
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

function getOutfitDraftStorageIds(outfit: Outfit) {
  return uniqueStrings([
    outfit.id,
    outfit.outfitId,
    outfit.favoriteOutfitId,
    outfit.outfitKey ? getRecommendationOutfitId(outfit) : undefined,
  ]);
}

function isSameOutfitIdentity(a: Outfit, b: Outfit) {
  const aIds = getOutfitIdentityValues(a);
  const bIds = getOutfitIdentityValues(b);
  return aIds.some((id) => bIds.includes(id));
}

function getOutfitIdentityValues(outfit: Outfit) {
  return uniqueStrings([
    outfit.id,
    outfit.outfitId,
    outfit.favoriteOutfitId,
    outfit.outfitKey,
    outfit.outfitKey ? getRecommendationOutfitId(outfit) : undefined,
  ]);
}

function uniqueStrings(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
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
        ...pickCopyEvidenceFields(item),
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
    ...pickCopyEvidenceFields(item),
  };
}

function pickCopyEvidenceFields(
  item: RecommendationCopyEvidenceCarrier | null | undefined,
): RecommendationCopyEvidenceCarrier {
  if (!item) return {};
  const fields: RecommendationCopyEvidenceCarrier = {
    confidence: item.confidence,
    recognitionConfidence: item.recognitionConfidence,
    aiConfidence: item.aiConfidence,
    factConfidence: item.factConfidence,
    factSource: item.factSource,
    factSources: item.factSources ? { ...item.factSources } : undefined,
    factConfidences: item.factConfidences ? { ...item.factConfidences } : undefined,
    factEvidence: cloneEvidence(item.factEvidence),
    factRecords: cloneEvidence(item.factRecords),
    factsWithSource: cloneEvidence(item.factsWithSource),
    contractFacts: cloneStrings(item.contractFacts),
    userFacts: cloneStrings(item.userFacts),
    careLabelFacts: cloneStrings(item.careLabelFacts),
    productFacts: cloneStrings(item.productFacts),
    structuredAiFacts: cloneStrings(item.structuredAiFacts),
    visualFacts: cloneStrings(item.visualFacts),
    fit: item.fit,
    silhouette: item.silhouette,
    shoulderFit: item.shoulderFit,
    shoulderLine: item.shoulderLine,
    sleeveLength: item.sleeveLength,
    sleeve: item.sleeve,
    pantsLength: item.pantsLength,
    patternType: item.patternType,
    styleComplexity: item.styleComplexity,
    thickness: item.thickness,
    material: item.material,
    neckline: item.neckline,
    collar: item.collar,
    closure: item.closure,
    shoeClosure: item.shoeClosure,
    shoeType: item.shoeType,
    materialGuess: item.materialGuess,
    userEdited: item.userEdited,
    fieldSource: item.fieldSource,
    styleTags: cloneStrings(item.styleTags),
    sceneTags: cloneStrings(item.sceneTags),
    aestheticFeatures: item.aestheticFeatures ? { ...item.aestheticFeatures } : undefined,
    functionalFeatures: item.functionalFeatures ? { ...item.functionalFeatures } : undefined,
  };
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  ) as RecommendationCopyEvidenceCarrier;
}

function cloneEvidence<T extends object>(values: T[] | undefined): T[] | undefined {
  return values?.map((entry) => ({ ...entry }));
}

function cloneStrings(values: string[] | undefined): string[] | undefined {
  return values?.slice();
}
