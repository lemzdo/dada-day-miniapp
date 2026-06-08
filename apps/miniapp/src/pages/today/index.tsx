import { Swiper, SwiperItem, Text, View } from '@tarojs/components';
import Taro, { useDidShow, useLoad, usePullDownRefresh, useUnload } from '@tarojs/taro';
import { useRef, useState } from 'react';
import { SafeImage } from '@/components/SafeImage';
import { WeatherCard } from '@/components/WeatherCard';
import { addOutfitHistory, clearCloudRecommendationCache, generateCloudOutfit, removeFavoriteOutfit, saveFavoriteOutfit } from '@/lib/cloud';
import { consumeOutfitStateSync, normalizeOutfitSnapshot, storeOutfitDetailDraft } from '@/utils/outfitSnapshot';
import { getOutfitStyleTags } from '@/utils/outfitContextText';
import { getOutfitDisplayTitle } from '@/utils/outfitTitle';
import type { Outfit, SceneTag, WeatherSnapshot } from '@starter-template/types';
import './index.scss';

interface TapEvent {
  stopPropagation: () => void;
}

interface SwiperChangeEvent {
  detail: {
    current: number;
  };
}

type OutfitOperation = 'favorite' | 'wear' | 'refresh' | null;
type SceneKey = 'home' | 'work' | 'date' | 'sport';

const SCENES = [
  { key: 'home', label: '居家' },
  { key: 'work', label: '通勤' },
  { key: 'date', label: '约会' },
  { key: 'sport', label: '运动' },
] as const;

const SCENE_TAGS: Record<SceneKey, SceneTag> = {
  home: '居家' as SceneTag,
  work: '上班' as SceneTag,
  date: '约会' as SceneTag,
  sport: '运动' as SceneTag,
};

export default function TodayPage() {
  const [selectedSceneKey, setSelectedSceneKey] = useState<SceneKey>('home');
  const [outfits, setOutfits] = useState<Outfit[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [operation, setOperation] = useState<OutfitOperation>(null);
  const [hasRecommendations, setHasRecommendations] = useState(true);
  const [error, setError] = useState('');
  const [recommendationNotice, setRecommendationNotice] = useState('');
  const [recommendationBatchId, setRecommendationBatchId] = useState('');
  const [batchLimited, setBatchLimited] = useState(false);
  const [batchExhausted, setBatchExhausted] = useState(false);
  const requestSeq = useRef(0);
  const seenOutfitKeysRef = useRef<Set<string>>(new Set());
  const currentWeatherRef = useRef<WeatherSnapshot | undefined>(undefined);
  const lastRecommendationWeatherKeyRef = useRef('');
  const initialRecommendationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [currentWeather, setCurrentWeather] = useState<WeatherSnapshot | undefined>(undefined);
  const selectedScene = SCENE_TAGS[selectedSceneKey];
  const selectedSceneRef = useRef<SceneTag>(selectedScene);
  selectedSceneRef.current = selectedScene;

  useLoad(() => {
    scheduleInitialRecommendation();
  });

  useUnload(() => {
    clearInitialRecommendationTimer();
  });

  usePullDownRefresh(() => {
    fetchRecommendations({ scene: selectedScene, trigger: 'pull-down' }).finally(() => {
      Taro.stopPullDownRefresh();
    });
  });

  useDidShow(() => {
    const syncedOutfit = consumeOutfitStateSync();
    if (syncedOutfit) {
      updateOutfitsByKey(syncedOutfit, syncedOutfit);
    }
  });

  async function fetchRecommendations({
    scene,
    weather = currentWeatherRef.current,
    excludedOutfitKeys = [],
    silent = false,
    trigger = 'unknown',
  }: {
    scene: SceneTag;
    weather?: WeatherSnapshot;
    excludedOutfitKeys?: string[];
    silent?: boolean;
    trigger?: string;
  }): Promise<boolean> {
    const seq = nextRequestSeq();
    console.log('[TodayPage] fetchRecommendations start', {
      requestSeq: seq,
      trigger,
      selectedScene,
      scene,
      hasWeather: Boolean(weather),
    });
    if (!silent) {
      setLoading(true);
      setError('');
      setRecommendationNotice('');
      setBatchLimited(false);
      setBatchExhausted(false);
      setCurrentIndex(0);
    }

    try {
      const data = await generateCloudOutfit({
        date: getToday(),
        scene,
        timeOfDay: 'all_day',
        maxResults: 8,
        ...(weather ? { weather } : {}),
        ...(excludedOutfitKeys.length > 0 ? { excludedOutfitKeys } : {}),
      });

      if (!isLatestRequest(seq)) return false;
      const nextOutfits = data.outfits.map((outfit) => normalizeOutfitSnapshot(outfit));
      console.log('[TodayPage] fetchRecommendations success', {
        requestSeq: seq,
        trigger,
        scene,
        debug: data.debug,
        outfitCount: nextOutfits.length,
        firstOutfitId: nextOutfits[0]?.id,
        firstItemIds: nextOutfits[0]?.clothingIds,
      });
      setOutfits(nextOutfits);
      setCurrentIndex(0);
      setHasRecommendations(data.outfits.length > 0);
      setRecommendationBatchId(data.recommendationBatchId ?? nextOutfits[0]?.recommendationBatchId ?? '');
      setBatchLimited(Boolean(data.limited));
      setBatchExhausted(Boolean(data.exhausted));
      setRecommendationNotice(getBatchNotice(data.recommendationNotice, Boolean(data.limited), Boolean(data.exhausted)));
      markOutfitShown(nextOutfits[0]);
      return true;
    } catch (err) {
      if (!isLatestRequest(seq)) return false;
      console.error('Fetch recommendations error:', err);
      if (!silent) {
        setError('获取推荐失败，请稍后再试');
        setOutfits([]);
        setHasRecommendations(false);
        Taro.showToast({ title: '获取推荐失败', icon: 'none' });
      }
      return false;
    } finally {
      if (!silent && isLatestRequest(seq)) setLoading(false);
    }
  }

  async function handleRefresh() {
    if (loading || operation) return;
    const seq = nextRequestSeq();
    setOperation('refresh');
    setError('');
    setRecommendationNotice('');

    try {
      console.log('[TodayPage] fetchRecommendations start', {
        requestSeq: seq,
        trigger: 'refresh',
        selectedScene,
        scene: selectedScene,
        hasWeather: Boolean(currentWeather ?? currentWeatherRef.current),
      });
      const weatherForRefresh = currentWeather ?? currentWeatherRef.current;
      const data = await generateCloudOutfit({
        date: getToday(),
        scene: selectedScene,
        timeOfDay: 'all_day',
        maxResults: 8,
        ...(weatherForRefresh ? { weather: weatherForRefresh } : {}),
        excludedOutfitKeys: getSeenOutfitKeys(),
      });

      if (!isLatestRequest(seq)) return;
      if (data.outfits.length > 0) {
        const nextOutfits = data.outfits.map((outfit) => normalizeOutfitSnapshot(outfit));
        console.log('[TodayPage] refresh success', {
          requestSeq: seq,
          trigger: 'refresh',
          selectedScene,
          debug: data.debug,
          outfitCount: nextOutfits.length,
          firstOutfitId: nextOutfits[0]?.id,
          firstItemIds: nextOutfits[0]?.clothingIds,
        });
        setOutfits(nextOutfits);
        setCurrentIndex(0);
        setHasRecommendations(true);
        setRecommendationBatchId(data.recommendationBatchId ?? nextOutfits[0]?.recommendationBatchId ?? '');
        setBatchLimited(Boolean(data.limited));
        setBatchExhausted(Boolean(data.exhausted));
        setRecommendationNotice(getBatchNotice(data.recommendationNotice, Boolean(data.limited), Boolean(data.exhausted)));
        markOutfitShown(nextOutfits[0]);
      } else {
        const notice = getBatchNotice(data.recommendationNotice, Boolean(data.limited), true);
        setBatchLimited(Boolean(data.limited));
        setBatchExhausted(true);
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
      if (nextFavorite) {
        const saved = await saveFavoriteOutfit(normalizeOutfitSnapshot(current), current.aiComment);
        updateOutfitsByKey(current, {
          isFavorite: true,
          favoriteOutfitId: saved.favoriteOutfitId || saved.id,
          favoritedAt: saved.favoritedAt || saved.createdAt,
        });
      } else {
        await removeFavoriteOutfit(current.favoriteOutfitId || current.id, current.outfitKey);
        updateOutfitsByKey(current, {
          isFavorite: false,
          favoriteOutfitId: undefined,
          favoritedAt: undefined,
        });
      }
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
    if (!current || operation) return;

    if (current.isWornToday) {
      Taro.showToast({ title: '今天已经穿过这套啦～', icon: 'none' });
      return;
    }

    setOperation('wear');
    try {
      await addOutfitHistory(normalizeOutfitSnapshot(current), {
        source: current.outfitKind === 'favorite' || current.isFavorite ? 'favorite' : 'recommendation',
        sourceFavoriteOutfitId:
          current.outfitKind === 'favorite' || current.isFavorite ? current.favoriteOutfitId || current.id : undefined,
        aiComment: current.aiComment,
      }).then((saved) => {
        updateOutfitsByKey(current, {
          isWornToday: true,
          todayHistoryId: saved.todayHistoryId || saved.historyId || saved.id,
          historyId: saved.historyId || saved.id,
          lastWornAt: saved.lastWornAt || saved.wornAt || new Date().toISOString(),
          wornAt: saved.wornAt,
          wornDate: saved.wornDate || getToday(),
        });
      });
      Taro.showToast({ title: '已记录到穿搭历史', icon: 'success' });
    } catch (err) {
      console.error('Confirm wear error:', err);
      Taro.showToast({ title: '操作失败', icon: 'none' });
    } finally {
      setOperation(null);
    }
  }

  function handleSceneSelect(key: SceneKey) {
    console.log('[TodayPage] scene clicked', {
      clickedSceneKey: key,
      clickedScene: SCENE_TAGS[key],
      currentSelectedScene: selectedScene,
    });
    setSelectedSceneKey(key);
    setCurrentIndex(0);
    setOutfits([]);
    setHasRecommendations(true);
    fetchRecommendations({ scene: SCENE_TAGS[key], weather: currentWeather ?? currentWeatherRef.current, trigger: 'scene' });
  }

  async function handleWeatherChange(weather: WeatherSnapshot, options: { forceRefresh?: boolean } = {}) {
    const weatherKey = getWeatherKey(weather);
    const sameWeather = weatherKey === lastRecommendationWeatherKeyRef.current;
    if (!options.forceRefresh && sameWeather && outfits.length > 0) {
      console.log('[TodayPage] weather unchanged, skip recommendation refresh', {
        weatherKey,
      });
      return;
    }

    clearInitialRecommendationTimer();
    currentWeatherRef.current = weather;
    lastRecommendationWeatherKeyRef.current = weatherKey;
    setCurrentWeather(weather);
    clearCloudRecommendationCache();
    const scene = selectedSceneRef.current;
    await fetchRecommendations({ scene, weather, silent: true, trigger: options.forceRefresh ? 'weather-force' : 'weather' });
    if (options.forceRefresh) {
      console.log('[TodayPage] weather refreshed, recommendations reloaded', {
        scene,
        weather,
      });
    }
  }

  function goToWardrobe() {
    Taro.switchTab({ url: '/pages/wardrobe/index' });
  }

  function goToOutfitDetail(outfitId: string) {
    const current = outfits.find((outfit) => outfit.id === outfitId);
    if (!current) return;
    storeOutfitDetailDraft(current);
    Taro.navigateTo({ url: `/pages/outfit-detail/index?id=${encodeURIComponent(outfitId)}&source=recommendation` });
  }

  function handleSwiperChange(event: SwiperChangeEvent) {
    const next = event.detail.current;
    setCurrentIndex(next);
    markOutfitShown(outfits[next]);
  }

  function scheduleInitialRecommendation() {
    clearInitialRecommendationTimer();
    initialRecommendationTimerRef.current = setTimeout(() => {
      if (currentWeatherRef.current || outfits.length > 0) return;
      fetchRecommendations({ scene: selectedSceneRef.current, trigger: 'initial-fallback' });
    }, 700);
  }

  function clearInitialRecommendationTimer() {
    if (!initialRecommendationTimerRef.current) return;
    clearTimeout(initialRecommendationTimerRef.current);
    initialRecommendationTimerRef.current = null;
  }

  function updateOutfitsByKey(reference: Outfit, patch: Partial<Outfit>) {
    const outfitKey = reference.outfitKey;
    setOutfits((prev) =>
      prev.map((outfit) =>
        outfit.outfitKey === outfitKey || outfit.id === reference.id ? normalizeOutfitSnapshot({ ...outfit, ...patch }) : outfit,
      ),
    );
  }

  function markOutfitShown(outfit: Outfit | undefined) {
    if (outfit?.outfitKey) {
      seenOutfitKeysRef.current.add(outfit.outfitKey);
    }
  }

  function getSeenOutfitKeys() {
    return [...seenOutfitKeysRef.current];
  }

  function getBatchNotice(notice: string | undefined, limited: boolean, exhausted: boolean) {
    if (exhausted || limited) {
      return notice || '小搭暂时只能搭出这些啦，多上传几件衣服，我就能给你更多灵感～';
    }
    return notice ?? '';
  }

  function formatOutfitMeta(outfit: Outfit) {
    if (currentWeather) return '适合今天';
    return `适合${getSceneText(outfit.scene || selectedScene)}`;
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

  return (
    <View className="today-page">
      <View className="top-section">
        <View className="hero-header">
          <View className="hero-brand">
            <Text className="hero-brand-cn">搭搭</Text>
            <Text className="hero-brand-day">day</Text>
          </View>
          <WeatherCard city="上海" onWeatherChange={handleWeatherChange} />
        </View>
      </View>

      <View className="scene-tabs">
        {SCENES.map((item) => {
          const active = selectedSceneKey === item.key;
          return (
            <View
              key={item.key}
              className={`scene-tab ${active ? 'active' : ''}`}
              onClick={() => handleSceneSelect(item.key)}
            >
              <Text className="scene-tab-text">{item.label}</Text>
              <View className="scene-tab-indicator" />
            </View>
          );
        })}
      </View>

      <View className="outfit-section">
        {loading && (
          <View className="loading-state">
            <View className="loading-spinner" />
            <Text className="loading-text">正在为你搭配...</Text>
          </View>
        )}

        {!loading && error && !currentOutfit && (
          <View className="empty-state">
            <View className="empty-icon-wrap">
              <View className="empty-icon" />
            </View>
            <Text className="empty-text">{error}</Text>
            <View className="empty-action" onClick={() => fetchRecommendations({ scene: selectedScene, trigger: 'retry' })}>
              <Text className="empty-action-text">重新获取</Text>
            </View>
          </View>
        )}

        {!loading && !error && !hasRecommendations && (
          <View className="empty-state">
            <View className="empty-icon-wrap">
              <View className="empty-icon" />
            </View>
            <Text className="empty-text">{recommendationNotice || '小搭还没找到合适搭配'}</Text>
            <Text className="empty-desc">先去衣橱放几件衣服，我再帮你搭得更准</Text>
            <View className="empty-action" onClick={goToWardrobe}>
              <Text className="empty-action-text">去衣橱</Text>
            </View>
          </View>
        )}

        {!loading && currentOutfit && (
          <View className="recommendation-browser">
            <Swiper
              className="outfit-swiper"
              current={currentIndex}
              previousMargin="24rpx"
              nextMargin="24rpx"
              circular={false}
              onChange={handleSwiperChange}
            >
              {outfits.map((outfit, index) => (
                <SwiperItem key={outfit.id} className="outfit-slide">
                  <View
                    className={`outfit-card ${recommendationBatchId ? 'has-batch' : ''} ${
                      batchLimited || batchExhausted ? 'limited' : ''
                    }`}
                    onClick={() => goToOutfitDetail(outfit.id)}
                  >
                    <View className="outfit-card-header">
                      <View className="outfit-title-section">
                        <Text className="outfit-title">{getOutfitDisplayTitle(outfit, '今日推荐')}</Text>
                        <Text className="outfit-meta">{formatOutfitMeta(outfit)}</Text>
                      </View>
                      <Text className="card-count">{index + 1} / {outfits.length}</Text>
                    </View>

                    {getDeletedItemCount(outfit) > 0 && (
                      <View className="deleted-notice">
                        <Text className="deleted-notice-text">
                          这套搭配中有 {getDeletedItemCount(outfit)} 件衣服已从衣橱删除
                        </Text>
                      </View>
                    )}

                    <View className="outfit-collage">
                      {outfit.items?.map((item) => (
                        <View key={item.clothingId} className={`collage-item ${item.isDeleted ? 'deleted' : ''}`}>
                          <SafeImage className="item-image" src={item.imageUrl} mode="aspectFit" lazyLoad />
                        </View>
                      ))}
                    </View>

                    <View className="outfit-reason">
                      <Text className="reason-label">小搭推荐</Text>
                      <Text className="reason-text">{outfit.reason || getFallbackReason(outfit.scene || selectedScene, Boolean(currentWeather))}</Text>
                    </View>

                    <View className="outfit-tags">
                      {getOutfitStyleTags(outfit, index).slice(0, 3).map((tag) => (
                        <Text key={tag} className="style-tag">{tag}</Text>
                      ))}
                    </View>
                  </View>
                </SwiperItem>
              ))}
            </Swiper>

            <View className="swiper-footer">
              <View className="pagination-dots">
                {outfits.map((outfit, index) => (
                  <View key={outfit.outfitKey || outfit.id} className={`pagination-dot ${index === currentIndex ? 'active' : ''}`} />
                ))}
              </View>
            </View>

            {(error || recommendationNotice) && (
              <View className="inline-notice">
                <Text className="inline-notice-text">{error || recommendationNotice}</Text>
              </View>
            )}

            <View className="outfit-actions" onClick={(event: TapEvent) => event.stopPropagation()}>
              <View
                className={`action-btn ${currentOutfit.isFavorite ? 'active' : ''} ${
                  isFavoriteBusy ? 'disabled' : ''
                }`}
                onClick={handleToggleFavorite}
              >
                <Text className="action-text">{currentOutfit.isFavorite ? '已收藏' : '收藏'}</Text>
              </View>
              <View className={`action-btn primary ${isWearBusy ? 'disabled' : ''}`} onClick={handleConfirmWear}>
                <Text className="action-text">{isWearBusy ? '记录中...' : currentOutfit.isWornToday ? '今天穿过' : '穿它'}</Text>
              </View>
              <View className="action-btn detail" onClick={() => goToOutfitDetail(currentOutfit.id)}>
                <Text className="action-text">详情</Text>
              </View>
            </View>

            <View className={`refresh-btn ${isRefreshing ? 'disabled' : ''}`} onClick={handleRefresh}>
              <Text className="refresh-text">{isRefreshing ? '正在找灵感...' : '换一批灵感'}</Text>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

function getToday() {
  return new Date().toISOString().split('T')[0]!;
}

function getWeatherKey(weather: WeatherSnapshot) {
  return [
    weather.temp,
    weather.humidity,
    weather.weather,
    weather.wind,
    weather.uv,
  ].join(':');
}

function getDeletedItemCount(outfit: Outfit) {
  if (typeof outfit.deletedItemCount === 'number') return outfit.deletedItemCount;
  const snapshotCount = outfit.snapshotItems?.filter((item) => item.isDeleted || item.deletedAt).length ?? 0;
  const itemCount = outfit.items?.filter((item) => item.isDeleted).length ?? 0;
  return Math.max(snapshotCount, itemCount);
}

function getFallbackReason(scene: SceneTag, hasWeather: boolean) {
  if (hasWeather) return '这套穿搭适合今天的节奏，和当前衣橱也很好配';
  return `这套穿搭适合${getSceneText(scene)}，简约舒适，日常也好穿`;
}

function getSceneText(scene: SceneTag) {
  return scene === '上班' ? '通勤' : String(scene);
}
