import Taro from '@tarojs/taro';
import type {
  Clothing,
  ClothingCategory,
  ClothingUpdateInput,
  ClothesDraft,
  CurrentWeather,
  Outfit,
  RecommendRequest,
  RecommendResponse,
  RecommendationProfile,
  ResolvedWeatherResponse,
  StyleDictItem,
  UploadBatch,
  UploadImage,
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
};

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

export interface GetWardrobeParams {
  id?: string;
  category?: ClothingCategory | 'all';
  status?: 'active' | 'archived' | 'deleted';
  page?: number;
  pageSize?: number;
}

export async function getWardrobe(params: GetWardrobeParams = {}) {
  return callCachedCloudFunction<{
    list: Clothing[];
    pagination: { total: number; page: number; pageSize: number; totalPages: number };
    capacity: { total: number; used: number; remaining: number };
  }>('getWardrobe', params as Record<string, unknown>, CACHE_TTL.wardrobe);
}

export async function getClothingById(id: string) {
  const data = await getWardrobe({ id });
  const item = data.list[0];
  if (!item) throw new Error('Clothing not found');
  return item;
}

export async function uploadClothing(filePath: string, category: ClothingCategory) {
  if (!taroCloud) throw new Error('wx.cloud is not available');

  const cloudPath = `wardrobe_uploads/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
  let uploadRes: { fileID: string };

  try {
    uploadRes = await taroCloud.uploadFile({ cloudPath, filePath });
  } catch (error) {
    console.error('[uploadClothing] wx.cloud.uploadFile failed', {
      cloudPath,
      category,
      filePath,
      error,
    });
    throw new Error('图片上传到云存储失败');
  }

  try {
    const item = await callCloudFunction<Clothing>('uploadClothing', {
      fileID: uploadRes.fileID,
      category,
    });
    clearCloudCache(['getWardrobe:', 'generateOutfit:']);
    return item;
  } catch (error) {
    console.error('[uploadClothing] uploadClothing failed', {
      fileID: uploadRes.fileID,
      category,
      error,
    });
    throw error;
  }
}

export async function uploadClothImage(filePath: string, category: ClothingCategory | string) {
  if (!taroCloud) throw new Error('wx.cloud is not available');

  const cloudPath = `wardrobe_uploads/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
  let uploadRes: { fileID: string };

  try {
    uploadRes = await taroCloud.uploadFile({ cloudPath, filePath });
  } catch (error) {
    console.error('[uploadClothImage] wx.cloud.uploadFile failed', {
      cloudPath,
      category,
      filePath,
      error,
    });
    throw new Error('图片上传到云存储失败');
  }

  const result = await callCloudFunction<{
    clothId: string;
    clothingId: string;
    originalImageUrl: string;
    item: Clothing;
  }>('uploadClothImage', {
    fileID: uploadRes.fileID,
    category,
  });

  clearCloudCache(['getWardrobe:', 'generateOutfit:']);
  return result.item;
}

export async function segmentCloudClothing(id: string) {
  const item = await callCloudFunction<Clothing>('segmentClothImage', { clothId: id });
  clearCloudCache(['getWardrobe:', 'generateOutfit:']);
  return item;
}

export async function recognizeClothAttributes(id: string) {
  const item = await callCloudFunction<Clothing>('recognizeClothAttributes', { clothId: id });
  clearCloudCache(['getWardrobe:', 'generateOutfit:']);
  return item;
}

export async function processClothUpload(filePath: string, category: ClothingCategory | string, recognizeNow = false) {
  if (!taroCloud) throw new Error('wx.cloud is not available');

  const cloudPath = `wardrobe_uploads/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
  const uploadRes = await taroCloud.uploadFile({ cloudPath, filePath });
  const item = await callCloudFunction<Clothing>('processClothUpload', {
    fileID: uploadRes.fileID,
    category,
    recognizeNow,
  });
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

export async function confirmClothesDrafts(batchId: string, drafts: Array<Partial<ClothesDraft> & { id: string }>) {
  const result = await callCloudFunction<{ list: Clothing[]; count: number }>('confirmClothesDrafts', {
    batchId,
    drafts,
  });
  clearCloudCache(['getWardrobe:', 'generateOutfit:']);
  return result;
}

export async function discardClothesDraft(draftId: string) {
  return callCloudFunction<{ id: string }>('discardClothesDraft', { draftId });
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
  const ttl = Array.isArray(params.excludeClothingIdSets) && params.excludeClothingIdSets.length > 0 ? 0 : CACHE_TTL.outfit;
  return callCachedCloudFunction<RecommendResponse>('generateOutfit', params as Record<string, unknown>, ttl);
}

export async function getCloudOutfit(id: string) {
  return callCloudFunction<Outfit>('generateOutfit', { action: 'detail', id });
}

export async function setCloudOutfitFavorite(id: string, isFavorite: boolean, outfit?: Outfit) {
  const outfitResult = await callCloudFunction<Outfit>('generateOutfit', {
    action: 'favorite',
    id,
    isFavorite,
    outfit,
  });
  clearCloudCache(['generateOutfit:']);
  return outfitResult;
}

export async function confirmCloudWear(id: string, outfit?: Outfit) {
  const outfitResult = await callCloudFunction<Outfit>('generateOutfit', {
    action: 'wear',
    id,
    outfit,
    date: new Date().toISOString().split('T')[0],
  });
  clearCloudCache(['generateOutfit:', 'getWardrobe:']);
  return outfitResult;
}

export async function getCloudOutfitList(params: { isFavorite?: boolean; wornOnly?: boolean; page?: number; pageSize?: number } = {}) {
  return callCloudFunction<{
    list: Outfit[];
    pagination: { total: number; page: number; pageSize: number; totalPages: number };
  }>('generateOutfit', { action: 'list', ...params });
}

export async function getCloudWeather(location: { latitude: number; longitude: number }) {
  return callCachedCloudFunction<ResolvedWeatherResponse>('getWeather', location, CACHE_TTL.weather);
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
    updatedAt: new Date().toISOString(),
  };
}
