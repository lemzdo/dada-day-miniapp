import Taro from '@tarojs/taro';
import type {
  Clothing,
  ClothingCategory,
  ClothingUpdateInput,
  ClothesDraft,
  CurrentWeather,
  Outfit,
  OutfitAiComment,
  RecommendRequest,
  RecommendResponse,
  RecommendationProfile,
  ResolvedWeatherResponse,
  StyleDictItem,
  UploadBatch,
  UploadImage,
  UserClothingSubcategory,
  UserClothingMaterial,
} from '@starter-template/types';
import { CLOUD_ENV_ID } from '@/config/cloud';

type CloudResult<T> = {
  code: number;
  data: T;
  message: string;
};

export class CloudFunctionError extends Error {
  code?: number;
  data?: unknown;
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

const taroCloud = (Taro as CloudTaro).cloud;
const cloudResponseCache = new Map<string, { expiresAt: number; data: unknown }>();
const cloudInflightRequests = new Map<string, Promise<unknown>>();

const CACHE_TTL = {
  login: 60 * 1000,
  wardrobe: 15 * 1000,
  outfit: 30 * 1000,
  weather: 10 * 60 * 1000,
  clothingSubcategories: 5 * 60 * 1000,
};

export const WEATHER_CACHE_KEY = 'd1d:lastWeather';

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

  const res = await taroCloud.callFunction<CloudResult<T>>({ name, data });
  const result = res.result;
  if (!result || result.code !== 0) {
    throw new CloudFunctionError(name, result?.message || `${name} failed`, result?.code, result?.data);
  }

  return result.data;
}

async function callCachedCloudFunction<T>(
  name: string,
  data: Record<string, unknown> = {},
  ttlMs = 0,
): Promise<T> {
  const key = getCloudCacheKey(name, data);
  const now = Date.now();
  const cached = cloudResponseCache.get(key);
  if (cached && cached.expiresAt > now) return cached.data as T;

  const inflight = cloudInflightRequests.get(key);
  if (inflight) return inflight as Promise<T>;

  const request = callCloudFunction<T>(name, data)
    .then((result) => {
      if (ttlMs > 0) {
        cloudResponseCache.set(key, {
          expiresAt: Date.now() + ttlMs,
          data: result,
        });
      }
      return result;
    })
    .finally(() => {
      cloudInflightRequests.delete(key);
    });

  cloudInflightRequests.set(key, request);
  return request;
}

function clearCloudCache(prefixes: string[]) {
  for (const key of cloudResponseCache.keys()) {
    if (prefixes.some((prefix) => key.startsWith(prefix))) {
      cloudResponseCache.delete(key);
    }
  }
}

export function clearCloudRecommendationCache() {
  clearCloudCache(['generateOutfit:']);
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

function getCloudCacheKey(name: string, data: Record<string, unknown>) {
  return `${name}:${stableStringify(data)}`;
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
  styleProfile?: Record<string, unknown>;
  recommendationProfile?: RecommendationProfile;
  updatedAt?: string;
}

export async function loginWithCloud() {
  return callCachedCloudFunction<CloudUserProfile>('login', {}, CACHE_TTL.login);
}

export async function getWardrobe(params: GetWardrobeParams = {}) {
  return callCachedCloudFunction<{
    list: Clothing[];
    pagination: { total: number; page: number; pageSize: number; totalPages: number };
    capacity: { total: number; used: number; remaining: number };
  }>('getWardrobe', params as Record<string, unknown>, CACHE_TTL.wardrobe);
}

export async function getClothingById(id: string) {
  const data = await callCachedCloudFunction<{
    list: Clothing[];
    pagination: { total: number; page: number; pageSize: number; totalPages: number };
    capacity: { total: number; used: number; remaining: number };
  }>('getWardrobe', { id, detail: true, includeTotal: false, includeCapacity: false }, CACHE_TTL.wardrobe);
  const item = data.list[0];
  if (!item) throw new Error('Clothing not found');
  return item;
}

export async function segmentCloudClothing(id: string) {
  const item = await callCloudFunction<Clothing>('segmentClothImage', { clothingId: id });
  clearCloudCache(['getWardrobe:', 'generateOutfit:']);
  return item;
}

export async function recognizeClothAttributes(id: string) {
  const item = await callCloudFunction<Clothing>('recognizeClothAttributes', { clothId: id });
  clearCloudCache(['getWardrobe:', 'generateOutfit:']);
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

export async function processUploadImage(imageId: string) {
  return callCloudFunction<{ imageId: string; drafts: ClothesDraft[]; errorMessage?: string }>('processUploadImage', {
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
  }>('confirmClothesDrafts', {
    batchId,
    drafts,
    selectedIds,
  });
  clearCloudCache(['getWardrobe:', 'generateOutfit:']);
  return result;
}

export async function discardClothesDraft(draftId: string) {
  return callCloudFunction<{ id: string }>('discardClothesDraft', { draftId });
}

export async function discardUploadBatch(batchId: string) {
  return callCloudFunction<{ id: string; status: 'discarded' }>('discardUploadBatch', { batchId });
}

export async function updateCloudClothing(id: string, data: ClothingUpdateInput) {
  const item = await callCloudFunction<Clothing>('updateClothes', { id, data });
  clearCloudCache(['getWardrobe:', 'generateOutfit:']);
  return item;
}

export async function deleteCloudClothing(id: string) {
  const result = await callCloudFunction<{ id: string }>('deleteClothes', { id });
  clearCloudCache(['getWardrobe:', 'generateOutfit:']);
  return result;
}

export interface BatchDeleteCloudClothingResult {
  successIds: string[];
  failedIds: string[];
  total: number;
  successCount: number;
  failedCount: number;
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
  clearCloudCache(['login:', 'generateOutfit:']);
  return result;
}

function isRecommendationProfile(input: RecommendationProfile | UpdateCloudUserProfileInput): input is RecommendationProfile {
  return 'genderPreference' in input || 'styleTags' in input || 'fitPreference' in input;
}

export async function generateCloudOutfit(params: RecommendRequest = {}) {
  const hasExclusions =
    (Array.isArray(params.excludeClothingIdSets) && params.excludeClothingIdSets.length > 0) ||
    (Array.isArray(params.excludedOutfitKeys) && params.excludedOutfitKeys.length > 0);
  const ttl = hasExclusions ? 0 : CACHE_TTL.outfit;
  console.log('[generateCloudOutfit] call generateOutfit', {
    scene: params.scene,
    date: params.date,
    timeOfDay: params.timeOfDay,
    weather: params.weather
      ? {
          temp: params.weather.temp,
          weather: params.weather.weather,
          humidity: params.weather.humidity,
        }
      : undefined,
    excludeCount: params.excludeClothingIdSets?.length ?? 0,
    excludedOutfitKeyCount: params.excludedOutfitKeys?.length ?? 0,
  });
  return callCachedCloudFunction<RecommendResponse>('generateOutfit', params as Record<string, unknown>, ttl);
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

export interface GenerateCloudOutfitCommentResult {
  success: boolean;
  aiComment?: OutfitAiComment;
  saved?: boolean;
  fallback?: boolean;
  message?: string;
}

export async function generateCloudOutfitComment(outfit: Outfit) {
  const result = await callCloudFunction<GenerateCloudOutfitCommentResult>('generateOutfit', {
    action: 'aiComment',
    outfitId: outfit.id,
    outfit,
    weather: outfit.weatherSnapshot,
    scene: outfit.scene,
    items: outfit.items,
    scores: outfit.scores,
    reason: outfit.reasoning || outfit.reason || '',
  });
  return result;
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
    clearCloudCache(['getWeather:']);
    clearLocalWeatherCache();
  }
  const data = options.forceRefresh
    ? await callCloudFunction<ResolvedWeatherResponse>('getWeather', payload)
    : await callCachedCloudFunction<ResolvedWeatherResponse>('getWeather', payload, CACHE_TTL.weather);

  writeLocalWeatherCache(data);
  if (options.forceRefresh) {
    clearCloudCache(['getWeather:']);
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
export function getFallbackWeather(city = '涓婃捣'): CurrentWeather {
  return {
    city,
    cityCode: '',
    temp: 22,
    feelsLike: 20,
    humidity: 65,
    weather: '多云',
    weatherIcon: 'cloudy',
    wind: 3,
    windDir: '东南风',
    uv: 4,
    visibility: 10,
    updateTime: new Date().toISOString(),
  };
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
  category?: ClothingCategory | 'all';
  subcategory?: string | 'all';
  subcategoryId?: string;
  status?: 'active' | 'archived' | 'deleted';
  page?: number;
  pageSize?: number;
}
