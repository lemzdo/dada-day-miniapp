import { Input, ScrollView, Text, View } from '@tarojs/components';
import Taro, { useDidShow, useLoad, usePullDownRefresh, useReachBottom } from '@tarojs/taro';
import { useCallback, useEffect, useRef, useState } from 'react';
import { SafeImage } from '@/components/SafeImage';
import { useAuthRuntime } from '@/hooks/useAuthRuntime';
import {
  invalidateAfterOutfitFavoriteMutation,
  invalidateFavoritesCache,
  invalidateHistoryCache,
  invalidateOutfitDetailCache,
} from '@/lib/cacheInvalidation';
import { listFavoriteOutfits, removeFavoriteOutfit, renameCloudOutfit } from '@/lib/cloud';
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
import { applyOutfitStatuses, setOutfitStatus, setOutfitStatuses } from '@/stores/outfitStatusStore';
import { normalizeOutfitSnapshot, storeOutfitDetailDraft, storeOutfitStateSync, updateTodayRestoreSnapshotOutfit } from '@/utils/outfitSnapshot';
import { getOutfitDisplayTitle } from '@/utils/outfitTitle';
import { getOutfitStyleTags, getOutfitWeatherSummary } from '@/utils/outfitContextText';
import { getSavedSnapshotDefaultCopy } from '@/utils/recommendationCopyContract';
import type { OutfitStatusPatch } from '@/stores/outfitStatusStore';
import type { Outfit } from '@starter-template/types';
import './index.scss';

const PAGE_SIZE = 10;
const MAX_TITLE_LENGTH = 16;
const FAVORITES_FIRST_PAGE_CACHE_TTL = 2 * 60 * 1000;
const FAVORITES_FIRST_PAGE_CACHE_KEY = buildPageCacheKey([
  'favorites',
  'first',
  'recommendation-copy-contract-v7',
  PAGE_SIZE,
]);

interface FavoritesFirstPageCache {
  list: Outfit[];
  hasMore: boolean;
  page: number;
  pageSize: number;
}

interface TapEvent {
  stopPropagation: () => void;
}

interface FavoriteMutationTarget {
  authContext: ActiveAuthContext;
  outfitId: string;
  outfitKey: string;
}

function isCurrentAuthContext(authContext: ActiveAuthContext | null | undefined) {
  return Boolean(authContext && isAuthContextCurrent(authContext));
}

export default function FavoriteOutfitsPage() {
  const { authStatus, runtimeKey, isAuthenticated } = useAuthRuntime();
  const [outfits, setOutfits] = useState<Outfit[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeMenuId, setActiveMenuId] = useState('');
  const [renamingOutfit, setRenamingOutfit] = useState<Outfit | null>(null);
  const [draftName, setDraftName] = useState('');
  const [renameSaving, setRenameSaving] = useState(false);
  const skipFirstDidShowRef = useRef(false);
  const fetchingRef = useRef(false);
  const lastHandledRuntimeKeyRef = useRef<string | null>(null);
  const outfitsRef = useRef<Outfit[]>([]);
  const renameTargetRef = useRef<FavoriteMutationTarget | null>(null);
  outfitsRef.current = outfits;

  const resetUserState = useCallback(() => {
    fetchingRef.current = false;
    renameTargetRef.current = null;
    setOutfits([]);
    setPage(1);
    setHasMore(true);
    setLoading(false);
    setError('');
    setActiveMenuId('');
    setRenamingOutfit(null);
    setDraftName('');
    setRenameSaving(false);
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !runtimeKey) {
      lastHandledRuntimeKeyRef.current = null;
      skipFirstDidShowRef.current = true;
      resetUserState();
      return;
    }

    if (lastHandledRuntimeKeyRef.current === runtimeKey) return;
    resetUserState();
    lastHandledRuntimeKeyRef.current = runtimeKey;
    skipFirstDidShowRef.current = true;
    void fetchFavorites(1, true, { force: true });
  }, [authStatus, isAuthenticated, resetUserState, runtimeKey]);

  useLoad(() => {
    skipFirstDidShowRef.current = true;
  });

  useDidShow(() => {
    if (skipFirstDidShowRef.current) {
      skipFirstDidShowRef.current = false;
      return;
    }
    syncFavoritesFromStatusStore();
    void fetchFavorites(1, true, { force: true });
  });

  usePullDownRefresh(() => {
    fetchFavorites(1, true, { force: true }).finally(() => {
      Taro.stopPullDownRefresh();
    });
  });

  useReachBottom(() => {
    if (loading || !hasMore) return;
    const nextPage = page + 1;
    setPage(nextPage);
    fetchFavorites(nextPage);
  });

  async function fetchFavorites(pageNum: number, reset = false, options: { force?: boolean } = {}) {
    if (fetchingRef.current) return;
    fetchingRef.current = true;

    const authContext = captureAuthContext();
    if (!authContext) {
      fetchingRef.current = false;
      return;
    }
    const isFirstPage = reset && pageNum === 1;
    const cached = isFirstPage && !options.force ? await hydrateFavoritesFirstPageCache(authContext) : false;
    if (!isCurrentAuthContext(authContext)) {
      fetchingRef.current = false;
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await listFavoriteOutfits({ page: pageNum, pageSize: PAGE_SIZE });
      const rawList = data.list || [];
      if (!isCurrentAuthContext(authContext)) return;
      setOutfitStatuses(getOutfitStatusPatches(rawList), authContext);
      const nextList = applyFavoriteOutfitStatuses(rawList, authContext);
      setOutfits((prev) => (reset ? nextList : applyFavoriteOutfitStatuses([...prev, ...nextList], authContext)));
      setHasMore(data.hasMore);
      if (reset) setPage(1);
      if (isFirstPage) {
        void writeFavoritesFirstPageCache({
          list: nextList,
          hasMore: data.hasMore,
          page: 1,
          pageSize: PAGE_SIZE,
        }, authContext);
      }
    } catch (err) {
      console.error('Fetch favorite outfits error:', err);
      if (!isCurrentAuthContext(authContext)) return;
      setError('收藏灵感暂时没加载出来');
    } finally {
      fetchingRef.current = false;
      if (isCurrentAuthContext(authContext)) {
        setLoading(false);
      }
    }
  }

  async function hydrateFavoritesFirstPageCache(authContext: ActiveAuthContext | null) {
    const cached = await getUserPageCache<FavoritesFirstPageCache>(FAVORITES_FIRST_PAGE_CACHE_KEY, { authContext });
    if (!cached.hit || !cached.data) return false;
    if (!isCurrentAuthContext(authContext)) return false;

    setOutfits(applyFavoriteOutfitStatuses(cached.data.list, authContext));
    setHasMore(cached.data.hasMore);
    setPage(cached.data.page);
    setError('');
    return true;
  }

  function syncFavoritesFromStatusStore() {
    const authContext = captureAuthContext();
    if (!isCurrentAuthContext(authContext)) return;

    setOutfits((prev) => {
      const next = applyFavoriteOutfitStatuses(prev, authContext).filter((outfit) => outfit.isFavorite !== false);
      if (!isSameFavoriteOutfitList(prev, next)) {
        void invalidateFavoritesCache({ authContext });
      }
      return next;
    });
  }

  function handleCardClick(outfitId: string) {
    Taro.navigateTo({ url: `/pages/outfit-detail/index?id=${encodeURIComponent(outfitId)}&source=favorite` });
  }

  function toggleMenu(outfitId: string, event: TapEvent) {
    event.stopPropagation();
    setActiveMenuId((current) => (current === outfitId ? '' : outfitId));
  }

  function openRename(outfit: Outfit, event?: TapEvent) {
    event?.stopPropagation();
    const target = captureFavoriteMutationTarget(outfit);
    if (!target) return;
    setActiveMenuId('');
    renameTargetRef.current = target;
    setRenamingOutfit(outfit);
    setDraftName(outfit.userTitle || getOutfitDisplayTitle(outfit, '收藏的搭配'));
  }

  async function handleRemoveFavorite(outfit: Outfit, event?: TapEvent) {
    event?.stopPropagation();
    setActiveMenuId('');
    const target = captureFavoriteMutationTarget(outfit);
    if (!target) return;
    const targetOutfitId = outfit.id;
    const targetOutfitKey = outfit.outfitKey;
    const modal = await Taro.showModal({
      title: '移出收藏？',
      content: '这套搭配会从你的灵感收藏夹里移除。',
      confirmColor: '#B8860B',
      cancelText: '先留着',
      confirmText: '移出收藏',
    });
    if (!modal.confirm) return;

    if (!isFavoriteMutationTargetCurrent(target)) return;
    try {
      await removeFavoriteOutfit(targetOutfitId, targetOutfitKey);
      if (!isFavoriteMutationTargetCurrent(target)) return;
      const nextOutfit = normalizeOutfitSnapshot({
        ...outfit,
        isFavorite: false,
        favoriteOutfitId: undefined,
        favoritedAt: undefined,
        outfitKind: 'recommendation',
      });
      syncFavoriteOutfitState(
        nextOutfit,
        {
          outfitKey: targetOutfitKey || nextOutfit.outfitKey || '',
          isFavorite: false,
          favoriteOutfitId: '',
          updatedAt: Date.now(),
        },
        target.authContext,
      );
      setOutfits((prev) => prev.filter((item) => item.id !== targetOutfitId));
      void Promise.all([
        invalidateAfterOutfitFavoriteMutation({ authContext: target.authContext }),
        invalidateOutfitDetailCache({ authContext: target.authContext }),
      ]);
      trackOutfitBehaviorEvent({
        schemaVersion: 1,
        eventId: createOutfitBehaviorEventId({
          pageSessionId: 'favorites',
          eventType: 'outfit_unfavorite',
        }),
        eventType: 'outfit_unfavorite',
        clientOccurredAt: new Date().toISOString(),
        ...buildOutfitBehaviorSnapshot(outfit),
        context: { source: 'favorites' },
      });
    } catch (err) {
      console.error('Unfavorite outfit error:', err);
      if (!isFavoriteMutationTargetCurrent(target)) return;
      Taro.showToast({ title: '移出失败，稍后再试', icon: 'none' });
    }
  }

  function closeRename() {
    if (renameSaving) return;
    renameTargetRef.current = null;
    setRenamingOutfit(null);
    setDraftName('');
  }

  async function saveRename() {
    if (!renamingOutfit || renameSaving) return;
    const target = renameTargetRef.current;
    if (!target || !isRenameMutationTargetCurrent(target)) return;
    const trimmed = draftName.trim();
    const currentTitle = renamingOutfit.userTitle || getOutfitDisplayTitle(renamingOutfit, '收藏的搭配');

    if (!trimmed) {
      Taro.showToast({ title: '名字不能为空', icon: 'none' });
      return;
    }
    if (Array.from(trimmed).length > MAX_TITLE_LENGTH) {
      Taro.showToast({ title: `最多 ${MAX_TITLE_LENGTH} 个字`, icon: 'none' });
      return;
    }
    if (trimmed === currentTitle) {
      closeRename();
      return;
    }

    setRenameSaving(true);
    try {
      const saved = await renameCloudOutfit({
        outfitId: renamingOutfit.outfitId || renamingOutfit.id,
        outfitKey: renamingOutfit.outfitKey,
        outfit: renamingOutfit,
        userTitle: trimmed,
      });
      if (!isRenameMutationTargetCurrent(target)) return;
      const nextOutfit = normalizeOutfitSnapshot({
        ...renamingOutfit,
        ...saved,
        id: renamingOutfit.id,
        userTitle: saved.userTitle ?? trimmed,
        displayTitle: saved.displayTitle ?? trimmed,
        title: saved.title || renamingOutfit.title,
        updatedAt: saved.updatedAt || renamingOutfit.updatedAt,
      });
      syncFavoriteOutfitState(
        nextOutfit,
        {
          ...getOutfitStatusPatch(saved, renamingOutfit.outfitKey, Date.now()),
          outfitKey: saved.outfitKey || renamingOutfit.outfitKey || nextOutfit.outfitKey || '',
          userTitle: saved.userTitle ?? trimmed,
          displayTitle: saved.displayTitle ?? trimmed,
          title: saved.title,
        },
        target.authContext,
      );
      setOutfits((prev) =>
        applyFavoriteOutfitStatuses(
          prev.map((item) =>
            item.id === renamingOutfit.id
              ? {
                  ...item,
                  ...nextOutfit,
                  id: item.id,
                }
              : item,
          ),
          target.authContext,
        ),
      );
      updateTodayRestoreSnapshotOutfit(nextOutfit, { authContext: target.authContext });
      void Promise.all([
        invalidateFavoritesCache({ authContext: target.authContext }),
        invalidateHistoryCache({ authContext: target.authContext }),
        invalidateOutfitDetailCache({ authContext: target.authContext }),
      ]);
      Taro.showToast({ title: '已更新名称', icon: 'success' });
      setRenameSaving(false);
      closeRename();
    } catch (err) {
      console.error('Rename favorite outfit error:', err);
      if (!isRenameMutationTargetCurrent(target)) return;
      Taro.showToast({ title: '名称暂时没保存，稍后再试', icon: 'none' });
    } finally {
      if (isRenameMutationTargetCurrent(target)) {
        setRenameSaving(false);
      }
    }
  }

  function captureFavoriteMutationTarget(outfit: Outfit): FavoriteMutationTarget | null {
    const authContext = captureAuthContext();
    if (!authContext) return null;

    return {
      authContext,
      outfitId: outfit.id,
      outfitKey: outfit.outfitKey ?? '',
    };
  }

  function isFavoriteMutationTargetCurrent(target: FavoriteMutationTarget) {
    return isCurrentAuthContext(target.authContext)
      && outfitsRef.current.some((item) => (
        item.id === target.outfitId
        && (item.outfitKey ?? '') === target.outfitKey
      ));
  }

  function isRenameMutationTargetCurrent(target: FavoriteMutationTarget) {
    return renameTargetRef.current === target && isFavoriteMutationTargetCurrent(target);
  }

  function syncFavoriteOutfitState(
    outfit: Outfit,
    statusPatch: OutfitStatusPatch,
    authContext: ActiveAuthContext,
  ) {
    const normalized = normalizeOutfitSnapshot(outfit);
    if (statusPatch.outfitKey) {
      setOutfitStatus(statusPatch, authContext);
    }
    const synced = applyFavoriteOutfitStatuses([normalized], authContext)[0] ?? normalized;
    storeOutfitDetailDraft(synced, { authContext });
    storeOutfitStateSync(synced, { authContext });
  }

  return (
    <View className="favorite-outfits-page" onClick={() => setActiveMenuId('')}>
      <View className="favorite-notebook">
        <View className="notebook-spine">
          <View className="spine-fold-line" />
          <View className="spine-stitch-line" />
          <View className="spine-holes">
            {Array.from({ length: 10 }).map((_, index) => (
              <View key={index} className="spine-hole" />
            ))}
          </View>
        </View>

        <View className="notebook-content">
          <View className="notebook-hero">
            <View className="hero-copy">
              <Text className="hero-kicker">OUTFIT NOTES</Text>
              <Text className="page-title">穿搭灵感收藏</Text>
              <Text className="page-subtitle">喜欢的搭配，都帮你收好了</Text>
            </View>
            <View className="memo-paper">
              <View className="memo-tape" />
              <Text className="memo-line">灵感已收好</Text>
              <Text className="memo-line">想穿就翻翻</Text>
            </View>
          </View>

          {error && outfits.length === 0 && (
            <View className="state-card">
              <View className="state-icon-wrap">
                <Text className="state-icon">!</Text>
              </View>
              <Text className="state-title">{error}</Text>
              <View className="state-action" onClick={() => fetchFavorites(1, true)}>
                <Text className="state-action-text">重新试试</Text>
              </View>
            </View>
          )}

          {!error && !loading && outfits.length === 0 && (
            <View className="state-card empty">
              <View className="state-icon-wrap">
                <Text className="state-icon">♡</Text>
              </View>
              <Text className="state-title">还没有收藏的搭配</Text>
              <Text className="state-desc">看到喜欢的搭配，可以先收进灵感本里。</Text>
              <View className="state-action" onClick={() => Taro.switchTab({ url: '/pages/today/index' })}>
                <Text className="state-action-text">去今日推荐看看</Text>
              </View>
            </View>
          )}

          {loading && outfits.length === 0 && (
            <View className="loading-state">
              <View className="skeleton-card">
                <View className="skeleton-img-row">
                  <View className="skeleton-img" />
                  <View className="skeleton-img" />
                  <View className="skeleton-img" />
                </View>
                <View className="skeleton-line short" />
                <View className="skeleton-line" />
              </View>
              <View className="skeleton-card">
                <View className="skeleton-img-row">
                  <View className="skeleton-img" />
                  <View className="skeleton-img" />
                  <View className="skeleton-img" />
                </View>
                <View className="skeleton-line short" />
                <View className="skeleton-line" />
              </View>
            </View>
          )}

          <ScrollView scrollY className="favorite-list" enhanced showScrollbar={false}>
            {outfits.map((outfit) => (
              <View key={outfit.id} className="outfit-card" onClick={() => handleCardClick(outfit.id)}>
                <View className="card-images">
                  {outfit.items?.slice(0, 3).map((item) => (
                    <View key={item.clothingId} className={`card-img-wrap ${item.isDeleted ? 'deleted' : ''}`}>
                      <SafeImage
                        className="card-img"
                        src={item.thumbnailUrl || item.imageUrl}
                        cacheIdentity={item.clothingId}
                        mode="aspectFill"
                        lazyLoad
                      />
                    </View>
                  ))}
                  {(!outfit.items || outfit.items.length < 3) && (
                    <>
                      {Array.from({ length: 3 - (outfit.items?.length ?? 0) }).map((_, idx) => (
                        <View key={`placeholder-${idx}`} className="card-img-wrap placeholder">
                          <View className="card-img-placeholder">
                            <Text className="placeholder-icon">衣</Text>
                          </View>
                        </View>
                      ))}
                    </>
                  )}
                </View>

                <View className="card-content">
                  <View className="card-title-row">
                    <Text className="card-title" numberOfLines={1}>
                      {getFavoriteDisplayTitle(outfit)}
                    </Text>
                    <View className="card-menu-wrap">
                      <View className="card-menu-btn" onClick={(event) => toggleMenu(outfit.id, event)}>
                        <Text className="card-menu-text">···</Text>
                      </View>
                      {activeMenuId === outfit.id && (
                        <View className="card-menu" onClick={(event: TapEvent) => event.stopPropagation()}>
                          <View className="card-menu-item" onClick={(event) => openRename(outfit, event)}>
                            <Text className="card-menu-item-text">重命名</Text>
                          </View>
                          <View className="card-menu-divider" />
                          <View className="card-menu-item danger" onClick={(event) => handleRemoveFavorite(outfit, event)}>
                            <Text className="card-menu-item-text">移出收藏</Text>
                          </View>
                        </View>
                      )}
                    </View>
                  </View>

                  <View className="card-meta">
                    {outfit.scene && (
                      <View className="meta-tag">
                        <Text className="meta-tag-text">{outfit.scene}</Text>
                      </View>
                    )}
                    {getOutfitStyleTags(outfit).slice(0, 2).map((tag) => (
                      <View key={tag} className="meta-tag">
                        <Text className="meta-tag-text">{tag}</Text>
                      </View>
                    ))}
                    {outfit.weatherSnapshot && (
                      <Text className="meta-time">{getOutfitWeatherSummary(outfit).chip}</Text>
                    )}
                    <Text className="meta-time">{formatDate(outfit.favoritedAt || outfit.createdAt)}</Text>
                  </View>

                  {getSavedSnapshotDefaultCopy(outfit) ? (
                    <View className="reason-note">
                      <Text className="reason-quote">“</Text>
                      <Text className="card-reason" numberOfLines={2}>
                        {getSavedSnapshotDefaultCopy(outfit)}
                      </Text>
                    </View>
                  ) : null}

                  {getDeletedItemCount(outfit) > 0 && (
                    <View className="card-deleted-notice">
                      <Text className="deleted-notice-text">有几件衣物已不在衣橱，仍为你保留当时的搭配灵感。</Text>
                    </View>
                  )}
                </View>
              </View>
            ))}
          </ScrollView>

          {loading && outfits.length > 0 && (
            <View className="load-more">
              <Text className="load-more-text">正在翻找你的收藏灵感...</Text>
            </View>
          )}

          {!loading && outfits.length > 0 && !hasMore && (
            <View className="load-more">
              <Text className="load-more-text">已经看到收藏夹底部啦</Text>
            </View>
          )}

          <View className="safe-bottom" />
        </View>
      </View>

      {renamingOutfit && (
        <View className="rename-overlay" onClick={closeRename}>
          <View className="rename-modal" onClick={(event: TapEvent) => event.stopPropagation()}>
            <Text className="rename-title">给这套搭配起个名字</Text>
            <Input
              className="rename-input"
              value={draftName}
              maxlength={MAX_TITLE_LENGTH}
              placeholder="比如：周一通勤不费脑"
              placeholderClass="rename-placeholder"
              onInput={(event) => setDraftName(String(event.detail.value ?? ''))}
            />
            <View className="rename-actions">
              <View className="rename-btn ghost" onClick={closeRename}>
                <Text className="rename-btn-text">取消</Text>
              </View>
              <View className={`rename-btn primary ${renameSaving ? 'disabled' : ''}`} onClick={saveRename}>
                <Text className="rename-btn-text">{renameSaving ? '保存中...' : '保存'}</Text>
              </View>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

async function writeFavoritesFirstPageCache(
  data: FavoritesFirstPageCache,
  authContext: ActiveAuthContext | null,
) {
  await setUserPageCache(FAVORITES_FIRST_PAGE_CACHE_KEY, data, {
    ttl: FAVORITES_FIRST_PAGE_CACHE_TTL,
    authContext,
    meta: {
      pageSize: data.pageSize,
    },
  });
}

function applyFavoriteOutfitStatuses(outfits: Outfit[], authContext?: ActiveAuthContext | null) {
  return applyOutfitStatuses(outfits, authContext);
}

function getOutfitStatusPatches(outfits: Outfit[]) {
  return outfits.map((outfit) => getOutfitStatusPatch(outfit)).filter((patch) => Boolean(patch.outfitKey));
}

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
  if (outfit.todayHistoryId !== undefined) patch.todayHistoryId = outfit.todayHistoryId;
  if (outfit.wornAt !== undefined) patch.wornAt = outfit.wornAt;
  if (outfit.wornDate !== undefined) patch.wornDate = outfit.wornDate;
  if (outfit.userTitle !== undefined) patch.userTitle = outfit.userTitle;
  if (outfit.displayTitle !== undefined) patch.displayTitle = outfit.displayTitle;
  if (outfit.title !== undefined) patch.title = outfit.title;

  return patch;
}

function getOutfitStatusUpdatedAt(updatedAt: string | undefined) {
  if (!updatedAt) return undefined;
  const timestamp = Date.parse(updatedAt);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function isSameFavoriteOutfitList(prev: Outfit[], next: Outfit[]) {
  if (prev.length !== next.length) return false;
  return prev.every((item, index) => {
    const nextItem = next[index];
    if (!nextItem) return false;
    return (
      item.id === nextItem.id
      && item.isFavorite === nextItem.isFavorite
      && item.favoriteOutfitId === nextItem.favoriteOutfitId
      && item.isWornToday === nextItem.isWornToday
      && item.todayHistoryId === nextItem.todayHistoryId
      && item.wornAt === nextItem.wornAt
      && item.wornDate === nextItem.wornDate
      && item.userTitle === nextItem.userTitle
      && item.displayTitle === nextItem.displayTitle
      && item.title === nextItem.title
    );
  });
}

function formatDate(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `${month}月${day}日收藏`;
}

function getDeletedItemCount(outfit: Outfit) {
  if (typeof outfit.deletedItemCount === 'number') return outfit.deletedItemCount;
  const snapshotCount = outfit.snapshotItems?.filter((item) => item.isDeleted || item.deletedAt).length ?? 0;
  const itemCount = outfit.items?.filter((item) => item.isDeleted).length ?? 0;
  return Math.max(snapshotCount, itemCount);
}

function getFavoriteDisplayTitle(outfit: Outfit) {
  return getOutfitDisplayTitle(outfit, '穿搭灵感');
}
