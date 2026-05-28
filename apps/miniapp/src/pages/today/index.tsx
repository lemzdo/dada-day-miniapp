import { Image, Swiper, SwiperItem, Text, View } from '@tarojs/components';
import Taro, { useLoad, usePullDownRefresh } from '@tarojs/taro';
import { useRef, useState } from 'react';
import { WeatherCard } from '@/components/WeatherCard';
import { addOutfitHistory, generateCloudOutfit, removeFavoriteOutfit, saveFavoriteOutfit } from '@/lib/cloud';
import { normalizeOutfitSnapshot, storeOutfitDetailDraft } from '@/utils/outfitSnapshot';
import sceneDate from '@/assets/scenes/scene-date-clean.png';
import sceneDateActive from '@/assets/scenes/scene-date-active-clean.png';
import sceneHome from '@/assets/scenes/scene-home-clean.png';
import sceneHomeActive from '@/assets/scenes/scene-home-active-clean.png';
import sceneSport from '@/assets/scenes/scene-sport-clean.png';
import sceneSportActive from '@/assets/scenes/scene-sport-active-clean.png';
import sceneWork from '@/assets/scenes/scene-work-clean.png';
import sceneWorkActive from '@/assets/scenes/scene-work-active-clean.png';
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
  { key: 'home', label: '居家', icon: sceneHome, activeIcon: sceneHomeActive },
  { key: 'work', label: '上班', icon: sceneWork, activeIcon: sceneWorkActive },
  { key: 'date', label: '约会', icon: sceneDate, activeIcon: sceneDateActive },
  { key: 'sport', label: '运动', icon: sceneSport, activeIcon: sceneSportActive },
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
  const [currentWeather, setCurrentWeather] = useState<WeatherSnapshot | undefined>(undefined);
  const selectedScene = SCENE_TAGS[selectedSceneKey];

  useLoad(() => {
    fetchRecommendations({ scene: selectedScene });
  });

  usePullDownRefresh(() => {
    fetchRecommendations({ scene: selectedScene }).finally(() => {
      Taro.stopPullDownRefresh();
    });
  });

  async function fetchRecommendations({
    scene,
    weather = currentWeatherRef.current,
    excludedOutfitKeys = [],
  }: {
    scene: SceneTag;
    weather?: WeatherSnapshot;
    excludedOutfitKeys?: string[];
  }) {
    const seq = nextRequestSeq();
    console.log('[TodayPage] fetchRecommendations start', {
      requestSeq: seq,
      selectedScene,
      scene,
      weather,
    });
    setLoading(true);
    setError('');
    setRecommendationNotice('');
    setBatchLimited(false);
    setBatchExhausted(false);
    setCurrentIndex(0);

    try {
      const data = await generateCloudOutfit({
        date: getToday(),
        scene,
        timeOfDay: 'all_day',
        maxResults: 8,
        ...(weather ? { weather } : {}),
        ...(excludedOutfitKeys.length > 0 ? { excludedOutfitKeys } : {}),
      });

      if (!isLatestRequest(seq)) return;
      const nextOutfits = data.outfits.map((outfit) => normalizeOutfitSnapshot(outfit));
      console.log('[TodayPage] fetchRecommendations success', {
        requestSeq: seq,
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
    } catch (err) {
      if (!isLatestRequest(seq)) return;
      console.error('Fetch recommendations error:', err);
      setError('获取推荐失败，请稍后再试');
      setOutfits([]);
      setHasRecommendations(false);
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
          scene: selectedScene,
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
        await removeFavoriteOutfit(current.favoriteOutfitId || current.id);
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
    fetchRecommendations({ scene: SCENE_TAGS[key], weather: currentWeather ?? currentWeatherRef.current });
  }

  function handleWeatherChange(weather: WeatherSnapshot, options: { forceRefresh?: boolean } = {}) {
    currentWeatherRef.current = weather;
    setCurrentWeather(weather);
    fetchRecommendations({ scene: selectedScene, weather });
    if (options.forceRefresh) {
      console.log('[TodayPage] weather refreshed, recommendations reloaded', {
        scene: selectedScene,
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
    return [outfit.scene ? `今日${outfit.scene}` : '今日推荐', formatTimeOfDay(outfit.timeOfDay)].filter(Boolean).join(' · ');
  }

  function formatTimeOfDay(value?: string) {
    if (value === 'all_day') return '适合全天';
    if (value === 'morning') return '适合早晨';
    if (value === 'afternoon') return '适合下午';
    if (value === 'evening') return '适合晚上';
    return '';
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
      <WeatherCard city="上海" onWeatherChange={handleWeatherChange} />

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
          <View className="recommendation-browser">
            <Text className="browser-hint">左右滑动，查看更多穿搭灵感</Text>
            <Swiper
              className="outfit-swiper"
              current={currentIndex}
              previousMargin="36px"
              nextMargin="36px"
              circular={false}
              onChange={handleSwiperChange}
            >
              {outfits.map((outfit) => (
                <SwiperItem key={outfit.id} className="outfit-slide">
                  <View
                    className={`outfit-card ${recommendationBatchId ? 'has-batch' : ''} ${
                      batchLimited || batchExhausted ? 'limited' : ''
                    }`}
                    onClick={() => goToOutfitDetail(outfit.id)}
                  >
                    <View className="outfit-header">
                      <View className="outfit-title-wrap">
                        <Text className="outfit-title">{outfit.title || '今日推荐'}</Text>
                        <Text className="outfit-meta">{formatOutfitMeta(outfit)}</Text>
                      </View>
                      <View className="status-badges">
                        {outfit.isFavorite && <Text className="status-badge favorite">已收藏</Text>}
                        {outfit.isWornToday && <Text className="status-badge worn">今天穿过啦</Text>}
                      </View>
                    </View>

                    {getDeletedItemCount(outfit) > 0 && (
                      <View className="deleted-notice">
                        <Text className="deleted-notice-text">
                          这套搭配中有 {getDeletedItemCount(outfit)} 件衣服已从衣橱删除
                        </Text>
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

                    {outfit.scores && (
                      <View className="outfit-scores">
                        <ScoreRow label="时尚" value={outfit.scores.fashion} />
                        <ScoreRow label="舒适" value={outfit.scores.comfort} />
                        <ScoreRow label="场景" value={outfit.scores.sceneMatch} />
                      </View>
                    )}

                    {(outfit.reasoning || outfit.reason) && (
                      <View className="outfit-reasoning">
                        <Text className="reasoning-text">{outfit.reasoning || outfit.reason}</Text>
                      </View>
                    )}
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
              <Text className="page-count">
                {currentIndex + 1} / {outfits.length}
              </Text>
            </View>

            {(error || recommendationNotice) && (
              <View className="inline-error">
                <Text className="inline-error-text">{error || recommendationNotice}</Text>
              </View>
            )}

            <View className="outfit-actions" onClick={(event: TapEvent) => event.stopPropagation()}>
              <View
                className={`action-btn ${currentOutfit.isFavorite ? 'active' : ''} ${
                  isFavoriteBusy ? 'disabled' : ''
                }`}
                onClick={handleToggleFavorite}
              >
                <Text className="btn-text">{currentOutfit.isFavorite ? '已收藏' : '收藏'}</Text>
              </View>
              <View className={`action-btn primary ${isWearBusy ? 'disabled' : ''}`} onClick={handleConfirmWear}>
                <Text className="btn-text">{isWearBusy ? '记录中...' : currentOutfit.isWornToday ? '今天穿过啦' : '穿它'}</Text>
              </View>
            </View>

            <View className={`batch-btn ${isRefreshing ? 'disabled' : ''}`} onClick={handleRefresh}>
              <Text className="batch-btn-text">{isRefreshing ? '正在找灵感...' : '换一批灵感'}</Text>
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

function getDeletedItemCount(outfit: Outfit) {
  if (typeof outfit.deletedItemCount === 'number') return outfit.deletedItemCount;
  const snapshotCount = outfit.snapshotItems?.filter((item) => item.isDeleted || item.deletedAt).length ?? 0;
  const itemCount = outfit.items?.filter((item) => item.isDeleted).length ?? 0;
  return Math.max(snapshotCount, itemCount);
}
