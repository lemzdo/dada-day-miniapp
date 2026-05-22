import { View, Text, Image, ScrollView } from '@tarojs/components';
import Taro, { useLoad, useRouter } from '@tarojs/taro';
import { useState } from 'react';
import { confirmCloudWear, getCloudOutfit, setCloudOutfitFavorite } from '@/lib/cloud';
import type { Outfit, OutfitScores } from '@starter-template/types';
import './index.scss';

const scoreLabels: Record<keyof OutfitScores, string> = {
  total: '总分',
  weatherAdaptation: '天气',
  styleUnity: '风格',
  freshness: '新鲜',
  preference: '偏好',
  fashion: '时尚',
  comfort: '舒适',
  warmth: '保暖',
  coolness: '清爽',
  sceneMatch: '场景',
  colorHarmony: '配色',
};

function getDeletedItemCount(outfit: Outfit) {
  if (typeof outfit.deletedItemCount === 'number') return outfit.deletedItemCount;
  const snapshotCount = outfit.snapshotItems?.filter((item) => item.isDeleted).length ?? 0;
  const itemCount = outfit.items?.filter((item) => item.isDeleted).length ?? 0;
  return Math.max(snapshotCount, itemCount);
}

export default function OutfitDetailPage() {
  const router = useRouter();
  const id = router.params.id;
  const [outfit, setOutfit] = useState<Outfit | null>(null);
  const [loading, setLoading] = useState(true);
  const [operating, setOperating] = useState(false);

  useLoad(() => {
    if (id) fetchOutfit(id);
    else setLoading(false);
  });

  async function fetchOutfit(outfitId: string) {
    setLoading(true);
    try {
      setOutfit(await getCloudOutfit(outfitId));
    } catch (err) {
      console.error('Fetch outfit detail error:', err);
      Taro.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      setLoading(false);
    }
  }

  async function handleToggleFavorite() {
    if (!outfit || operating) return;

    setOperating(true);
    try {
      const nextFavorite = !outfit.isFavorite;
      const updated = await setCloudOutfitFavorite(outfit.id, nextFavorite);
      setOutfit(updated);
      Taro.showToast({ title: nextFavorite ? '已收藏' : '已取消收藏', icon: 'success' });
    } catch (err) {
      console.error('Toggle outfit favorite error:', err);
      Taro.showToast({ title: '操作失败', icon: 'none' });
    } finally {
      setOperating(false);
    }
  }

  async function handleConfirmWear() {
    if (!outfit || operating || outfit.isWornToday) return;

    setOperating(true);
    try {
      const updated = await confirmCloudWear(outfit.id);
      setOutfit(updated);
      Taro.showToast({ title: '已确认今日穿搭', icon: 'success' });
    } catch (err) {
      console.error('Confirm outfit wear error:', err);
      Taro.showToast({ title: '操作失败', icon: 'none' });
    } finally {
      setOperating(false);
    }
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

  const scoreEntries = outfit.scores
    ? (Object.entries(outfit.scores) as Array<[keyof OutfitScores, number]>)
    : [];
  const deletedItemCount = getDeletedItemCount(outfit);

  return (
    <View className="outfit-detail-page">
      <ScrollView scrollY className="detail-scroll">
        <View className="hero-card">
          <View className="hero-header">
            <View>
              <Text className="hero-title">{outfit.title || '今日推荐穿搭'}</Text>
              <Text className="hero-subtitle">
                {[outfit.scene, outfit.timeOfDay, outfit.targetDate].filter(Boolean).join(' · ')}
              </Text>
            </View>
            {outfit.isFavorite && <Text className="favorite-mark">已收藏</Text>}
          </View>

          {deletedItemCount > 0 && (
            <View className="deleted-notice">
              <Text className="deleted-notice-text">该搭配中有 {deletedItemCount} 件衣服已删除</Text>
            </View>
          )}

          <View className="outfit-items">
            {outfit.items?.map((item) => (
              <View key={item.clothingId} className={`outfit-item ${item.isDeleted ? 'deleted' : ''}`}>
                <Image className="item-image" src={item.imageUrl} mode="aspectFit" lazyLoad />
                <Text className="item-name">{item.subcategory || item.category}</Text>
              </View>
            ))}
          </View>
        </View>

        {outfit.weatherSnapshot && (
          <View className="detail-card">
            <Text className="card-title">天气参考</Text>
            <View className="weather-grid">
              <WeatherValue label="温度" value={`${outfit.weatherSnapshot.temp}度`} />
              <WeatherValue label="天气" value={outfit.weatherSnapshot.weather} />
              <WeatherValue label="湿度" value={`${outfit.weatherSnapshot.humidity}%`} />
            </View>
          </View>
        )}

        {scoreEntries.length > 0 && (
          <View className="detail-card">
            <Text className="card-title">穿搭评分</Text>
            {scoreEntries.map(([key, value]) => (
              <ScoreValue key={key} label={scoreLabels[key] ?? key} value={value} />
            ))}
          </View>
        )}

        {outfit.reasoning && (
          <View className="detail-card">
            <Text className="card-title">搭配理由</Text>
            <Text className="reasoning-text">{outfit.reasoning}</Text>
          </View>
        )}
      </ScrollView>

      <View className="action-bar">
        <View
          className={`action-btn favorite ${outfit.isFavorite ? 'active' : ''}`}
          onClick={handleToggleFavorite}
        >
          <Text className="btn-text">{outfit.isFavorite ? '取消收藏' : '收藏'}</Text>
        </View>
        <View
          className={`action-btn wear ${outfit.isWornToday ? 'disabled' : ''}`}
          onClick={handleConfirmWear}
        >
          <Text className="btn-text">{outfit.isWornToday ? '已确认' : '穿它'}</Text>
        </View>
      </View>
    </View>
  );
}

function WeatherValue({ label, value }: { label: string; value: string }) {
  return (
    <View className="weather-item">
      <Text className="weather-value">{value}</Text>
      <Text className="weather-label">{label}</Text>
    </View>
  );
}

function ScoreValue({ label, value }: { label: string; value: number }) {
  const score = formatScore(value);

  return (
    <View className="score-row">
      <Text className="score-label">{label}</Text>
      <View className="score-track">
        <View className="score-fill" style={{ width: `${score * 10}%` }} />
      </View>
      <Text className="score-value">{score}</Text>
    </View>
  );
}

function formatScore(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(10, Math.round(value * 10) / 10));
}
