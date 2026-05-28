import { Image, ScrollView, Text, View } from '@tarojs/components';
import Taro, { useLoad, usePullDownRefresh, useReachBottom } from '@tarojs/taro';
import { useState } from 'react';
import { listFavoriteOutfits, removeFavoriteOutfit } from '@/lib/cloud';
import { getOutfitDisplayTitle } from '@/utils/outfitTitle';
import type { Outfit } from '@starter-template/types';
import './index.scss';

const PAGE_SIZE = 10;

interface TapEvent {
  stopPropagation: () => void;
}

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
      setError('收藏加载失败');
      Taro.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      setLoading(false);
    }
  }

  function goToOutfitDetail(outfitId: string) {
    Taro.navigateTo({ url: `/pages/outfit-detail/index?id=${encodeURIComponent(outfitId)}&source=favorite` });
  }

  async function handleUnfavorite(outfit: Outfit) {
    try {
      await removeFavoriteOutfit(outfit.id);
      setOutfits((prev) => prev.filter((item) => item.id !== outfit.id));
      Taro.showToast({ title: '已取消收藏', icon: 'success' });
    } catch (err) {
      console.error('Unfavorite outfit error:', err);
      Taro.showToast({ title: '操作失败', icon: 'none' });
    }
  }

  return (
    <View className="favorite-outfits-page">
      {error && outfits.length === 0 && (
        <View className="state-card">
          <Text className="state-title">{error}</Text>
          <View className="state-action" onClick={() => fetchFavorites(1, true)}>
            <Text className="state-action-text">重新加载</Text>
          </View>
        </View>
      )}

      {!error && !loading && outfits.length === 0 && (
        <View className="state-card">
          <Text className="state-title">还没有收藏穿搭</Text>
          <Text className="state-desc">看到喜欢的搭配，点击「收藏」后会出现在这里。</Text>
          <View className="state-action" onClick={() => Taro.switchTab({ url: '/pages/today/index' })}>
            <Text className="state-action-text">去今日页</Text>
          </View>
        </View>
      )}

      <ScrollView scrollY className="favorite-list">
        {outfits.map((outfit) => (
          <View key={outfit.id} className="favorite-card" onClick={() => goToOutfitDetail(outfit.id)}>
            <View className="favorite-header">
              <View className="favorite-title-wrap">
                <Text className="favorite-title">{getOutfitDisplayTitle(outfit, '收藏穿搭')}</Text>
                <Text className="favorite-meta">{formatMeta(outfit)}</Text>
              </View>
              <Text className={`favorite-badge ${getDeletedItemCount(outfit) > 0 ? 'incomplete' : ''}`}>
                {getDeletedItemCount(outfit) > 0 ? '不完整' : '已收藏'}
              </Text>
            </View>

            {getDeletedItemCount(outfit) > 0 && (
              <View className="deleted-notice">
                <Text className="deleted-notice-text">部分单品已从衣柜删除，仍按收藏快照展示。</Text>
              </View>
            )}

            <View className="thumb-row">
              {outfit.items?.slice(0, 4).map((item) => (
                <Image key={item.clothingId} className="thumb-image" src={item.imageUrl} mode="aspectFill" lazyLoad />
              ))}
            </View>

            <Text className="reason-preview">{outfit.reasoning || outfit.reason || '这套搭配已保存为收藏。'}</Text>

            <View className="favorite-info">
              <View className="info-pill">
                <Text className="info-num">{outfit.clothingIds.length}</Text>
                <Text className="info-label">件单品</Text>
              </View>
              {outfit.scores && (
                <View className="info-pill">
                  <Text className="info-num">{outfit.scores.fashion}</Text>
                  <Text className="info-label">时尚分</Text>
                </View>
              )}
            </View>

            <View className="favorite-actions">
              <Text className="detail-text">查看详情</Text>
              <View
                className="unfavorite-btn"
                onClick={(event: TapEvent) => {
                  event.stopPropagation();
                  handleUnfavorite(outfit);
                }}
              >
                <Text className="unfavorite-text">取消收藏</Text>
              </View>
            </View>
          </View>
        ))}
      </ScrollView>

      {loading && (
        <View className="loading-row">
          <Text className="loading-text">加载中...</Text>
        </View>
      )}

      {!loading && outfits.length > 0 && !hasMore && (
        <View className="loading-row">
          <Text className="loading-text">没有更多收藏了</Text>
        </View>
      )}
    </View>
  );
}

function formatMeta(outfit: Outfit) {
  return [outfit.scene, formatDate(outfit.favoritedAt || outfit.createdAt)].filter(Boolean).join(' · ') || '日常搭配';
}

function formatDate(value?: string) {
  if (!value) return '';
  return value.slice(0, 10);
}

function getDeletedItemCount(outfit: Outfit) {
  if (typeof outfit.deletedItemCount === 'number') return outfit.deletedItemCount;
  const snapshotCount = outfit.snapshotItems?.filter((item) => item.isDeleted || item.deletedAt).length ?? 0;
  const itemCount = outfit.items?.filter((item) => item.isDeleted).length ?? 0;
  return Math.max(snapshotCount, itemCount);
}
