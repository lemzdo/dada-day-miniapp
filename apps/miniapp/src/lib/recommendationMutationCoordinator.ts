import type {
  RecommendationHomeLightResponseV2,
  SceneTag,
  WeatherMode,
  WeatherSnapshot,
} from '@starter-template/types';
import { generateCloudOutfitV2, type RecommendationV2Request } from './cloud';
import { createRecommendationCoordinatorCore } from './recommendationCoordinatorCore';
import { buildRecommendationInputIdentity } from './recommendationIdentity';
import {
  TODAY_PROFILE_INPUT_VERSION_KEY,
  TODAY_RECOMMENDATION_CONTEXT_KEY,
  TODAY_RECOMMENDATION_HARD_INVALID_KEY,
  TODAY_RECOMMENDATION_LATEST_IDENTITY_KEY,
  TODAY_V2_SNAPSHOT_KEY,
  TODAY_WARDROBE_INPUT_VERSION_KEY,
} from './recommendationInputKeys';
import { isAuthContextCurrent, type ActiveAuthContext } from './userPageCache';
import { getUserStorageSync, setUserStorageSync } from './userStorage';
import { getRecommendationWeatherFingerprint } from '@/utils/weather';

export type RecommendationMutationSource =
  | 'wardrobe_add'
  | 'wardrobe_edit'
  | 'wardrobe_delete'
  | 'wardrobe_reprocess'
  | 'style_preference_save';

export interface RecommendationInputContext {
  sceneKey: string;
  scene: SceneTag;
  timeOfDay: string;
  weather?: WeatherSnapshot;
  weatherMode: WeatherMode;
}

export interface EffectiveRecommendationInput extends RecommendationInputContext {
  authContext: ActiveAuthContext;
  date: string;
  weatherFingerprint: string;
  wardrobeVersion: number;
  profileVersion: number;
  identity: string;
  requestIdentity: string;
  recommendationBatchId?: string;
  excludedOutfitKeys: string[];
  requestKind: 'initial' | 'refresh';
}

interface RecommendationHardInvalidMarker {
  identity: string;
  source: RecommendationMutationSource;
  createdAt: number;
}

interface AcquireOptions {
  input: EffectiveRecommendationInput;
  trigger: string;
  requestOverrides?: Partial<RecommendationV2Request>;
}

const DEFAULT_CONTEXT: RecommendationInputContext = {
  sceneKey: 'home',
  scene: '居家' as SceneTag,
  timeOfDay: 'all_day',
  weatherMode: 'disabled',
};

const coordinator = createRecommendationCoordinatorCore<RecommendationV2Request, RecommendationHomeLightResponseV2>({
  execute: (request) => generateCloudOutfitV2(request),
});

export function registerRecommendationInputContext(
  context: RecommendationInputContext,
  authContext: ActiveAuthContext,
): EffectiveRecommendationInput | null {
  if (!isAuthContextCurrent(authContext)) return null;
  setUserStorageSync(TODAY_RECOMMENDATION_CONTEXT_KEY, context, { authContext });
  const input = buildEffectiveRecommendationInput(authContext, context);
  persistLatestIdentity(input);
  coordinator.setLatestIdentity(input.identity);
  return input;
}

export function buildEffectiveRecommendationInput(
  authContext: ActiveAuthContext,
  context?: RecommendationInputContext,
  options: {
    recommendationBatchId?: string;
    excludedOutfitKeys?: string[];
    requestKind?: 'initial' | 'refresh';
  } = {},
): EffectiveRecommendationInput {
  const currentContext = context
    ?? getUserStorageSync<RecommendationInputContext>(TODAY_RECOMMENDATION_CONTEXT_KEY, { authContext })
    ?? DEFAULT_CONTEXT;
  const wardrobeVersion = readInputVersion(TODAY_WARDROBE_INPUT_VERSION_KEY, authContext);
  const profileVersion = readInputVersion(TODAY_PROFILE_INPUT_VERSION_KEY, authContext);
  const date = getToday();
  const requestKind = options.requestKind ?? 'initial';
  const excludedOutfitKeys = options.excludedOutfitKeys ?? [];
  const weatherFingerprint = getRecommendationWeatherFingerprint(currentContext.weather);
  const identityParts = {
    userRuntimeKey: authContext.userScope,
    sceneKey: currentContext.sceneKey,
    date,
    timeOfDay: currentContext.timeOfDay,
    weatherFingerprint,
    wardrobeVersion,
    profileVersion,
  };
  const identity = buildRecommendationInputIdentity(identityParts);
  const requestIdentity = buildRecommendationInputIdentity({
    ...identityParts,
    recommendationBatchId: options.recommendationBatchId,
    excludedOutfitKeys,
    requestKind,
  });
  return {
    ...currentContext,
    authContext,
    date,
    weatherFingerprint,
    wardrobeVersion,
    profileVersion,
    identity,
    requestIdentity,
    recommendationBatchId: options.recommendationBatchId,
    excludedOutfitKeys,
    requestKind,
  };
}

export function recommendationInputChanged(input: {
  source: RecommendationMutationSource;
  authContext: ActiveAuthContext;
}): { identity: string; prebuildStarted: boolean } | null {
  const { authContext, source } = input;
  if (!isAuthContextCurrent(authContext)) return null;
  const versionKey = source === 'style_preference_save'
    ? TODAY_PROFILE_INPUT_VERSION_KEY
    : TODAY_WARDROBE_INPUT_VERSION_KEY;
  bumpInputVersion(versionKey, authContext);
  const effectiveInput = buildEffectiveRecommendationInput(authContext);
  persistLatestIdentity(effectiveInput);
  setUserStorageSync<RecommendationHardInvalidMarker>(TODAY_RECOMMENDATION_HARD_INVALID_KEY, {
    identity: effectiveInput.identity,
    source,
    createdAt: Date.now(),
  }, { authContext });
  setUserStorageSync(TODAY_V2_SNAPSHOT_KEY, null, { authContext });

  const prebuild = coordinator.invalidateAndPrebuild({
    identity: effectiveInput.identity,
    request: toRecommendationRequest(effectiveInput, source),
  });
  void prebuild.promise.catch((error) => {
    console.warn('[RecommendationInputChanged] prebuild failed', {
      identity: effectiveInput.identity,
      source,
      error,
    });
  });
  return { identity: effectiveInput.identity, prebuildStarted: true };
}

export function acquireRecommendationForInput(options: AcquireOptions) {
  const { input } = options;
  persistLatestIdentity(input);
  const request = {
    ...toRecommendationRequest(input, options.trigger),
    ...options.requestOverrides,
  };
  const run = coordinator.acquire({
    identity: input.identity,
    requestKey: input.requestIdentity,
    request,
    mode: 'today',
  });
  if (run.source !== 'prebuild-in-flight') return run;
  return {
    ...run,
    promise: run.promise.catch((error) => {
      if (!isRecommendationInputIdentityCurrent(input.identity, input.authContext)) throw error;
      return coordinator.acquire({
        identity: input.identity,
        requestKey: input.requestIdentity,
        request,
        mode: 'today',
      }).promise;
    }),
  };
}

export function isRecommendationInputIdentityCurrent(
  identity: string,
  authContext: ActiveAuthContext,
): boolean {
  if (!isAuthContextCurrent(authContext) || !coordinator.isLatest(identity)) return false;
  return getUserStorageSync<string>(TODAY_RECOMMENDATION_LATEST_IDENTITY_KEY, { authContext }) === identity;
}

export function hasRecommendationInputHardInvalid(authContext: ActiveAuthContext): boolean {
  return Boolean(getUserStorageSync<RecommendationHardInvalidMarker>(
    TODAY_RECOMMENDATION_HARD_INVALID_KEY,
    { authContext },
  ));
}

export function clearRecommendationInputHardInvalid(
  authContext: ActiveAuthContext,
  identity?: string,
): void {
  if (identity && !isRecommendationInputIdentityCurrent(identity, authContext)) return;
  setUserStorageSync(TODAY_RECOMMENDATION_HARD_INVALID_KEY, null, { authContext });
}

export function getCurrentRecommendationInputIdentity(authContext: ActiveAuthContext): string {
  return buildEffectiveRecommendationInput(authContext).identity;
}

function toRecommendationRequest(
  input: EffectiveRecommendationInput,
  trigger: RecommendationMutationSource | string,
): RecommendationV2Request {
  return {
    date: input.date,
    scene: input.scene,
    timeOfDay: input.timeOfDay,
    weatherMode: input.weatherMode,
    trigger,
    requestKind: input.requestKind,
    ...(input.weather ? { weather: input.weather } : {}),
    ...(input.excludedOutfitKeys.length > 0 ? { excludedOutfitKeys: input.excludedOutfitKeys } : {}),
  };
}

function persistLatestIdentity(input: EffectiveRecommendationInput) {
  setUserStorageSync(TODAY_RECOMMENDATION_LATEST_IDENTITY_KEY, input.identity, {
    authContext: input.authContext,
  });
}

function readInputVersion(key: string, authContext: ActiveAuthContext) {
  return Number(getUserStorageSync<number>(key, { authContext })) || 0;
}

function bumpInputVersion(key: string, authContext: ActiveAuthContext) {
  const current = readInputVersion(key, authContext);
  setUserStorageSync(key, Math.max(Date.now(), current + 1), { authContext });
}

function getToday() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
