import { Input, ScrollView, Text, View } from '@tarojs/components';
import Taro, { useLoad, usePullDownRefresh, useReachBottom } from '@tarojs/taro';
import { useState } from 'react';
import { SafeImage } from '@/components/SafeImage';
import { listFavoriteOutfits, removeFavoriteOutfit, renameCloudOutfit } from '@/lib/cloud';
import { getOutfitDisplayTitle } from '@/utils/outfitTitle';
import type { Outfit } from '@starter-template/types';
import './index.scss';

const PAGE_SIZE = 10;
const MAX_TITLE_LENGTH = 16;

interface TapEvent {
  stopPropagation: () => void;
}

export default function FavoriteOutfitsPage() {
  const [outfits, setOutfits] = useState<Outfit[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeMenuId, setActiveMenuId] = useState('');
  const [renamingOutfit, setRenamingOutfit] = useState<Outfit | null>(null);
  const [draftName, setDraftName] = useState('');
  const [renameSaving, setRenameSaving] = useState(false);

  useLoad(() => {
    fetchFavorites(1, true);
  });

  usePullDownRefresh(() => {
    fetchFavorites(1, true).finally(() => {
      Taro.stopPullDownRefresh();
    });
  });

  useReachBottom(() => {
    if (loading || !hasMore) return;
    const nextPage = page + 1;
    setPage(nextPage);
    fetchFavorites(nextPage);
  });

  async function fetchFavorites(pageNum: number, reset = false) {
    if (loading) return;

    setLoading(true);
    setError('');
    try {
      const data = await listFavoriteOutfits({ page: pageNum, pageSize: PAGE_SIZE });
      setOutfits((prev) => (reset ? data.list : [...prev, ...data.list]));
      setHasMore(data.hasMore);
      if (reset) setPage(1);
    } catch (err) {
      console.error('Fetch favorite outfits error:', err);
      setError('收藏灵感暂时没加载出来');
    } finally {
      setLoading(false);
    }
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
    setActiveMenuId('');
    setRenamingOutfit(outfit);
    setDraftName(outfit.userTitle || getOutfitDisplayTitle(outfit, '收藏的搭配'));
  }

  async function handleRemoveFavorite(outfit: Outfit, event?: TapEvent) {
    event?.stopPropagation();
    setActiveMenuId('');
    const modal = await Taro.showModal({
      title: '移出收藏？',
      content: '这套搭配会从你的灵感收藏夹里移除。',
      confirmColor: '#B8860B',
      cancelText: '先留着',
      confirmText: '移出收藏',
    });
    if (!modal.confirm) return;

    try {
      await removeFavoriteOutfit(outfit.id, outfit.outfitKey);
      setOutfits((prev) => prev.filter((item) => item.id !== outfit.id));
    } catch (err) {
      console.error('Unfavorite outfit error:', err);
      Taro.showToast({ title: '移出失败，稍后再试', icon: 'none' });
    }
  }

  function closeRename() {
    if (renameSaving) return;
    setRenamingOutfit(null);
    setDraftName('');
  }

  async function saveRename() {
    if (!renamingOutfit || renameSaving) return;
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
      setOutfits((prev) =>
        prev.map((item) =>
          item.id === renamingOutfit.id
            ? {
                ...item,
                ...saved,
                id: item.id,
                userTitle: trimmed,
                displayTitle: trimmed,
                updatedAt: saved.updatedAt || item.updatedAt,
              }
            : item,
        ),
      );
      Taro.showToast({ title: '已更新名称', icon: 'success' });
      closeRename();
    } catch (err) {
      console.error('Rename favorite outfit error:', err);
      Taro.showToast({ title: '名称暂时没保存，稍后再试', icon: 'none' });
    } finally {
      setRenameSaving(false);
    }
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
                    <Text className="meta-time">{formatDate(outfit.favoritedAt || outfit.createdAt)}</Text>
                  </View>

                  {(outfit.reasoning || outfit.reason) && (
                    <View className="reason-note">
                      <Text className="reason-quote">“</Text>
                      <Text className="card-reason" numberOfLines={2}>
                        {outfit.reasoning || outfit.reason}
                      </Text>
                    </View>
                  )}

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
