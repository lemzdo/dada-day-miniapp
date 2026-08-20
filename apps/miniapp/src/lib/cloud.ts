import Taro from '@tarojs/taro';
import type {
  Clothing,
  ClothingCategory,
  ClothingUpdateInput,
  ClothesDraft,
  Outfit,
  OutfitAiComment,
  OutfitAiReviewResponse,
  OutfitBehaviorEventInputV1,
  ProcessUploadImageStatus,
  RecommendRequest,
  RecommendResponse,
  RecommendationProfile,
  TrackOutfitBehaviorEventsResponseV1,
  ResolvedWeatherResponse,
  StyleDictItem,
  UploadBatch,
  UploadImage,
  UserClothingSubcategory,
  UserClothingMaterial,
  WardrobeCapacity,
  RecommendationDetailResponseV2,
  RecommendationHomeLightResponseV2,
  RecommendationV2Response,
} from '@starter-template/types';
import {
  RECOMMENDATION_V2_RUNTIME_VERSION,
  RECOMMENDATION_V2_SCHEMA_VERSION,
} from '@starter-template/types';
import { CLOUD_ENV_ID } from '@/config/cloud';
import { buildAuthRuntimeKey } from '@/lib/userRuntimeScope';
import {
  captureAuthContext,
  isAuthContextCurrent,
  type ActiveAuthContext,
} from '@/stores/userStore';
import {
  createRecommendationAuditId,
  isRecommendationLifecycleLoggingEnabled,
} from './recommendationDiagnostics';

type CloudResult<T> = {
  code: number;
  data: T;
  message: string;
};

export interface SupersededCloudResult {
  status: 'superseded';
}

export type ClothingAttemptResult = Clothing | SupersededCloudResult;

export class CloudFunctionError extends Error {
  code?: number;
  data?: unknown;
  transportDiagnostics?: CloudResponseTransportDiagnostics;
  functionName: string;

  constructor(functionName: string, message: string, code?: number, data?: unknown) {
    super(message);
    this.name = 'CloudFunctionError';
    this.functionName = functionName;
    this.code = code;
    this.data = data;
  }
}

type CloudApi = {
  init: (options: { env: string; traceUser?: boolean }) => void;
  callFunction: <T = unknown>(options: { name: string; data?: Record<string, unknown> }) => Promise<{ result: T }>;
  uploadFile: (options: { cloudPath: string; filePath: string }) => Promise<{ fileID: string }>;
};

type CloudTaro = typeof Taro & { cloud?: CloudApi };
type CloudCacheScope =
  | { type: 'user'; authContext?: ActiveAuthContext | null }
  | { type: 'device'; key?: string }
  | { type: 'none' };
type ResolvedCloudCacheScope =
  | { type: 'user'; prefix: string; authContext: ActiveAuthContext }
  | { type: 'device'; prefix: string }
  | { type: 'none' };

const taroCloud = (Taro as CloudTaro).cloud;
const cloudResponseCache = new Map<string, { expiresAt: number; data: unknown }>();
const GENERATE_OUTFIT_CACHE_NAMESPACE = 'generateOutfit:recommendation-copy-contract-v8';
interface CloudInflightRequest<T = unknown> {
  promise: Promise<T>;
  invalidated: boolean;
}

export interface CloudResponseTransportDiagnostics {
  cacheStatus: 'miss' | 'hit' | 'inflight' | 'bypassed';
  resultDataUnwrapped: boolean;
  resultKeysBeforeUnwrap: string[];
  dataKeysAfterUnwrap: string[];
  immediatelyBeforeCallFunction?: number;
  callFunctionPromiseResolved?: number;
  responseAdaptStart?: number;
  responseAdaptEnd?: number;
  generateOutfitWrapperStart?: number;
  generateOutfitWrapperEnd?: number;
  clientMilestones?: Record<string, number>;
}

export function isSupersededCloudResult(value: unknown): value is SupersededCloudResult {
  return Boolean(value && typeof value === 'object' && (value as { status?: unknown }).status === 'superseded');
}

export function isClothingNotActiveError(error: unknown) {
  return error instanceof CloudFunctionError && error.message === 'CLOTHING_NOT_ACTIVE';
}

interface CachedCloudFunctionOptions {
  cacheNamespace?: string;
  cacheKeyData?: Record<string, unknown>;
}

const cloudInflightRequests = new Map<string, CloudInflightRequest>();
const cloudResponseTransportDiagnostics = new WeakMap<object, CloudResponseTransportDiagnostics>();
let currentUserCloudRuntimeKey: string | null = null;
export const CLIENT_BUILD_VERSION = 'miniapp-xiaoda-copy-v4-20260716';

const CACHE_TTL = {
  wardrobe: 15 * 1000,
  outfit: 30 * 1000,
  weather: 10 * 60 * 1000,
  clothingSubcategories: 5 * 60 * 1000,
  outfitAiReview: 15 * 1000,
};

export const WEATHER_CACHE_KEY = 'd1d:lastWeather';
export const GENERATE_OUTFIT_PERFORMANCE_ARTIFACT_KEY = 'generateOutfit:performance-ledger:v1';
export const GENERATE_OUTFIT_ACCEPTANCE_TRANSPORT_KEY = 'generateOutfit:acceptance-transport:v1';

export function initCloud() {
  if (!taroCloud) {
    console.warn('wx.cloud is not available in current runtime');
    return;
  }

  taroCloud.init({
    env: CLOUD_ENV_ID,
    traceUser: true,
  });
}

async function callCloudFunction<T>(name: string, data: Record<string, unknown> = {}): Promise<T> {
  if (!taroCloud) throw new Error('wx.cloud is not available');

  const immediatelyBeforeCallFunction = Date.now();
  const res = await taroCloud.callFunction<CloudResult<T>>({ name, data });
  const callFunctionPromiseResolved = Date.now();
  const result = res.result;
  if (!result || result.code !== 0) {
    const error = new CloudFunctionError(name, result?.message || `${name} failed`, result?.code, result?.data);
    error.transportDiagnostics = {
      cacheStatus: 'miss',
      resultDataUnwrapped: false,
      resultKeysBeforeUnwrap: getObjectKeys(result),
      dataKeysAfterUnwrap: getObjectKeys(result?.data),
    };
    throw error;
  }

  const responseAdaptStart = Date.now();
  const resultData = result.data;
  setCloudResponseTransportDiagnostics(resultData, {
    cacheStatus: 'miss',
    resultDataUnwrapped: true,
    resultKeysBeforeUnwrap: getObjectKeys(result),
    dataKeysAfterUnwrap: getObjectKeys(resultData),
    immediatelyBeforeCallFunction,
    callFunctionPromiseResolved,
    responseAdaptStart,
    responseAdaptEnd: Date.now(),
  });
  return resultData;
}

async function callCachedCloudFunction<T>(
  name: string,
  data: Record<string, unknown> = {},
  ttlMs = 0,
  scope: CloudCacheScope = { type: 'user' },
  options: CachedCloudFunctionOptions = {},
): Promise<T> {
  const resolvedScope = resolveCloudCacheScope(scope);
  if (resolvedScope.type === 'none') {
    return callCloudFunction<T>(name, data).then((result) => {
      setCloudResponseCacheStatus(result, 'bypassed');
      return result;
    });
  }

  const key = getCloudCacheKey(
    options.cacheNamespace || name,
    options.cacheKeyData || data,
    resolvedScope,
  );
  const now = Date.now();
  const cached = cloudResponseCache.get(key);
  if (cached && cached.expiresAt > now) {
    const result = cached.data as T;
    setCloudResponseCacheStatus(result, 'hit');
    return result;
  }

  const inflight = cloudInflightRequests.get(key) as CloudInflightRequest<T> | undefined;
  if (inflight) {
    return inflight.promise.then((result) => {
      setCloudResponseCacheStatus(result, 'inflight');
      return result;
    });
  }

  const requestRecord: CloudInflightRequest<T> = {
    invalidated: false,
    promise: Promise.resolve(undefined as T),
  };
  const request = callCloudFunction<T>(name, data)
    .then((result) => {
      if (!requestRecord.invalidated && ttlMs > 0 && canWriteCloudCache(resolvedScope)) {
        cloudResponseCache.set(key, {
          expiresAt: Date.now() + ttlMs,
          data: result,
        });
      }
      return result;
    })
    .finally(() => {
      if (cloudInflightRequests.get(key) === requestRecord) {
        cloudInflightRequests.delete(key);
      }
    });

  requestRecord.promise = request;
  cloudInflightRequests.set(key, requestRecord);
  return request;
}

export function getCloudResponseTransportDiagnostics(value: unknown): CloudResponseTransportDiagnostics | null {
  if (!isObjectReference(value)) return null;
  const diagnostics = cloudResponseTransportDiagnostics.get(value);
  if (!diagnostics) return null;
  return {
    ...diagnostics,
    resultKeysBeforeUnwrap: [...diagnostics.resultKeysBeforeUnwrap],
    dataKeysAfterUnwrap: [...diagnostics.dataKeysAfterUnwrap],
  };
}

function setCloudResponseTransportDiagnostics(value: unknown, diagnostics: CloudResponseTransportDiagnostics) {
  if (!isObjectReference(value)) return;
  cloudResponseTransportDiagnostics.set(value, diagnostics);
}

function setCloudResponseCacheStatus(
  value: unknown,
  cacheStatus: CloudResponseTransportDiagnostics['cacheStatus'],
) {
  if (!isObjectReference(value)) return;
  const diagnostics = cloudResponseTransportDiagnostics.get(value);
  if (!diagnostics) return;
  cloudResponseTransportDiagnostics.set(value, { ...diagnostics, cacheStatus });
}

function getObjectKeys(value: unknown): string[] {
  return isObjectReference(value) ? Object.keys(value) : [];
}

function isObjectReference(value: unknown): value is object {
  return Boolean(value) && typeof value === 'object';
}

function invalidateCachedCloudFunctionNamespace(
  cacheNamespace: string,
  scope: CloudCacheScope = { type: 'user' },
) {
  const resolvedScope = resolveCloudCacheScope(scope);
  if (resolvedScope.type === 'none') return;

  const namespacePrefix = `${resolvedScope.prefix}${cacheNamespace}:`;
  for (const key of cloudResponseCache.keys()) {
    if (key.startsWith(namespacePrefix)) cloudResponseCache.delete(key);
  }
  for (const key of cloudInflightRequests.keys()) {
    if (!key.startsWith(namespacePrefix)) continue;
    const inflight = cloudInflightRequests.get(key);
    if (inflight) inflight.invalidated = true;
    cloudInflightRequests.delete(key);
  }
}

function clearCloudCache(prefixes: string[], scopeTypes: Array<'user' | 'device'> = ['user']) {
  syncUserCloudRuntimeSession(captureAuthContext());
  const functionNames = prefixes.map((prefix) => prefix.replace(/:$/, ''));
  for (const key of cloudResponseCache.keys()) {
    if (matchesCloudRuntimeCacheKey(key, functionNames, scopeTypes)) {
      cloudResponseCache.delete(key);
    }
  }

  for (const key of cloudInflightRequests.keys()) {
    if (matchesCloudRuntimeCacheKey(key, functionNames, scopeTypes)) {
      const inflight = cloudInflightRequests.get(key);
      if (inflight) inflight.invalidated = true;
      cloudInflightRequests.delete(key);
    }
  }
}

export function clearCloudRecommendationCache() {
  clearCloudCache(['generateOutfit:']);
}

export function clearCurrentUserCloudRuntimeCache() {
  const authContext = captureAuthContext();
  if (!authContext) return;
  const runtimeKey = buildAuthRuntimeKey(authContext);
  clearCloudRuntimeEntries((key) => key.startsWith(`user:${runtimeKey}:`));
}

export function resetUserCloudRuntimeSession() {
  currentUserCloudRuntimeKey = null;
  clearCloudRuntimeEntries((key) => key.startsWith('user:'));
}

export function writeLocalWeatherCache(value: ResolvedWeatherResponse) {
  if (value.source === 'fallback' || !value.weather.weather) return;

  const cacheValue: ResolvedWeatherResponse = {
    location: value.location,
    weather: value.weather,
    source: 'cache',
    cacheHit: true,
    fetchedAt: value.fetchedAt,
    observedAt: value.observedAt ?? value.weather.reportTime,
    updatedAt: value.updatedAt,
  };
  Taro.setStorageSync(WEATHER_CACHE_KEY, cacheValue);
}

export function clearLocalWeatherCache() {
  Taro.removeStorageSync(WEATHER_CACHE_KEY);
}

function getCloudCacheKey(name: string, data: Record<string, unknown>, scope: Exclude<ResolvedCloudCacheScope, { type: 'none' }>) {
  return `${scope.prefix}${name}:${stableStringify(data)}`;
}

function resolveCloudCacheScope(scope: CloudCacheScope): ResolvedCloudCacheScope {
  if (scope.type === 'none') return { type: 'none' };

  if (scope.type === 'device') {
    return {
      type: 'device',
      prefix: `device:${encodeCloudCacheScopePart(scope.key || 'default')}:`,
    };
  }

  const authContext = scope.authContext === undefined ? captureAuthContext() : scope.authContext;
  if (!authContext || !isAuthContextCurrent(authContext)) return { type: 'none' };

  const runtimeKey = buildAuthRuntimeKey(authContext);
  syncUserCloudRuntimeSession(authContext);

  return {
    type: 'user',
    prefix: `user:${runtimeKey}:`,
    authContext,
  };
}

function canWriteCloudCache(scope: ResolvedCloudCacheScope) {
  if (scope.type === 'device') return true;
  if (scope.type === 'user') return isAuthContextCurrent(scope.authContext);
  return false;
}

function syncUserCloudRuntimeSession(authContext: ActiveAuthContext | null) {
  const nextRuntimeKey = authContext && isAuthContextCurrent(authContext)
    ? buildAuthRuntimeKey(authContext)
    : null;

  if (nextRuntimeKey === currentUserCloudRuntimeKey) return;
  currentUserCloudRuntimeKey = nextRuntimeKey;
  clearCloudRuntimeEntries((key) => key.startsWith('user:') && !key.startsWith(`user:${nextRuntimeKey}:`));
}

function clearCloudRuntimeEntries(predicate: (key: string) => boolean) {
  for (const key of cloudResponseCache.keys()) {
    if (predicate(key)) cloudResponseCache.delete(key);
  }
  for (const key of cloudInflightRequests.keys()) {
    if (predicate(key)) {
      const inflight = cloudInflightRequests.get(key);
      if (inflight) inflight.invalidated = true;
      cloudInflightRequests.delete(key);
    }
  }
}

function matchesCloudRuntimeCacheKey(
  key: string,
  functionNames: string[],
  scopeTypes: Array<'user' | 'device'>,
) {
  if (!scopeTypes.some((scopeType) => key.startsWith(`${scopeType}:`))) return false;
  return functionNames.some((name) => key.includes(`:${name}:`));
}

function encodeCloudCacheScopePart(value: string) {
  return encodeURIComponent(value);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export interface CloudUserProfile {
  id: string;
  openid: string;
  nickname: string;
  avatarUrl?: string;
  avatarType?: 'wechat' | 'preset' | 'default';
  profileCompleted?: boolean;
  capacityTotal: number;
  capacityUsed: number;
  membershipTier: string;
  capacity?: WardrobeCapacity;
  styleProfile?: Record<string, unknown>;
  recommendationProfile?: RecommendationProfile;
  updatedAt?: string;
}

export async function loginWithCloud() {
  return callCloudFunction<CloudUserProfile>('login');
}

export async function getWardrobe(params: GetWardrobeParams = {}, options: { force?: boolean } = {}) {
  type WardrobeResponse = {
    list: Clothing[];
    pagination: { total: number; page: number; pageSize: number; totalPages: number };
    capacity: WardrobeCapacity & { total?: number };
  };
  return options.force
    ? callCloudFunction<WardrobeResponse>('getWardrobe', params as Record<string, unknown>)
    : callCachedCloudFunction<WardrobeResponse>('getWardrobe', params as Record<string, unknown>, CACHE_TTL.wardrobe);
}

export async function getClothingById(id: string, options: { force?: boolean } = {}) {
  type ClothingDetailResponse = {
    list: Clothing[];
    pagination: { total: number; page: number; pageSize: number; totalPages: number };
    capacity: WardrobeCapacity & { total?: number };
  };
  const params = { id, detail: true, includeTotal: false, includeCapacity: false };
  const data = options.force
    ? await callCloudFunction<ClothingDetailResponse>('getWardrobe', params)
    : await callCachedCloudFunction<ClothingDetailResponse>('getWardrobe', params, CACHE_TTL.wardrobe);
  const item = data.list[0];
  if (!item) throw new Error('Clothing not found');
  return item;
}

export async function segmentCloudClothing(id: string) {
  const item = await callCloudFunction<ClothingAttemptResult>('segmentClothImage', { clothingId: id });
  if (!isSupersededCloudResult(item)) clearCloudCache(['getWardrobe:', 'generateOutfit:']);
  return item;
}

export async function recognizeClothAttributes(id: string) {
  const item = await callCloudFunction<ClothingAttemptResult>('recognizeClothAttributes', { clothId: id });
  if (!isSupersededCloudResult(item)) clearCloudCache(['getWardrobe:', 'generateOutfit:']);
  return item;
}

export async function createUploadBatch(totalImages: number) {
  return callCloudFunction<UploadBatch>('createUploadBatch', { totalImages });
}

export async function getUploadBatchDetail(batchId: string) {
  return callCloudFunction<{
    batch: UploadBatch;
    images: UploadImage[];
    drafts: ClothesDraft[];
  }>('createUploadBatch', { action: 'detail', batchId });
}

export interface RecoverableUploadBatch extends UploadBatch {
  successImages: number;
  failedImages: number;
  draftCount: number;
  recognizedCount: number;
}

export async function getRecoverableUploadBatches(limit = 1) {
  return callCloudFunction<{ list: RecoverableUploadBatch[] }>('createUploadBatch', {
    action: 'recoverable',
    limit,
  });
}

export async function createUploadImage(batchId: string, fileID: string) {
  return callCloudFunction<UploadImage>('createUploadImage', {
    batchId,
    fileID,
    originalImageUrl: fileID,
  });
}

export async function uploadBatchSourceImage(filePath: string) {
  if (!taroCloud) throw new Error('wx.cloud is not available');
  const cloudPath = `wardrobe_uploads/batches/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
  const uploadRes = await taroCloud.uploadFile({ cloudPath, filePath });
  return uploadRes.fileID;
}

export async function uploadFeedbackImage(filePath: string) {
  if (!taroCloud) throw new Error('wx.cloud is not available');
  const openid = String(Taro.getStorageSync('openid') || 'anonymous').replace(/[^a-zA-Z0-9_-]/g, '');
  const cloudPath = `user_feedback/${openid || 'anonymous'}/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
  const uploadRes = await taroCloud.uploadFile({ cloudPath, filePath });
  return uploadRes.fileID;
}

export async function processUploadImage(imageId: string) {
  return callCloudFunction<{
    success?: boolean;
    status: ProcessUploadImageStatus;
    imageId: string;
    drafts?: ClothesDraft[];
    reused?: boolean;
    reason?: string;
    emptyReason?: string;
    errorMessage?: string;
    warnings?: string[];
  }>('processUploadImage', {
    imageId,
  });
}

export async function segmentClothesDraft(draftId: string) {
  return callCloudFunction<ClothesDraft>('segmentClothImage', { draftId });
}

export async function confirmClothesDrafts(
  batchId: string,
  drafts: Array<Partial<ClothesDraft> & { id: string }>,
  selectedIds = drafts.map((draft) => draft.id),
) {
  const result = await callCloudFunction<{
    list: Clothing[];
    count: number;
    skippedDuplicateCount?: number;
    actualCreatedCount?: number;
    failedCount?: number;
    capacity?: WardrobeCapacity;
  }>('confirmClothesDrafts', {
    batchId,
    drafts,
    selectedIds,
  });
  clearCloudCache(['getWardrobe:', 'generateOutfit:', 'login:']);
  return result;
}

export async function discardClothesDraft(draftId: string) {
  return callCloudFunction<{
    id: string;
    draftDiscarded: boolean;
    batchTerminal: boolean;
    batchStatus?: 'discarded';
  }>('discardClothesDraft', { draftId });
}

export async function discardUploadBatch(batchId: string) {
  return callCloudFunction<{ id: string; status: 'discarded' }>('discardUploadBatch', { batchId });
}

export async function updateCloudClothing(id: string, data: ClothingUpdateInput) {
  const item = await callCloudFunction<Clothing>('updateClothes', { id, data });
  clearCloudCache(['getWardrobe:', 'generateOutfit:', 'login:']);
  return item;
}

export interface DeleteCloudClothingResult {
  id: string;
  deletedAt?: string;
  referenceRepairStatus: 'pending' | 'processing' | 'complete' | 'failed';
  referenceRepairPending: boolean;
  referenceRepairFoundReferences?: boolean;
}

export async function deleteCloudClothing(id: string) {
  const result = await callCloudFunction<DeleteCloudClothingResult>('deleteClothes', { id });
  clearCloudCache(['getWardrobe:', 'generateOutfit:', 'login:']);
  return result;
}

export interface BatchDeleteCloudClothingResult {
  successIds: string[];
  failedIds: string[];
  results?: DeleteCloudClothingResult[];
  total: number;
  successCount: number;
  failedCount: number;
  referenceRepairPending?: boolean;
}

export async function deleteCloudClothingBatch(ids: string[]) {
  const result = await callCloudFunction<BatchDeleteCloudClothingResult>('deleteClothes', { ids });
  clearCloudCache(['getWardrobe:', 'generateOutfit:']);
  return result;
}

export interface DeleteClothingImpact {
  id: string;
  affectedFavoriteCount: number;
  affectedHistoryCount: number;
  affectedOutfitCount: number;
}

export async function inspectCloudClothingDelete(id: string) {
  return callCloudFunction<DeleteClothingImpact>('deleteClothes', { id, action: 'inspect' });
}

export interface UpdateCloudUserProfileInput {
  recommendationProfile?: RecommendationProfile;
  nickname?: string;
  avatarUrl?: string;
  avatarType?: 'wechat' | 'preset' | 'default';
  profileCompleted?: boolean;
}

export async function updateCloudUserProfile(input: RecommendationProfile | UpdateCloudUserProfileInput) {
  const data = isRecommendationProfile(input) ? { recommendationProfile: input } : input;
  const result = await callCloudFunction<{
    styleProfile: Record<string, unknown>;
    recommendationProfile?: RecommendationProfile;
    nickname?: string;
    avatarUrl?: string;
    avatarType?: 'wechat' | 'preset' | 'default';
    profileCompleted?: boolean;
    updatedAt?: string;
  }>('updateUserProfile', data as Record<string, unknown>);
  clearCloudCache(hasRecommendationProfileMutation(data) ? ['login:', 'generateOutfit:'] : ['login:']);
  return result;
}

function isRecommendationProfile(input: RecommendationProfile | UpdateCloudUserProfileInput): input is RecommendationProfile {
  return 'genderPreference' in input
    || 'styleTags' in input
    || 'fitPreference' in input
    || 'colorPreference' in input
    || 'avoidTags' in input
    || 'temperatureSensitivity' in input;
}

function hasRecommendationProfileMutation(input: UpdateCloudUserProfileInput) {
  return Object.prototype.hasOwnProperty.call(input, 'recommendationProfile');
}

export async function generateCloudOutfit(params: RecommendRequest = {}) {
  const hasExclusions =
    (Array.isArray(params.excludeClothingIdSets) && params.excludeClothingIdSets.length > 0) ||
    (Array.isArray(params.excludedOutfitKeys) && params.excludedOutfitKeys.length > 0);
  // A diagnostic response is deliberately never served from or written to the
  // recommendation cache: the returned ledger must describe this invocation.
  let ttl = hasExclusions ? 0 : CACHE_TTL.outfit;
  if (params.diagnostics === true || params.performanceDiagnostics === true) ttl = 0;
  const clientMilestones = params.clientMilestones;
  const requestPayload: Record<string, unknown> = {
    ...params,
    auditId: params.auditId || createRecommendationAuditId('cloud'),
  };
  delete requestPayload.clientMilestones;
  if (isRecommendationDiagnosticEnvironment()
    && !requestPayload.debugRecommendationAudit
    && requestPayload.performanceDiagnostics !== true) {
    requestPayload.debugRecommendationAudit = true;
  }
  const {
    auditId: _auditId,
    trigger: _trigger,
    diagnostics: _diagnostics,
    ...cacheKeyData
  } = requestPayload;
  const generateOutfitWrapperStart = Date.now();
  if (clientMilestones) clientMilestones.cloudRequestConstructedAt = generateOutfitWrapperStart;
  const result = await callCachedCloudFunction<RecommendResponse>(
    'generateOutfit',
    requestPayload,
    ttl,
    { type: 'user' },
    {
      cacheNamespace: GENERATE_OUTFIT_CACHE_NAMESPACE,
      cacheKeyData,
    },
  );
  const transport = getCloudResponseTransportDiagnostics(result);
  if (transport) {
    setCloudResponseTransportDiagnostics(result, {
      ...transport,
      generateOutfitWrapperStart,
      generateOutfitWrapperEnd: Date.now(),
      ...(clientMilestones ? {
        clientMilestones: {
          ...clientMilestones,
          generateOutfitWrapperStart,
        },
      } : {}),
    });
  }
  if (typeof params.acceptanceRunId === 'string' && typeof params.captureId === 'string') {
    const acceptanceTransport = getCloudResponseTransportDiagnostics(result);
    try {
      Taro.setStorageSync(GENERATE_OUTFIT_ACCEPTANCE_TRANSPORT_KEY, {
        acceptanceRunId: params.acceptanceRunId,
        captureId: params.captureId,
        auditId: requestPayload.auditId,
        ...(acceptanceTransport ?? {}),
        clientTotalMs: acceptanceTransport?.immediatelyBeforeCallFunction !== undefined
          && acceptanceTransport.callFunctionPromiseResolved !== undefined
          ? acceptanceTransport.callFunctionPromiseResolved - acceptanceTransport.immediatelyBeforeCallFunction
          : undefined,
      });
    } catch (error) {
      console.warn('[generateOutfit] acceptance transport persistence skipped:', error);
    }
  }
  if (params.diagnostics === true || params.performanceDiagnostics === true) {
    const performance = result?.diagnostics?.performance;
    if (performance && typeof performance === 'object') {
      try {
        Taro.setStorageSync(GENERATE_OUTFIT_PERFORMANCE_ARTIFACT_KEY, performance);
      } catch (error) {
        console.warn('[generateOutfit] performance artifact persistence skipped:', error);
      }
    }
  }
  return result;
}

export interface RecommendationV2Request {
  scene?: string;
  date?: string;
  timeOfDay?: string;
  weather?: unknown;
  weatherMode?: string;
  v2BatchId?: string;
  performanceDiagnostics?: boolean;
  acceptanceRunId?: string;
  captureId?: string;
}

function assertHomeLightV2(value: unknown): RecommendationHomeLightResponseV2 {
  if (!value || typeof value !== 'object') throw new Error('V2 response is not an object');
  const response = value as Partial<RecommendationHomeLightResponseV2>;
  if (response.runtimeVersion !== RECOMMENDATION_V2_RUNTIME_VERSION
    || response.schemaVersion !== RECOMMENDATION_V2_SCHEMA_VERSION
    || !response.batch || !response.light
    || response.batch.runtimeVersion !== RECOMMENDATION_V2_RUNTIME_VERSION
    || response.light.runtimeVersion !== RECOMMENDATION_V2_RUNTIME_VERSION
    || response.batch.cardCount !== 8
    || !Array.isArray(response.batch.order)
    || response.batch.order.length !== 8
    || !Array.isArray(response.light.cards)
    || response.light.cards.length !== 8) {
    throw new Error('V2 response contract invalid');
  }
  const order = response.batch.order;
  response.light.cards.forEach((card, index) => {
    if (card.position !== index || card.outfitKey !== order[index]) throw new Error('V2 response order invalid');
    const forbidden = ['scores', 'eligibility', 'snapshotItems', 'itemsSnapshot', 'copyContract', 'evidence', 'debug'];
    if (forbidden.some((key) => Object.prototype.hasOwnProperty.call(card as object, key))) throw new Error('V2 response contains forbidden field');
  });
  return response as RecommendationHomeLightResponseV2;
}

export async function generateCloudOutfitV2(params: RecommendationV2Request = {}) {
  const result = await callCloudFunction<RecommendationV2Response>('generateOutfit', {
    ...params,
    runtimeVersion: RECOMMENDATION_V2_RUNTIME_VERSION,
  });
  return assertHomeLightV2(result);
}

export async function getCloudOutfitDetailV2(input: { batchId: string; outfitKey: string; referenceId?: string }) {
  const result = await callCloudFunction<RecommendationV2Response>('generateOutfit', {
    action: 'detailV2',
    runtimeVersion: RECOMMENDATION_V2_RUNTIME_VERSION,
    ...input,
  });
  if (!result || result.runtimeVersion !== RECOMMENDATION_V2_RUNTIME_VERSION
    || result.schemaVersion !== RECOMMENDATION_V2_SCHEMA_VERSION
    || !('detailIdentityReady' in result) || result.detailIdentityReady !== true) {
    throw new Error('V2 detail response contract invalid');
  }
  return result as RecommendationDetailResponseV2;
}

export async function updateCloudOutfitFavoriteV2(input: { batchId: string; outfitKey: string; isFavorite: boolean }) {
  return callCloudFunction<{ batchId: string; outfitKey: string; isFavorite: boolean }>('generateOutfit', {
    action: 'favoriteV2',
    runtimeVersion: RECOMMENDATION_V2_RUNTIME_VERSION,
    ...input,
  });
}

export async function updateCloudOutfitWearV2(input: { batchId: string; outfitKey: string; date?: string }) {
  return callCloudFunction<{ batchId: string; outfitKey: string; isWornToday: boolean }>('generateOutfit', {
    action: 'wearV2',
    runtimeVersion: RECOMMENDATION_V2_RUNTIME_VERSION,
    ...input,
  });
}

export async function materializeCloudRecommendationCopyV2(recommendationBatchId: string) {
  return callCloudFunction<{
    version: string;
    status: 'ready' | 'ready_cache_hit' | 'partially_failed_open' | 'failed_open' | 'not_found';
    recommendationBatchId: string;
    recordCount: number;
    materializedCount: number;
    cacheHitCount?: number;
    mismatchCount?: number;
    failureCode?: string;
    latencyMs?: number;
    ttftMs?: number;
  }>('generateOutfit', {
    action: 'materializeRecommendationCopyV2',
    recommendationBatchId,
  });
}

export async function probeGenerateOutfitTransport(
  kind: 'small' | 'payload',
  payloadBytes?: number,
) {
  return callCloudFunction<Record<string, unknown>>('generateOutfit', {
    action: kind === 'payload' ? 'transport_probe_payload' : 'transport_probe_small',
    diagnostic: true,
    ...(kind === 'payload' && payloadBytes ? { payloadBytes } : {}),
  });
}

export function isRecommendationDiagnosticEnvironment(): boolean {
  try {
    const taroWithAccountInfo = Taro as typeof Taro & {
      getAccountInfoSync?: () => { miniProgram?: { envVersion?: string } };
    };
    const raw = taroWithAccountInfo.getAccountInfoSync?.().miniProgram?.envVersion;
    const envVersion: string = typeof raw === 'string' ? raw : '';
    return isRecommendationLifecycleLoggingEnabled(envVersion);
  } catch {
    return false;
  }
}

export async function trackCloudOutfitBehaviorEvents(events: OutfitBehaviorEventInputV1[]) {
  return callCloudFunction<TrackOutfitBehaviorEventsResponseV1>('trackOutfitBehaviorEvents', { events });
}

export async function getCloudOutfit(id: string) {
  return callCloudFunction<Outfit>('generateOutfit', { action: 'detail', id });
}

export async function setCloudOutfitFavorite(id: string, isFavorite: boolean, outfit?: Outfit) {
  const outfitResult = isFavorite
    ? await saveFavoriteOutfit(outfit ?? ({ id } as Outfit))
    : await removeFavoriteOutfit(id).then(() => ({
        ...(outfit ?? ({} as Outfit)),
        id,
        isFavorite: false,
      }));
  clearCloudCache(['generateOutfit:']);
  return outfitResult;
}

export async function confirmCloudWear(id: string, outfit?: Outfit) {
  const outfitResult = await addOutfitHistory(outfit ?? ({ id } as Outfit), {
    source: outfit?.outfitKind === 'favorite' || outfit?.isFavorite ? 'favorite' : 'recommendation',
    sourceFavoriteOutfitId: outfit?.outfitKind === 'favorite' || outfit?.isFavorite ? id : undefined,
  });
  clearCloudCache(['generateOutfit:', 'getWardrobe:']);
  return outfitResult;
}

export async function saveFavoriteOutfit(outfit: Outfit, aiComment: OutfitAiComment | undefined = outfit.aiComment) {
  const outfitResult = await callCloudFunction<Outfit>('generateOutfit', {
    action: 'saveFavoriteOutfit',
    id: outfit.id,
    outfit,
    aiComment,
  });
  clearCloudCache(['generateOutfit:', 'favoriteOutfits:', 'outfitHistory:']);
  return outfitResult;
}

export async function removeFavoriteOutfit(favoriteOutfitId: string, outfitKey?: string) {
  const result = await callCloudFunction<{ success: boolean; id?: string; outfitKey?: string; alreadyRemoved?: boolean }>('generateOutfit', {
    action: 'removeFavoriteOutfit',
    favoriteOutfitId,
    outfitKey,
  });
  clearCloudCache(['generateOutfit:', 'favoriteOutfits:']);
  return result;
}

export interface RenameCloudOutfitInput {
  outfitId?: string;
  outfitKey?: string;
  outfit?: Outfit;
  userTitle: string;
}

export async function renameCloudOutfit(input: RenameCloudOutfitInput) {
  const outfitResult = await callCloudFunction<Outfit>('generateOutfit', {
    action: 'renameOutfit',
    outfitId: input.outfitId,
    outfitKey: input.outfitKey,
    outfit: input.outfit,
    userTitle: input.userTitle,
  });
  clearCloudCache(['generateOutfit:', 'favoriteOutfits:', 'outfitHistory:']);
  return outfitResult;
}

export async function listFavoriteOutfits(params: { page?: number; pageSize?: number } = {}) {
  return callCloudFunction<{
    list: Outfit[];
    hasMore: boolean;
    pagination: { total: number; page: number; pageSize: number; totalPages: number };
  }>('generateOutfit', { action: 'listFavoriteOutfits', ...params });
}

export async function getFavoriteOutfitDetail(id: string) {
  return callCloudFunction<Outfit>('generateOutfit', { action: 'detail', source: 'favorite', id });
}

export async function addOutfitHistory(
  outfit: Outfit,
  options: {
    source?: 'recommendation' | 'favorite';
    sourceFavoriteOutfitId?: string;
    aiComment?: OutfitAiComment;
  } = {},
) {
  const outfitResult = await callCloudFunction<Outfit>('generateOutfit', {
    action: 'addOutfitHistory',
    id: outfit.id,
    outfit,
    source: options.source ?? (outfit.outfitKind === 'favorite' || outfit.isFavorite ? 'favorite' : 'recommendation'),
    sourceFavoriteOutfitId: options.sourceFavoriteOutfitId,
    aiComment: options.aiComment ?? outfit.aiComment,
  });
  clearCloudCache(['generateOutfit:', 'outfitHistory:']);
  return outfitResult;
}

export async function listOutfitHistory(params: { page?: number; pageSize?: number } = {}) {
  return callCloudFunction<{
    list: Outfit[];
    page: number;
    pageSize: number;
    hasMore: boolean;
    pagination: { total: number; page: number; pageSize: number; totalPages: number };
  }>('generateOutfit', { action: 'listOutfitHistory', ...params });
}

export async function getOutfitHistoryDetail(id: string) {
  return callCloudFunction<Outfit>('generateOutfit', { action: 'detail', source: 'history', id });
}

function getOutfitAiCommentPayload(outfit: Outfit, forceRegenerate?: boolean) {
  return {
    outfitId: outfit.outfitId || outfit.id,
    detailId: outfit.id,
    detailSource: outfit.outfitKind,
    outfitKey: outfit.outfitKey,
    outfit,
    weather: outfit.weatherSnapshot,
    scene: outfit.scene,
    items: outfit.items,
    scores: outfit.scores,
    reason: outfit.reasoning || outfit.reason || '',
    ...(forceRegenerate !== undefined ? { forceRegenerate } : {}),
  };
}

function getOutfitAiCommentCacheNamespace(outfit: Outfit) {
  const outfitKey = outfit.outfitKey || [...outfit.clothingIds].sort().join('|');
  const normalizedScene = String(outfit.scene || '').trim();
  const scene = {
    home: '居家',
    work: '上班',
    date: '约会',
    sport: '运动',
    sports: '运动',
  }[normalizedScene.toLowerCase()] || normalizedScene;
  return `outfitAiReview:${encodeCloudCacheScopePart(outfitKey)}:${encodeCloudCacheScopePart(scene)}`;
}

function getOutfitAiCommentCacheVariant(outfit: Outfit) {
  return {
    detailId: outfit.id,
    detailSource: outfit.outfitKind || '',
    updatedAt: outfit.updatedAt || '',
  };
}

export async function getCloudOutfitAiComment(outfit: Outfit) {
  return callCachedCloudFunction<OutfitAiReviewResponse>(
    'generateOutfit',
    {
      action: 'getAiComment',
      ...getOutfitAiCommentPayload(outfit),
    },
    CACHE_TTL.outfitAiReview,
    { type: 'user' },
    {
      cacheNamespace: getOutfitAiCommentCacheNamespace(outfit),
      cacheKeyData: getOutfitAiCommentCacheVariant(outfit),
    },
  );
}

export async function generateCloudOutfitComment(outfit: Outfit, options: { forceRegenerate?: boolean } = {}) {
  const result = await callCloudFunction<OutfitAiReviewResponse>('generateOutfit', {
    action: 'aiComment',
    ...getOutfitAiCommentPayload(outfit, Boolean(options.forceRegenerate)),
  });
  if (result.saved) {
    invalidateCachedCloudFunctionNamespace(getOutfitAiCommentCacheNamespace(outfit));
  }
  return result;
}

export interface SubmitFeedbackInput {
  type: string;
  content: string;
  images: string[];
  contact?: string;
  page?: string;
  systemInfo?: Record<string, unknown>;
}

export async function submitFeedback(input: SubmitFeedbackInput) {
  return callCloudFunction<{ id: string; status: 'new' }>('submitFeedback', {
    ...input,
    contact: typeof input.contact === 'string' ? input.contact.trim() : '',
  } as unknown as Record<string, unknown>);
}

export async function getCloudOutfitList(params: { isFavorite?: boolean; wornOnly?: boolean; page?: number; pageSize?: number } = {}) {
  if (params.isFavorite) return listFavoriteOutfits(params);
  if (params.wornOnly) return listOutfitHistory(params);
  return listFavoriteOutfits(params);
}

export async function getCloudWeather(
  location: { latitude: number; longitude: number },
  options: { forceRefresh?: boolean } = {},
) {
  const payload = options.forceRefresh ? { ...location, forceRefresh: true } : location;
  if (options.forceRefresh) {
    clearCloudCache(['getWeather:'], ['device']);
    clearLocalWeatherCache();
  }
  const data = options.forceRefresh
    ? await callCloudFunction<ResolvedWeatherResponse>('getWeather', payload)
    : await callCachedCloudFunction<ResolvedWeatherResponse>('getWeather', payload, CACHE_TTL.weather, {
        type: 'device',
        key: 'weather',
      });

  writeLocalWeatherCache(data);
  if (options.forceRefresh) {
    clearCloudCache(['getWeather:'], ['device']);
    clearCloudRecommendationCache();
  }
  return data;
}

export function getLocalStyles(): StyleDictItem[] {
  return [
    { key: '日常休闲', label: '日常休闲', category: 'daily' },
    { key: '通勤简约', label: '通勤简约', category: 'daily' },
    { key: '韩系', label: '韩系', category: 'style' },
    { key: '日系', label: '日系', category: 'style' },
    { key: '甜酷', label: '甜酷', category: 'style' },
    { key: '工装', label: '工装', category: 'style' },
    { key: '运动', label: '运动', category: 'scene' },
    { key: '美式复古', label: '美式复古', category: 'style' },
    { key: 'Clean Fit', label: 'Clean Fit', category: 'style' },
    { key: '极简', label: '极简', category: 'style' },
  ];
}
export function getFallbackResolvedWeather(displayName = '当前位置'): ResolvedWeatherResponse {
  const now = new Date().toISOString();
  return {
    location: {
      province: '',
      city: displayName,
      district: '',
      adcode: '',
      displayName,
    },
    weather: {
      weather: '',
      temperature: 0,
    },
    source: 'fallback',
    cacheHit: false,
    fetchedAt: now,
    updatedAt: now,
  };
}

export interface GetUserClothingSubcategoriesParams {
  parentCategory?: ClothingCategory;
}

export async function getUserClothingSubcategories(params: GetUserClothingSubcategoriesParams = {}) {
  return callCachedCloudFunction<UserClothingSubcategory[]>(
    'getUserClothingSubcategories',
    params as Record<string, unknown>,
    CACHE_TTL.clothingSubcategories,
  );
}

export interface CreateUserClothingSubcategoryParams {
  name: string;
  parentCategory: ClothingCategory;
}

export interface CreateUserClothingSubcategoryResult {
  id: string;
  userId: string;
  name: string;
  normalizedName: string;
  parentCategory: ClothingCategory;
  status: 'active';
  reused?: boolean;
  createdAt: string;
  updatedAt: string;
}

export async function createUserClothingSubcategory(params: CreateUserClothingSubcategoryParams) {
  const result = await callCloudFunction<CreateUserClothingSubcategoryResult>(
    'createUserClothingSubcategory',
    params as unknown as Record<string, unknown>,
  );
  clearCloudCache(['getUserClothingSubcategories:']);
  return result;
}

export function clearUserClothingSubcategoriesCache() {
  clearCloudCache(['getUserClothingSubcategories:']);
}

export async function getUserClothingMaterials() {
  return callCachedCloudFunction<UserClothingMaterial[]>(
    'getUserClothingMaterials',
    {},
    CACHE_TTL.clothingSubcategories,
  );
}

export interface CreateUserClothingMaterialParams {
  name: string;
}

export interface CreateUserClothingMaterialResult {
  id: string;
  userId: string;
  name: string;
  normalizedName: string;
  status: 'active';
  reused?: boolean;
  createdAt: string;
  updatedAt: string;
}

export async function createUserClothingMaterial(params: CreateUserClothingMaterialParams) {
  const result = await callCloudFunction<CreateUserClothingMaterialResult>(
    'createUserClothingMaterial',
    params as unknown as Record<string, unknown>,
  );
  clearCloudCache(['getUserClothingMaterials']);
  return result;
}

export interface ArchiveUserClothingMaterialResult {
  ok: boolean;
  id: string;
}

export async function archiveUserClothingMaterial(id: string) {
  const result = await callCloudFunction<ArchiveUserClothingMaterialResult>('archiveUserClothingMaterial', { id });
  clearCloudCache(['getUserClothingMaterials']);
  return result;
}

export function clearUserClothingMaterialsCache() {
  clearCloudCache(['getUserClothingMaterials']);
}

export interface GetWardrobeParams {
  id?: string;
  detail?: boolean;
  includeTotal?: boolean;
  includeCapacity?: boolean;
  capacityOnly?: boolean;
  category?: ClothingCategory | 'all';
  subcategory?: string | 'all';
  subcategoryId?: string;
  status?: 'active' | 'archived' | 'deleted';
  page?: number;
  pageSize?: number;
}
