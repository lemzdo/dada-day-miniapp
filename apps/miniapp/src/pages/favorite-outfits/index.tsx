import { Image, ScrollView, Text, View } from '@tarojs/components';
import Taro, { useLoad, usePullDownRefresh, useReachBottom } from '@tarojs/taro';
import { useState } from 'react';
import { listFavoriteOutfits, removeFavoriteOutfit } from '@/lib/cloud';
import { getOutfitDisplayTitle } from '@/utils/outfitTitle';
import type { Outfit } from '@starter-template/types';
import './index.scss';

const PAGE_SIZE = 10;

export default function FavoriteOutfitsPage() {
  const [outfits, setOutfits] = useState<Outfit[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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

  function goToOutfitDetail(outfitId: string) {
    Taro.navigateTo({ url: `/pages/outfit-detail/index?id=${encodeURIComponent(outfitId)}&source=favorite` });
  }

  async function handleToggleFavorite(outfit: Outfit) {
    try {
      await removeFavoriteOutfit(outfit.id, outfit.outfitKey);
      setOutfits((prev) => prev.filter((item) => item.id !== outfit.id));
    } catch (err) {
      console.error('Unfavorite outfit error:', err);
      Taro.showToast({ title: '移出失败，稍后再试', icon: 'none' });
    }
  }

  function handleCardClick(outfitId: string) {
    goToOutfitDetail(outfitId);
  }

  function handleFavoriteClick(outfit: Outfit, e: { stopPropagation: () => void }) {
    e.stopPropagation();
    Taro.showModal({
      title: '移出收藏？',
      content: '这套搭配会从你的灵感收藏夹里移除。',
      confirmColor: '#B8860B',
      cancelText: '先留着',
      confirmText: '移出收藏',
      success: (res) => {
        if (res.confirm) {
          handleToggleFavorite(outfit);
        }
      },
    });
  }

  return (
    <View className="favorite-outfits-page">
      <View className="page-header">
        <Text className="page-title">穿搭灵感收藏</Text>
        <Text className="page-subtitle">喜欢的搭配，都帮你收好了</Text>
      </View>

      {error && outfits.length === 0 && (
        <View className="state-card">
          <View className="state-icon-wrap">
            <Text className="state-icon">🌸</Text>
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
            <Text className="state-icon">💝</Text>
          </View>
          <Text className="state-title">还没有收藏穿搭灵感</Text>
          <Text className="state-desc">看到喜欢的搭配，点一下收藏，小搭会帮你收好。</Text>
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
            <View className="card-favorite-btn" onClick={(e) => handleFavoriteClick(outfit, e)}>
              <Text className="favorite-icon">♥</Text>
            </View>

            <View className="card-images">
              {outfit.items?.slice(0, 3).map((item, idx) => (
                <View key={item.clothingId} className={`card-img-wrap ${item.isDeleted ? 'deleted' : ''}`}>
                  <Image
                    className="card-img"
                    src={item.imageUrl}
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
                        <Text className="placeholder-icon">👗</Text>
                      </View>
                    </View>
                  ))}
                </>
              )}
            </View>

            <View className="card-content">
              <Text className="card-title" numberOfLines={2}>
                {getOutfitDisplayTitle(outfit, '收藏的搭配')}
              </Text>

              <View className="card-meta">
                {outfit.scene && (
                  <View className="meta-tag">
                    <Text className="meta-tag-text">{outfit.scene}</Text>
                  </View>
                )}
                <Text className="meta-time">{formatDate(outfit.favoritedAt || outfit.createdAt)}</Text>
              </View>

              {(outfit.reasoning || outfit.reason) && (
                <Text className="card-reason" numberOfLines={2}>
                  {outfit.reasoning || outfit.reason}
                </Text>
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
