import { Image, Swiper, SwiperItem, Text, View } from '@tarojs/components';
import Taro, { useDidShow, usePullDownRefresh, useUnload } from '@tarojs/taro';
import { useCallback, useEffect, useRef, useState } from 'react';
import { WeatherCard, type WeatherRecommendationRefreshResult } from '@/components/WeatherCard';
import { useAuthRuntime } from '@/hooks/useAuthRuntime';
import {
  TODAY_PROFILE_INPUT_VERSION_KEY,
  TODAY_WARDROBE_INPUT_VERSION_KEY,
  invalidateAfterOutfitFavoriteMutation,
  invalidateAfterOutfitWornMutation,
} from '@/lib/cacheInvalidation';
import {
  addOutfitHistory,
  generateCloudOutfit,
  getCloudResponseTransportDiagnostics,
  isRecommendationDiagnosticEnvironment,
  removeFavoriteOutfit,
  saveFavoriteOutfit,
} from '@/lib/cloud';
import {
  buildRecommendationQaLogSummary,
  createRecommendationAuditId,
  logRecommendationEvent,
} from '@/lib/recommendationDiagnostics';
import {
  buildOutfitBehaviorSnapshot,
  createOutfitBehaviorEventId,
  createOutfitBehaviorExposureTracker,
  trackOutfitBehaviorEvent,
} from '@/lib/outfitBehavior';
import {
  captureAuthContext,
  isAuthContextCurrent,
  type ActiveAuthContext,
} from '@/lib/userPageCache';
import {
  getUserStorageSync,
  setUserStorageSync,
} from '@/lib/userStorage';
import { applyOutfitStatuses, setOutfitStatus, setOutfitStatuses } from '@/stores/outfitStatusStore';
import { consumeOutfitStateSync, normalizeOutfitSnapshot, storeOutfitDetailDraft } from '@/utils/outfitSnapshot';
import {
  COPY_CONTRACT_VERSION,
  hasCurrentNewRecommendationCopy,
} from '@/utils/recommendationCopyContract';
import {
  NO_MORE_NEW_OUTFITS_NOTICE,
  getRecommendationEmptyStateCopy,
} from '@/utils/recommendationAvailability';
import { getOutfitStyleTags } from '@/utils/outfitContextText';
import { getOutfitDisplayTitle } from '@/utils/outfitTitle';
import {
  getImageSessionDiagnostics,
  isImageSessionReady,
  markImageSessionFailed,
  markImageSessionReady,
  preloadImageSession,
  recordImageSessionMount,
  subscribeImageSession,
} from '@/utils/imageSessionCache';
import { getRecommendationWeatherFingerprint, type RecommendationWeatherFingerprint } from '@/utils/weather';
import {
  buildSceneIdentityKey,
  mergeSeenOutfitKeys,
} from './refreshExclusions';
import { getProductStateCopy } from '@/utils/xiaodaProductStateCopy';
import { buildOutfitCardViewModel } from './cardViewModel';
import {
  buildRecommendationInputSignature,
  createRecommendationIntentRegistry,
  type RecommendationIntent,
  type RecommendationIntentRegistry,
} from './recommendationIntent';
import {
  TODAY_SCENE_COPY_VERSION,
  buildExhaustedSnapshotState,
  buildSceneSnapshotKey,
  chooseSceneTransitionState,
  isNoMoreRecommendationState,
  isValidSceneSnapshotCountState,
  shouldUseSceneSnapshot,
  type SceneSnapshot,
} from './sceneSnapshot';
import {
  validateRecommendationCountContract,
  validateSceneContract as validateSceneContractPure,
} from './sceneResponseValidation';
import type { OutfitStatusPatch } from '@/stores/outfitStatusStore';
import type { SceneContractValidation } from './sceneResponseValidation';
import type { Outfit, RecommendResponse, RecommendationCountContract, RecommendationMissingFact, RecommendationMissingRole, SceneTag, WeatherMode, WeatherSnapshot } from '@starter-template/types';
import './index.scss';

interface ExtendedSceneSnapshot extends SceneSnapshot {
  sceneKey?: SceneKey
  weatherMode?: WeatherMode
}

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

interface RecommendationRequestContext {
  auditId: string
  requestSeq: number
  intentId: string
  inputSignature: string
  intentGeneration: number
  sceneKey: SceneKey
  sceneLabel: SceneTag
  weatherMode: WeatherMode
  requestedAt: number
}

interface ClientImageTiming {
  auditId: string;
  cloudRoundTripMs: number;
  clientApplyMs: number;
  requestedImageCount: number;
  resolvedImageCount: number;
  applyFinishedAt: number;
  timeoutId?: ReturnType<typeof setTimeout>;
}

interface TodayRestoreSnapshot {
  version: 3;
  copyContractVersion: typeof COPY_CONTRACT_VERSION;
  outfits: Outfit[];
  currentIndex: number;
  selectedSceneKey: SceneKey;
  scene: SceneTag;
  weatherSnapshot?: WeatherSnapshot;
  weatherMode: WeatherMode;
  weatherFingerprint?: RecommendationWeatherFingerprint;
  weatherKey: string;
  targetDate: string;
  timeOfDay: TimeOfDay;
  sceneSnapshotKey: string;
  recommendationBatchId: string | undefined;
  generatedAt: number;
  seenOutfitKeys: string[];
  hasRecommendations: boolean;
  batchLimited: boolean;
  batchExhausted: boolean;
  noMoreRecommendations: boolean;
  countContract?: RecommendationCountContract;
  lastVisibleBatch?: SceneSnapshot['lastVisibleBatch'];
  recommendationNotice: string;
}

interface TodayRestoreSnapshotInput {
  outfits?: Outfit[];
  currentIndex?: number;
  selectedSceneKey?: SceneKey;
  weatherSnapshot?: WeatherSnapshot;
  weatherMode?: WeatherMode;
  weatherFingerprint?: RecommendationWeatherFingerprint;
  recommendationBatchId?: string;
  seenOutfitKeys?: string[];
  hasRecommendations?: boolean;
  batchLimited?: boolean;
  batchExhausted?: boolean;
  noMoreRecommendations?: boolean;
  countContract?: RecommendationCountContract;
  lastVisibleBatch?: SceneSnapshot['lastVisibleBatch'];
  recommendationNotice?: string;
}

const TODAY_RESTORE_SNAPSHOT_KEY = 'today:outfitReturnSnapshot:recommendation-copy-contract-v3';
const TODAY_SCENE_SNAPSHOT_STORAGE_PREFIX = 'today:sceneSnapshot:recommendation-copy-contract-v3';
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

function applyTodayOutfitStatuses(outfits: Outfit[], authContext?: ActiveAuthContext | null) {
  return applyOutfitStatuses(outfits, authContext).map((outfit) => normalizeOutfitSnapshot(outfit));
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
  const { authStatus, runtimeKey, isAuthenticated } = useAuthRuntime();
  const [selectedSceneKey, setSelectedSceneKey] = useState<SceneKey>('home');
  const [outfits, setOutfits] = useState<Outfit[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [operation, setOperation] = useState<OutfitOperation>(null);
  const [hasRecommendations, setHasRecommendations] = useState(true);
  const [error, setError] = useState('');
  const [recommendationNotice, setRecommendationNotice] = useState('');
  const [missingRoles, setMissingRoles] = useState<RecommendationMissingRole[]>([]);
  const [missingFacts, setMissingFacts] = useState<RecommendationMissingFact[]>([]);
  const [recommendationBatchId, setRecommendationBatchId] = useState<string | undefined>(undefined);
  const [batchLimited, setBatchLimited] = useState(false);
  const [batchExhausted, setBatchExhausted] = useState(false);
  const requestSeq = useRef(0);
  const activeRequestSeqRef = useRef<number | null>(null);
  const intentCounterRef = useRef(0);
  const entryIntentIdRef = useRef('today-entry:pending');
  const recommendationIntentRegistryRef = useRef<RecommendationIntentRegistry | null>(null);
  if (!recommendationIntentRegistryRef.current) {
    recommendationIntentRegistryRef.current = createRecommendationIntentRegistry();
  }
  const requestContextByIntentGenerationRef = useRef<Record<number, RecommendationRequestContext>>({});
  const seenOutfitKeysRef = useRef<Set<string>>(new Set());
  const seenOutfitKeysBySceneIdentityRef = useRef<Record<string, string[]>>({});
  const seenIdentityHashBySceneRef = useRef<Record<string, string>>({});
  const activeSeenSceneIdentityKeyRef = useRef(buildSceneIdentityKey('home', ''));
  const outfitsRef = useRef<Outfit[]>([]);
  const currentIndexRef = useRef(0);
  const selectedSceneKeyRef = useRef<SceneKey>('home');
  const recommendationBatchIdRef = useRef<string | undefined>(undefined);
  const hasRecommendationsRef = useRef(true);
  const batchLimitedRef = useRef(false);
  const batchExhaustedRef = useRef(false);
  const countContractRef = useRef<RecommendationCountContract | undefined>(undefined);
  const recommendationNoticeRef = useRef('');
  const clientImageTimingRef = useRef<ClientImageTiming | null>(null);
  const imagePreloadGenerationRef = useRef(0);
  const shouldRestoreFromDetailRef = useRef(false);
  const currentWeatherRef = useRef<WeatherSnapshot | undefined>(undefined);
  const currentWeatherModeRef = useRef<WeatherMode>('disabled');
  const currentWeatherFingerprintRef = useRef<RecommendationWeatherFingerprint>(getRecommendationWeatherFingerprint(undefined));
  const recommendationWeatherSnapshotRef = useRef<WeatherSnapshot | undefined>(undefined);
  const recommendationWeatherFingerprintRef = useRef<RecommendationWeatherFingerprint>(getRecommendationWeatherFingerprint(undefined));
  const loadingOwnerSeqRef = useRef<number | null>(null);
  const operationOwnerSeqRef = useRef<number | null>(null);
  const lastHandledRuntimeKeyRef = useRef<string | null>(null);
  const operationTargetRef = useRef<{ operation: OutfitOperation; outfitKey: string } | null>(null);
  const behaviorTrackerRef = useRef(createOutfitBehaviorExposureTracker());
  const sceneSnapshotsRef = useRef<Record<string, ExtendedSceneSnapshot>>({});
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

  const resetUserState = useCallback(() => {
    requestSeq.current += 1;
    activeRequestSeqRef.current = null;
    recommendationIntentRegistryRef.current?.reset();
    requestContextByIntentGenerationRef.current = {};
    seenOutfitKeysRef.current = new Set();
    seenOutfitKeysBySceneIdentityRef.current = {};
    seenIdentityHashBySceneRef.current = {};
    activeSeenSceneIdentityKeyRef.current = buildSceneIdentityKey('home', '');
    outfitsRef.current = [];
    currentIndexRef.current = 0;
    recommendationBatchIdRef.current = undefined;
    hasRecommendationsRef.current = true;
    batchLimitedRef.current = false;
    batchExhaustedRef.current = false;
    recommendationNoticeRef.current = '';
    shouldRestoreFromDetailRef.current = false;
    operationTargetRef.current = null;
    sceneSnapshotsRef.current = {};
    recommendationWeatherSnapshotRef.current = undefined;
    recommendationWeatherFingerprintRef.current = getRecommendationWeatherFingerprint(undefined);
    loadingOwnerSeqRef.current = null;
    operationOwnerSeqRef.current = null;
    behaviorTrackerRef.current = createOutfitBehaviorExposureTracker();
    setOutfits([]);
    setCurrentIndex(0);
    setLoading(false);
    setOperation(null);
    setHasRecommendations(true);
    setError('');
    setRecommendationNotice('');
    setMissingRoles([]);
    setMissingFacts([]);
    setRecommendationBatchId(undefined);
    setBatchLimited(false);
    setBatchExhausted(false);
  }, []);

  useUnload(() => {
    if (clientImageTimingRef.current?.timeoutId) clearTimeout(clientImageTimingRef.current.timeoutId);
    clientImageTimingRef.current = null;
    requestSeq.current += 1;
    activeRequestSeqRef.current = null;
    recommendationIntentRegistryRef.current?.reset();
    loadingOwnerSeqRef.current = null;
    operationOwnerSeqRef.current = null;
    imagePreloadGenerationRef.current += 1;
  });

  useEffect(() => {
    if (outfits.length === 0) return;
    const generation = imagePreloadGenerationRef.current + 1;
    imagePreloadGenerationRef.current = generation;
    const timer = setTimeout(() => {
      void preloadRecommendationCards(outfits, currentIndex, () => imagePreloadGenerationRef.current === generation);
    }, currentIndex === 0 ? 300 : 0);
    return () => {
      clearTimeout(timer);
    };
  }, [currentIndex, outfits]);

  usePullDownRefresh(() => {
    requestRecommendations({
      intentId: nextRecommendationIntentId('pull-down'),
      sceneKey: selectedSceneKeyRef.current,
      weather: currentWeatherRef.current,
      weatherMode: currentWeatherModeRef.current,
      trigger: 'pull-down',
    }).finally(() => {
      Taro.stopPullDownRefresh();
    });
  });

  useDidShow(() => {
    if (!isAuthenticated || !runtimeKey) return;
    const authContext = captureAuthContext();
    restoreTodaySnapshotFromDetail(authContext);
    const syncedOutfit = consumeOutfitStateSync({ authContext });
    if (syncedOutfit) {
      updateOutfitsByKey(syncedOutfit, syncedOutfit, authContext);
    }
  });

  useEffect(() => {
    if (!isAuthenticated || !runtimeKey) {
      lastHandledRuntimeKeyRef.current = null;
      resetUserState();
      return;
    }

    if (lastHandledRuntimeKeyRef.current === runtimeKey) return;
    resetUserState();
    lastHandledRuntimeKeyRef.current = runtimeKey;
    entryIntentIdRef.current = `today-entry:${runtimeKey}:${Date.now()}`;
    // A valid user-scoped snapshot is synchronous and must be allowed to paint
    // before WeatherCard finishes location/auth/cloud work. Weather changes
    // continue through handleWeatherChange as a background refresh afterwards.
    restoreTodaySnapshotFromDetail(captureAuthContext(), { requireReturnIntent: false });
    if (currentWeatherRef.current) {
      void handleWeatherChange(currentWeatherRef.current, {
        weatherMode: currentWeatherModeRef.current,
      });
    }
  }, [authStatus, isAuthenticated, resetUserState, runtimeKey]);

  function requestRecommendations({
    intentId,
    sceneKey,
    weather = currentWeatherRef.current,
    weatherMode = currentWeatherModeRef.current,
    excludedOutfitKeys = [],
    silent = false,
    trigger = 'unknown',
    requestKind = 'initial',
  }: {
    intentId: string
    sceneKey: SceneKey
    weather?: WeatherSnapshot
    weatherMode?: WeatherMode
    excludedOutfitKeys?: string[]
    silent?: boolean
    trigger?: string
    requestKind?: 'initial' | 'refresh'
  }): Promise<boolean> {
    const inputSignature = getRecommendationInputSignature({
      sceneKey,
      weather,
      recommendationBatchId: requestKind === 'refresh' ? recommendationBatchIdRef.current : undefined,
      excludedOutfitKeys,
      requestKind,
    });
    const registry = recommendationIntentRegistryRef.current;
    if (!registry) return Promise.resolve(false);
    const run = registry.run<boolean>({
      intentId,
      inputSignature,
      execute: (intent) => {
        const requestContext = createRecommendationRequestContext(
          sceneKey,
          weatherMode,
          intent,
        );
        requestContextByIntentGenerationRef.current[intent.generation] = requestContext;
        activeRequestSeqRef.current = requestContext.requestSeq;
        return fetchRecommendations({
          intent,
          requestContext,
          weather,
          excludedOutfitKeys,
          silent,
          trigger,
          requestKind,
        });
      },
    });
    const joinedContext = requestContextByIntentGenerationRef.current[run.intent.generation];
    if (joinedContext) {
      activeRequestSeqRef.current = joinedContext.requestSeq;
      if (!silent) setLoadingForRequest(joinedContext.requestSeq);
    }
    return run.promise;
  }

  async function fetchRecommendations({
    intent,
    requestContext,
    weather = currentWeatherRef.current,
    excludedOutfitKeys = [],
    silent = false,
    trigger = 'unknown',
    requestKind = 'initial',
  }: {
    intent: RecommendationIntent
    requestContext: RecommendationRequestContext
    weather?: WeatherSnapshot
    excludedOutfitKeys?: string[]
    silent?: boolean
    trigger?: string
    requestKind?: 'initial' | 'refresh'
  }): Promise<boolean> {
    const seq = requestContext.requestSeq;
    const scene = requestContext.sceneLabel;
    const weatherMode = requestContext.weatherMode;
    const auditId = requestContext.auditId;
    const authContext = captureAuthContext();
    if (!authContext) return false;
    logRecommendationStart(requestContext, trigger, Boolean(weather));

    if (!silent) {
      setLoadingForRequest(seq);
      setError('');
      setRecommendationNotice('');
      setBatchLimited(false);
      setBatchExhausted(false);
      setCurrentIndex(0);
    }

    try {
      const cloudRequestStartedAt = Date.now();
      const data = await generateCloudOutfit({
        date: getToday(),
        scene,
        timeOfDay: TODAY_TIME_OF_DAY,
        maxResults: 8,
        auditId,
        weatherMode,
        trigger,
        ...(weather ? { weather } : {}),
        ...(excludedOutfitKeys.length > 0 ? { excludedOutfitKeys } : {}),
      });
      const cloudRoundTripMs = Date.now() - cloudRequestStartedAt;
      const responseReceivedAt = Date.now();

      if (!isRecommendationIntentCurrent(intent) || !isAuthContextCurrent(authContext)) {
        logRecommendationIntentReject(requestContext, data, 'SUPERSEDED_INTENT');
        return false;
      }
      const currentInputSignature = getRecommendationInputSignature({
        sceneKey: requestContext.sceneKey,
        weather,
        recommendationBatchId: requestKind === 'refresh' ? recommendationBatchIdRef.current : undefined,
        excludedOutfitKeys,
        requestKind,
      });
      if (currentInputSignature !== requestContext.inputSignature) {
        logRecommendationIntentReject(requestContext, data, 'INPUT_SIGNATURE_CHANGED');
        return false;
      }
      const validation = validateSceneContract(requestContext, data);
      if (!validation.ok) {
        logSceneContractReject(auditId, data, validation);
        return false;
      }
      const countValidation = validateRecommendationCountContract(data);
      if (!countValidation.ok) {
        logRecommendationEvent('[RecommendReject]', {
          auditId: getRecommendationAuditId(data, auditId),
          reason: countValidation.reason,
          responseCardCount: countValidation.returnedCardCount,
          topLevelKeys: Object.keys(data).slice(0, 20),
          cloudBuild: data.debug?.cloudBuildVersion ?? data.meta?.cloudBuildVersion ?? '',
          transport: getCloudResponseTransportDiagnostics(data),
        });
        return false;
      }
      countContractRef.current = data.countContract;
      const eligibleApiOutfits = data.outfits.filter(hasCurrentNewRecommendationCopy);

      const requestWeatherFingerprint = getRecommendationWeatherFingerprint(weather);
      const normalizedOutfits = eligibleApiOutfits.map((outfit) => normalizeOutfitSnapshot(outfit));
      mergeSuccessfulSeenBatch(requestContext.sceneKey, getResponseIdentityHash(data), normalizedOutfits);
      setOutfitStatuses(getOutfitStatusPatches(normalizedOutfits), authContext);
      const nextOutfits = applyTodayOutfitStatuses(normalizedOutfits, authContext);
      const responseMissingRoles = data.debug?.limitedReason === 'MISSING_REQUIRED_CATEGORY'
        ? (data.missingRoles ?? data.debug.missingRoles ?? [])
        : [];
      const responseMissingFacts = data.outfits.length === 0
        ? (data.missingFacts ?? data.debug?.missingFacts ?? [])
        : [];
      const nextNotice = nextOutfits.length > 0
        ? getBatchNotice(data.recommendationNotice, Boolean(data.limited), Boolean(data.exhausted))
        : getRecommendationEmptyStateCopy(responseMissingRoles, responseMissingFacts);
      logRecommendationResponse(requestContext, data, trigger, nextOutfits.length);
      logRecommendationQa(data, auditId);
      recommendationWeatherSnapshotRef.current = weather;
      currentWeatherModeRef.current = weatherMode;
      recommendationWeatherFingerprintRef.current = requestWeatherFingerprint;
      outfitsRef.current = nextOutfits;
      currentIndexRef.current = 0;
      recommendationBatchIdRef.current = data.recommendationBatchId ?? nextOutfits[0]?.recommendationBatchId;
      setOutfits(nextOutfits);
      setCurrentIndex(0);
      setHasRecommendations(nextOutfits.length > 0);
      setError('');
      setMissingRoles(responseMissingRoles);
      setMissingFacts(responseMissingFacts);
      setRecommendationBatchId(data.recommendationBatchId ?? nextOutfits[0]?.recommendationBatchId);
      setBatchLimited(Boolean(data.limited));
      setBatchExhausted(Boolean(data.exhausted));
      setRecommendationNotice(nextNotice);
      storeSceneSnapshot({
        sceneKey: requestContext.sceneKey,
        scene,
        weather,
        weatherMode,
        weatherFingerprint: requestWeatherFingerprint,
        outfits: nextOutfits,
        currentIndex: 0,
        recommendationBatchId: data.recommendationBatchId ?? nextOutfits[0]?.recommendationBatchId,
        hasRecommendations: nextOutfits.length > 0,
        batchLimited: Boolean(data.limited),
        batchExhausted: Boolean(data.exhausted),
        recommendationNotice: nextNotice,
      });
      markOutfitShown(nextOutfits[0]);
      trackCurrentOutfitExposure(nextOutfits[0], 0, data.recommendationBatchId ?? nextOutfits[0]?.recommendationBatchId);
      storeTodayRestoreSnapshot({
        outfits: nextOutfits,
        currentIndex: 0,
        selectedSceneKey: requestContext.sceneKey,
        weatherSnapshot: weather,
        weatherMode,
        weatherFingerprint: requestWeatherFingerprint,
        recommendationBatchId: data.recommendationBatchId ?? nextOutfits[0]?.recommendationBatchId,
        hasRecommendations: nextOutfits.length > 0,
        batchLimited: Boolean(data.limited),
        batchExhausted: Boolean(data.exhausted),
        recommendationNotice: nextNotice,
      }, authContext);
      beginClientImageTiming({
        auditId: getRecommendationAuditId(data, auditId),
        cloudRoundTripMs,
        clientApplyMs: Date.now() - responseReceivedAt,
        firstOutfit: nextOutfits[0],
      });
      return true;
    } catch (err) {
      if (!isRecommendationIntentCurrent(intent) || !isLatestRequest(seq)) return false;
      logRecommendationError(auditId, seq, 'fetchRecommendations', err);
      if (!silent) {
        setError('获取推荐失败，请稍后再试');
        if (outfitsRef.current.length === 0) {
          setOutfits([]);
          setHasRecommendations(false);
        } else {
          setRecommendationNotice('新场景暂时没取到，先保留刚才这批');
        }
        Taro.showToast({ title: '获取推荐失败', icon: 'none' });
      }
      return false;
    } finally {
      delete requestContextByIntentGenerationRef.current[intent.generation];
      if (!silent) clearLoadingForRequest(seq);
    }
  }

  async function handleRefresh() {
    if (loading || operation) return;
    if (isNoMoreRecommendationState({
      batchExhausted: batchExhaustedRef.current,
      countContract: countContractRef.current,
    })) {
      setRecommendationNotice(NO_MORE_NEW_OUTFITS_NOTICE);
      Taro.showToast({ title: NO_MORE_NEW_OUTFITS_NOTICE, icon: 'none' });
      return;
    }
    shouldRestoreFromDetailRef.current = false;
    const weatherForRefresh = currentWeather ?? currentWeatherRef.current;
    const weatherModeForRefresh = currentWeatherModeRef.current;
    const excludedOutfitKeys = getSeenOutfitKeysForScene(selectedSceneKeyRef.current);
    const intent = recommendationIntentRegistryRef.current?.activate({
      intentId: nextRecommendationIntentId('refresh'),
      inputSignature: getRecommendationInputSignature({
        sceneKey: selectedSceneKeyRef.current,
        weather: weatherForRefresh,
        recommendationBatchId: recommendationBatchIdRef.current,
        excludedOutfitKeys,
        requestKind: 'refresh',
      }),
    });
    if (!intent) return;
    const requestContext = createRecommendationRequestContext(
      selectedSceneKeyRef.current,
      weatherModeForRefresh,
      intent,
    );
    activeRequestSeqRef.current = requestContext.requestSeq;
    const seq = requestContext.requestSeq;
    const auditId = requestContext.auditId;
    const authContext = captureAuthContext();
    if (!authContext) return;
    const previousOutfits = outfitsRef.current;
    const previousRecommendationBatchId = recommendationBatchIdRef.current;
    setOperationForRequest(seq, 'refresh');
    setError('');
    setRecommendationNotice('');

    try {
      const weatherFingerprintForRefresh = getRecommendationWeatherFingerprint(weatherForRefresh);
      logRecommendationStart(requestContext, 'refresh', Boolean(weatherForRefresh));
      const cloudRequestStartedAt = Date.now();
      const data = await generateCloudOutfit({
        date: getToday(),
        scene: requestContext.sceneLabel,
        timeOfDay: TODAY_TIME_OF_DAY,
        maxResults: 8,
        auditId,
        weatherMode: weatherModeForRefresh,
        trigger: 'refresh',
        ...(weatherForRefresh ? { weather: weatherForRefresh } : {}),
        ...(typeof previousRecommendationBatchId === 'string' && previousRecommendationBatchId.length > 0 ? { recommendationBatchId: previousRecommendationBatchId } : {}),
        excludedOutfitKeys,
      });
      const cloudRoundTripMs = Date.now() - cloudRequestStartedAt;
      const responseReceivedAt = Date.now();

      if (!isRecommendationIntentCurrent(intent) || !isAuthContextCurrent(authContext)) return;
      const currentInputSignature = getRecommendationInputSignature({
        sceneKey: requestContext.sceneKey,
        weather: weatherForRefresh,
        recommendationBatchId: previousRecommendationBatchId,
        excludedOutfitKeys,
        requestKind: 'refresh',
      });
      if (currentInputSignature !== requestContext.inputSignature) {
        logRecommendationIntentReject(requestContext, data, 'INPUT_SIGNATURE_CHANGED');
        return;
      }
      const validation = validateSceneContract(requestContext, data);
      if (!validation.ok) {
        logSceneContractReject(auditId, data, validation);
        return;
      }
      const countValidation = validateRecommendationCountContract(data);
      if (!countValidation.ok) {
        logRecommendationEvent('[RecommendReject]', {
          auditId: getRecommendationAuditId(data, auditId),
          reason: countValidation.reason,
          responseCardCount: countValidation.returnedCardCount,
        });
        return;
      }
      const eligibleApiOutfits = data.outfits.filter(hasCurrentNewRecommendationCopy);
      logRecommendationResponse(requestContext, data, 'refresh', eligibleApiOutfits.length);
      logRecommendationQa(data, auditId);
      if (eligibleApiOutfits.length > 0) {
        countContractRef.current = data.countContract;
        const normalizedOutfits = eligibleApiOutfits.map((outfit) => normalizeOutfitSnapshot(outfit));
        mergeSuccessfulSeenBatch(requestContext.sceneKey, getResponseIdentityHash(data), normalizedOutfits);
        setOutfitStatuses(getOutfitStatusPatches(normalizedOutfits), authContext);
        const nextOutfits = applyTodayOutfitStatuses(normalizedOutfits, authContext);
        recommendationWeatherSnapshotRef.current = weatherForRefresh;
        recommendationWeatherFingerprintRef.current = weatherFingerprintForRefresh;
        outfitsRef.current = nextOutfits;
        currentIndexRef.current = 0;
        recommendationBatchIdRef.current = data.recommendationBatchId ?? nextOutfits[0]?.recommendationBatchId;
        setOutfits(nextOutfits);
        setCurrentIndex(0);
        setHasRecommendations(true);
        setMissingRoles([]);
        setMissingFacts([]);
        setRecommendationBatchId(data.recommendationBatchId ?? nextOutfits[0]?.recommendationBatchId);
        setBatchLimited(Boolean(data.limited));
        setBatchExhausted(Boolean(data.exhausted));
        setRecommendationNotice(getBatchNotice(data.recommendationNotice, Boolean(data.limited), Boolean(data.exhausted)));
        storeSceneSnapshot({
          sceneKey: requestContext.sceneKey,
          scene: requestContext.sceneLabel,
          weather: weatherForRefresh,
          weatherMode: weatherModeForRefresh,
          weatherFingerprint: weatherFingerprintForRefresh,
          outfits: nextOutfits,
          currentIndex: 0,
          recommendationBatchId: data.recommendationBatchId ?? nextOutfits[0]?.recommendationBatchId,
          hasRecommendations: true,
          batchLimited: Boolean(data.limited),
          batchExhausted: Boolean(data.exhausted),
          countContract: data.countContract,
          recommendationNotice: getBatchNotice(data.recommendationNotice, Boolean(data.limited), Boolean(data.exhausted)),
        });
        markOutfitShown(nextOutfits[0]);
        trackCurrentOutfitExposure(nextOutfits[0], 0, data.recommendationBatchId ?? nextOutfits[0]?.recommendationBatchId);
        storeTodayRestoreSnapshot({
          outfits: nextOutfits,
          currentIndex: 0,
          selectedSceneKey,
          weatherSnapshot: weatherForRefresh,
          weatherMode: weatherModeForRefresh,
          weatherFingerprint: weatherFingerprintForRefresh,
          recommendationBatchId: data.recommendationBatchId ?? nextOutfits[0]?.recommendationBatchId,
          hasRecommendations: true,
          batchLimited: Boolean(data.limited),
          batchExhausted: Boolean(data.exhausted),
          countContract: data.countContract,
          recommendationNotice: getBatchNotice(data.recommendationNotice, Boolean(data.limited), Boolean(data.exhausted)),
        }, authContext);
        beginClientImageTiming({
          auditId: getRecommendationAuditId(data, auditId),
          cloudRoundTripMs,
          clientApplyMs: Date.now() - responseReceivedAt,
          firstOutfit: nextOutfits[0],
        });
        trackOutfitBehaviorEvent(behaviorTrackerRef.current.buildBatchRefreshEvent({
          previousRecommendationBatchId,
          previousOutfits,
          scene: selectedSceneKey,
          trigger: 'manual',
        }));
      } else {
        const notice = NO_MORE_NEW_OUTFITS_NOTICE;
        const exhaustedState = buildExhaustedSnapshotState({
          outfits: previousOutfits,
          currentIndex: currentIndexRef.current,
          recommendationBatchId: previousRecommendationBatchId || '',
          countContract: data.countContract,
          recommendationNotice: notice,
        });
        if (!exhaustedState) {
          logRecommendationEvent('[RecommendReject]', {
            auditId: getRecommendationAuditId(data, auditId),
            reason: 'INVALID_EXHAUSTED_STATE',
            responseCardCount: data.outfits.length,
          });
          return;
        }
        countContractRef.current = data.countContract;
        hasRecommendationsRef.current = exhaustedState.hasRecommendations;
        batchLimitedRef.current = exhaustedState.batchLimited;
        batchExhaustedRef.current = exhaustedState.batchExhausted;
        recommendationNoticeRef.current = notice;
        setHasRecommendations(exhaustedState.hasRecommendations);
        setBatchLimited(exhaustedState.batchLimited);
        setBatchExhausted(exhaustedState.batchExhausted);
        setRecommendationNotice(notice);
        storeSceneSnapshot({
          sceneKey: requestContext.sceneKey,
          scene: requestContext.sceneLabel,
          weather: weatherForRefresh,
          weatherMode: weatherModeForRefresh,
          weatherFingerprint: weatherFingerprintForRefresh,
          outfits: previousOutfits,
          currentIndex: exhaustedState.currentIndex,
          recommendationBatchId: previousRecommendationBatchId,
          hasRecommendations: exhaustedState.hasRecommendations,
          batchLimited: exhaustedState.batchLimited,
          batchExhausted: exhaustedState.batchExhausted,
          noMoreRecommendations: true,
          countContract: data.countContract,
          lastVisibleBatch: exhaustedState.lastVisibleBatch,
          recommendationNotice: notice,
        });
        storeTodayRestoreSnapshot({
          outfits: previousOutfits,
          currentIndex: exhaustedState.currentIndex,
          selectedSceneKey: requestContext.sceneKey,
          weatherSnapshot: weatherForRefresh,
          weatherMode: weatherModeForRefresh,
          weatherFingerprint: weatherFingerprintForRefresh,
          recommendationBatchId: previousRecommendationBatchId,
          hasRecommendations: exhaustedState.hasRecommendations,
          batchLimited: exhaustedState.batchLimited,
          batchExhausted: exhaustedState.batchExhausted,
          noMoreRecommendations: true,
          countContract: data.countContract,
          lastVisibleBatch: exhaustedState.lastVisibleBatch,
          recommendationNotice: notice,
        }, authContext);
        Taro.showToast({ title: notice, icon: 'none' });
        beginClientImageTiming({
          auditId: getRecommendationAuditId(data, auditId),
          cloudRoundTripMs,
          clientApplyMs: Date.now() - responseReceivedAt,
          firstOutfit: undefined,
        });
      }
    } catch (err) {
      if (!isRecommendationIntentCurrent(intent) || !isLatestRequest(seq)) return;
      logRecommendationError(auditId, seq, 'handleRefresh', err);
      setError('换一套失败，请稍后再试');
      Taro.showToast({ title: '刷新失败', icon: 'none' });
    } finally {
      clearOperationForRequest(seq);
    }
  }

  async function handleToggleFavorite() {
    const current = outfits[currentIndex];
    if (!current || operation) return;

    const authContext = captureAuthContext();
    if (!authContext) return;
    const operationOutfitKey = getMutationTargetKey(current);
    const nextFavorite = !current.isFavorite;
    operationTargetRef.current = { operation: 'favorite', outfitKey: operationOutfitKey };
    setOperation('favorite');

    try {
      if (nextFavorite) {
        const saved = await saveFavoriteOutfit(normalizeOutfitSnapshot(current), current.aiComment);
        if (!isCurrentMutation(authContext, 'favorite', operationOutfitKey)) return;
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
        trackExplicitOutfitBehavior('outfit_favorite', current, 'today');
      } else {
        const removed = await removeFavoriteOutfit(current.favoriteOutfitId || current.id, current.outfitKey);
        if (!isCurrentMutation(authContext, 'favorite', operationOutfitKey)) return;
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
        trackExplicitOutfitBehavior('outfit_unfavorite', current, 'today');
      }
      if (!isCurrentMutation(authContext, 'favorite', operationOutfitKey)) return;
      await invalidateAfterOutfitFavoriteMutation({ authContext });
      if (!isCurrentMutation(authContext, 'favorite', operationOutfitKey)) return;
      Taro.showToast({ title: nextFavorite ? '已收藏' : '已取消收藏', icon: 'success' });
    } catch (err) {
      console.error('Toggle favorite error:', err);
      if (isCurrentMutation(authContext, 'favorite', operationOutfitKey)) {
        const errorData = (err as { data?: { errorCode?: string } })?.data;
        if (errorData?.errorCode === 'OUTFIT_CONTAINS_DELETED_CLOTHES') {
          Taro.showToast({ title: '这套搭配有衣物已移出衣橱，暂时不能继续使用', icon: 'none' });
        } else {
          Taro.showToast({ title: '操作失败', icon: 'none' });
        }
      }
    } finally {
      if (isCurrentMutation(authContext, 'favorite', operationOutfitKey)) {
        operationTargetRef.current = null;
        setOperation(null);
      }
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
    if (!authContext) return;
    const operationOutfitKey = getMutationTargetKey(current);
    operationTargetRef.current = { operation: 'wear', outfitKey: operationOutfitKey };
    setOperation('wear');
    try {
      const saved = await addOutfitHistory(normalizeOutfitSnapshot(current), {
        source: current.outfitKind === 'favorite' || current.isFavorite ? 'favorite' : 'recommendation',
        sourceFavoriteOutfitId:
          current.outfitKind === 'favorite' || current.isFavorite ? current.favoriteOutfitId || current.id : undefined,
        aiComment: current.aiComment,
      });
      if (!isCurrentMutation(authContext, 'wear', operationOutfitKey)) return;
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
      trackExplicitOutfitBehavior('outfit_wear', current, 'today');
      if (!isCurrentMutation(authContext, 'wear', operationOutfitKey)) return;
      await invalidateAfterOutfitWornMutation({ authContext });
      if (!isCurrentMutation(authContext, 'wear', operationOutfitKey)) return;
      Taro.showToast({ title: '已记录到穿搭历史', icon: 'success' });
    } catch (err) {
      console.error('Confirm wear error:', err);
      if (isCurrentMutation(authContext, 'wear', operationOutfitKey)) {
        const errorData = (err as { data?: { errorCode?: string } })?.data;
        if (errorData?.errorCode === 'OUTFIT_CONTAINS_DELETED_CLOTHES') {
          Taro.showToast({ title: '这套搭配有衣物已移出衣橱，暂时不能继续使用', icon: 'none' });
        } else {
          Taro.showToast({ title: '操作失败', icon: 'none' });
        }
      }
    } finally {
      if (isCurrentMutation(authContext, 'wear', operationOutfitKey)) {
        operationTargetRef.current = null;
        setOperation(null);
      }
    }
  }

  function handleSceneSelect(key: SceneKey) {
    if (key === selectedSceneKeyRef.current) return;
    const scene = SCENE_TAGS[key];
    const authContext = captureAuthContext();
    const weatherForScene = currentWeather ?? currentWeatherRef.current;
    const weatherModeForScene = currentWeatherModeRef.current;
    const weatherFingerprint = getRecommendationWeatherFingerprint(weatherForScene);
    const snapshotKey = getSceneSnapshotKey(scene, weatherFingerprint);
    const snapshot = readSceneSnapshot(snapshotKey);
    const transition = chooseSceneTransitionState({
      currentOutfits: outfitsRef.current,
      snapshot,
      nextSceneKey: key,
    });
    setSelectedSceneKey(key);
    selectedSceneKeyRef.current = key;
    selectedSceneRef.current = scene;
    activateSceneSeenState(key);
    setCurrentIndex(transition.currentIndex);
    setOutfits(transition.outfits);
    setHasRecommendations(transition.hasRecommendations || transition.keepPreviousWhileLoading);
    setRecommendationBatchId(transition.recommendationBatchId);
    setBatchLimited(transition.batchLimited);
    setBatchExhausted(transition.batchExhausted);
    setRecommendationNotice(transition.recommendationNotice);
    setMissingRoles([]);
    setMissingFacts([]);
    setError('');
    if (snapshot) {
      activateCachedRecommendationIntent({
        intentId: nextRecommendationIntentId('scene-snapshot'),
        sceneKey: key,
        weather: weatherForScene,
      });
      activateSceneSeenState(key);
      const nextOutfits = applyTodayOutfitStatuses(snapshot.outfits, authContext);
      outfitsRef.current = nextOutfits;
      currentIndexRef.current = transition.currentIndex;
      recommendationBatchIdRef.current = snapshot.recommendationBatchId;
      countContractRef.current = snapshot.countContract;
      hasRecommendationsRef.current = snapshot.hasRecommendations !== false;
      batchLimitedRef.current = Boolean(snapshot.batchLimited);
      batchExhaustedRef.current = Boolean(snapshot.batchExhausted);
      recommendationNoticeRef.current = snapshot.recommendationNotice || '';
      setOutfits(nextOutfits);
      markOutfitShown(nextOutfits[transition.currentIndex]);
      trackCurrentOutfitExposure(nextOutfits[transition.currentIndex], transition.currentIndex, snapshot.recommendationBatchId);
      storeTodayRestoreSnapshot({
        outfits: nextOutfits,
        currentIndex: transition.currentIndex,
        selectedSceneKey: key,
        weatherSnapshot: weatherForScene,
        weatherMode: weatherModeForScene,
        weatherFingerprint,
        recommendationBatchId: snapshot.recommendationBatchId,
        hasRecommendations: snapshot.hasRecommendations !== false,
        batchLimited: Boolean(snapshot.batchLimited),
        batchExhausted: Boolean(snapshot.batchExhausted),
        noMoreRecommendations: snapshot.noMoreRecommendations === true,
        countContract: snapshot.countContract,
        lastVisibleBatch: snapshot.lastVisibleBatch,
        recommendationNotice: snapshot.recommendationNotice || '',
      }, authContext);
      setLoading(false);
      return;
    }
    setLoading(true);
    void requestRecommendations({
      intentId: nextRecommendationIntentId(`scene-${key}`),
      sceneKey: key,
      weather: weatherForScene,
      weatherMode: weatherModeForScene,
      trigger: 'scene',
    });
  }

  async function handleWeatherChange(
    weather: WeatherSnapshot | undefined,
    options: { forceRefresh?: boolean; weatherMode: WeatherMode },
  ): Promise<WeatherRecommendationRefreshResult> {
    const weatherFingerprint = getRecommendationWeatherFingerprint(weather);
    const sameRecommendationWeather = weatherFingerprint === recommendationWeatherFingerprintRef.current;
    currentWeatherRef.current = weather;
    currentWeatherModeRef.current = options.weatherMode;
    currentWeatherFingerprintRef.current = weatherFingerprint;
    setCurrentWeather(weather);

    const sceneKey = selectedSceneKeyRef.current;
    if (!options.forceRefresh) {
      const snapshot = readSceneSnapshot(getSceneSnapshotKey(SCENE_TAGS[sceneKey], weatherFingerprint));
      if (snapshot) {
        activateCachedRecommendationIntent({
          intentId: entryIntentIdRef.current,
          sceneKey,
          weather,
        });
        restoreSceneSnapshotToPage(snapshot, sceneKey, weather, options.weatherMode);
        return 'unchanged';
      }
    }

    if (outfitsRef.current.length > 0 && sameRecommendationWeather) {
      return 'unchanged';
    }

    try {
      const refreshed = await requestRecommendations({
        intentId: outfitsRef.current.length === 0
          ? entryIntentIdRef.current
          : nextRecommendationIntentId(options.forceRefresh ? 'weather-force' : 'weather'),
        sceneKey,
        weather,
        weatherMode: options.weatherMode,
        silent: outfitsRef.current.length > 0,
        trigger: options.forceRefresh ? 'weather-force' : 'weather',
      });
      return refreshed ? 'refreshed' : 'failed';
    } catch (error) {
      return 'failed';
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
    currentIndexRef.current = next;
    setCurrentIndex(next);
    markOutfitShown(outfits[next]);
    trackCurrentOutfitExposure(outfits[next], next);
    storeTodayRestoreSnapshot({ currentIndex: next });
    if (isRecommendationDiagnosticEnvironment()) {
      logRecommendationEvent('[RecommendationImagePerf]', {
        auditId: clientImageTimingRef.current?.auditId || 'image-session',
        scene: selectedSceneKeyRef.current,
        activeIndex: next,
        imageSession: getImageSessionDiagnostics(),
      });
    }
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

    setOutfitStatus(statusPatch, authContext);
    setOutfits((prev) => {
      const next = prev.map((outfit) =>
        outfit.outfitKey === statusPatch.outfitKey || outfit.outfitKey === reference.outfitKey || outfit.id === reference.id
          ? normalizeOutfitSnapshot({ ...outfit, ...listPatch })
          : outfit,
      );
      const nextWithStatus = applyTodayOutfitStatuses(next, authContext);
      storeTodayRestoreSnapshot({ outfits: nextWithStatus }, authContext);
      return nextWithStatus;
    });
  }

  function markOutfitShown(outfit: Outfit | undefined) {
    if (outfit?.outfitKey) {
      seenOutfitKeysRef.current.add(outfit.outfitKey);
      seenOutfitKeysBySceneIdentityRef.current[activeSeenSceneIdentityKeyRef.current] = [...seenOutfitKeysRef.current].sort();
    }
  }

  function getSeenOutfitKeys() {
    return [...seenOutfitKeysRef.current];
  }

  function getSeenOutfitKeysForScene(sceneKey: SceneKey) {
    const identityHash = seenIdentityHashBySceneRef.current[sceneKey] || '';
    const key = buildSceneIdentityKey(sceneKey, identityHash);
    return (seenOutfitKeysBySceneIdentityRef.current[key] || []).slice();
  }

  function activateSceneSeenState(sceneKey: SceneKey) {
    const identityHash = seenIdentityHashBySceneRef.current[sceneKey] || '';
    const key = buildSceneIdentityKey(sceneKey, identityHash);
    activeSeenSceneIdentityKeyRef.current = key;
    seenOutfitKeysRef.current = new Set(seenOutfitKeysBySceneIdentityRef.current[key] || []);
  }

  function mergeSuccessfulSeenBatch(sceneKey: SceneKey, identityHash: string, nextOutfits: Outfit[]) {
    const previousIdentityHash = seenIdentityHashBySceneRef.current[sceneKey] || '';
    const normalizedIdentityHash = identityHash || previousIdentityHash;
    if (previousIdentityHash && normalizedIdentityHash && previousIdentityHash !== normalizedIdentityHash) {
      // Wardrobe/weather/profile identity changed: old candidates are not valid exclusions.
      const oldKey = buildSceneIdentityKey(sceneKey, previousIdentityHash);
      delete seenOutfitKeysBySceneIdentityRef.current[oldKey];
    }
    seenIdentityHashBySceneRef.current[sceneKey] = normalizedIdentityHash;
    const key = buildSceneIdentityKey(sceneKey, normalizedIdentityHash);
    const merged = mergeSeenOutfitKeys(seenOutfitKeysBySceneIdentityRef.current[key], nextOutfits);
    seenOutfitKeysBySceneIdentityRef.current[key] = merged;
    activeSeenSceneIdentityKeyRef.current = key;
    seenOutfitKeysRef.current = new Set(merged);
  }

  function getResponseIdentityHash(data: RecommendResponse) {
    return readDebugString(data.debug?.candidatePoolIdentityHash ?? data.qaBatchAudit?.candidatePoolIdentityHash);
  }

  function trackCurrentOutfitExposure(
    outfit: Outfit | undefined,
    position: number,
    batchId = recommendationBatchIdRef.current,
  ) {
    if (!outfit) return;
    const event = behaviorTrackerRef.current.buildExposureEvent({
      outfit,
      recommendationBatchId: batchId || outfit.recommendationBatchId,
      position,
      candidateCount: outfitsRef.current.length || outfits.length || 1,
      context: { scene: selectedSceneKeyRef.current },
    });
    trackOutfitBehaviorEvent(event);
  }

  function trackExplicitOutfitBehavior(
    eventType: 'outfit_favorite' | 'outfit_unfavorite' | 'outfit_wear',
    outfit: Outfit,
    source: 'today',
  ) {
    trackOutfitBehaviorEvent({
      schemaVersion: 1,
      eventId: createOutfitBehaviorEventId({
        pageSessionId: behaviorTrackerRef.current.pageSessionId,
        eventType,
      }),
      eventType,
      clientOccurredAt: new Date().toISOString(),
      ...buildOutfitBehaviorSnapshot(outfit),
      context: { source },
    });
  }

  function storeTodayRestoreSnapshot(
    input: TodayRestoreSnapshotInput = {},
    authContext?: ActiveAuthContext | null,
  ) {
    const snapshotOutfits = applyTodayOutfitStatuses(
      (input.outfits ?? outfitsRef.current).map((outfit) => normalizeOutfitSnapshot(outfit)),
      authContext,
    );

    const snapshotSceneKey = input.selectedSceneKey ?? selectedSceneKeyRef.current;
    const snapshotWeather = input.weatherSnapshot ?? recommendationWeatherSnapshotRef.current;
    const snapshotWeatherFingerprint = input.weatherFingerprint ?? recommendationWeatherFingerprintRef.current;
    const snapshotIndex = clampIndex(input.currentIndex ?? currentIndexRef.current, snapshotOutfits.length);
    const snapshotCountContract = input.countContract ?? countContractRef.current;
    const noMoreRecommendations = input.noMoreRecommendations
      ?? Boolean(snapshotCountContract?.returnedCardCount === 0 && snapshotCountContract.poolExhaustedAfterConsume);
    const exhaustedIdentity = noMoreRecommendations ? buildExhaustedSnapshotState({
      outfits: snapshotOutfits,
      currentIndex: snapshotIndex,
      recommendationBatchId: input.recommendationBatchId ?? recommendationBatchIdRef.current ?? '',
      countContract: snapshotCountContract,
      recommendationNotice: input.recommendationNotice ?? recommendationNoticeRef.current,
    }) : null;
    const snapshot: TodayRestoreSnapshot = {
      version: 3,
      copyContractVersion: COPY_CONTRACT_VERSION,
      outfits: snapshotOutfits,
      currentIndex: snapshotIndex,
      selectedSceneKey: snapshotSceneKey,
      scene: SCENE_TAGS[snapshotSceneKey],
      weatherSnapshot: snapshotWeather,
      weatherMode: input.weatherMode ?? currentWeatherModeRef.current,
      weatherFingerprint: snapshotWeatherFingerprint,
      weatherKey: snapshotWeather ? getWeatherKey(snapshotWeather) : '',
      targetDate: getToday(),
      timeOfDay: TODAY_TIME_OF_DAY,
      sceneSnapshotKey: getSceneSnapshotKey(SCENE_TAGS[snapshotSceneKey], snapshotWeatherFingerprint),
      recommendationBatchId: input.recommendationBatchId ?? recommendationBatchIdRef.current,
      generatedAt: Date.now(),
      seenOutfitKeys: input.seenOutfitKeys ?? getSeenOutfitKeys(),
      hasRecommendations: input.hasRecommendations ?? hasRecommendationsRef.current,
      batchLimited: input.batchLimited ?? batchLimitedRef.current,
      batchExhausted: input.batchExhausted ?? batchExhaustedRef.current,
      noMoreRecommendations,
      countContract: snapshotCountContract,
      lastVisibleBatch: input.lastVisibleBatch ?? exhaustedIdentity?.lastVisibleBatch,
      recommendationNotice: input.recommendationNotice ?? recommendationNoticeRef.current,
    };
    if (!isValidSceneSnapshotCountState(snapshot)) return;

    setUserStorageSync(TODAY_RESTORE_SNAPSHOT_KEY, snapshot, { authContext });
    storeSceneSnapshot({
      sceneKey: snapshot.selectedSceneKey,
      scene: snapshot.scene,
      weather: snapshotWeather,
      weatherMode: snapshot.weatherMode,
      weatherFingerprint: snapshotWeatherFingerprint,
      outfits: snapshotOutfits,
      currentIndex: snapshotIndex,
      recommendationBatchId: snapshot.recommendationBatchId,
      hasRecommendations: snapshot.hasRecommendations,
      batchLimited: snapshot.batchLimited,
      batchExhausted: snapshot.batchExhausted,
      noMoreRecommendations: snapshot.noMoreRecommendations,
      countContract: snapshot.countContract,
      lastVisibleBatch: snapshot.lastVisibleBatch,
      recommendationNotice: snapshot.recommendationNotice,
    });
  }

  function restoreTodaySnapshotFromDetail(
    authContext?: ActiveAuthContext | null,
    options: { requireReturnIntent?: boolean } = {},
  ) {
    if (options.requireReturnIntent !== false && !shouldRestoreFromDetailRef.current) return false;
    shouldRestoreFromDetailRef.current = false;

    const snapshot = readTodayRestoreSnapshot(authContext);
    if (!snapshot || !canRestoreTodaySnapshot(snapshot)) return false;

    const restoredOutfits = applyTodayOutfitStatuses(
      snapshot.outfits.map((outfit) => normalizeOutfitSnapshot(outfit)),
      authContext,
    );
    const restoredIndex = clampIndex(snapshot.currentIndex, restoredOutfits.length);
    const restoredRecommendationWeatherFingerprint = getSnapshotWeatherFingerprint(snapshot);
    const restoredCurrentWeather = currentWeatherRef.current ?? snapshot.weatherSnapshot;
    nextRequestSeq();
    outfitsRef.current = restoredOutfits;
    currentIndexRef.current = restoredIndex;
    selectedSceneKeyRef.current = snapshot.selectedSceneKey;
    selectedSceneRef.current = SCENE_TAGS[snapshot.selectedSceneKey];
    recommendationBatchIdRef.current = snapshot.recommendationBatchId;
    countContractRef.current = snapshot.countContract;
    hasRecommendationsRef.current = snapshot.hasRecommendations;
    batchLimitedRef.current = snapshot.batchLimited;
    batchExhaustedRef.current = snapshot.batchExhausted;
    recommendationNoticeRef.current = snapshot.recommendationNotice;
    seenOutfitKeysRef.current = new Set(snapshot.seenOutfitKeys);
    const restoreSceneIdentityHash = seenIdentityHashBySceneRef.current[snapshot.selectedSceneKey] || '';
    const restoreSceneIdentityKey = buildSceneIdentityKey(snapshot.selectedSceneKey, restoreSceneIdentityHash);
    activeSeenSceneIdentityKeyRef.current = restoreSceneIdentityKey;
    seenOutfitKeysBySceneIdentityRef.current[restoreSceneIdentityKey] = snapshot.seenOutfitKeys.slice();
    if (restoredOutfits.length > 0) {
      markOutfitShown(restoredOutfits[restoredIndex]);
      trackCurrentOutfitExposure(restoredOutfits[restoredIndex], restoredIndex, snapshot.recommendationBatchId);
    }
    recommendationWeatherSnapshotRef.current = snapshot.weatherSnapshot;
    recommendationWeatherFingerprintRef.current = restoredRecommendationWeatherFingerprint;
    currentWeatherRef.current = restoredCurrentWeather;
    currentWeatherModeRef.current = snapshot.weatherMode || (restoredCurrentWeather ? 'cached' : 'disabled');
    currentWeatherFingerprintRef.current = getRecommendationWeatherFingerprint(restoredCurrentWeather);
    setSelectedSceneKey(snapshot.selectedSceneKey);
    setOutfits(restoredOutfits);
    setCurrentIndex(restoredIndex);
    setCurrentWeather(restoredCurrentWeather);
    setHasRecommendations(snapshot.hasRecommendations);
    setRecommendationBatchId(snapshot.recommendationBatchId);
    setBatchLimited(snapshot.batchLimited);
    setBatchExhausted(snapshot.batchExhausted);
    setRecommendationNotice(snapshot.recommendationNotice);
    setMissingRoles([]);
    setMissingFacts([]);
    setError('');
    loadingOwnerSeqRef.current = null;
    setLoading(false);
    if (
      restoredCurrentWeather
      && currentWeatherFingerprintRef.current !== restoredRecommendationWeatherFingerprint
    ) {
      void handleWeatherChange(restoredCurrentWeather, {
        weatherMode: currentWeatherModeRef.current,
      });
    }
    return true;
  }

  function readTodayRestoreSnapshot(authContext?: ActiveAuthContext | null) {
    try {
      const value = getUserStorageSync<TodayRestoreSnapshot>(TODAY_RESTORE_SNAPSHOT_KEY, { authContext });
      if (!value || typeof value !== 'object') return null;
      if (
        value.version !== 3
        || value.copyContractVersion !== COPY_CONTRACT_VERSION
        || !Array.isArray(value.outfits)
      ) return null;
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
    if (snapshot.sceneSnapshotKey !== getSceneSnapshotKey(snapshot.scene, getSnapshotWeatherFingerprint(snapshot))) return false;
    if (hasWardrobeRefreshSignal()) return false;
    if (!snapshot.outfits.every(hasCurrentNewRecommendationCopy)) return false;
    return isValidSceneSnapshotCountState(snapshot);
  }

  function hasWardrobeRefreshSignal() {
    try {
      return Boolean(getUserStorageSync(WARDROBE_REFRESH_STORAGE_KEY));
    } catch {
      return false;
    }
  }

  function getRecommendationInputVersions(authContext?: ActiveAuthContext | null) {
    const wardrobeVersion = getUserStorageSync<number>(
      TODAY_WARDROBE_INPUT_VERSION_KEY,
      { authContext },
    );
    const profileVersion = getUserStorageSync<number>(
      TODAY_PROFILE_INPUT_VERSION_KEY,
      { authContext },
    );
    return {
      wardrobeVersion: `wardrobe-${Number(wardrobeVersion) || 0}`,
      profileVersion: `profile-${Number(profileVersion) || 0}`,
    };
  }

  function getRecommendationInputSignature({
    sceneKey,
    weather,
    recommendationBatchId: batchId,
    excludedOutfitKeys = [],
    requestKind = 'initial',
  }: {
    sceneKey: SceneKey
    weather?: WeatherSnapshot
    recommendationBatchId?: string
    excludedOutfitKeys?: string[]
    requestKind?: 'initial' | 'refresh'
  }) {
    const inputVersions = getRecommendationInputVersions();
    return buildRecommendationInputSignature({
      userRuntimeKey: runtimeKey || '',
      sceneKey,
      date: getToday(),
      timeOfDay: TODAY_TIME_OF_DAY,
      weatherFingerprint: getRecommendationWeatherFingerprint(weather),
      wardrobeVersion: inputVersions.wardrobeVersion,
      profileVersion: inputVersions.profileVersion,
      recommendationBatchId: batchId,
      excludedOutfitKeys,
      requestKind,
    });
  }

  function activateCachedRecommendationIntent({
    intentId,
    sceneKey,
    weather,
  }: {
    intentId: string
    sceneKey: SceneKey
    weather?: WeatherSnapshot
  }) {
    const intent = recommendationIntentRegistryRef.current?.activate({
      intentId,
      inputSignature: getRecommendationInputSignature({
        sceneKey,
        weather,
      }),
    });
    activeRequestSeqRef.current = null;
    return intent;
  }

  function restoreSceneSnapshotToPage(
    snapshot: ExtendedSceneSnapshot,
    sceneKey: SceneKey,
    weather: WeatherSnapshot | undefined,
    weatherMode: WeatherMode,
  ) {
    const authContext = captureAuthContext();
    const nextOutfits = applyTodayOutfitStatuses(snapshot.outfits, authContext);
    const nextIndex = clampIndex(snapshot.currentIndex ?? 0, nextOutfits.length);
    const weatherFingerprint = getRecommendationWeatherFingerprint(weather);
    selectedSceneKeyRef.current = sceneKey;
    selectedSceneRef.current = SCENE_TAGS[sceneKey];
    outfitsRef.current = nextOutfits;
    currentIndexRef.current = nextIndex;
    recommendationBatchIdRef.current = snapshot.recommendationBatchId;
    countContractRef.current = snapshot.countContract;
    hasRecommendationsRef.current = snapshot.hasRecommendations !== false;
    batchLimitedRef.current = Boolean(snapshot.batchLimited);
    batchExhaustedRef.current = Boolean(snapshot.batchExhausted);
    recommendationNoticeRef.current = snapshot.recommendationNotice || '';
    recommendationWeatherSnapshotRef.current = weather;
    recommendationWeatherFingerprintRef.current = weatherFingerprint;
    setSelectedSceneKey(sceneKey);
    setOutfits(nextOutfits);
    setCurrentIndex(nextIndex);
    setHasRecommendations(snapshot.hasRecommendations !== false);
    setRecommendationBatchId(snapshot.recommendationBatchId);
    setBatchLimited(Boolean(snapshot.batchLimited));
    setBatchExhausted(Boolean(snapshot.batchExhausted));
    setRecommendationNotice(snapshot.recommendationNotice || '');
    setMissingRoles([]);
    setMissingFacts([]);
    setError('');
    setLoading(false);
    if (nextOutfits.length > 0) {
      markOutfitShown(nextOutfits[nextIndex]);
      trackCurrentOutfitExposure(nextOutfits[nextIndex], nextIndex, snapshot.recommendationBatchId);
    }
    storeTodayRestoreSnapshot({
      outfits: nextOutfits,
      currentIndex: nextIndex,
      selectedSceneKey: sceneKey,
      weatherSnapshot: weather,
      weatherMode,
      weatherFingerprint,
      recommendationBatchId: snapshot.recommendationBatchId,
      hasRecommendations: snapshot.hasRecommendations !== false,
      batchLimited: Boolean(snapshot.batchLimited),
      batchExhausted: Boolean(snapshot.batchExhausted),
      noMoreRecommendations: snapshot.noMoreRecommendations === true,
      countContract: snapshot.countContract,
      lastVisibleBatch: snapshot.lastVisibleBatch,
      recommendationNotice: snapshot.recommendationNotice || '',
    }, authContext);
  }

  function getSceneSnapshotKey(scene: SceneTag, weatherFingerprint = currentWeatherFingerprintRef.current) {
    const inputVersions = getRecommendationInputVersions();
    return buildSceneSnapshotKey({
      userRuntimeKey: runtimeKey || '',
      date: getToday(),
      timeOfDay: TODAY_TIME_OF_DAY,
      scene,
      weatherFingerprint,
      wardrobeVersion: inputVersions.wardrobeVersion,
      profileVersion: inputVersions.profileVersion,
      reasonVersion: 'recommendation-reason-v3',
      copyVersion: TODAY_SCENE_COPY_VERSION,
    });
  }

  function readSceneSnapshot(key: string) {
    const memorySnapshot = sceneSnapshotsRef.current[key];
    const snapshot = memorySnapshot
      ?? getUserStorageSync<ExtendedSceneSnapshot>([TODAY_SCENE_SNAPSHOT_STORAGE_PREFIX, key]);
    if (!snapshot || !shouldUseSceneSnapshot(snapshot, { key })) return null;
    sceneSnapshotsRef.current[key] = snapshot;
    return snapshot;
  }

  function storeSceneSnapshot({
    sceneKey,
    scene,
    weather,
    weatherMode = currentWeatherModeRef.current,
    weatherFingerprint = getRecommendationWeatherFingerprint(weather),
    outfits: snapshotOutfits,
    currentIndex: snapshotIndex,
    recommendationBatchId: snapshotBatchId,
    hasRecommendations: snapshotHasRecommendations,
    batchLimited: snapshotBatchLimited,
    batchExhausted: snapshotBatchExhausted,
    noMoreRecommendations: snapshotNoMoreRecommendations = false,
    countContract: snapshotCountContract,
    lastVisibleBatch: snapshotLastVisibleBatch,
    recommendationNotice: snapshotRecommendationNotice,
  }: {
    sceneKey: SceneKey
    scene: SceneTag
    weather?: WeatherSnapshot
    weatherMode?: WeatherMode
    weatherFingerprint?: RecommendationWeatherFingerprint
    outfits: Outfit[]
    currentIndex: number
    recommendationBatchId: string | undefined
    hasRecommendations: boolean
    batchLimited: boolean
    batchExhausted: boolean
    noMoreRecommendations?: boolean
    countContract?: RecommendationCountContract
    lastVisibleBatch?: SceneSnapshot['lastVisibleBatch']
    recommendationNotice: string
  }) {
    const key = getSceneSnapshotKey(scene, weatherFingerprint);
    const snapshot: ExtendedSceneSnapshot = {
      key,
      outfits: snapshotOutfits,
      currentIndex: snapshotIndex,
      hasRecommendations: snapshotHasRecommendations,
      recommendationBatchId: snapshotBatchId,
      batchLimited: snapshotBatchLimited,
      batchExhausted: snapshotBatchExhausted,
      noMoreRecommendations: snapshotNoMoreRecommendations,
      countContract: snapshotCountContract ?? countContractRef.current,
      lastVisibleBatch: snapshotLastVisibleBatch,
      recommendationNotice: snapshotRecommendationNotice,
      generatedAt: Date.now(),
      weatherMode,
      sceneKey,
    };
    if (!shouldUseSceneSnapshot(snapshot, { key })) return;
    sceneSnapshotsRef.current[key] = snapshot;
    setUserStorageSync([TODAY_SCENE_SNAPSHOT_STORAGE_PREFIX, key], snapshot);
  }

  function createRecommendationRequestContext(
    sceneKey: SceneKey,
    weatherMode: WeatherMode,
    intent: RecommendationIntent,
  ): RecommendationRequestContext {
    const nextSeq = nextRequestSeq();
    return {
      auditId: createRecommendationAuditId(String(nextSeq)),
      requestSeq: nextSeq,
      intentId: intent.intentId,
      inputSignature: intent.inputSignature,
      intentGeneration: intent.generation,
      sceneKey,
      sceneLabel: SCENE_TAGS[sceneKey],
      weatherMode,
      requestedAt: Date.now(),
    };
  }

  function validateSceneContract(
    requestContext: RecommendationRequestContext,
    data: RecommendResponse,
  ): SceneContractValidation {
    return validateSceneContractPure(
      requestContext,
      data,
      activeRequestSeqRef.current ?? -1,
      selectedSceneKeyRef.current,
    );
  }

  function logSceneContractReject(
    auditId: string,
    data: RecommendResponse,
    validation: Exclude<SceneContractValidation, { ok: true }>,
  ) {
    logRecommendationEvent('[RecommendReject]', {
      auditId: getRecommendationAuditId(data, auditId),
      reason: validation.reason,
      seq: validation.requestSeq,
      requestScene: validation.requestSceneKey,
      responseSceneKey: validation.responseSceneKey,
      responseScene: validation.responseScene,
      topLevelKeys: Object.keys(data).slice(0, 20),
      cloudBuild: data.debug?.cloudBuildVersion ?? data.meta?.cloudBuildVersion ?? '',
      transport: getCloudResponseTransportDiagnostics(data),
    });
  }

  function logRecommendationIntentReject(
    requestContext: RecommendationRequestContext,
    data: RecommendResponse,
    reason: string,
  ) {
    logRecommendationEvent('[RecommendReject]', {
      auditId: getRecommendationAuditId(data, requestContext.auditId),
      seq: requestContext.requestSeq,
      intentId: requestContext.intentId,
      intentGeneration: requestContext.intentGeneration,
      sceneKey: requestContext.sceneKey,
      reason,
    });
  }

  function logRecommendationStart(
    requestContext: RecommendationRequestContext,
    trigger: string,
    hasWeather: boolean,
  ) {
    if (!isRecommendationDiagnosticEnvironment()) return;
    logRecommendationEvent('[RecommendStart]', {
      auditId: requestContext.auditId,
      seq: requestContext.requestSeq,
      trigger,
      sceneKey: requestContext.sceneKey,
      scene: requestContext.sceneLabel,
      weatherMode: requestContext.weatherMode,
      hasWeather,
    });
  }

  function logRecommendationResponse(
    requestContext: RecommendationRequestContext,
    data: RecommendResponse,
    trigger: string,
    outfitCount: number,
  ) {
    if (!isRecommendationDiagnosticEnvironment()) return;
    const debug = data.debug;
    const qaAudit = data.qaBatchAudit;
    logRecommendationEvent('[RecommendResponse]', {
      auditId: getRecommendationAuditId(data, requestContext.auditId),
      seq: requestContext.requestSeq,
      trigger,
      sceneKey: requestContext.sceneKey,
      scene: data.scene,
      outfitCount,
      cloudBuild: debug?.cloudBuildVersion ?? data.meta?.cloudBuildVersion ?? '',
      executionMode: readDebugString(debug?.executionMode),
      cacheHit: debug?.cacheHit === true,
      cacheMissReason: readDebugString(debug?.cacheMissReason),
      candidatePoolSaveStatus: readDebugString(debug?.candidatePoolSaveStatus),
      candidatePoolSaveReason: readDebugString(debug?.candidatePoolSaveReason),
      candidatePoolSerializedBytes: readDebugNumber(debug?.candidatePoolSerializedBytes),
      candidatePoolChunkCount: readDebugNumber(debug?.candidatePoolChunkCount),
      candidatePoolManifestBytes: readDebugNumber(debug?.candidatePoolManifestBytes),
      candidatePoolChunksBytes: readDebugNumber(debug?.candidatePoolChunksBytes),
      countContract: data.countContract ? { ...data.countContract, candidatePoolId: null } : null,
      requestedExcludedCount: readDebugNumber(debug?.requestedExcludedCount),
      actualExcludedCandidateCount: readDebugNumber(debug?.actualExcludedCandidateCount),
      remainingCandidateCount: readDebugNumber(debug?.remainingCandidateCount),
      recommendationBatchIdPresent: debug?.recommendationBatchIdPresent === true || qaAudit?.recommendationBatchIdPresent === true,
      recommendationBatchIdLength: readDebugNumber(debug?.recommendationBatchIdLength ?? qaAudit?.recommendationBatchIdLength),
      requestedCandidatePoolIdPresent: debug?.requestedCandidatePoolIdPresent === true || qaAudit?.requestedCandidatePoolIdPresent === true,
      requestedCandidatePoolIdLength: readDebugNumber(debug?.requestedCandidatePoolIdLength ?? qaAudit?.requestedCandidatePoolIdLength),
      timings: debug?.timings ?? qaAudit?.timings ?? {},
      responseBytes: debug?.responseBytes ?? qaAudit?.responseBytes ?? {},
      qaEnabled: Boolean(data.qaBatchAudit),
    });
  }

  function readDebugString(value: unknown): string {
    return typeof value === 'string' ? value : '';
  }

  function readDebugNumber(value: unknown): number {
    const num = Number(value);
    return Number.isFinite(num) && num >= 0 ? num : 0;
  }

  function logRecommendationQa(data: RecommendResponse, fallbackAuditId: string) {
    if (!isRecommendationDiagnosticEnvironment() || !data.qaBatchAudit) return;
    const summary = buildRecommendationQaLogSummary(data.qaBatchAudit);
    if (!summary) return;
    logRecommendationEvent('[RecommendationQA]', {
      ...summary,
      auditId: getRecommendationAuditId(data, fallbackAuditId),
    });
  }

  function beginClientImageTiming({
    auditId,
    cloudRoundTripMs,
    clientApplyMs,
    firstOutfit,
  }: {
    auditId: string;
    cloudRoundTripMs: number;
    clientApplyMs: number;
    firstOutfit?: Outfit;
  }) {
    if (!isRecommendationDiagnosticEnvironment()) return;
    if (clientImageTimingRef.current?.timeoutId) clearTimeout(clientImageTimingRef.current.timeoutId);
    const requestedImageCount = firstOutfit
      ? buildOutfitCardViewModel(firstOutfit).previewItems.filter((item) => Boolean(item.thumbnailUrl || item.imageUrl)).length
      : 0;
    const timing: ClientImageTiming = {
      auditId,
      cloudRoundTripMs,
      clientApplyMs,
      requestedImageCount,
      resolvedImageCount: 0,
      applyFinishedAt: Date.now(),
    };
    clientImageTimingRef.current = timing;
    if (requestedImageCount === 0) {
      finishClientImageTiming(timing, false);
      return;
    }
    timing.timeoutId = setTimeout(() => finishClientImageTiming(timing, true), 8_000);
  }

  function handleRecommendationImageResolved() {
    const timing = clientImageTimingRef.current;
    if (!timing) return;
    timing.resolvedImageCount += 1;
    if (timing.resolvedImageCount >= timing.requestedImageCount) finishClientImageTiming(timing, false);
  }

  function finishClientImageTiming(timing: ClientImageTiming, imageTimeout: boolean) {
    if (clientImageTimingRef.current !== timing) return;
    if (timing.timeoutId) clearTimeout(timing.timeoutId);
    clientImageTimingRef.current = null;
    logRecommendationEvent('[RecommendDone]', {
      auditId: timing.auditId,
      clientTimings: {
        cloudRoundTripMs: timing.cloudRoundTripMs,
        clientApplyMs: timing.clientApplyMs,
        imageReadyMs: Date.now() - timing.applyFinishedAt,
        imageTimeout,
        requestedImageCount: timing.requestedImageCount,
        resolvedImageCount: timing.resolvedImageCount,
      },
    });
  }

  function logRecommendationError(auditId: string, seq: number, stage: string, error: unknown) {
    const cloudError = error as {
      code?: unknown;
      functionName?: unknown;
      data?: unknown;
      message?: unknown;
      transportDiagnostics?: unknown;
    };
    logRecommendationEvent('[RecommendError]', {
      auditId,
      seq,
      stage,
      errorCode: typeof cloudError.code === 'number' || typeof cloudError.code === 'string'
        ? cloudError.code
        : 'UNKNOWN',
      message: typeof cloudError.message === 'string' ? cloudError.message.slice(0, 240) : 'unknown error',
      functionName: typeof cloudError.functionName === 'string' ? cloudError.functionName : '',
      transport: cloudError.transportDiagnostics ?? (cloudError.data && typeof cloudError.data === 'object'
        ? { errorDataKeys: Object.keys(cloudError.data as Record<string, unknown>).slice(0, 20) }
        : undefined),
    });
  }

  function getRecommendationAuditId(data: RecommendResponse, fallback: string) {
    return fallback || data.debug?.auditId || data.meta?.auditId || data.qaBatchAudit?.auditId || 'missing-audit-id';
  }

  function getBatchNotice(notice: string | undefined, limited: boolean, exhausted: boolean) {
    if (exhausted) return notice || getProductStateCopy('exhausted');
    if (limited) return notice ?? '';
    return notice ?? '';
  }

  function formatOutfitMeta(outfit: Outfit) {
    const facts = [
      currentWeather ? `${currentWeather.temp}° ${currentWeather.weather}` : '',
      String(outfit.scene || selectedScene || ''),
      `${outfit.clothingIds?.length ?? 0} 件`,
    ];
    return facts.filter(Boolean).join(' · ');
  }

  function nextRequestSeq() {
    requestSeq.current += 1;
    return requestSeq.current;
  }

  function nextRecommendationIntentId(kind: string) {
    intentCounterRef.current += 1;
    return `${kind}:${runtimeKey || 'anonymous'}:${intentCounterRef.current}`;
  }

  function isRecommendationIntentCurrent(intent: RecommendationIntent) {
    return recommendationIntentRegistryRef.current?.isCurrent(intent) === true;
  }

  function setLoadingForRequest(seq: number) {
    loadingOwnerSeqRef.current = seq;
    setLoading(true);
  }

  function clearLoadingForRequest(seq: number) {
    if (loadingOwnerSeqRef.current !== seq) return;
    loadingOwnerSeqRef.current = null;
    setLoading(false);
  }

  function setOperationForRequest(seq: number, nextOperation: Exclude<OutfitOperation, null>) {
    operationOwnerSeqRef.current = seq;
    setOperation(nextOperation);
  }

  function clearOperationForRequest(seq: number) {
    if (operationOwnerSeqRef.current !== seq) return;
    operationOwnerSeqRef.current = null;
    setOperation(null);
  }

  function isLatestRequest(seq: number) {
    return seq === activeRequestSeqRef.current;
  }

  function isCurrentMutation(
    authContext: ActiveAuthContext,
    expectedOperation: OutfitOperation,
    expectedOutfitKey: string,
  ) {
    const target = operationTargetRef.current;
    return Boolean(
      authContext
        && isAuthContextCurrent(authContext)
        && target
        && target.operation === expectedOperation
        && target.outfitKey === expectedOutfitKey,
    );
  }

  const currentOutfit = outfits[currentIndex];
  const isRefreshing = operation === 'refresh';
  const isNoMoreRecommendations = isNoMoreRecommendationState({
    batchExhausted,
    countContract: countContractRef.current,
  });
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
        {loading && !currentOutfit && (
          <View className="loading-state">
            <View className="loading-spinner" />
            <Text className="loading-text">{getProductStateCopy('loading')}</Text>
          </View>
        )}

        {!loading && error && !currentOutfit && (
          <View className="empty-state">
            <View className="empty-icon-wrap">
              <View className="empty-icon" />
            </View>
            <Text className="empty-text">{error}</Text>
            <View className="empty-action" onClick={() => {
              void requestRecommendations({
                intentId: nextRecommendationIntentId('retry'),
                sceneKey: selectedSceneKeyRef.current,
                weather: currentWeatherRef.current,
                weatherMode: currentWeatherModeRef.current,
                trigger: 'retry',
              });
            }}>
              <Text className="empty-action-text">重新获取</Text>
            </View>
          </View>
        )}

        {!loading && !error && !hasRecommendations && (
          <View className="empty-state">
            <View className="empty-icon-wrap">
              <View className="empty-icon" />
            </View>
            <Text className="empty-text">{recommendationNotice || getRecommendationEmptyStateCopy(missingRoles, missingFacts)}</Text>
            {missingRoles.length > 0 || missingFacts.length > 0 ? (
              <>
                <Text className="empty-desc">补齐当前场景需要的衣物后，再来试试</Text>
                <View className="empty-action" onClick={goToWardrobe}>
                  <Text className="empty-action-text">去衣橱</Text>
                </View>
              </>
            ) : null}
          </View>
        )}

        {currentOutfit && (
          <View className="recommendation-browser">
            {loading && (
              <View className="scene-loading-overlay">
                <View className="loading-spinner small" />
                <Text className="scene-loading-text">{getProductStateCopy('refreshing')}</Text>
              </View>
            )}
            <Swiper
              className="outfit-swiper"
              current={currentIndex}
              circular={false}
              onChange={handleSwiperChange}
            >
              {outfits.map((outfit, index) => {
                const cardViewModel = buildOutfitCardViewModel(outfit);
                const previewItems = cardViewModel.previewItems;
                const hiddenItemCount = cardViewModel.hiddenItemCount;
                const todayReason = hasCurrentNewRecommendationCopy(outfit)
                  ? outfit.copyContract.todayReason
                  : '';
                return (
                <SwiperItem key={outfit.outfitKey || outfit.id} className="outfit-slide">
                  <View
                    className={`outfit-card ${cardViewModel.layoutVariant} ${recommendationBatchId ? 'has-batch' : ''} ${
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
                      {previewItems.map((item, itemIndex) => (
                        <View key={item.clothingId} className={`collage-item ${item.isDeleted ? 'deleted' : ''}`}>
                          <RecommendationImage
                            src={item.thumbnailUrl || item.imageUrl}
                            cacheIdentity={item.clothingId}
                            onResolved={index === 0 ? handleRecommendationImageResolved : undefined}
                          />
                          {hiddenItemCount > 0 && itemIndex === previewItems.length - 1 && (
                            <View className="collage-more">
                              <Text className="collage-more-text">+{hiddenItemCount}</Text>
                            </View>
                          )}
                        </View>
                      ))}
                    </View>

                    <View className="outfit-tags">
                      {getOutfitStyleTags(outfit, index).slice(0, 3).map((tag) => (
                        <Text key={tag} className="style-tag">{tag}</Text>
                      ))}
                    </View>

                    <View className="outfit-reason">
                      <Text className="reason-label">小搭推荐</Text>
                      <Text className="reason-text">{todayReason}</Text>
                    </View>
                  </View>
                </SwiperItem>
                );
              })}
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

            <View className={`refresh-btn ${isRefreshing || isNoMoreRecommendations ? 'disabled' : ''}`} onClick={handleRefresh}>
              <Text className="refresh-text">{isRefreshing ? '正在找灵感...' : isNoMoreRecommendations ? '这一轮已看完' : '换一批灵感'}</Text>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

function RecommendationImage({
  src,
  cacheIdentity,
  onResolved,
}: {
  src?: string;
  cacheIdentity?: string;
  onResolved?: () => void;
}) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'failed' | 'empty'>(
    src ? (isImageSessionReady(src, cacheIdentity) ? 'loaded' : 'loading') : 'empty',
  );
  const [retryKey, setRetryKey] = useState(0);
  const resolvedSourceRef = useRef('');

  useEffect(() => {
    resolvedSourceRef.current = '';
    setStatus(src ? (isImageSessionReady(src, cacheIdentity) ? 'loaded' : 'loading') : 'empty');
    setRetryKey(0);
    return subscribeImageSession(src, cacheIdentity, (state) => {
      if (state === 'ready') setStatus('loaded');
    });
  }, [cacheIdentity, src]);

  useEffect(() => recordImageSessionMount(), []);

  useEffect(() => {
    if (!src || (status !== 'loaded' && status !== 'failed') || resolvedSourceRef.current === src) return;
    resolvedSourceRef.current = src;
    onResolved?.();
  }, [onResolved, src, status]);

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
        onLoad={() => {
          markImageSessionReady(src, cacheIdentity);
          setStatus('loaded');
        }}
        onError={() => {
          markImageSessionFailed(src, cacheIdentity);
          setStatus('failed');
        }}
      />
    </View>
  );
}

async function preloadRecommendationCards(
  outfits: Outfit[],
  currentIndex: number,
  isCurrent: () => boolean,
): Promise<void> {
  const remainingIndexes = outfits
    .map((_, index) => index)
    .filter((index) => index !== currentIndex);
  const orderedIndexes = [
    currentIndex + 1,
    currentIndex - 1,
    ...remainingIndexes,
  ].filter((index, position, values) => (
    index >= 0
    && index < outfits.length
    && values.indexOf(index) === position
  ));

  for (let offset = 0; offset < orderedIndexes.length; offset += 2) {
    if (!isCurrent()) return;
    const cardIndexes = orderedIndexes.slice(offset, offset + 2);
    await Promise.all(cardIndexes.map(async (cardIndex) => {
      const outfit = outfits[cardIndex];
      if (!outfit) return;
      const items = buildOutfitCardViewModel(outfit).previewItems;
      await Promise.all(items.map((item) => preloadImageSession(
        item.thumbnailUrl || item.imageUrl,
        item.clothingId,
      )));
    }));
  }
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

function getSnapshotWeatherFingerprint(snapshot: TodayRestoreSnapshot) {
  return snapshot.weatherFingerprint ?? getRecommendationWeatherFingerprint(snapshot.weatherSnapshot);
}

function getDeletedItemCount(outfit: Outfit) {
  if (typeof outfit.deletedItemCount === 'number') return outfit.deletedItemCount;
  const snapshotCount = outfit.snapshotItems?.filter((item) => item.isDeleted || item.deletedAt).length ?? 0;
  const itemCount = outfit.items?.filter((item) => item.isDeleted).length ?? 0;
  return Math.max(snapshotCount, itemCount);
}

function getMutationTargetKey(outfit: Outfit) {
  return outfit.outfitKey || outfit.id;
}
