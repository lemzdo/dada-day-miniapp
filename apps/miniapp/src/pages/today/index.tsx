import { View, Text, Image } from '@tarojs/components';
import Taro, { useDidShow, useLoad, usePullDownRefresh, useUnload } from '@tarojs/taro';
import { useRef, useState } from 'react';
import { WeatherCard } from '@/components/WeatherCard';
import {
  confirmCloudWear,
  generateCloudOutfit,
  getCloudOutfit,
  setCloudOutfitFavorite,
} from '@/lib/cloud';
import sceneDate from '@/assets/scenes/scene-date-clean.png';
import sceneDateActive from '@/assets/scenes/scene-date-active-clean.png';
import sceneHome from '@/assets/scenes/scene-home-clean.png';
import sceneHomeActive from '@/assets/scenes/scene-home-active-clean.png';
import sceneSport from '@/assets/scenes/scene-sport-clean.png';
import sceneSportActive from '@/assets/scenes/scene-sport-active-clean.png';
import sceneWork from '@/assets/scenes/scene-work-clean.png';
import sceneWorkActive from '@/assets/scenes/scene-work-active-clean.png';
import type { Outfit, SceneTag } from '@starter-template/types';
import './index.scss';

interface TapEvent {
  stopPropagation: () => void;
}

type OutfitOperation = 'favorite' | 'wear' | 'refresh' | null;

type SceneKey = 'home' | 'work' | 'date' | 'sport';

const SCENES = [
  { key: 'home', label: '\u5c45\u5bb6', icon: sceneHome, activeIcon: sceneHomeActive },
  { key: 'work', label: '\u4e0a\u73ed', icon: sceneWork, activeIcon: sceneWorkActive },
  { key: 'date', label: '\u7ea6\u4f1a', icon: sceneDate, activeIcon: sceneDateActive },
  { key: 'sport', label: '\u8fd0\u52a8', icon: sceneSport, activeIcon: sceneSportActive },
] as const;

const SCENE_TAGS: Record<SceneKey, SceneTag> = {
  home: '\u5c45\u5bb6' as SceneTag,
  work: '\u4e0a\u73ed' as SceneTag,
  date: '\u7ea6\u4f1a' as SceneTag,
  sport: '\u8fd0\u52a8' as SceneTag,
};

function getDeletedItemCount(outfit: Outfit) {
  if (typeof outfit.deletedItemCount === 'number') return outfit.deletedItemCount;
  const snapshotCount = outfit.snapshotItems?.filter((item) => item.isDeleted).length ?? 0;
  const itemCount = outfit.items?.filter((item) => item.isDeleted).length ?? 0;
  return Math.max(snapshotCount, itemCount);
}

export default function TodayPage() {
  const [selectedSceneKey, setSelectedSceneKey] = useState<SceneKey>('home');
  const [outfits, setOutfits] = useState<Outfit[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [operation, setOperation] = useState<OutfitOperation>(null);
  const [hasRecommendations, setHasRecommendations] = useState(true);
  const [error, setError] = useState('');
  const [recommendationNotice, setRecommendationNotice] = useState('');
  const requestSeq = useRef(0);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedScene = SCENE_TAGS[selectedSceneKey];

  useLoad(() => {
    fetchRecommendations({ scene: selectedScene });
  });

  useDidShow(() => {
    const current = outfits[currentIndex];
    if (!current || loading || operation) return;
    scheduleCurrentOutfitSync(current.id);
  });

  useUnload(() => {
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
  });

  usePullDownRefresh(() => {
    fetchRecommendations({ scene: selectedScene }).finally(() => {
      Taro.stopPullDownRefresh();
    });
  });

  async function fetchRecommendations({ scene }: { scene: SceneTag }) {
    const seq = nextRequestSeq();
    setLoading(true);
    setError('');
    setRecommendationNotice('');

    try {
      const data = await generateCloudOutfit({
        date: getToday(),
        scene,
        timeOfDay: 'all_day',
      });

      if (!isLatestRequest(seq)) return;
      setOutfits(data.outfits.slice(0, 3));
      setCurrentIndex(0);
      setHasRecommendations(data.outfits.length > 0);
      setRecommendationNotice(data.recommendationNotice ?? '');
    } catch (err) {
      if (!isLatestRequest(seq)) return;
      console.error('Fetch recommendations error:', err);
      setError('获取推荐失败，请稍后再试');
      setOutfits([]);
      setHasRecommendations(false);
      setRecommendationNotice('');
      Taro.showToast({ title: '获取推荐失败', icon: 'none' });
    } finally {
      if (isLatestRequest(seq)) setLoading(false);
    }
  }

  async function handleRefresh() {
    if (loading || operation) return;

    const seq = nextRequestSeq();
    setOperation('refresh');
    setError('');
    setRecommendationNotice('');

    try {
      const data = await generateCloudOutfit({
        date: getToday(),
        scene: selectedScene,
        timeOfDay: 'all_day',
        excludeClothingIdSets: outfits.map((outfit) => outfit.clothingIds),
      });

      if (!isLatestRequest(seq)) return;

      if (data.outfits.length > 0) {
        setOutfits(data.outfits.slice(0, 3));
        setCurrentIndex(0);
        setHasRecommendations(true);
        setRecommendationNotice(data.recommendationNotice ?? '');
      } else {
        const notice = data.recommendationNotice ?? '暂时没有更多搭配';
        setRecommendationNotice(notice);
        Taro.showToast({ title: notice, icon: 'none' });
      }
    } catch (err) {
      if (!isLatestRequest(seq)) return;
      console.error('Refresh recommendations error:', err);
      setError('换一套失败，请稍后再试');
      Taro.showToast({ title: '刷新失败', icon: 'none' });
    } finally {
      if (isLatestRequest(seq)) setOperation(null);
    }
  }

  async function handleToggleFavorite() {
    const current = outfits[currentIndex];
    if (!current || operation) return;

    const nextFavorite = !current.isFavorite;
    setOperation('favorite');

    try {
      const saved = await setCloudOutfitFavorite(current.id, nextFavorite, nextFavorite ? current : undefined);
      replaceOutfitInList(current.id, saved);
      Taro.showToast({ title: nextFavorite ? '已收藏' : '已取消收藏', icon: 'success' });
    } catch (err) {
      console.error('Toggle favorite error:', err);
      Taro.showToast({ title: '操作失败', icon: 'none' });
    } finally {
      setOperation(null);
    }
  }

  async function handleConfirmWear() {
    const current = outfits[currentIndex];
    if (!current || operation || current.isWornToday) return;

    setOperation('wear');

    try {
      const saved = await confirmCloudWear(current.id, current);
      replaceOutfitInList(current.id, saved);
      Taro.showToast({ title: '已确认今日穿搭', icon: 'success' });
    } catch (err) {
      console.error('Confirm wear error:', err);
      Taro.showToast({ title: '操作失败', icon: 'none' });
    } finally {
      setOperation(null);
    }
  }

  function handleSceneSelect(key: SceneKey) {
    setSelectedSceneKey(key);
  }

  function goToWardrobe() {
    Taro.switchTab({ url: '/pages/wardrobe/index' });
  }

  function goToOutfitDetail(outfitId: string) {
    if (isRecommendOutfitId(outfitId)) {
      Taro.showToast({ title: '收藏或穿它后可查看详情', icon: 'none' });
      return;
    }
    Taro.navigateTo({ url: `/pages/outfit-detail/index?id=${outfitId}` });
  }

  async function syncCurrentOutfit(outfitId: string) {
    if (loading || operation || isRecommendOutfitId(outfitId)) return;

    try {
      const detail = await getCloudOutfit(outfitId);
      updateOutfitInList(outfitId, {
        isFavorite: detail.isFavorite,
        isWornToday: detail.isWornToday,
        title: detail.title,
      });
    } catch (err) {
      console.warn('Sync outfit status failed:', err);
    }
  }

  function scheduleCurrentOutfitSync(outfitId: string) {
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      syncCurrentOutfit(outfitId);
    }, 800);
  }

  function updateOutfitInList(outfitId: string, patch: Partial<Outfit>) {
    setOutfits((prev) =>
      prev.map((outfit) => (outfit.id === outfitId ? { ...outfit, ...patch } : outfit)),
    );
  }

  function replaceOutfitInList(outfitId: string, next: Outfit) {
    setOutfits((prev) => prev.map((outfit) => (outfit.id === outfitId ? next : outfit)));
  }

  function nextRequestSeq() {
    requestSeq.current += 1;
    return requestSeq.current;
  }

  function isLatestRequest(seq: number) {
    return seq === requestSeq.current;
  }

  const currentOutfit = outfits[currentIndex];
  const isRefreshing = operation === 'refresh';
  const isFavoriteBusy = operation === 'favorite';
  const isWearBusy = operation === 'wear';
  const isWornToday = currentOutfit?.isWornToday ?? false;

  return (
    <View className="today-page">
      <WeatherCard city="上海" />

      <View className="scene-section">
        {SCENES.map((item) => {
          const active = selectedSceneKey === item.key;

          return (
            <View
              key={item.key}
              className={`scene-card ${active ? 'active' : ''}`}
              onClick={() => handleSceneSelect(item.key)}
            >
              <Image className="scene-card-image" src={active ? item.activeIcon : item.icon} mode="aspectFit" />
              <Text className="scene-card-label">{item.label}</Text>
            </View>
          );
        })}
      </View>

      <View className="outfit-section">
        <View className="section-header">
          <Text className="section-title">今日穿搭</Text>
          {currentOutfit && (
            <Text className="section-hint">
              {currentIndex + 1} / {outfits.length}
            </Text>
          )}
        </View>

        {loading && (
          <View className="loading-state">
            <Text className="loading-text">正在推荐...</Text>
          </View>
        )}

        {!loading && error && !currentOutfit && (
          <View className="empty-state">
            <View className="empty-icon">!</View>
            <Text className="empty-text">{error}</Text>
            <View className="empty-action" onClick={() => fetchRecommendations({ scene: selectedScene })}>
              <Text className="action-text">重新获取</Text>
            </View>
          </View>
        )}

        {!loading && !error && !hasRecommendations && (
          <View className="empty-state">
            <View className="empty-icon">衣</View>
            <Text className="empty-text">{recommendationNotice || '暂时没有可推荐的搭配'}</Text>
            <Text className="empty-desc">先去衣橱添加几件衣服吧</Text>
            <View className="empty-action" onClick={goToWardrobe}>
              <Text className="action-text">去添加衣服</Text>
            </View>
          </View>
        )}

        {!loading && currentOutfit && (
          <View className="outfit-card" onClick={() => goToOutfitDetail(currentOutfit.id)}>
            <View className="outfit-header">
              <Text className="outfit-title">{currentOutfit.title || '今日推荐'}</Text>
              {currentOutfit.isFavorite && <Text className="favorite-badge">已收藏</Text>}
            </View>

            {getDeletedItemCount(currentOutfit) > 0 && (
              <View className="deleted-notice">
                <Text className="deleted-notice-text">
                  该搭配中有 {getDeletedItemCount(currentOutfit)} 件衣服已删除
                </Text>
              </View>
            )}

            <View className="outfit-items">
              {currentOutfit.items?.map((item) => (
                <View key={item.clothingId} className={`outfit-item ${item.isDeleted ? 'deleted' : ''}`}>
                  <Image className="item-image" src={item.imageUrl} mode="aspectFit" lazyLoad />
                  <Text className="item-name">{item.subcategory || item.category}</Text>
                </View>
              ))}
            </View>

            {currentOutfit.scores && (
              <View className="outfit-scores">
                <ScoreRow label="时尚" value={currentOutfit.scores.fashion} />
                <ScoreRow label="舒适" value={currentOutfit.scores.comfort} />
                <ScoreRow label="场景" value={currentOutfit.scores.sceneMatch} />
              </View>
            )}

            {currentOutfit.reasoning && (
              <View className="outfit-reasoning">
                <Text className="reasoning-text">{currentOutfit.reasoning}</Text>
              </View>
            )}

            {(error || recommendationNotice) && (
              <View className="inline-error">
                <Text className="inline-error-text">{error || recommendationNotice}</Text>
              </View>
            )}

            <View className="outfit-actions" onClick={(event: TapEvent) => event.stopPropagation()}>
              <View className={`action-btn secondary ${isRefreshing ? 'disabled' : ''}`} onClick={handleRefresh}>
                <Text className="btn-text">{isRefreshing ? '正在换...' : '换一套'}</Text>
              </View>
              <View
                className={`action-btn ${currentOutfit.isFavorite ? 'active' : ''} ${
                  isFavoriteBusy ? 'disabled' : ''
                }`}
                onClick={handleToggleFavorite}
              >
                <Text className="btn-text">{currentOutfit.isFavorite ? '已收藏' : '收藏'}</Text>
              </View>
              <View
                className={`action-btn primary ${isWornToday || isWearBusy ? 'disabled' : ''}`}
                onClick={handleConfirmWear}
              >
                <Text className="btn-text">
                  {isWornToday ? '已确认' : isWearBusy ? '确认中...' : '穿它'}
                </Text>
              </View>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

function ScoreRow({ label, value }: { label: string; value: number }) {
  const score = formatScore(value);

  return (
    <View className="score-row">
      <Text className="score-label">{label}</Text>
      <View className="score-bar">
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

function getToday() {
  return new Date().toISOString().split('T')[0]!;
}

function isRecommendOutfitId(id: string) {
  return id.startsWith('recommend:');
}
