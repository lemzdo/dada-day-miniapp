import { Image, Swiper, SwiperItem, Text, View } from '@tarojs/components';
import Taro, { useDidShow, useLoad, usePullDownRefresh, useUnload } from '@tarojs/taro';
import { useCallback, useEffect, useRef, useState } from 'react';
import { WeatherCard, type WeatherRecommendationRefreshResult } from '@/components/WeatherCard';
import { useAuthRuntime } from '@/hooks/useAuthRuntime';
import {
  TODAY_PROFILE_INPUT_VERSION_KEY,
  TODAY_RECOMMENDATION_HARD_INVALID_KEY,
  TODAY_WARDROBE_INPUT_VERSION_KEY,
  clearTodayRecommendationDirty,
  clearTodayRecommendationHardInvalid,
  getTodayRecommendationDirty,
  hasTodayRecommendationHardInvalid,
  invalidateAfterOutfitFavoriteMutation,
  invalidateAfterOutfitWornMutation,
} from '@/lib/cacheInvalidation';
import {
  generateCloudOutfitV2,
  getCloudResponseTransportDiagnostics,
  isDevelopV2ColdTelemetryEnvironment,
  isRecommendationDiagnosticEnvironment,
  materializeCloudRecommendationCopyV2,
  updateCloudOutfitFavoriteV2,
  updateCloudOutfitWearV2,
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
import { hydrateHomeLightForRender } from '@/utils/mediaResolution';
import { buildOutfitCardViewModel } from './cardViewModel';
import {
  beginTodayV2ColdTelemetry,
  completeTodayPerformanceRun,
  markTodayPerformanceDuration,
  markTodayPerformanceStage,
  markTodayV2ColdRequestSent,
  markTodayV2ColdResponseResolved,
  markTodayV2ColdUsable,
  recordTodayAuthContextCurrentChecked,
  recordTodayRestoreDispatchAttempt,
  recordTodayRestoreException,
  recordTodayRestoreFunctionEntered,
  recordTodayRestoreReturn,
  readTodayPerformanceLedger,
  startTodayPerformanceRun,
  subscribeTodayPerformanceLedger,
  type TodayPerformanceLedgerSnapshot,
} from '@/lib/performance/todayPerformanceLedger';
import {
  buildRecommendationInputSignature,
  createRecommendationInputCoordinator,
  createRecommendationIntentRegistry,
  type RecommendationIntent,
  type RecommendationIntentRegistry,
} from './recommendationIntent';
import { validateRecommendationCountContract } from './sceneResponseValidation';
import type { RecommendationCountContract, RecommendationMissingFact, RecommendationMissingRole, SceneTag, WeatherMode, WeatherSnapshot } from '@starter-template/types';
import './index.scss';
import { HomeLightCardV2 } from './HomeLightCardV2';
import { commitCanonicalSnapshotForRender as commitRenderBoundary } from './todayRenderCommit';
const TODAY_TIME_OF_DAY: TimeOfDay = 'all_day';
import {
  patchTodayV2CardStatus,
  readTodayV2Snapshot,
  toTodayV2Snapshot,
  TODAY_V2_SNAPSHOT_KEY,
  type TodayV2Snapshot,
} from './todayV2Adapter';

interface TapEvent {
  stopPropagation: () => void;
}

interface SwiperChangeEvent {
  detail: {
    current: number;
  };
}

function assertNoCloudUrlInRenderState(snapshot: TodayV2Snapshot | null): boolean {
  const unresolved = snapshot?.cards?.flatMap((card) => card.items || [])
    .filter((item) => typeof item.displayImageUrl === 'string' && item.displayImageUrl.startsWith('cloud://')) || [];
  if (unresolved.length === 0) return true;
  if (process.env.NODE_ENV !== 'production') {
    console.error('[TodayRenderInvariant] unresolved cloud media', unresolved.map((item) => item.clothingId));
  }
  return false;
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
  transport: ReturnType<typeof getCloudResponseTransportDiagnostics>;
  requestedImageCount: number;
  resolvedImageCount: number;
  applyFinishedAt: number;
  timeoutId?: ReturnType<typeof setTimeout>;
}

interface TodayFullComputeAcceptanceRequest {
  acceptanceRunId: string;
  captureId: string;
  performanceDiagnostics?: boolean;
  weatherModeOverride?: 'disabled';
  clientMilestones?: Record<string, number>;
}

function markAcceptanceClientMilestone(
  request: TodayFullComputeAcceptanceRequest | undefined,
  milestone: string,
) {
  if (!request) return;
  request.clientMilestones ??= {};
  request.clientMilestones[milestone] = Date.now();
}

const TODAY_HARD_INVALID_ACCEPTANCE_KEY = 'today:ttui-hard-invalid-acceptance:v1';

function consumeHardInvalidAcceptanceRequest(
  authContext?: ActiveAuthContext | null,
): TodayFullComputeAcceptanceRequest | undefined {
  if (!isTodayDiagnosticsRuntime()) return undefined;
  try {
    const value = Taro.getStorageSync(TODAY_HARD_INVALID_ACCEPTANCE_KEY) as TodayFullComputeAcceptanceRequest | '';
    Taro.removeStorageSync(TODAY_HARD_INVALID_ACCEPTANCE_KEY);
    if (value
      && typeof value.acceptanceRunId === 'string'
      && typeof value.captureId === 'string') {
      markAcceptanceClientMilestone(value, 'acceptanceConsumedAt');
      return value;
    }
    const marker = getUserStorageSync<{
      acceptanceDiagnostics?: TodayFullComputeAcceptanceRequest;
    }>(TODAY_RECOMMENDATION_HARD_INVALID_KEY, { authContext });
    const diagnostics = marker?.acceptanceDiagnostics;
    return diagnostics
      && typeof diagnostics.acceptanceRunId === 'string'
      && typeof diagnostics.captureId === 'string'
      ? diagnostics
      : undefined;
  } catch {
    return undefined;
  }
}

interface TodayDiagnosticsBridge {
  marker: 'd1d-today-production-handler-v1';
  copyAcceptanceBuild: 'today-copy-naturalness-v3';
  bundleRevision: 'today-v2-client-4b51368';
  ready: boolean;
  sceneKey: SceneKey;
  triggerFullCompute: (request: TodayFullComputeAcceptanceRequest) => Promise<boolean>;
  triggerRefresh: (request: TodayFullComputeAcceptanceRequest) => Promise<boolean>;
  releaseCaptureLock: () => void;
  readCopyAcceptanceState: () => {
    sceneKey: SceneKey;
    recommendationBatchId?: string;
    cards: Array<{ outfitKey: string; displayTitle: string; todayReason: string; isFavorite: boolean; isWornToday: boolean }>;
  };
  readUsableCardState: () => {
    batchIndex: number;
    batchTotal: number;
    hasOutfit: boolean;
    copyTextPresent: boolean;
    copySource: string;
    canSwipe: boolean;
    canFavorite: boolean;
    canOpenDetail: boolean;
  };
}

function isTodayDiagnosticsRuntime() {
  if (isRecommendationDiagnosticEnvironment()) return true;
  try {
    const runtimeWx = (globalThis as typeof globalThis & {
      wx?: { getAccountInfoSync?: () => { miniProgram?: { envVersion?: string } } };
    }).wx;
    const envVersion = runtimeWx?.getAccountInfoSync?.().miniProgram?.envVersion;
    return envVersion === 'develop' || envVersion === 'trial';
  } catch {
    return false;
  }
}

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

function getRecommendationInputSignature(input: {
  sceneKey: SceneKey;
  weather?: WeatherSnapshot;
  recommendationBatchId?: string;
  excludedOutfitKeys?: string[];
  requestKind?: 'initial' | 'refresh';
}) {
  return buildRecommendationInputSignature({
    userRuntimeKey: '',
    sceneKey: input.sceneKey,
    date: getToday(),
    timeOfDay: TODAY_TIME_OF_DAY,
    weatherFingerprint: getRecommendationWeatherFingerprint(input.weather),
    wardrobeVersion: 'wardrobe-0',
    profileVersion: 'profile-0',
    recommendationBatchId: input.recommendationBatchId,
    excludedOutfitKeys: input.excludedOutfitKeys || [],
    requestKind: input.requestKind || 'initial',
  });
}

export default function TodayPage() {
  const { authStatus, runtimeKey, isAuthenticated } = useAuthRuntime();
  const [v2Snapshot, setV2Snapshot] = useState<TodayV2Snapshot | null>(null);
  const v2SnapshotRef = useRef<TodayV2Snapshot | null>(null);
  const canonicalSnapshotRef = useRef<TodayV2Snapshot | null>(null);
  const [selectedSceneKey, setSelectedSceneKey] = useState<SceneKey>('home');
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
  const [showDelayedRequestHint, setShowDelayedRequestHint] = useState(false);
  const requestSeq = useRef(0);
  const restoreGenerationRef = useRef(0);
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
  const currentIndexRef = useRef(0);
  const selectedSceneKeyRef = useRef<SceneKey>('home');
  const recommendationBatchIdRef = useRef<string | undefined>(undefined);
  const hasRecommendationsRef = useRef(true);
  const batchLimitedRef = useRef(false);
  const batchExhaustedRef = useRef(false);
  const dirtyRefreshInFlightRef = useRef(false);
  const hardRefreshInFlightRef = useRef(false);
  const recommendationInputCoordinatorRef = useRef(createRecommendationInputCoordinator());
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
  const copyAcceptanceCaptureLockRef = useRef(false);
  const todayV2EntryAtRef = useRef<number | null>(null);
  const todayV2EntryColdEligibleRef = useRef(false);
  const todayV2ColdCorrelationRef = useRef<string | null>(null);
  const [currentWeather, setCurrentWeather] = useState<WeatherSnapshot | undefined>(undefined);
  const [performanceSnapshot, setPerformanceSnapshot] = useState<TodayPerformanceLedgerSnapshot>({ active: null, history: [] });
  const selectedScene = SCENE_TAGS[selectedSceneKey];
  v2SnapshotRef.current = v2Snapshot;
  const selectedSceneRef = useRef<SceneTag>(selectedScene);
  currentIndexRef.current = currentIndex;
  selectedSceneKeyRef.current = selectedSceneKey;
  recommendationBatchIdRef.current = recommendationBatchId;
  hasRecommendationsRef.current = hasRecommendations;
  batchLimitedRef.current = batchLimited;
  batchExhaustedRef.current = batchExhausted;
  recommendationNoticeRef.current = recommendationNotice;
  selectedSceneRef.current = selectedScene;

  const commitCanonicalSnapshotForRender = (canonicalSnapshot: TodayV2Snapshot, isOwner: () => boolean, persistCanonical?: () => void) => commitRenderBoundary({
    canonicalSnapshot,
    isOwner,
    hydrate: hydrateHomeLightForRender,
    setCanonicalRef: (snapshot) => { canonicalSnapshotRef.current = snapshot; },
    persistCanonical,
    setRenderState: setV2Snapshot,
    assertRenderState: assertNoCloudUrlInRenderState,
  });

  useLoad(() => {
    markTodayPerformanceStage('todayOnLoad');
  });

  useEffect(() => subscribeTodayPerformanceLedger(setPerformanceSnapshot), []);

  useEffect(() => {
    const correlationId = todayV2ColdCorrelationRef.current;
    if (!correlationId || !v2Snapshot || v2Snapshot.cards.length !== 8
      || v2Snapshot.cards.some((card) => card.items.length === 0
        || card.items.some((item) => item.isDeleted || !item.displayImageUrl.trim()))) return;
    markTodayV2ColdUsable(correlationId, Date.now());
    todayV2ColdCorrelationRef.current = null;
  }, [v2Snapshot]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const authContext = captureAuthContext();
    if (!authContext) return;
    const snapshot = readTodayV2Snapshot((key) => getUserStorageSync(key, { authContext }));
    if (!snapshot) return;
    const restoreGeneration = ++restoreGenerationRef.current;
    void commitCanonicalSnapshotForRender(snapshot, () => (
      restoreGeneration === restoreGenerationRef.current && isAuthContextCurrent(authContext)
    ));
  }, [isAuthenticated]);

  const resetUserState = useCallback(() => {
    restoreGenerationRef.current += 1;
    recommendationInputCoordinatorRef.current.reset();
    requestSeq.current += 1;
    activeRequestSeqRef.current = null;
    recommendationIntentRegistryRef.current?.reset();
    requestContextByIntentGenerationRef.current = {};
    seenOutfitKeysRef.current = new Set();
    seenOutfitKeysBySceneIdentityRef.current = {};
    seenIdentityHashBySceneRef.current = {};
    activeSeenSceneIdentityKeyRef.current = buildSceneIdentityKey('home', '');
    currentIndexRef.current = 0;
    recommendationBatchIdRef.current = undefined;
    hasRecommendationsRef.current = true;
    batchLimitedRef.current = false;
    batchExhaustedRef.current = false;
    recommendationNoticeRef.current = '';
    shouldRestoreFromDetailRef.current = false;
    operationTargetRef.current = null;
    recommendationWeatherSnapshotRef.current = undefined;
    recommendationWeatherFingerprintRef.current = getRecommendationWeatherFingerprint(undefined);
    loadingOwnerSeqRef.current = null;
    operationOwnerSeqRef.current = null;
    behaviorTrackerRef.current = createOutfitBehaviorExposureTracker();
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
    canonicalSnapshotRef.current = null;
    setV2Snapshot(null);
  }, []);

  useUnload(() => {
    restoreGenerationRef.current += 1;
    if (clientImageTimingRef.current?.timeoutId) clearTimeout(clientImageTimingRef.current.timeoutId);
    clientImageTimingRef.current = null;
    requestSeq.current += 1;
    activeRequestSeqRef.current = null;
    recommendationIntentRegistryRef.current?.reset();
    loadingOwnerSeqRef.current = null;
    operationOwnerSeqRef.current = null;
    imagePreloadGenerationRef.current += 1;
  });

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
    todayV2EntryAtRef.current = Date.now();
    todayV2EntryColdEligibleRef.current = !(v2SnapshotRef.current?.cards.length === 8);
    todayV2ColdCorrelationRef.current = null;
    startTodayPerformanceRun();
    markTodayPerformanceStage('appOrPageEntry');
    markTodayPerformanceStage('todayComponentEnter');
    markTodayPerformanceStage('todayOnShow');
    const authContext = captureAuthContext();
    if (!authContext) return;
    markTodayPerformanceStage('localIdentityReady');
    if (hasTodayRecommendationHardInvalid({ authContext })) {
      if (!currentWeatherRef.current && currentWeatherModeRef.current === 'disabled') {
        recommendationInputCoordinatorRef.current.report({
          inputIdentity: `${runtimeKey || 'anonymous'}|${selectedSceneKeyRef.current}|initial`,
          readiness: 'deferred',
        });
      } else {
        void refreshHardInvalidRecommendation(authContext, consumeHardInvalidAcceptanceRequest(authContext));
      }
      return;
    }
    // A resumed Today tab is a normal restore entry, not only a return from
    // outfit detail. Keep the detail-intent gate for detail-specific callers,
    // but never let it suppress the user-scoped hot snapshot on a fresh run.
  });

  useEffect(() => {
    markTodayPerformanceStage('identityStart');
    if (!isAuthenticated || !runtimeKey) {
      lastHandledRuntimeKeyRef.current = null;
      resetUserState();
      return;
    }

    if (lastHandledRuntimeKeyRef.current === runtimeKey) return;
    resetUserState();
    lastHandledRuntimeKeyRef.current = runtimeKey;
    markTodayPerformanceStage('identityRemoteStart');
    markTodayPerformanceStage('identityReady');
    markTodayPerformanceStage('identityRemoteEnd');
    markTodayPerformanceStage('sceneReady');
    entryIntentIdRef.current = `today-entry:${runtimeKey}:${Date.now()}`;
    // A valid user-scoped snapshot is synchronous and must be allowed to paint
    // before WeatherCard finishes location/auth/cloud work. Weather changes
    // continue through handleWeatherChange as a background refresh afterwards.
    const authContext = captureAuthContext();
    if (authContext && hasTodayRecommendationHardInvalid({ authContext })) {
      const acceptanceDiagnostics = consumeHardInvalidAcceptanceRequest(authContext);
      markAcceptanceClientMilestone(acceptanceDiagnostics, 'hardInvalidDetectedAt');
      if (!currentWeatherRef.current && currentWeatherModeRef.current === 'disabled') {
        recommendationInputCoordinatorRef.current.report({
          inputIdentity: `${runtimeKey || 'anonymous'}|${selectedSceneKeyRef.current}|initial`,
          readiness: 'deferred',
        });
      } else {
        void refreshHardInvalidRecommendation(authContext, acceptanceDiagnostics);
      }
      return;
    }
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
    acceptanceDiagnostics,
  }: {
    intentId: string
    sceneKey: SceneKey
    weather?: WeatherSnapshot
    weatherMode?: WeatherMode
    excludedOutfitKeys?: string[]
    silent?: boolean
    trigger?: string
    requestKind?: 'initial' | 'refresh'
    acceptanceDiagnostics?: TodayFullComputeAcceptanceRequest
  }): Promise<boolean> {
    markAcceptanceClientMilestone(acceptanceDiagnostics, 'requestRecommendationsStartedAt');
    const inputSignature = getRecommendationInputSignature({
      sceneKey,
      weather,
      recommendationBatchId: requestKind === 'refresh' ? recommendationBatchIdRef.current : undefined,
      excludedOutfitKeys,
      requestKind,
    });
    markAcceptanceClientMilestone(acceptanceDiagnostics, 'requestIdentityConstructedAt');
    const registry = recommendationIntentRegistryRef.current;
    if (!registry) return Promise.resolve(false);
    const run = registry.run<boolean>({
      intentId,
      inputSignature,
      execute: (intent) => {
        markAcceptanceClientMilestone(acceptanceDiagnostics, 'registryExecuteStartedAt');
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
          acceptanceDiagnostics,
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

  async function refreshDirtyRecommendation(authContext: ActiveAuthContext) {
    if (dirtyRefreshInFlightRef.current || !(v2SnapshotRef.current?.cards.length === 8)) return;
    const dirty = getTodayRecommendationDirty({ authContext });
    if (!dirty) return;
    dirtyRefreshInFlightRef.current = true;
    setRecommendationNotice(dirty.message);
    try {
      const refreshed = await requestRecommendations({
        intentId: nextRecommendationIntentId(`dirty-${dirty.reason}`),
        sceneKey: selectedSceneKeyRef.current,
        weather: currentWeatherRef.current,
        weatherMode: currentWeatherModeRef.current,
        silent: true,
        trigger: dirty.reason,
      });
      if (refreshed && isAuthContextCurrent(authContext)) {
        clearTodayRecommendationDirty({ authContext });
        setRecommendationNotice('');
      }
    } finally {
      dirtyRefreshInFlightRef.current = false;
    }
  }

  async function refreshHardInvalidRecommendation(
    authContext: ActiveAuthContext,
    acceptanceDiagnostics?: TodayFullComputeAcceptanceRequest,
  ) {
    if (hardRefreshInFlightRef.current) return;
    markAcceptanceClientMilestone(acceptanceDiagnostics, 'hardRefreshStartedAt');
    hardRefreshInFlightRef.current = true;
    markAcceptanceClientMilestone(acceptanceDiagnostics, 'runtimeStateResetStartedAt');
    resetUserState();
    todayV2EntryColdEligibleRef.current = true;
    markAcceptanceClientMilestone(acceptanceDiagnostics, 'runtimeStateResetCompletedAt');
    setRecommendationNotice('正在重新搭配…');
    try {
      const refreshed = await requestRecommendations({
        intentId: nextRecommendationIntentId('hard-invalid'),
        sceneKey: selectedSceneKeyRef.current,
        weather: currentWeatherRef.current,
        weatherMode: currentWeatherModeRef.current,
        trigger: 'hard-invalid',
        acceptanceDiagnostics,
      });
      if (refreshed && isAuthContextCurrent(authContext)) {
        clearTodayRecommendationHardInvalid({ authContext });
      }
    } finally {
      hardRefreshInFlightRef.current = false;
    }
  }

  async function fetchRecommendations({
    intent,
    requestContext,
    weather = currentWeatherRef.current,
    excludedOutfitKeys = [],
    silent = false,
    trigger = 'unknown',
    requestKind = 'initial',
    acceptanceDiagnostics,
  }: {
    intent: RecommendationIntent
    requestContext: RecommendationRequestContext
    weather?: WeatherSnapshot
    excludedOutfitKeys?: string[]
    silent?: boolean
    trigger?: string
    requestKind?: 'initial' | 'refresh'
    acceptanceDiagnostics?: TodayFullComputeAcceptanceRequest
  }): Promise<boolean> {
    markAcceptanceClientMilestone(acceptanceDiagnostics, 'fetchRecommendationsStartedAt');
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
      {
        const passiveColdTelemetry = isRecommendationDiagnosticEnvironment()
          && isDevelopV2ColdTelemetryEnvironment()
          && acceptanceDiagnostics?.performanceDiagnostics === true
          && requestKind !== 'refresh'
          && (trigger === 'hard-invalid' || todayV2EntryColdEligibleRef.current)
          && !silent
          && trigger !== 'pull-down'
          && trigger !== 'scene'
          && (trigger === 'hard-invalid' || !(v2SnapshotRef.current?.cards.length === 8));
        const telemetryCorrelationId = passiveColdTelemetry
          ? (todayV2ColdCorrelationRef.current
            || (todayV2ColdCorrelationRef.current = beginTodayV2ColdTelemetry(
              todayV2EntryAtRef.current || Date.now(),
            ) || null))
          : null;
        if (passiveColdTelemetry) todayV2EntryColdEligibleRef.current = false;
        const rawResponse = await generateCloudOutfitV2({
          date: getToday(),
          scene,
          timeOfDay: TODAY_TIME_OF_DAY,
          weatherMode,
          trigger,
          requestKind: passiveColdTelemetry ? 'cold' : (requestKind === 'refresh' ? 'refresh' : 'initial'),
          ...(telemetryCorrelationId ? { telemetryCorrelationId } : {}),
          ...(passiveColdTelemetry ? { performanceDiagnostics: true } : {}),
          ...(excludedOutfitKeys.length > 0 ? { excludedOutfitKeys } : {}),
          ...(weather ? { weather } : {}),
          ...(acceptanceDiagnostics ? {
            performanceDiagnostics: true,
            acceptanceRunId: acceptanceDiagnostics.acceptanceRunId,
            captureId: acceptanceDiagnostics.captureId,
            clientMilestones: acceptanceDiagnostics.clientMilestones,
          } : {}),
        });
        if (telemetryCorrelationId) {
          const transport = getCloudResponseTransportDiagnostics(rawResponse);
          const performance = (transport?.performance && typeof transport.performance === 'object')
            ? transport.performance as { serverTotalMs?: number; serverResponseReadyAt?: number }
            : undefined;
          if (typeof transport?.immediatelyBeforeCallFunction === 'number') {
            markTodayV2ColdRequestSent(telemetryCorrelationId, transport.immediatelyBeforeCallFunction);
          }
          if (typeof transport?.callFunctionPromiseResolved === 'number') {
            markTodayV2ColdResponseResolved(telemetryCorrelationId, transport.callFunctionPromiseResolved, performance);
          }
        }
        markAcceptanceClientMilestone(acceptanceDiagnostics, 'v2ResponseReceivedAt');
        const v2IntentCurrent = isRecommendationIntentCurrent(intent);
        const v2AuthCurrent = isAuthContextCurrent(authContext);
        if (v2IntentCurrent) markAcceptanceClientMilestone(acceptanceDiagnostics, 'v2IntentCurrentAt');
        if (v2AuthCurrent) markAcceptanceClientMilestone(acceptanceDiagnostics, 'v2AuthContextCurrentAt');
        if (!v2IntentCurrent || !v2AuthCurrent) {
          markAcceptanceClientMilestone(acceptanceDiagnostics, 'v2ApplyRejectedAt');
          return false;
        }
        const canonicalSnapshot = toTodayV2Snapshot(rawResponse);
        if (!isRecommendationIntentCurrent(intent) || !isAuthContextCurrent(authContext)) {
          markAcceptanceClientMilestone(acceptanceDiagnostics, 'v2MediaResolutionRejectedAt');
          return false;
        }
        const committed = await commitCanonicalSnapshotForRender(canonicalSnapshot,
          () => isRecommendationIntentCurrent(intent) && isAuthContextCurrent(authContext),
          () => setUserStorageSync(TODAY_V2_SNAPSHOT_KEY, canonicalSnapshot, { authContext }));
        if (!committed) {
          markAcceptanceClientMilestone(acceptanceDiagnostics, 'v2MediaResolutionRejectedAt');
          return false;
        }
        const nextSnapshot = committed;
        setLoading(false);
        setError('');
        setHasRecommendations(true);
        setRecommendationBatchId(nextSnapshot.batchId);
        markAcceptanceClientMilestone(acceptanceDiagnostics, 'v2ApplyCommittedAt');
        return true;
      }
    } catch (err) {
      if (!isRecommendationIntentCurrent(intent) || !isLatestRequest(seq)) return false;
      logRecommendationError(auditId, seq, 'fetchRecommendations', err);
      if (!silent) {
        setError('获取推荐失败，请稍后再试');
        if (!(v2SnapshotRef.current?.cards.length === 8)) {
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

  async function handleV2Refresh(acceptanceDiagnostics?: TodayFullComputeAcceptanceRequest): Promise<boolean> {
    const previous = v2Snapshot;
    const authContext = captureAuthContext();
    if (!authContext) return false;
    const exclusions = previous?.cards.map((card) => card.outfitKey) ?? [];
    setLoading(true);
    const refreshSeq = requestSeq.current + 1;
    requestSeq.current = refreshSeq;
    activeRequestSeqRef.current = refreshSeq;
    setOperationForRequest(refreshSeq, 'refresh');
    setError('');
    try {
      const response = await generateCloudOutfitV2({
        date: getToday(),
        scene: selectedSceneRef.current,
        timeOfDay: TODAY_TIME_OF_DAY,
        weather: currentWeatherRef.current,
        weatherMode: currentWeatherModeRef.current,
        trigger: 'refresh',
        excludedOutfitKeys: exclusions,
        ...(acceptanceDiagnostics ? {
          performanceDiagnostics: true,
          acceptanceRunId: acceptanceDiagnostics?.acceptanceRunId,
          captureId: acceptanceDiagnostics?.captureId,
          clientMilestones: acceptanceDiagnostics?.clientMilestones,
        } : {}),
      });
      if (!isAuthContextCurrent(authContext) || activeRequestSeqRef.current !== refreshSeq) return false;
      const canonicalSnapshot = toTodayV2Snapshot(response);
      const committed = await commitCanonicalSnapshotForRender(canonicalSnapshot,
        () => isAuthContextCurrent(authContext) && activeRequestSeqRef.current === refreshSeq,
        () => setUserStorageSync(TODAY_V2_SNAPSHOT_KEY, canonicalSnapshot, { authContext }));
      if (!committed) return false;
      const next = committed;
      setRecommendationBatchId(next.batchId);
      setLoading(false);
      return true;
    } catch (error) {
      console.error('V2 refresh error:', error);
      clearOperationForRequest(refreshSeq);
      setLoading(false);
      setRecommendationNotice('换一套失败，先保留刚才这批');
      return false;
    }
    finally {
      clearOperationForRequest(refreshSeq);
    }
  }

  async function handleRefresh(acceptanceDiagnostics?: TodayFullComputeAcceptanceRequest): Promise<boolean> {
    if (loading || operation) return false;
    return handleV2Refresh(acceptanceDiagnostics);
  }

  function handleSceneSelect(sceneKey: SceneKey) {
    if (sceneKey === selectedSceneKey && !error) return;
    setSelectedSceneKey(sceneKey);
    selectedSceneKeyRef.current = sceneKey;
    setCurrentIndex(0);
    currentIndexRef.current = 0;
    setV2Snapshot(null);
    setError('');
    void requestRecommendations({
      intentId: nextRecommendationIntentId('scene'),
      sceneKey,
      weather: currentWeatherRef.current,
      weatherMode: currentWeatherModeRef.current,
      trigger: 'scene-change',
    });
  }

  async function handleV2Favorite(card: import('@starter-template/types').HomeLightCardV2) {
    if (!v2Snapshot || operation) return;
    const canonicalSnapshot = canonicalSnapshotRef.current;
    if (!canonicalSnapshot || canonicalSnapshot.batchId !== v2Snapshot.batchId) return;
    const authContext = captureAuthContext();
    if (!authContext) return;
    setOperation('favorite');
    try {
      const result = await updateCloudOutfitFavoriteV2({
        batchId: v2Snapshot.batchId,
        outfitKey: card.outfitKey,
        isFavorite: !card.isFavorite,
      });
      const nextRender = patchTodayV2CardStatus(v2Snapshot, result);
      const nextCanonical = patchTodayV2CardStatus(canonicalSnapshot, result);
      if (!assertNoCloudUrlInRenderState(nextRender)) return;
      canonicalSnapshotRef.current = nextCanonical;
      setV2Snapshot(nextRender);
      setUserStorageSync(TODAY_V2_SNAPSHOT_KEY, nextCanonical, { authContext });
    } finally {
      setOperation(null);
    }
  }

  async function handleV2Wear(card: import('@starter-template/types').HomeLightCardV2) {
    if (!v2Snapshot || operation || card.isWornToday) return;
    const canonicalSnapshot = canonicalSnapshotRef.current;
    if (!canonicalSnapshot || canonicalSnapshot.batchId !== v2Snapshot.batchId) return;
    const authContext = captureAuthContext();
    if (!authContext) return;
    setOperation('wear');
    try {
      const result = await updateCloudOutfitWearV2({ batchId: v2Snapshot.batchId, outfitKey: card.outfitKey, date: getToday() });
      const nextRender = patchTodayV2CardStatus(v2Snapshot, result);
      const nextCanonical = patchTodayV2CardStatus(canonicalSnapshot, result);
      if (!assertNoCloudUrlInRenderState(nextRender)) return;
      canonicalSnapshotRef.current = nextCanonical;
      setV2Snapshot(nextRender);
      setUserStorageSync(TODAY_V2_SNAPSHOT_KEY, nextCanonical, { authContext });
    } finally {
      setOperation(null);
    }
  }

  function openV2Detail(card: import('@starter-template/types').HomeLightCardV2) {
    if (!v2Snapshot) return;
    void Taro.navigateTo({
      url: `/pages/outfit-detail/index?runtimeVersion=today-runtime-v2&batchId=${encodeURIComponent(v2Snapshot.batchId)}&outfitKey=${encodeURIComponent(card.outfitKey)}&referenceId=${encodeURIComponent(card.referenceId)}`,
    });
  }

  async function handleWeatherChange(
    weather: WeatherSnapshot | undefined,
    options: { forceRefresh?: boolean; weatherMode: WeatherMode },
  ): Promise<WeatherRecommendationRefreshResult> {
    markTodayPerformanceStage('weatherStart');
    const weatherFingerprint = getRecommendationWeatherFingerprint(weather);
    const sameRecommendationWeather = weatherFingerprint === recommendationWeatherFingerprintRef.current;
    currentWeatherRef.current = weather;
    currentWeatherModeRef.current = options.weatherMode;
    currentWeatherFingerprintRef.current = weatherFingerprint;
    setCurrentWeather(weather);

    if (copyAcceptanceCaptureLockRef.current) {
      markTodayPerformanceStage('weatherEnd');
      return 'unchanged';
    }

    const sceneKey = selectedSceneKeyRef.current;
    const inputRelease = recommendationInputCoordinatorRef.current.report({
      inputIdentity: `${runtimeKey || 'anonymous'}|${sceneKey}|${weatherFingerprint}`,
      readiness: weather ? 'ready' : (options.weatherMode === 'disabled' || options.weatherMode === 'unavailable' ? 'unavailable' : 'deferred'),
    });
    if (inputRelease.dispatch) {
      const authContext = captureAuthContext();
      if (authContext && hasTodayRecommendationHardInvalid({ authContext })) {
        void refreshHardInvalidRecommendation(authContext);
        markTodayPerformanceStage('weatherEnd');
        return 'refreshed';
      }
    }
    if (v2SnapshotRef.current?.cards.length === 8 && sameRecommendationWeather) {
      markTodayPerformanceStage('weatherEnd');
      return 'unchanged';
    }

    try {
      const hasVisibleBatch = v2SnapshotRef.current?.cards.length === 8;
      if (hasVisibleBatch) {
        markTodayPerformanceStage('backgroundRefreshStart');
        setRecommendationNotice('天气变了，正在更新搭配…');
      }
      const refreshed = await requestRecommendations({
        intentId: !(v2SnapshotRef.current?.cards.length === 8)
          ? entryIntentIdRef.current
          : nextRecommendationIntentId(options.forceRefresh ? 'weather-force' : 'weather'),
        sceneKey,
        weather,
        weatherMode: options.weatherMode,
        silent: v2SnapshotRef.current?.cards.length === 8,
        trigger: options.forceRefresh ? 'weather-force' : 'weather',
      });
      if (hasVisibleBatch) {
        markTodayPerformanceStage('backgroundRefreshEnd');
        setRecommendationNotice(refreshed ? '已按最新天气更新' : '天气更新暂时失败，先保留当前搭配');
      }
      markTodayPerformanceStage('weatherEnd');
      return refreshed ? 'refreshed' : 'failed';
    } catch (error) {
      markTodayPerformanceStage('weatherEnd');
      return 'failed';
    }
  }

  function goToWardrobe() {
    Taro.switchTab({ url: '/pages/wardrobe/index' });
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

  function nextRequestSeq() { requestSeq.current += 1; return requestSeq.current; }
  function nextRecommendationIntentId(kind: string) { intentCounterRef.current += 1; return kind + ':' + (runtimeKey || 'anonymous') + ':' + intentCounterRef.current; }
  function isRecommendationIntentCurrent(intent: RecommendationIntent) { return recommendationIntentRegistryRef.current?.isCurrent(intent) === true; }
  function setLoadingForRequest(seq: number) { loadingOwnerSeqRef.current = seq; setLoading(true); }
  function clearLoadingForRequest(seq: number) { if (loadingOwnerSeqRef.current === seq) { loadingOwnerSeqRef.current = null; setLoading(false); } }

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

  const isRefreshing = operation === 'refresh';
  const isNoMoreRecommendations = batchExhausted;
  useEffect(() => {
    if (!isTodayDiagnosticsRuntime()) return undefined;
    const diagnosticsGlobal = globalThis as typeof globalThis & {
      __d1dTodayDiagnostics?: TodayDiagnosticsBridge;
    };
    const bridge: TodayDiagnosticsBridge = {
      marker: 'd1d-today-production-handler-v1',
      copyAcceptanceBuild: 'today-copy-naturalness-v3',
      bundleRevision: 'today-v2-client-4b51368',
      ready: Boolean(isAuthenticated && runtimeKey && !loading && !operation),
      sceneKey: selectedSceneKeyRef.current,
      readCopyAcceptanceState: () => ({
        sceneKey: selectedSceneKeyRef.current,
        recommendationBatchId: recommendationBatchIdRef.current,
        cards: (v2Snapshot?.cards ?? []).map((card) => ({
          outfitKey: card.outfitKey,
          displayTitle: card.displayTitle,
          todayReason: card.todayReason,
          isFavorite: card.isFavorite,
          isWornToday: card.isWornToday,
        })),
      }),
      readUsableCardState: () => {
        const batch = v2Snapshot?.cards ?? [];
        const index = currentIndexRef.current;
        const card = batch[index];
        const copyText = card?.todayReason || '';
        return {
          batchIndex: card ? index + 1 : 0,
          batchTotal: batch.length,
          hasOutfit: Boolean(card),
          copyTextPresent: Boolean(copyText.trim()),
          copySource: 'safe',
          canSwipe: batch.length > 1,
          canFavorite: Boolean(card) && operation !== 'favorite',
          canOpenDetail: Boolean(card),
        };
      },
      releaseCaptureLock: () => {
        copyAcceptanceCaptureLockRef.current = false;
      },
      triggerFullCompute: async (request) => {
        if (!request?.acceptanceRunId || !request?.captureId) {
          throw new Error('acceptanceRunId and captureId are required');
        }
        if (loading || operation) throw new Error('Today recommendation handler is busy');
        copyAcceptanceCaptureLockRef.current = true;
        return requestRecommendations({
          intentId: nextRecommendationIntentId('retry'),
          sceneKey: selectedSceneKeyRef.current,
          weather: request.weatherModeOverride === 'disabled' ? undefined : currentWeatherRef.current,
          weatherMode: request.weatherModeOverride ?? currentWeatherModeRef.current,
          trigger: 'retry',
          acceptanceDiagnostics: { ...request, performanceDiagnostics: true },
        });
      },
      triggerRefresh: async (request) => {
        if (!request?.acceptanceRunId || !request?.captureId) {
          throw new Error('acceptanceRunId and captureId are required');
        }
        if (loading || operation) throw new Error('Today recommendation handler is busy');
        copyAcceptanceCaptureLockRef.current = true;
        const acceptanceRequest = { ...request, performanceDiagnostics: true };
        return handleRefresh(acceptanceRequest);
      },
    };
    diagnosticsGlobal.__d1dTodayDiagnostics = bridge;
    return () => {
      if (diagnosticsGlobal.__d1dTodayDiagnostics === bridge) {
        delete diagnosticsGlobal.__d1dTodayDiagnostics;
      }
    };
  });

  return (
    <View className="today-page">
      {performanceSnapshot.active && (
        <TodayPerformancePanel snapshot={performanceSnapshot} />
      )}
      <View className="top-section">
        <View className="hero-header">
          <View className="hero-brand">
            <Text className="hero-brand-cn">搭搭</Text>
            <Text className="hero-brand-day">day</Text>
          </View>
          <WeatherCard
            city="上海"
            onLocationPermissionPrompt={() => markTodayPerformanceStage('locationPermissionPromptStart')}
            onLocationPermissionResolved={() => markTodayPerformanceStage('locationPermissionResolved')}
            onWeatherChange={handleWeatherChange}
          />
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
        {v2Snapshot && (
          <View className="recommendation-browser recommendation-browser-v2">
            <Swiper className="outfit-swiper" current={currentIndex} circular={false} onChange={(event) => setCurrentIndex(event.detail.current)}>
              {v2Snapshot.cards.map((card) => (
                <SwiperItem key={card.outfitKey} className="outfit-slide">
                  <HomeLightCardV2
                    card={card}
                    onFavorite={(value) => { void handleV2Favorite(value); }}
                    onWear={(value) => { void handleV2Wear(value); }}
                    onDetail={openV2Detail}
                  />
                </SwiperItem>
              ))}
            </Swiper>
            <View className="swiper-footer"><Text>{currentIndex + 1} / {v2Snapshot.cards.length}</Text></View>
            <View className={`refresh-btn ${v2Snapshot.core.countContract.exhausted ? 'disabled' : ''}`} onClick={() => { if (!v2Snapshot.core.countContract.exhausted) void handleRefresh(); }}><Text className="refresh-text">{v2Snapshot.core.countContract.exhausted ? '这一轮已看完' : '换一批灵感'}</Text></View>
          </View>
        )}
        {!v2Snapshot && loading && (
          <View className="loading-state"><View className="loading-spinner" /><Text className="loading-text">正在生成今日搭配…</Text></View>
        )}
        {!v2Snapshot && !loading && error && (
          <View className="empty-state"><Text className="empty-text">{error}</Text></View>
        )}
      </View>
    </View>
  );
}

function TodayPerformancePanel({ snapshot }: { snapshot: TodayPerformanceLedgerSnapshot }) {
  const [expanded, setExpanded] = useState(false);
  const active = snapshot.active;
  if (!active) return null;
  const firstCardMs = active.durations.onShowToFirstCard;
  const firstImageMs = active.durations.onShowToFirstImage;
  const stageDurations = Object.entries(active.durations)
    .sort(([, left], [, right]) => right - left)
    .slice(0, 4);
  return (
    <View className={`today-performance-panel ${expanded ? 'expanded' : ''}`}>
      <View className="today-performance-header" onClick={() => setExpanded((value) => !value)}>
        <Text className="today-performance-title">性能 {active.complete ? 'COMPLETE' : 'RUNNING'}</Text>
        <Text className="today-performance-mode">{active.executionMode} · {expanded ? '收起' : '展开'}</Text>
      </View>
      {expanded && (
        <View className="today-performance-body">
          <Text>snapshot {String(active.stages.snapshotFound === 'NOT_OBSERVED' ? 'not found' : active.stages.snapshotValid)} · cards {active.finalCardCount}</Text>
          <Text>requests {active.generateOutfitRequestCount} · first card {formatPerformanceMs(firstCardMs)} · first image {formatPerformanceMs(firstImageMs)}</Text>
          <Text>runId {active.runId}</Text>
          {stageDurations.map(([name, duration]) => <Text key={name}>{name}: {Math.round(duration)}ms</Text>)}
        </View>
      )}
    </View>
  );
}

function formatPerformanceMs(value: number | undefined) {
  return typeof value === 'number' ? `${Math.round(value)}ms` : 'NOT_OBSERVED';
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
