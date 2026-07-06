import { Input, Text, View } from '@tarojs/components';
import Taro, { useDidShow, useLoad, useRouter, useUnload } from '@tarojs/taro';
import { useCallback, useEffect, useRef, useState } from 'react';
import { SafeImage } from '@/components/SafeImage';
import { getAiReviewErrorCopy, USER_FACING_COPY } from '@/constants/userFacingCopy';
import { useAuthRuntime } from '@/hooks/useAuthRuntime';
import {
  invalidateAfterOutfitFavoriteMutation,
  invalidateAfterOutfitWornMutation,
  invalidateFavoritesCache,
  invalidateHistoryCache,
} from '@/lib/cacheInvalidation';
import {
  addOutfitHistory,
  CloudFunctionError,
  generateCloudOutfitComment,
  getCloudOutfit,
  getCloudOutfitAiComment,
  getFavoriteOutfitDetail,
  getOutfitHistoryDetail,
  removeFavoriteOutfit,
  renameCloudOutfit,
  saveFavoriteOutfit,
} from '@/lib/cloud';
import {
  buildOutfitBehaviorSnapshot,
  createOutfitBehaviorEventId,
  trackOutfitBehaviorEvent,
} from '@/lib/outfitBehavior';
import { buildPageCacheKey } from '@/lib/pageCache';
import {
  captureAuthContext,
  getUserPageCache,
  isAuthContextCurrent,
  setUserPageCache,
  type ActiveAuthContext,
} from '@/lib/userPageCache';
import { getUserStorageSync } from '@/lib/userStorage';
import { applyOutfitStatus, setOutfitStatus } from '@/stores/outfitStatusStore';
import { normalizeOutfitSnapshot, readOutfitDetailDraft, storeOutfitDetailDraft, storeOutfitStateSync } from '@/utils/outfitSnapshot';
import {
  getDateLabel,
  getItemCountText,
  getOutfitScoreLabels,
  getOutfitStyleTags,
  getOutfitWeatherSummary,
  getSceneLabel,
  getTimeLabel,
} from '@/utils/outfitContextText';
import { getOutfitDisplayTitle } from '@/utils/outfitTitle';
import { buildAiReviewPresentation } from './aiReviewPresentation';
import type { OutfitStatusPatch } from '@/stores/outfitStatusStore';
import type { Outfit, OutfitAiReviewResponse, OutfitItemSummary, OutfitSnapshotItem } from '@starter-template/types';
import './index.scss';

type DetailSource = 'recommendation' | 'favorite' | 'history';
type EditableModalOptions = Parameters<typeof Taro.showModal>[0] & {
  editable: boolean;
  placeholderText: string;
};
type EditableModalResult = Awaited<ReturnType<typeof Taro.showModal>> & {
  content?: string;
};
interface AiReviewMeta {
  hasCanonical: boolean;
  fallbackFailed?: boolean;
  reviewId?: string;
  generatedAt?: string;
  cacheHit?: boolean;
  saved?: boolean;
  stale?: boolean;
  inProgress?: boolean;
  cooldown?: boolean;
  retryAfterMs?: number;
  promptVersion?: string;
  model?: string;
}

// 品类映射
const categoryLabels: Record<string, string> = {
  top: '上衣',
  bottom: '下装',
  onepiece: '连体',
  shoes: '鞋子',
  accessory: '配饰',
};

const OUTFIT_DETAIL_CACHE_TTL = 5 * 60 * 1000;
const WARDROBE_REFRESH_STORAGE_KEY = 'wardrobeNeedsRefresh';

function getOutfitStatusPatch(outfit: Outfit, fallbackOutfitKey = '', updatedAtOverride?: number): OutfitStatusPatch {
  const patch: OutfitStatusPatch = {
    outfitKey: outfit.outfitKey ?? fallbackOutfitKey,
  };
  const updatedAt = updatedAtOverride ?? getOutfitStatusUpdatedAt(outfit.updatedAt);

  if (updatedAt !== undefined) patch.updatedAt = updatedAt;
  if (outfit.isFavorite !== undefined) patch.isFavorite = outfit.isFavorite;
  if (outfit.favoriteOutfitId !== undefined) {
    patch.favoriteOutfitId = outfit.favoriteOutfitId;
  } else if (outfit.isFavorite === false) {
    patch.favoriteOutfitId = '';
  }
  if (outfit.isWornToday !== undefined) patch.isWornToday = outfit.isWornToday;
  if (outfit.todayHistoryId !== undefined) {
    patch.todayHistoryId = outfit.todayHistoryId;
  } else if (outfit.isWornToday === false) {
    patch.todayHistoryId = '';
  }
  if (outfit.wornAt !== undefined) patch.wornAt = outfit.wornAt;
  if (outfit.wornDate !== undefined) patch.wornDate = outfit.wornDate;
  if (outfit.userTitle !== undefined) patch.userTitle = outfit.userTitle;
  if (outfit.displayTitle !== undefined) patch.displayTitle = outfit.displayTitle;
  if (outfit.title !== undefined) patch.title = outfit.title;

  return patch;
}

function prepareOutfitForState(outfit: Outfit, authContext?: ActiveAuthContext | null) {
  const normalized = normalizeOutfitSnapshot(outfit);
  const patch = getOutfitStatusPatch(normalized);
  if (patch.outfitKey) setOutfitStatus(patch, authContext);
  return applyDetailOutfitStatus(normalized, authContext);
}

function applyDetailOutfitStatus(outfit: Outfit, authContext?: ActiveAuthContext | null) {
  return normalizeOutfitSnapshot(applyOutfitStatus(outfit, authContext));
}

function withDefinedOutfitFields(patch: Partial<Outfit>, source: Outfit): Partial<Outfit> {
  const next = { ...patch };
  if (source.userTitle !== undefined) next.userTitle = source.userTitle;
  if (source.displayTitle !== undefined) next.displayTitle = source.displayTitle;
  if (source.title !== undefined) next.title = source.title;
  if (source.updatedAt !== undefined) next.updatedAt = source.updatedAt;
  if (source.outfitKey !== undefined) next.outfitKey = source.outfitKey;
  if (source.outfitId !== undefined) next.outfitId = source.outfitId;
  return next;
}

function getOutfitStatusUpdatedAt(updatedAt: string | undefined) {
  if (!updatedAt) return undefined;
  const timestamp = Date.parse(updatedAt);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function buildOutfitDetailCacheKey(source: DetailSource, detailId: string | undefined, scene?: Outfit['scene']) {
  if (!detailId) return '';
  return buildPageCacheKey([
    'outfitDetail',
    'v1',
    source,
    detailId,
    scene || 'unknown',
  ]);
}

function getCacheableOutfitDetail(outfit: Outfit) {
  const {
    aiComment: _aiComment,
    isFavorite: _isFavorite,
    favoriteOutfitId: _favoriteOutfitId,
    isWornToday: _isWornToday,
    todayHistoryId: _todayHistoryId,
    wornAt: _wornAt,
    wornDate: _wornDate,
    ...cacheable
  } = outfit;
  return normalizeOutfitSnapshot(cacheable);
}

function hasWardrobeRefreshSignal(authContext?: ActiveAuthContext | null) {
  try {
    return Boolean(getUserStorageSync(WARDROBE_REFRESH_STORAGE_KEY, { authContext }));
  } catch {
    return false;
  }
}

function readCloudAiReviewErrorCode(error: unknown) {
  if (error instanceof CloudFunctionError) {
    const data = error.data as { errorCode?: unknown } | undefined;
    if (typeof data?.errorCode === 'string') return data.errorCode;
  }
  return 'AI_REVIEW_UNKNOWN';
}

// 获取单品数据源（优先级：snapshotItems > itemsSnapshot > items）
function isCurrentAuthContext(authContext: ActiveAuthContext | null | undefined) {
  return Boolean(authContext && isAuthContextCurrent(authContext));
}

function getOutfitItems(outfit: Outfit): (OutfitSnapshotItem | OutfitItemSummary)[] {
  if (outfit.snapshotItems && outfit.snapshotItems.length > 0) {
    return outfit.snapshotItems;
  }
  if (outfit.itemsSnapshot && outfit.itemsSnapshot.length > 0) {
    return outfit.itemsSnapshot;
  }
  if (outfit.items && outfit.items.length > 0) {
    return outfit.items;
  }
  return [];
}

// 获取单品名称
function getItemName(item: OutfitSnapshotItem | OutfitItemSummary): string {
  const snapshotItem = item as OutfitSnapshotItem;
  const summaryItem = item as OutfitItemSummary;
  
  return (
    snapshotItem.name ||
    summaryItem.subcategory ||
    summaryItem.category ||
    snapshotItem.category ||
    snapshotItem.type ||
    '单品'
  );
}

// 获取单品图片
function getItemImage(item: OutfitSnapshotItem | OutfitItemSummary): string {
  const snapshotItem = item as OutfitSnapshotItem;
  const summaryItem = item as OutfitItemSummary;
  
  return (
    snapshotItem.thumbnailUrl ||
    summaryItem.thumbnailUrl ||
    snapshotItem.displayImageUrl ||
    summaryItem.displayImageUrl ||
    summaryItem.imageUrl ||
    snapshotItem.imageUrl ||
    ''
  );
}

function getItemDetailImage(item: OutfitSnapshotItem | OutfitItemSummary): string {
  const snapshotItem = item as OutfitSnapshotItem;
  const summaryItem = item as OutfitItemSummary;

  return (
    snapshotItem.displayImageUrl ||
    summaryItem.displayImageUrl ||
    summaryItem.imageUrl ||
    snapshotItem.imageUrl ||
    snapshotItem.thumbnailUrl ||
    summaryItem.thumbnailUrl ||
    ''
  );
}

// 获取单品副信息（最多3个关键词）
function getItemMeta(item: OutfitSnapshotItem | OutfitItemSummary): string[] {
  const snapshotItem = item as OutfitSnapshotItem;
  const metas: string[] = [];
  
  if (snapshotItem.color) metas.push(snapshotItem.color);
  if (snapshotItem.material) metas.push(snapshotItem.material);
  if (snapshotItem.thickness) metas.push(snapshotItem.thickness);
  if (snapshotItem.style) metas.push(snapshotItem.style);
  
  return metas.slice(0, 3);
}

// 获取品类标签
function getItemCategory(item: OutfitSnapshotItem | OutfitItemSummary): string {
  const snapshotItem = item as OutfitSnapshotItem;
  const summaryItem = item as OutfitItemSummary;
  const category = summaryItem.category || snapshotItem.category || snapshotItem.type || '';
  return categoryLabels[category] || category;
}

// 获取 clothingId
function getItemClothingId(item: OutfitSnapshotItem | OutfitItemSummary): string | undefined {
  const snapshotItem = item as OutfitSnapshotItem;
  const summaryItem = item as OutfitItemSummary;
  return summaryItem.clothingId || snapshotItem.clothingId;
}

// 判断是否已删除
function isItemDeleted(item: OutfitSnapshotItem | OutfitItemSummary): boolean {
  const snapshotItem = item as OutfitSnapshotItem;
  const summaryItem = item as OutfitItemSummary;
  return Boolean(summaryItem.isDeleted || snapshotItem.isDeleted || snapshotItem.deletedAt);
}

function hasDeletedOutfitItems(outfit: Outfit): boolean {
  if (outfit.incomplete) return true;
  if (typeof outfit.deletedItemCount === 'number' && outfit.deletedItemCount > 0) return true;
  return Boolean(
    outfit.snapshotItems?.some((item) => item.isDeleted || item.deletedAt)
      || outfit.itemsSnapshot?.some((item) => item.isDeleted || item.deletedAt)
      || outfit.items?.some((item) => item.isDeleted),
  );
}

function isDeletedClothesBusinessError(error: unknown): boolean {
  const errorData = (error as { data?: { errorCode?: string } })?.data;
  return errorData?.errorCode === 'OUTFIT_CONTAINS_DELETED_CLOTHES';
}

// 单品卡片组件
function OutfitItemRow({
  item,
  index,
  total,
}: {
  item: OutfitSnapshotItem | OutfitItemSummary;
  index: number;
  total: number;
}) {
  const name = getItemName(item);
  const image = getItemImage(item);
  const metas = getItemMeta(item);
  const category = getItemCategory(item);
  const clothingId = getItemClothingId(item);
  const isDeleted = isItemDeleted(item);
  const isLast = index === total - 1;

  const handleClick = () => {
    if (isDeleted) {
      Taro.showToast({ title: '这件衣服已不在衣橱里', icon: 'none' });
      return;
    }
    if (clothingId) {
      Taro.navigateTo({ url: `/pages/clothing-detail/index?id=${clothingId}` });
    }
  };

  return (
    <View
      className={`outfit-item-row ${isDeleted ? 'deleted' : ''} ${isLast ? 'last' : ''}`}
      onClick={handleClick}
    >
      <SafeImage className="item-thumb" src={image} mode="aspectFill" lazyLoad />
      <View className="item-info">
        <Text className="item-name-row">{name}</Text>
        <View className="item-meta">
          {metas.length > 0 ? (
            metas.map((meta, i) => (
              <Text key={i} className="meta-text">
                {i > 0 && ' · '}
                {meta}
              </Text>
            ))
          ) : (
            <Text className="meta-text">{category || '已加入衣橱'}</Text>
          )}
        </View>
        {category && (
          <View className="category-tag">
            <Text className="tag-text">{category}</Text>
          </View>
        )}
      </View>
      {!isDeleted && clothingId && (
        <View className="item-arrow">
          <Text className="arrow-icon">›</Text>
        </View>
      )}
    </View>
  );
}

export default function OutfitDetailPage() {
  const router = useRouter();
  const id = router.params.id;
  const sourceParam = router.params.source;
  const { authStatus, runtimeKey, isAuthenticated } = useAuthRuntime();
  const [outfit, setOutfit] = useState<Outfit | null>(null);
  const [detailSource, setDetailSource] = useState<DetailSource>('recommendation');
  const [loading, setLoading] = useState(true);
  const [operating, setOperating] = useState(false);
  const [commentLoading, setCommentLoading] = useState(false);
  const [itemsExpanded, setItemsExpanded] = useState(false);
  const [showNameModal, setShowNameModal] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [favoriteOperating, setFavoriteOperating] = useState(false);
  const [wearOperating, setWearOperating] = useState(false);
  const [aiReviewMeta, setAiReviewMeta] = useState<AiReviewMeta | null>(null);
  const requestSeqRef = useRef(0);
  const aiCommentRequestSeqRef = useRef(0);
  const lastHandledRuntimeKeyRef = useRef<string | null>(null);
  const detailViewTrackedRef = useRef(false);

  const resetUserState = useCallback(() => {
    requestSeqRef.current += 1;
    aiCommentRequestSeqRef.current += 1;
    detailViewTrackedRef.current = false;
    setOutfit(null);
    setDetailSource(normalizeSource(sourceParam));
    setLoading(false);
    setOperating(false);
    setCommentLoading(false);
    setItemsExpanded(false);
    setShowNameModal(false);
    setDraftName('');
    setFavoriteOperating(false);
    setWearOperating(false);
    setAiReviewMeta(null);
  }, [sourceParam]);

  useLoad(() => {
    setLoading(false);
  });

  useDidShow(() => {
    if (!isAuthenticated || !runtimeKey) return;
    const authContext = captureAuthContext();
    if (!isCurrentAuthContext(authContext)) return;
    setOutfit((current) => (current ? applyDetailOutfitStatus(current, authContext) : current));
  });

  useUnload(() => {
    requestSeqRef.current += 1;
    aiCommentRequestSeqRef.current += 1;
  });

  useEffect(() => {
    if (!isAuthenticated || !runtimeKey) {
      lastHandledRuntimeKeyRef.current = null;
      resetUserState();
      return;
    }

    if (lastHandledRuntimeKeyRef.current === runtimeKey) return;
    resetUserState();
    lastHandledRuntimeKeyRef.current = runtimeKey;
    if (id) void fetchOutfit(id);
  }, [authStatus, id, isAuthenticated, resetUserState, runtimeKey]);

  async function fetchOutfit(outfitId: string) {
    const requestSeq = requestSeqRef.current + 1;
    requestSeqRef.current = requestSeq;
    detailViewTrackedRef.current = false;
    const authContext = captureAuthContext();
    if (!authContext) {
      setLoading(false);
      return;
    }

    setLoading(true);
    let hasDisplayableOutfit = false;
    try {
      const decodedId = decodeURIComponent(outfitId);
      const source = normalizeSource(sourceParam);
      const cacheKey = buildOutfitDetailCacheKey(source, decodedId);
      if (requestSeqRef.current !== requestSeq || !isCurrentAuthContext(authContext)) return;
      setDetailSource(source);

      if (source === 'recommendation') {
        const draft = readOutfitDetailDraft(decodedId, { authContext });
        if (draft) {
          if (requestSeqRef.current !== requestSeq || !isCurrentAuthContext(authContext)) return;
          const preparedDraft = prepareOutfitForState({ ...draft, outfitKind: draft.outfitKind || 'recommendation' }, authContext);
          setOutfit(preparedDraft);
          setLoading(false);
          hasDisplayableOutfit = true;
          trackDetailViewOnce(preparedDraft, source);
          void loadCanonicalAiComment(preparedDraft, requestSeq, authContext);
        }
      }

      if (!hasDisplayableOutfit && cacheKey && !hasWardrobeRefreshSignal(authContext)) {
        const cached = await getUserPageCache<Outfit>(cacheKey, { authContext });
        if (cached.hit && cached.data) {
          if (requestSeqRef.current !== requestSeq || !isCurrentAuthContext(authContext)) return;
          const preparedCached = applyDetailOutfitStatus(normalizeOutfitSnapshot(cached.data), authContext);
          setOutfit(preparedCached);
          setLoading(false);
          hasDisplayableOutfit = true;
          trackDetailViewOnce(preparedCached, source);
          void loadCanonicalAiComment(preparedCached, requestSeq, authContext);
        }
      }

      const detail =
        source === 'favorite'
          ? await getFavoriteOutfitDetail(decodedId)
          : source === 'history'
            ? await getOutfitHistoryDetail(decodedId)
            : await getCloudOutfit(decodedId);
      if (requestSeqRef.current !== requestSeq || !isCurrentAuthContext(authContext)) return;
      const prepared = prepareOutfitForState(detail, authContext);
      setOutfit(prepared);
      trackDetailViewOnce(prepared, source);
      void loadCanonicalAiComment(prepared, requestSeq, authContext);
      await writeOutfitDetailCache(cacheKey, prepared, source, authContext);
    } catch (err) {
      console.error('Fetch outfit detail error:', err);
      if (requestSeqRef.current !== requestSeq || !isCurrentAuthContext(authContext)) return;
      Taro.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      if (requestSeqRef.current === requestSeq && isCurrentAuthContext(authContext)) {
        setLoading(false);
      }
    }
  }

  async function handleToggleFavorite() {
    if (!outfit || favoriteOperating) return;
    if (!outfit.isFavorite && hasDeletedOutfitItems(outfit)) {
      Taro.showToast({ title: '这套搭配有衣物已移出衣橱，暂时不能继续使用', icon: 'none' });
      return;
    }

    const authContext = captureAuthContext();
    if (!authContext) return;
    setFavoriteOperating(true);
    try {
      if (outfit.isFavorite) {
        const removed = await removeFavoriteOutfit(outfit.favoriteOutfitId || outfit.id, outfit.outfitKey);
        if (!isCurrentAuthContext(authContext)) return;
        persistOutfitUpdate(
          normalizeOutfitSnapshot({
            ...outfit,
            isFavorite: false,
            favoriteOutfitId: undefined,
            favoritedAt: undefined,
            outfitKind: 'recommendation',
          }),
          {
            outfitKey: removed.outfitKey ?? outfit.outfitKey ?? '',
            isFavorite: false,
            favoriteOutfitId: '',
            updatedAt: Date.now(),
          },
          authContext,
        );
        trackExplicitOutfitBehavior('outfit_unfavorite', outfit, getBehaviorSource(detailSource));
        if (!isCurrentAuthContext(authContext)) return;
        await invalidateAfterOutfitFavoriteMutation({ authContext });
        if (!isCurrentAuthContext(authContext)) return;
        setDetailSource('recommendation');
        Taro.showToast({ title: '已取消收藏', icon: 'success' });
        return;
      }

      const sourceForFavorite: Outfit = detailSource === 'history' ? { ...outfit, source: 'history' } : outfit;
      const saved = await saveFavoriteOutfit(normalizeOutfitSnapshot(sourceForFavorite), outfit.aiComment);
      if (!isCurrentAuthContext(authContext)) return;
      const nextFavoriteOutfitId = saved.favoriteOutfitId || saved.id;
      persistOutfitUpdate(
        normalizeOutfitSnapshot({
          ...outfit,
          ...withDefinedOutfitFields(
            {
              isFavorite: true,
              favoriteOutfitId: nextFavoriteOutfitId,
              favoritedAt: saved.favoritedAt || saved.createdAt,
            },
            saved,
          ),
        }),
        {
          ...getOutfitStatusPatch(saved, outfit.outfitKey, getOutfitStatusUpdatedAt(saved.updatedAt) ?? Date.now()),
          outfitKey: saved.outfitKey ?? outfit.outfitKey ?? '',
          isFavorite: true,
          favoriteOutfitId: nextFavoriteOutfitId,
        },
        authContext,
      );
      trackExplicitOutfitBehavior('outfit_favorite', outfit, getBehaviorSource(detailSource));
      if (!isCurrentAuthContext(authContext)) return;
      await invalidateAfterOutfitFavoriteMutation({ authContext });
      if (!isCurrentAuthContext(authContext)) return;
      Taro.showToast({ title: '已收藏', icon: 'success' });
    } catch (err) {
      console.error('Toggle outfit favorite error:', err);
      if (!isCurrentAuthContext(authContext)) return;
      Taro.showToast({
        title: isDeletedClothesBusinessError(err)
          ? '这套搭配有衣物已移出衣橱，暂时不能继续使用'
          : '操作失败',
        icon: 'none',
      });
    } finally {
      if (isCurrentAuthContext(authContext)) {
        setFavoriteOperating(false);
      }
    }
  }

  async function handleConfirmWear() {
    if (!outfit || wearOperating) return;

    if (hasDeletedOutfitItems(outfit)) {
      Taro.showToast({ title: '这套搭配有衣物已移出衣橱，暂时不能继续使用', icon: 'none' });
      return;
    }

    if (outfit.isWornToday) {
      Taro.showToast({ title: '今天已经穿过这套啦～', icon: 'none' });
      return;
    }

    const authContext = captureAuthContext();
    if (!authContext) return;
    setWearOperating(true);
    try {
      const saved = await addOutfitHistory(normalizeOutfitSnapshot(outfit), {
        source: detailSource === 'favorite' || outfit.isFavorite ? 'favorite' : 'recommendation',
        sourceFavoriteOutfitId:
          detailSource === 'favorite' || outfit.isFavorite
            ? outfit.favoriteOutfitId || outfit.id
            : outfit.sourceFavoriteOutfitId,
        aiComment: outfit.aiComment,
      });
      const nextTodayHistoryId = saved.todayHistoryId || saved.historyId || saved.id;
      if (!isCurrentAuthContext(authContext)) return;
      persistOutfitUpdate(
        normalizeOutfitSnapshot({
          ...outfit,
          isWornToday: true,
          todayHistoryId: nextTodayHistoryId,
          historyId: saved.historyId || saved.id,
          lastWornAt: saved.lastWornAt || saved.wornAt || new Date().toISOString(),
          wornAt: saved.wornAt,
          wornDate: saved.wornDate || outfit.wornDate,
        }),
        {
          ...getOutfitStatusPatch(saved, outfit.outfitKey, getOutfitStatusUpdatedAt(saved.updatedAt) ?? Date.now()),
          outfitKey: saved.outfitKey ?? outfit.outfitKey ?? '',
          isWornToday: true,
          todayHistoryId: nextTodayHistoryId,
          wornAt: saved.wornAt,
          wornDate: saved.wornDate || outfit.wornDate,
        },
        authContext,
      );
      trackExplicitOutfitBehavior('outfit_wear', outfit, getBehaviorSource(detailSource));
      void invalidateAfterOutfitWornMutation({ authContext });
      if (!isCurrentAuthContext(authContext)) return;
      Taro.showToast({ title: '已记录到穿搭历史', icon: 'success' });
    } catch (err) {
      console.error('Confirm outfit wear error:', err);
      if (!isCurrentAuthContext(authContext)) return;
      Taro.showToast({
        title: isDeletedClothesBusinessError(err)
          ? '这套搭配有衣物已移出衣橱，暂时不能继续使用'
          : '操作失败',
        icon: 'none',
      });
    } finally {
      if (isCurrentAuthContext(authContext)) {
        setWearOperating(false);
      }
    }
  }

  async function handleRenameOutfit() {
    if (!outfit || operating) return;

    setDraftName(outfit.userTitle || '');
    setShowNameModal(true);
  }

  async function handleSaveNameFromModal() {
    if (!outfit || operating) return;

    const authContext = captureAuthContext();
    if (!authContext) return;
    setOperating(true);
    try {
      const userTitle = draftName;
      const saved = await renameCloudOutfit({
        outfitId: outfit.outfitId || (detailSource === 'recommendation' ? outfit.id : undefined),
        outfitKey: outfit.outfitKey,
        outfit: normalizeOutfitSnapshot(outfit),
        userTitle,
      });
      const nextOutfit = normalizeOutfitSnapshot({
        ...outfit,
        title: saved.title || outfit.title,
        userTitle: saved.userTitle,
        displayTitle: saved.displayTitle,
        outfitId: saved.outfitId || saved.id || outfit.outfitId,
        outfitKey: saved.outfitKey || outfit.outfitKey,
        updatedAt: saved.updatedAt || outfit.updatedAt,
      });
      if (!isCurrentAuthContext(authContext)) return;

      persistOutfitUpdate(
        nextOutfit,
        {
          ...getOutfitStatusPatch(saved, outfit.outfitKey, getOutfitStatusUpdatedAt(saved.updatedAt) ?? Date.now()),
          outfitKey: saved.outfitKey || outfit.outfitKey || '',
          userTitle: saved.userTitle,
          displayTitle: saved.displayTitle,
          title: saved.title,
        },
        authContext,
      );
      if (!isCurrentAuthContext(authContext)) return;
      await Promise.all([
        invalidateFavoritesCache({ authContext }),
        invalidateHistoryCache({ authContext }),
      ]);
      if (!isCurrentAuthContext(authContext)) return;
      setShowNameModal(false);
      Taro.showToast({ title: userTitle.trim() ? '已保存名称' : '已清空名称', icon: 'success' });
    } catch (err) {
      console.error('Rename outfit error:', err);
      if (!isCurrentAuthContext(authContext)) return;
      Taro.showToast({ title: '名称保存失败', icon: 'none' });
    } finally {
      if (isCurrentAuthContext(authContext)) {
        setOperating(false);
      }
    }
  }

  function handleCloseNameModal() {
    setShowNameModal(false);
  }

  async function loadCanonicalAiComment(
    targetOutfit: Outfit,
    detailRequestSeq: number,
    authContext: ActiveAuthContext,
  ) {
    const commentRequestSeq = aiCommentRequestSeqRef.current + 1;
    aiCommentRequestSeqRef.current = commentRequestSeq;
    try {
      const result = await getCloudOutfitAiComment(targetOutfit);
      if (
        requestSeqRef.current !== detailRequestSeq ||
        aiCommentRequestSeqRef.current !== commentRequestSeq ||
        !isCurrentAuthContext(authContext)
      ) {
        return;
      }
      applyAiReviewResult(result, { clearStaleComment: true });
    } catch (err) {
      console.error('Fetch outfit AI comment failed:', err);
    }
  }

  async function handleGenerateAiComment() {
    if (!outfit || commentLoading) return;

    const authContext = captureAuthContext();
    if (!authContext) return;
    const commentRequestSeq = aiCommentRequestSeqRef.current + 1;
    aiCommentRequestSeqRef.current = commentRequestSeq;
    const forceRegenerate = Boolean(aiReviewMeta?.hasCanonical && outfit.aiComment);
    setCommentLoading(true);
    try {
      const result = await generateCloudOutfitComment(outfit, { forceRegenerate });
      if (aiCommentRequestSeqRef.current !== commentRequestSeq || !isCurrentAuthContext(authContext)) return;
      logAiReviewDebugSummary(result);
      if (result.cooldown) {
        applyAiReviewResult(result);
        showAiReviewError(result.errorCode || 'AI_REVIEW_COOLDOWN');
        return;
      }
      if (result.inProgress) {
        applyAiReviewResult(result);
        showAiReviewError(result.errorCode || 'AI_REVIEW_IN_PROGRESS');
        return;
      }
      if (result.superseded) {
        applyAiReviewResult(result);
        Taro.showToast({ title: result.aiComment ? '小搭多说了两句' : '让我再想想……', icon: 'none' });
        return;
      }
      if (isFallbackAiReviewResult(result)) {
        applyAiReviewResult(result);
        Taro.showToast({ title: '刚刚没接上话，再试一次吧。', icon: 'none' });
        return;
      }
      if (result.success && result.aiComment && !isFallbackAiReviewResult(result)) {
        applyAiReviewResult(result);
        Taro.showToast({
          title: result.cacheHit ? '小搭多说了两句' : forceRegenerate ? '换了个角度说' : '小搭多说了两句',
          icon: 'success',
        });
        return;
      }
      showAiReviewError(result.errorCode || 'AI_REVIEW_UNKNOWN', result.message);
    } catch (err) {
      console.error('Generate outfit AI comment error:', err);
      if (aiCommentRequestSeqRef.current !== commentRequestSeq || !isCurrentAuthContext(authContext)) return;
      showAiReviewError(readCloudAiReviewErrorCode(err));
    } finally {
      if (aiCommentRequestSeqRef.current === commentRequestSeq && isCurrentAuthContext(authContext)) {
        setCommentLoading(false);
      }
    }
  }

  function showAiReviewError(errorCode: string | undefined, fallbackMessage?: string) {
    const message = getAiReviewErrorCopy(errorCode || 'AI_REVIEW_UNKNOWN') || fallbackMessage || USER_FACING_COPY.aiReview.genericRetry;
    Taro.showToast({ title: message, icon: 'none' });
  }

  function isFallbackAiReviewResult(result: OutfitAiReviewResponse) {
    return result.source === 'rule_fallback'
      || result.source === 'cached_fallback'
      || result.reviewSource === 'rule_fallback'
      || result.reviewSource === 'cached_fallback'
      || result.review?.source === 'rule_fallback'
      || result.review?.source === 'cached_fallback';
  }

  function logAiReviewDebugSummary(result: OutfitAiReviewResponse) {
    if (!shouldPrintAiReviewDebug()) return;
    const debug = result.aiReviewDebug;
    if (!debug) return;
    console.info('[xiaoda-review]', {
      requestId: debug.requestId,
      source: result.source,
      reviewSource: result.reviewSource,
      enhanced: Boolean(result.success && result.aiComment && result.reviewSource !== 'rule_fallback'),
      aiAttempted: debug.aiAttempted,
      provider: debug.provider,
      model: debug.model ?? result.model,
      cacheDecision: debug.cacheDecision,
      fallbackReason: debug.fallbackReason,
      errorCode: debug.errorCode ?? result.errorCode,
      validatorRejectReasons: debug.validatorRejectReasons ?? result.validatorRejectReasons,
    });
  }

  function shouldPrintAiReviewDebug() {
    try {
      return Taro.getAccountInfoSync?.().miniProgram?.envVersion !== 'release';
    } catch {
      return false;
    }
  }

  function applyAiReviewResult(
    result: OutfitAiReviewResponse,
    options: { clearStaleComment?: boolean } = {},
  ) {
    const isFallbackResult = isFallbackAiReviewResult(result);
    const hasReadyReview = Boolean(result.aiComment && result.review?.status === 'ready' && !result.stale && !isFallbackResult);
    const shouldPreserveDisplayedComment = Boolean(
      result.aiComment && !isFallbackResult && (hasReadyReview || result.inProgress || result.cooldown),
    );
    setAiReviewMeta({
      hasCanonical: shouldPreserveDisplayedComment,
      fallbackFailed: isFallbackResult && result.success === false,
      reviewId: result.reviewId ?? result.review?.reviewId,
      generatedAt: result.generatedAt ?? result.review?.generatedAt,
      cacheHit: result.cacheHit,
      saved: result.saved,
      stale: result.stale,
      inProgress: result.inProgress,
      cooldown: result.cooldown,
      retryAfterMs: result.retryAfterMs,
      promptVersion: result.promptVersion ?? result.review?.promptVersion,
      model: result.model ?? result.review?.model,
    });
    if (shouldPreserveDisplayedComment && result.aiComment) {
      setOutfit((current) => (current ? normalizeOutfitSnapshot({ ...current, aiComment: result.aiComment ?? undefined }) : current));
      return;
    }

    if (options.clearStaleComment && (result.stale || !result.aiComment)) {
      setOutfit((current) => (current ? normalizeOutfitSnapshot({ ...current, aiComment: undefined }) : current));
    }
  }

  function persistOutfitUpdate(
    nextOutfit: Outfit,
    statusPatch?: OutfitStatusPatch,
    authContext?: ActiveAuthContext | null,
  ) {
    if (!isCurrentAuthContext(authContext)) return;

    const normalized = normalizeOutfitSnapshot(nextOutfit);
    const patch = statusPatch ?? getOutfitStatusPatch(normalized);
    if (patch.outfitKey) setOutfitStatus(patch, authContext);

    const nextWithStatus = applyDetailOutfitStatus(normalized, authContext);
    setOutfit(nextWithStatus);
    storeOutfitStateSync(nextWithStatus, { authContext });
    if (detailSource === 'recommendation') {
      storeOutfitDetailDraft(nextWithStatus, { authContext });
    }
    void writeOutfitDetailCache(getCurrentOutfitDetailCacheKey(), nextWithStatus, detailSource, authContext);
  }

  function getCurrentOutfitDetailCacheKey() {
    if (!id) return '';
    return buildOutfitDetailCacheKey(detailSource, decodeURIComponent(id));
  }

  function trackDetailViewOnce(targetOutfit: Outfit, source: DetailSource) {
    if (detailViewTrackedRef.current) return;
    detailViewTrackedRef.current = true;
    trackOutfitBehaviorEvent({
      schemaVersion: 1,
      eventId: createOutfitBehaviorEventId({
        pageSessionId: `detail:${id || targetOutfit.id}`,
        eventType: 'outfit_detail_view',
      }),
      eventType: 'outfit_detail_view',
      clientOccurredAt: new Date().toISOString(),
      ...buildOutfitBehaviorSnapshot(targetOutfit),
      context: { source: getBehaviorSource(source) },
    });
  }

  function trackExplicitOutfitBehavior(
    eventType: 'outfit_favorite' | 'outfit_unfavorite' | 'outfit_wear',
    targetOutfit: Outfit,
    source: 'today' | 'favorites' | 'history' | 'other',
  ) {
    trackOutfitBehaviorEvent({
      schemaVersion: 1,
      eventId: createOutfitBehaviorEventId({
        pageSessionId: `detail:${id || targetOutfit.id}`,
        eventType,
      }),
      eventType,
      clientOccurredAt: new Date().toISOString(),
      ...buildOutfitBehaviorSnapshot(targetOutfit),
      context: { source },
    });
  }

  async function writeOutfitDetailCache(
    cacheKey: string,
    nextOutfit: Outfit,
    source: DetailSource,
    authContext: ActiveAuthContext | null = captureAuthContext(),
  ) {
    if (!cacheKey) return;
    await setUserPageCache(cacheKey, getCacheableOutfitDetail(nextOutfit), {
      ttl: OUTFIT_DETAIL_CACHE_TTL,
      authContext,
      meta: {
        source,
        id: nextOutfit.id,
        outfitKey: nextOutfit.outfitKey ?? '',
      },
    });
  }

  if (loading) {
    return (
      <View className="outfit-detail-page loading">
        <View className="skeleton-title" />
        <View className="skeleton-card" />
        <View className="skeleton-card short" />
      </View>
    );
  }

  if (!outfit) {
    return (
      <View className="outfit-detail-page empty">
        <Text className="empty-title">没有找到这套穿搭</Text>
        <Text className="empty-desc">可能已经被删除，返回今日页再试试。</Text>
      </View>
    );
  }

  const deletedItemCount = getDeletedItemCount(outfit);
  const hasDeletedItems = hasDeletedOutfitItems(outfit);
  const isFavoriteDetail = Boolean(outfit.isFavorite);
  const styleTags = getOutfitStyleTags(outfit);
  const weatherSummary = getOutfitWeatherSummary(outfit);
  const scoreLabels = getOutfitScoreLabels(outfit);
  const itemCountText = getItemCountText(outfit);
  const items = getOutfitItems(outfit);
  const showCount = itemsExpanded || items.length <= 4 ? items.length : 4;
  const displayItems = items.slice(0, showCount);
  const hasCanonicalAiComment = Boolean(aiReviewMeta?.hasCanonical && outfit.aiComment);
  const aiCommentButtonText = commentLoading
    ? '让我再想想……'
    : aiReviewMeta?.fallbackFailed
      ? '再听小搭说说'
      : hasCanonicalAiComment
        ? '换个角度再说说'
        : '听小搭多说两句';
  const aiReviewPresentation = buildAiReviewPresentation(outfit.aiComment, outfit.contentPlan);
  const hasAiReviewContent = Boolean(
    aiReviewPresentation
      && (aiReviewPresentation.bodyParagraphs.length > 0 || aiReviewPresentation.advice),
  );

  return (
    <View className="outfit-detail-page">
      <View className="detail-scroll">
        <View className="hero-card">
          <View className="hero-header">
            <View className="hero-title-block">
              <Text className="hero-title">{getOutfitDisplayTitle(outfit, '今日推荐穿搭')}</Text>
              <View className="fact-chips">
                <Text className="fact-chip">{getSceneLabel(outfit)}</Text>
                <Text className="fact-chip">{getDateLabel(outfit)}</Text>
                <Text className="fact-chip">{weatherSummary.chip || getTimeLabel(outfit)}</Text>
                {isFavoriteDetail && <Text className="fact-chip favorite">已收藏</Text>}
                {outfit.isWornToday && <Text className="fact-chip worn">今天穿过啦</Text>}
              </View>
            </View>
            <View className="name-action" onClick={handleRenameOutfit}>
              <Text className="name-action-text">{outfit.userTitle ? '编辑' : '命名'}</Text>
            </View>
          </View>

          {deletedItemCount > 0 && (
            <View className="deleted-notice">
              <Text className="deleted-notice-text">部分单品已从衣柜删除，仍按当时的搭配记录展示。</Text>
            </View>
          )}
        </View>

        <View className="visual-card">
          <View className="visual-collage">
            {getOutfitItems(outfit).map((item, index) => (
              <View key={getItemClothingId(item) || index} className={`visual-item ${isItemDeleted(item) ? 'deleted' : ''}`}>
                <SafeImage className="visual-image" src={getItemDetailImage(item)} mode="aspectFit" lazyLoad />
              </View>
            ))}
          </View>
        </View>

        {styleTags.length > 0 && (
          <View className="style-tags">
            {styleTags.map((tag) => (
              <Text key={tag} className="style-tag">
                {tag}
              </Text>
            ))}
          </View>
        )}

        <View className="detail-card weather-card">
          <Text className="card-title">今日天气参考</Text>
          <View className="weather-summary">
            <Text className="weather-title">{weatherSummary.title}</Text>
            <Text className="weather-tip">{weatherSummary.tip}</Text>
          </View>
        </View>

        {scoreLabels.length > 0 && (
          <View className="detail-card">
            <Text className="card-title">搭配指数</Text>
            <View className="score-cards">
              {scoreLabels.map((score) => (
                <View key={score.label} className="score-card">
                  <Text className="score-card-label">{score.label}</Text>
                  <Text className="score-card-value">{score.value}</Text>
                  <Text className="score-card-text">{score.text}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        <View className="detail-card ai-comment-card">
          <View className="ai-comment-header">
            <View className="xiaoda-review-heading">
              <Text className="card-title">小搭说衣</Text>
              <Text className="ai-comment-invite">这套，我还想多说两句</Text>
              <Text className="ai-comment-desc">再结合今天的天气和场景，看看有没有容易忽略的小细节。</Text>
            </View>
            <View
              className={`ai-comment-btn ${commentLoading ? 'disabled' : ''}`}
              onClick={handleGenerateAiComment}
            >
              <Text className="ai-comment-btn-text">{aiCommentButtonText}</Text>
            </View>
          </View>

          {commentLoading && (
            <Text className="ai-comment-loading">{USER_FACING_COPY.aiReview.loading}</Text>
          )}

          {hasAiReviewContent && aiReviewPresentation ? (
            <View className="ai-comment-content">
              {aiReviewPresentation.bodyParagraphs.map((paragraph) => (
                <Text key={paragraph} className="ai-comment-reason">{paragraph}</Text>
              ))}
              {aiReviewPresentation.advice && (
                <View className="ai-comment-advice">
                  <Text className="ai-comment-advice-title">可以试试</Text>
                  <Text className="ai-comment-tip">{aiReviewPresentation.advice}</Text>
                </View>
              )}
            </View>
          ) : null}
        </View>

        <View className="detail-card item-list-card">
          <Text className="card-title">用到的单品 {itemCountText}</Text>
          <View className="outfit-item-list">
            {displayItems.map((item, index) => (
              <OutfitItemRow
                key={getItemClothingId(item) || index}
                item={item}
                index={index}
                total={displayItems.length}
              />
            ))}
            {items.length > 4 && (
              <View className="expand-btn" onClick={() => setItemsExpanded(!itemsExpanded)}>
                <Text className="expand-text">
                  {itemsExpanded ? '收起部分单品' : `展开其余 ${items.length - 4} 件`}
                </Text>
              </View>
            )}
          </View>
        </View>
      </View>

      {showNameModal && (
        <View className="name-modal-overlay" onClick={handleCloseNameModal}>
          <View className="name-modal-container" onClick={(e) => e.stopPropagation()}>
            <Text className="name-modal-title">
              {outfit?.userTitle ? '编辑穿搭名称' : '给这套起个名字'}
            </Text>
            <Text className="name-modal-hint">
              {outfit?.userTitle ? '改个更好找的名字，小搭会帮你记住～' : '起一个你以后好找的名字吧'}
            </Text>
            <Input
              className="name-input"
              value={draftName}
              onInput={(e) => setDraftName(e.detail.value)}
              placeholder="例如：周一开会套装"
              placeholderClass="name-input-placeholder"
              maxlength={50}
              focus
            />
            <Text className="name-modal-tip">留空保存，会恢复小搭默认名称</Text>
            <View className="name-modal-actions">
              <View className="name-modal-cancel" onClick={handleCloseNameModal}>
                <Text className="cancel-text">取消</Text>
              </View>
              <View
                className={`name-modal-confirm ${operating ? 'disabled' : ''}`}
                onClick={handleSaveNameFromModal}
              >
                <Text className="confirm-text">{operating ? '保存中...' : '保存'}</Text>
              </View>
            </View>
          </View>
        </View>
      )}

      <View className="action-bar">
        <View
          className={`action-btn favorite ${isFavoriteDetail ? 'active' : ''} ${favoriteOperating || (!isFavoriteDetail && hasDeletedItems) ? 'disabled' : ''}`}
          onClick={handleToggleFavorite}
        >
          <Text className="btn-text">{isFavoriteDetail ? '取消收藏' : '收藏'}</Text>
        </View>
        <View className={`action-btn wear ${wearOperating || hasDeletedItems ? 'disabled' : ''}`} onClick={handleConfirmWear}>
          <Text className="btn-text">{wearOperating ? '处理中...' : outfit.isWornToday ? '今天穿过啦' : '穿它'}</Text>
        </View>
      </View>
    </View>
  );
}

function normalizeSource(value?: string): DetailSource {
  if (value === 'favorite' || value === 'history') return value;
  return 'recommendation';
}

function getBehaviorSource(source: DetailSource): 'today' | 'favorites' | 'history' | 'other' {
  if (source === 'favorite') return 'favorites';
  if (source === 'history') return 'history';
  if (source === 'recommendation') return 'today';
  return 'other';
}

function getDeletedItemCount(outfit: Outfit) {
  if (typeof outfit.deletedItemCount === 'number') return outfit.deletedItemCount;
  const snapshotCount = outfit.snapshotItems?.filter((item) => item.isDeleted || item.deletedAt).length ?? 0;
  const itemCount = outfit.items?.filter((item) => item.isDeleted).length ?? 0;
  return Math.max(snapshotCount, itemCount);
}
