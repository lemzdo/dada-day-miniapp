import { Image, Swiper, SwiperItem, Text, View } from '@tarojs/components';
import Taro, { useDidShow, useLoad, usePullDownRefresh, useUnload } from '@tarojs/taro';
import { useEffect, useRef, useState } from 'react';
import { WeatherCard } from '@/components/WeatherCard';
import { invalidateAfterOutfitWornMutation } from '@/lib/cacheInvalidation';
import { addOutfitHistory, clearCloudRecommendationCache, generateCloudOutfit, removeFavoriteOutfit, saveFavoriteOutfit } from '@/lib/cloud';
import {
  captureAuthContext,
  type ActiveAuthContext,
} from '@/lib/userPageCache';
import {
  getUserStorageSync,
  setUserStorageSync,
} from '@/lib/userStorage';
import { applyOutfitStatuses, setOutfitStatus, setOutfitStatuses } from '@/stores/outfitStatusStore';
import { consumeOutfitStateSync, normalizeOutfitSnapshot, storeOutfitDetailDraft } from '@/utils/outfitSnapshot';
import { getOutfitStyleTags } from '@/utils/outfitContextText';
import { getOutfitDisplayTitle } from '@/utils/outfitTitle';
import type { OutfitStatusPatch } from '@/stores/outfitStatusStore';
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
type TimeOfDay = 'all_day';

interface TodayRestoreSnapshot {
  version: 1;
  outfits: Outfit[];
  currentIndex: number;
  selectedSceneKey: SceneKey;
  scene: SceneTag;
  weatherSnapshot?: WeatherSnapshot;
  weatherKey: string;
  targetDate: string;
  timeOfDay: TimeOfDay;
  recommendationBatchId: string;
  generatedAt: number;
  seenOutfitKeys: string[];
  hasRecommendations: boolean;
  batchLimited: boolean;
  batchExhausted: boolean;
  recommendationNotice: string;
}

interface TodayRestoreSnapshotInput {
  outfits?: Outfit[];
  currentIndex?: number;
  selectedSceneKey?: SceneKey;
  weatherSnapshot?: WeatherSnapshot;
  recommendationBatchId?: string;
  seenOutfitKeys?: string[];
  hasRecommendations?: boolean;
  batchLimited?: boolean;
  batchExhausted?: boolean;
  recommendationNotice?: string;
}

const TODAY_RESTORE_SNAPSHOT_KEY = 'today:outfitReturnSnapshot';
const TODAY_RESTORE_SNAPSHOT_TTL_MS = 10 * 60 * 1000;
const WARDROBE_REFRESH_STORAGE_KEY = 'wardrobeNeedsRefresh';
const TODAY_TIME_OF_DAY: TimeOfDay = 'all_day';

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

function getOutfitStatusPatches(outfits: Outfit[]) {
  return outfits.map((outfit) => getOutfitStatusPatch(outfit)).filter((patch) => Boolean(patch.outfitKey));
}

function getOutfitStatusPatch(outfit: Outfit, fallbackOutfitKey = ''): OutfitStatusPatch {
  const patch: OutfitStatusPatch = {
    outfitKey: outfit.outfitKey ?? fallbackOutfitKey,
  };
  const updatedAt = getOutfitStatusUpdatedAt(outfit.updatedAt);

  if (updatedAt !== undefined) patch.updatedAt = updatedAt;
  if (outfit.isFavorite !== undefined) patch.isFavorite = outfit.isFavorite;
  if (outfit.favoriteOutfitId !== undefined) {
    patch.favoriteOutfitId = outfit.favoriteOutfitId;
  } else if (outfit.isFavorite === false) {
    patch.favoriteOutfitId = '';
  }
  if (outfit.isWornToday !== undefined) patch.isWornToday = outfit.isWornToday;
  if (outfit.todayHistoryId !== undefined) {
    patch.todayHistoryId = outfit.todayHistoryId;
  } else if (outfit.isWornToday === false) {
    patch.todayHistoryId = '';
  }
  if (outfit.wornAt !== undefined) patch.wornAt = outfit.wornAt;
  if (outfit.wornDate !== undefined) patch.wornDate = outfit.wornDate;
  if (outfit.userTitle !== undefined) patch.userTitle = outfit.userTitle;
  if (outfit.displayTitle !== undefined) patch.displayTitle = outfit.displayTitle;
  if (outfit.title !== undefined) patch.title = outfit.title;

  return patch;
}

function applyTodayOutfitStatuses(outfits: Outfit[]) {
  return applyOutfitStatuses(outfits).map((outfit) => normalizeOutfitSnapshot(outfit));
}

function withDefinedOutfitFields(patch: Partial<Outfit>, source: Outfit): Partial<Outfit> {
  const next = { ...patch };
  if (source.userTitle !== undefined) next.userTitle = source.userTitle;
  if (source.displayTitle !== undefined) next.displayTitle = source.displayTitle;
  if (source.title !== undefined) next.title = source.title;
  if (source.updatedAt !== undefined) next.updatedAt = source.updatedAt;
  return next;
}

function getOutfitStatusUpdatedAt(updatedAt: string | undefined) {
  if (!updatedAt) return undefined;
  const timestamp = Date.parse(updatedAt);
  return Number.isFinite(timestamp) ? timestamp : undefined;
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
  const [recommendationBatchId, setRecommendationBatchId] = useState('');
  const [batchLimited, setBatchLimited] = useState(false);
  const [batchExhausted, setBatchExhausted] = useState(false);
  const requestSeq = useRef(0);
  const seenOutfitKeysRef = useRef<Set<string>>(new Set());
  const outfitsRef = useRef<Outfit[]>([]);
  const currentIndexRef = useRef(0);
  const selectedSceneKeyRef = useRef<SceneKey>('home');
  const recommendationBatchIdRef = useRef('');
  const hasRecommendationsRef = useRef(true);
  const batchLimitedRef = useRef(false);
  const batchExhaustedRef = useRef(false);
  const recommendationNoticeRef = useRef('');
  const shouldRestoreFromDetailRef = useRef(false);
  const currentWeatherRef = useRef<WeatherSnapshot | undefined>(undefined);
  const lastRecommendationWeatherKeyRef = useRef('');
  const initialRecommendationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [currentWeather, setCurrentWeather] = useState<WeatherSnapshot | undefined>(undefined);
  const selectedScene = SCENE_TAGS[selectedSceneKey];
  const selectedSceneRef = useRef<SceneTag>(selectedScene);
  outfitsRef.current = outfits;
  currentIndexRef.current = currentIndex;
  selectedSceneKeyRef.current = selectedSceneKey;
  recommendationBatchIdRef.current = recommendationBatchId;
  hasRecommendationsRef.current = hasRecommendations;
  batchLimitedRef.current = batchLimited;
  batchExhaustedRef.current = batchExhausted;
  recommendationNoticeRef.current = recommendationNotice;
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
    const authContext = captureAuthContext();
    restoreTodaySnapshotFromDetail(authContext);
    const syncedOutfit = consumeOutfitStateSync({ authContext });
    if (syncedOutfit) {
      updateOutfitsByKey(syncedOutfit, syncedOutfit, authContext);
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
    const authContext = captureAuthContext();
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
        timeOfDay: TODAY_TIME_OF_DAY,
        maxResults: 8,
        ...(weather ? { weather } : {}),
        ...(excludedOutfitKeys.length > 0 ? { excludedOutfitKeys } : {}),
      });

      if (!isLatestRequest(seq)) return false;
      const normalizedOutfits = data.outfits.map((outfit) => normalizeOutfitSnapshot(outfit));
      setOutfitStatuses(getOutfitStatusPatches(normalizedOutfits));
      const nextOutfits = applyTodayOutfitStatuses(normalizedOutfits);
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
      storeTodayRestoreSnapshot({
        outfits: nextOutfits,
        currentIndex: 0,
        selectedSceneKey: getSceneKeyByTag(scene),
        weatherSnapshot: weather,
        recommendationBatchId: data.recommendationBatchId ?? nextOutfits[0]?.recommendationBatchId ?? '',
        hasRecommendations: data.outfits.length > 0,
        batchLimited: Boolean(data.limited),
        batchExhausted: Boolean(data.exhausted),
        recommendationNotice: getBatchNotice(data.recommendationNotice, Boolean(data.limited), Boolean(data.exhausted)),
      }, authContext);
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
    shouldRestoreFromDetailRef.current = false;
    const seq = nextRequestSeq();
    const authContext = captureAuthContext();
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
        timeOfDay: TODAY_TIME_OF_DAY,
        maxResults: 8,
        ...(weatherForRefresh ? { weather: weatherForRefresh } : {}),
        excludedOutfitKeys: getSeenOutfitKeys(),
      });

      if (!isLatestRequest(seq)) return;
      if (data.outfits.length > 0) {
        const normalizedOutfits = data.outfits.map((outfit) => normalizeOutfitSnapshot(outfit));
        setOutfitStatuses(getOutfitStatusPatches(normalizedOutfits));
        const nextOutfits = applyTodayOutfitStatuses(normalizedOutfits);
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
        storeTodayRestoreSnapshot({
          outfits: nextOutfits,
          currentIndex: 0,
          selectedSceneKey,
          weatherSnapshot: weatherForRefresh,
          recommendationBatchId: data.recommendationBatchId ?? nextOutfits[0]?.recommendationBatchId ?? '',
          hasRecommendations: true,
          batchLimited: Boolean(data.limited),
          batchExhausted: Boolean(data.exhausted),
          recommendationNotice: getBatchNotice(data.recommendationNotice, Boolean(data.limited), Boolean(data.exhausted)),
        }, authContext);
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

    const authContext = captureAuthContext();
    const nextFavorite = !current.isFavorite;
    setOperation('favorite');

    try {
      if (nextFavorite) {
        const saved = await saveFavoriteOutfit(normalizeOutfitSnapshot(current), current.aiComment);
        const nextFavoriteOutfitId = saved.favoriteOutfitId || saved.id;
        updateOutfitStatusByKey(
          current,
          {
            ...getOutfitStatusPatch(saved, current.outfitKey),
            outfitKey: saved.outfitKey ?? current.outfitKey ?? '',
            isFavorite: true,
            favoriteOutfitId: nextFavoriteOutfitId,
          },
          withDefinedOutfitFields(
            {
              isFavorite: true,
              favoriteOutfitId: nextFavoriteOutfitId,
              favoritedAt: saved.favoritedAt || saved.createdAt,
            },
            saved,
          ),
          authContext,
        );
      } else {
        const removed = await removeFavoriteOutfit(current.favoriteOutfitId || current.id, current.outfitKey);
        updateOutfitStatusByKey(
          current,
          {
            outfitKey: removed.outfitKey ?? current.outfitKey ?? '',
            isFavorite: false,
            favoriteOutfitId: '',
          },
          {
            isFavorite: false,
            favoriteOutfitId: undefined,
            favoritedAt: undefined,
          },
          authContext,
        );
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

    const authContext = captureAuthContext();
    setOperation('wear');
    try {
      await addOutfitHistory(normalizeOutfitSnapshot(current), {
        source: current.outfitKind === 'favorite' || current.isFavorite ? 'favorite' : 'recommendation',
        sourceFavoriteOutfitId:
          current.outfitKind === 'favorite' || current.isFavorite ? current.favoriteOutfitId || current.id : undefined,
        aiComment: current.aiComment,
      }).then((saved) => {
        const nextTodayHistoryId = saved.todayHistoryId || saved.historyId || saved.id;
        updateOutfitStatusByKey(
          current,
          {
            ...getOutfitStatusPatch(saved, current.outfitKey),
            outfitKey: saved.outfitKey ?? current.outfitKey ?? '',
            isWornToday: true,
            todayHistoryId: nextTodayHistoryId,
            wornAt: saved.wornAt,
            wornDate: saved.wornDate || getToday(),
          },
          {
            isWornToday: true,
            todayHistoryId: nextTodayHistoryId,
            historyId: saved.historyId || saved.id,
            lastWornAt: saved.lastWornAt || saved.wornAt || new Date().toISOString(),
            wornAt: saved.wornAt,
            wornDate: saved.wornDate || getToday(),
          },
          authContext,
        );
      });
      void invalidateAfterOutfitWornMutation();
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
    clearInitialRecommendationTimer();
    currentWeatherRef.current = weather;
    lastRecommendationWeatherKeyRef.current = weatherKey;
    setCurrentWeather(weather);

    if (!options.forceRefresh && outfitsRef.current.length > 0) {
      console.log('[TodayPage] weather unchanged, skip recommendation refresh', {
        weatherKey,
        sameWeather,
      });
      return;
    }

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
    const authContext = captureAuthContext();
    shouldRestoreFromDetailRef.current = true;
    storeTodayRestoreSnapshot({ currentIndex }, authContext);
    storeOutfitDetailDraft(current, { authContext });
    Taro.navigateTo({ url: `/pages/outfit-detail/index?id=${encodeURIComponent(outfitId)}&source=recommendation` });
  }

  function handleSwiperChange(event: SwiperChangeEvent) {
    const next = event.detail.current;
    setCurrentIndex(next);
    markOutfitShown(outfits[next]);
    storeTodayRestoreSnapshot({ currentIndex: next });
  }

  function scheduleInitialRecommendation() {
    clearInitialRecommendationTimer();
    initialRecommendationTimerRef.current = setTimeout(() => {
      if (currentWeatherRef.current || outfitsRef.current.length > 0) return;
      fetchRecommendations({ scene: selectedSceneRef.current, trigger: 'initial-fallback' });
    }, 700);
  }

  function clearInitialRecommendationTimer() {
    if (!initialRecommendationTimerRef.current) return;
    clearTimeout(initialRecommendationTimerRef.current);
    initialRecommendationTimerRef.current = null;
  }

  function updateOutfitsByKey(
    reference: Outfit,
    patch: Partial<Outfit>,
    authContext?: ActiveAuthContext | null,
  ) {
    const outfitKey = reference.outfitKey;
    setOutfits((prev) => {
      const next = prev.map((outfit) =>
        outfit.outfitKey === outfitKey || outfit.id === reference.id ? normalizeOutfitSnapshot({ ...outfit, ...patch }) : outfit,
      );
      storeTodayRestoreSnapshot({ outfits: next }, authContext);
      return next;
    });
  }

  function updateOutfitStatusByKey(
    reference: Outfit,
    statusPatch: OutfitStatusPatch,
    listPatch: Partial<Outfit>,
    authContext?: ActiveAuthContext | null,
  ) {
    if (!statusPatch.outfitKey) {
      updateOutfitsByKey(reference, listPatch, authContext);
      return;
    }

    setOutfitStatus(statusPatch);
    setOutfits((prev) => {
      const next = prev.map((outfit) =>
        outfit.outfitKey === statusPatch.outfitKey || outfit.outfitKey === reference.outfitKey || outfit.id === reference.id
          ? normalizeOutfitSnapshot({ ...outfit, ...listPatch })
          : outfit,
      );
      const nextWithStatus = applyTodayOutfitStatuses(next);
      storeTodayRestoreSnapshot({ outfits: nextWithStatus }, authContext);
      return nextWithStatus;
    });
  }

  function markOutfitShown(outfit: Outfit | undefined) {
    if (outfit?.outfitKey) {
      seenOutfitKeysRef.current.add(outfit.outfitKey);
    }
  }

  function getSeenOutfitKeys() {
    return [...seenOutfitKeysRef.current];
  }

  function storeTodayRestoreSnapshot(
    input: TodayRestoreSnapshotInput = {},
    authContext?: ActiveAuthContext | null,
  ) {
    const snapshotOutfits = applyTodayOutfitStatuses((input.outfits ?? outfitsRef.current).map((outfit) => normalizeOutfitSnapshot(outfit)));
    if (snapshotOutfits.length === 0) return;

    const snapshotSceneKey = input.selectedSceneKey ?? selectedSceneKeyRef.current;
    const snapshotWeather = input.weatherSnapshot ?? currentWeatherRef.current;
    const snapshotIndex = clampIndex(input.currentIndex ?? currentIndexRef.current, snapshotOutfits.length);
    const snapshot: TodayRestoreSnapshot = {
      version: 1,
      outfits: snapshotOutfits,
      currentIndex: snapshotIndex,
      selectedSceneKey: snapshotSceneKey,
      scene: SCENE_TAGS[snapshotSceneKey],
      weatherSnapshot: snapshotWeather,
      weatherKey: snapshotWeather ? getWeatherKey(snapshotWeather) : '',
      targetDate: getToday(),
      timeOfDay: TODAY_TIME_OF_DAY,
      recommendationBatchId: input.recommendationBatchId ?? recommendationBatchIdRef.current,
      generatedAt: Date.now(),
      seenOutfitKeys: input.seenOutfitKeys ?? getSeenOutfitKeys(),
      hasRecommendations: input.hasRecommendations ?? hasRecommendationsRef.current,
      batchLimited: input.batchLimited ?? batchLimitedRef.current,
      batchExhausted: input.batchExhausted ?? batchExhaustedRef.current,
      recommendationNotice: input.recommendationNotice ?? recommendationNoticeRef.current,
    };

    setUserStorageSync(TODAY_RESTORE_SNAPSHOT_KEY, snapshot, { authContext });
  }

  function restoreTodaySnapshotFromDetail(authContext?: ActiveAuthContext | null) {
    if (!shouldRestoreFromDetailRef.current) return false;
    shouldRestoreFromDetailRef.current = false;

    const snapshot = readTodayRestoreSnapshot(authContext);
    if (!snapshot || !canRestoreTodaySnapshot(snapshot)) return false;

    const restoredOutfits = applyTodayOutfitStatuses(snapshot.outfits.map((outfit) => normalizeOutfitSnapshot(outfit)));
    const restoredIndex = clampIndex(snapshot.currentIndex, restoredOutfits.length);
    clearInitialRecommendationTimer();
    nextRequestSeq();
    outfitsRef.current = restoredOutfits;
    currentIndexRef.current = restoredIndex;
    selectedSceneKeyRef.current = snapshot.selectedSceneKey;
    recommendationBatchIdRef.current = snapshot.recommendationBatchId;
    hasRecommendationsRef.current = snapshot.hasRecommendations;
    batchLimitedRef.current = snapshot.batchLimited;
    batchExhaustedRef.current = snapshot.batchExhausted;
    recommendationNoticeRef.current = snapshot.recommendationNotice;
    seenOutfitKeysRef.current = new Set(snapshot.seenOutfitKeys);
    markOutfitShown(restoredOutfits[restoredIndex]);
    currentWeatherRef.current = snapshot.weatherSnapshot;
    lastRecommendationWeatherKeyRef.current = snapshot.weatherKey;
    setSelectedSceneKey(snapshot.selectedSceneKey);
    setOutfits(restoredOutfits);
    setCurrentIndex(restoredIndex);
    setCurrentWeather(snapshot.weatherSnapshot);
    setHasRecommendations(snapshot.hasRecommendations);
    setRecommendationBatchId(snapshot.recommendationBatchId);
    setBatchLimited(snapshot.batchLimited);
    setBatchExhausted(snapshot.batchExhausted);
    setRecommendationNotice(snapshot.recommendationNotice);
    setError('');
    setLoading(false);
    return true;
  }

  function readTodayRestoreSnapshot(authContext?: ActiveAuthContext | null) {
    try {
      const value = getUserStorageSync<TodayRestoreSnapshot>(TODAY_RESTORE_SNAPSHOT_KEY, { authContext });
      if (!value || typeof value !== 'object') return null;
      if (value.version !== 1 || !Array.isArray(value.outfits)) return null;
      return value;
    } catch {
      return null;
    }
  }

  function canRestoreTodaySnapshot(snapshot: TodayRestoreSnapshot) {
    if (Date.now() - snapshot.generatedAt > TODAY_RESTORE_SNAPSHOT_TTL_MS) return false;
    if (snapshot.targetDate !== getToday()) return false;
    if (snapshot.timeOfDay !== TODAY_TIME_OF_DAY) return false;
    if (snapshot.selectedSceneKey !== selectedSceneKeyRef.current) return false;
    if (snapshot.scene !== selectedSceneRef.current) return false;
    if (hasWardrobeRefreshSignal()) return false;

    const weather = currentWeatherRef.current;
    if (weather && getWeatherKey(weather) !== snapshot.weatherKey) {
      return false;
    }

    return snapshot.outfits.length > 0;
  }

  function hasWardrobeRefreshSignal() {
    try {
      return Boolean(getUserStorageSync(WARDROBE_REFRESH_STORAGE_KEY));
    } catch {
      return false;
    }
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
                          <RecommendationImage src={item.thumbnailUrl || item.imageUrl} />
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

function RecommendationImage({ src }: { src?: string }) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'failed' | 'empty'>(src ? 'loading' : 'empty');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    setStatus(src ? 'loading' : 'empty');
    setRetryKey(0);
  }, [src]);

  if (!src || status === 'empty') {
    return (
      <View className="image-fallback empty">
        <Text className="image-fallback-text">暂无图片</Text>
      </View>
    );
  }

  if (status === 'failed') {
    return (
      <View
        className="image-fallback failed"
        onClick={(event: TapEvent) => {
          event.stopPropagation();
          setStatus('loading');
          setRetryKey((value) => value + 1);
        }}
      >
        <Text className="image-fallback-text">图片暂时没取到</Text>
        <Text className="image-retry-text">点一下重试</Text>
      </View>
    );
  }

  return (
    <View className="image-stage">
      {status === 'loading' && (
        <View className="image-skeleton">
          <View className="image-skeleton-shine" />
          <Text className="image-skeleton-text">小搭取图中</Text>
        </View>
      )}
      <Image
        key={`${src}:${retryKey}`}
        className={`item-image ${status === 'loaded' ? 'loaded' : ''}`}
        src={src}
        mode="aspectFit"
        lazyLoad
        onLoad={() => setStatus('loaded')}
        onError={() => setStatus('failed')}
      />
    </View>
  );
}

function getToday() {
  return new Date().toISOString().split('T')[0]!;
}

function clampIndex(index: number, length: number) {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(index, length - 1));
}

function getSceneKeyByTag(scene: SceneTag): SceneKey {
  return SCENES.find((item) => SCENE_TAGS[item.key] === scene)?.key ?? 'home';
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
