import { Image, ScrollView, Text, View } from '@tarojs/components';
import Taro, { useLoad, usePullDownRefresh, useReachBottom } from '@tarojs/taro';
import { useState } from 'react';
import { listOutfitHistory } from '@/lib/cloud';
import type { Outfit } from '@starter-template/types';
import './index.scss';

const PAGE_SIZE = 10;

export default function OutfitHistoryPage() {
  const [records, setRecords] = useState<Outfit[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useLoad(() => {
    fetchHistory(1, true);
  });

  usePullDownRefresh(() => {
    fetchHistory(1, true).finally(() => {
      Taro.stopPullDownRefresh();
    });
  });

  useReachBottom(() => {
    if (loading || !hasMore) return;
    const nextPage = page + 1;
    setPage(nextPage);
    fetchHistory(nextPage);
  });

  async function fetchHistory(pageNum: number, reset = false) {
    if (loading) return;

    setLoading(true);
    setError('');
    try {
      const data = await listOutfitHistory({ page: pageNum, pageSize: PAGE_SIZE });
      setRecords((prev) => (reset ? data.list : [...prev, ...data.list]));
      setHasMore(data.hasMore);
      if (reset) setPage(1);
    } catch (err) {
      console.error('Fetch outfit history error:', err);
      setError('历史加载失败');
      Taro.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      setLoading(false);
    }
  }

  function goToDetail(record: Outfit) {
    Taro.navigateTo({ url: `/pages/outfit-detail/index?id=${encodeURIComponent(record.id)}&source=history` });
  }

  const stats = buildStats(records);

  return (
    <View className="outfit-history-page">
      <View className="stats-card">
        <View className="stat-item">
          <Text className="stat-num">{stats.days}</Text>
          <Text className="stat-label">记录天数</Text>
        </View>
        <View className="stat-item">
          <Text className="stat-num">{records.length}</Text>
          <Text className="stat-label">穿搭次数</Text>
        </View>
        <View className="stat-item">
          <Text className="stat-num">{stats.items}</Text>
          <Text className="stat-label">出现单品</Text>
        </View>
      </View>

      {error && records.length === 0 && (
        <View className="state-card">
          <Text className="state-title">{error}</Text>
          <View className="state-action" onClick={() => fetchHistory(1, true)}>
            <Text className="state-action-text">重新加载</Text>
          </View>
        </View>
      )}

      {!error && !loading && records.length === 0 && (
        <View className="state-card">
          <Text className="state-title">还没有穿搭记录</Text>
          <Text className="state-desc">点击「穿它」后，会在这里留下你的每日穿搭。</Text>
          <View className="state-action" onClick={() => Taro.switchTab({ url: '/pages/today/index' })}>
            <Text className="state-action-text">去今日页</Text>
          </View>
        </View>
      )}

      <ScrollView scrollY className="history-list">
        {records.map((record) => (
          <View key={record.id} className="history-card" onClick={() => goToDetail(record)}>
            <View className="history-date">
              <Text className="date-text">{formatDay(record.wornAt || record.createdAt)}</Text>
              <Text className="date-year">{formatYear(record.wornAt || record.createdAt)}</Text>
            </View>

            <View className="history-main">
              <View className="history-header">
                <Text className="history-title">{record.title || '穿搭记录'}</Text>
                <Text className="detail-hint">详情</Text>
              </View>

              <Text className="history-meta">{[record.scene, formatWeather(record)].filter(Boolean).join(' · ')}</Text>

              <View className="thumb-row">
                {record.items?.slice(0, 4).map((item) => (
                  <Image key={item.clothingId} className="thumb-image" src={item.imageUrl} mode="aspectFill" lazyLoad />
                ))}
              </View>

              <Text className="history-weather">{record.reasoning || record.reason || '已记录这次穿搭。'}</Text>
            </View>
          </View>
        ))}
      </ScrollView>

      {loading && (
        <View className="loading-row">
          <Text className="loading-text">加载中...</Text>
        </View>
      )}

      {!loading && records.length > 0 && !hasMore && (
        <View className="loading-row">
          <Text className="loading-text">没有更多历史了</Text>
        </View>
      )}
    </View>
  );
}

function buildStats(records: Outfit[]) {
  const days = new Set(records.map((item) => (item.wornAt || item.createdAt).slice(0, 10))).size;
  const items = new Set(records.flatMap((item) => item.clothingIds)).size;
  return { days, items };
}

function formatDay(value?: string) {
  if (!value) return '--';
  return value.slice(5, 10);
}

function formatYear(value?: string) {
  if (!value) return '';
  return value.slice(0, 4);
}

function formatWeather(record: Outfit) {
  const weather = record.weatherSnapshot;
  if (!weather) return '';
  return [weather.weather, `${weather.temp}度`].filter(Boolean).join(' ');
}
