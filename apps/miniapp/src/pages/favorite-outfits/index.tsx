import { View, Text, ScrollView } from '@tarojs/components';
import Taro, { useLoad, usePullDownRefresh, useReachBottom } from '@tarojs/taro';
import { useState } from 'react';
import { getCloudOutfitList, setCloudOutfitFavorite } from '@/lib/cloud';
import type { Outfit } from '@starter-template/types';
import './index.scss';

const PAGE_SIZE = 10;

interface TapEvent {
  stopPropagation: () => void;
}

function getDeletedItemCount(outfit: Outfit) {
  if (typeof outfit.deletedItemCount === 'number') return outfit.deletedItemCount;
  const snapshotCount = outfit.snapshotItems?.filter((item) => item.isDeleted).length ?? 0;
  const itemCount = outfit.items?.filter((item) => item.isDeleted).length ?? 0;
  return Math.max(snapshotCount, itemCount);
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
      const data = await getCloudOutfitList({ isFavorite: true, page: pageNum, pageSize: PAGE_SIZE });
      setOutfits((prev) => (reset ? data.list : [...prev, ...data.list]));
      setHasMore(pageNum < data.pagination.totalPages);
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
    Taro.navigateTo({ url: `/pages/outfit-detail/index?id=${outfitId}` });
  }

  async function handleUnfavorite(outfit: Outfit) {
    try {
      await setCloudOutfitFavorite(outfit.id, false);
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
          <Text className="state-desc">遇到喜欢的推荐，点一下收藏就会出现在这里。</Text>
          <View className="state-action" onClick={() => Taro.switchTab({ url: '/pages/today/index' })}>
            <Text className="state-action-text">去今日页</Text>
          </View>
        </View>
      )}

      <ScrollView scrollY className="favorite-list">
        {outfits.map((outfit) => {
          const deletedItemCount = getDeletedItemCount(outfit);

          return (
            <View key={outfit.id} className="favorite-card" onClick={() => goToOutfitDetail(outfit.id)}>
              <View className="favorite-header">
                <View className="favorite-title-wrap">
                  <Text className="favorite-title">{outfit.title || '收藏穿搭'}</Text>
                  <Text className="favorite-meta">
                    {[outfit.scene, outfit.targetDate].filter(Boolean).join(' · ') || '日常搭配'}
                  </Text>
                </View>
                <Text className={`favorite-badge ${deletedItemCount > 0 ? 'incomplete' : ''}`}>
                  {deletedItemCount > 0 ? '不完整' : '已收藏'}
                </Text>
              </View>

              {deletedItemCount > 0 && (
                <View className="deleted-notice">
                  <Text className="deleted-notice-text">该搭配中有 {deletedItemCount} 件衣服已删除</Text>
                </View>
              )}

              <View className="favorite-info">
                <View className="info-pill">
                  <Text className="info-num">{outfit.clothingIds.length}</Text>
                  <Text className="info-label">件单品</Text>
                </View>
                {outfit.scores && (
                  <View className="info-pill">
                    <Text className="info-num">{outfit.scores.sceneMatch}</Text>
                    <Text className="info-label">场景分</Text>
                  </View>
                )}
                {outfit.isWornToday && (
                  <View className="info-pill worn">
                    <Text className="info-label">今日已穿</Text>
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
          );
        })}
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
