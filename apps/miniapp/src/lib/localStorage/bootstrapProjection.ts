import type { RecommendationProfile, ResolvedWeatherResponse } from '@starter-template/types';
import {
  readLocalStorage,
  removeLocalStorage,
  writeLocalStorage,
  type LocalStorageAddress,
  type LocalWriteResult,
} from './gateway';

export interface AuthResumeV2 {
  userId: string;
  confirmedOpenid: string;
  userScope: string;
  updatedAt: string;
}

export interface ProfileBootstrapV2 {
  userScope: string;
  userId: string;
  nickname: string;
  avatarUrl: string;
  avatarType: 'wechat' | 'preset' | 'default';
  profileCompleted: boolean;
  recommendationProfile: RecommendationProfile;
  capacityTotal: number;
  capacityUsed: number;
  membershipTier: string;
  profileRevision?: string;
}

export interface StorageMetaV2 {
  checkpoint: string;
  completedVersion?: number;
  updatedAt: string;
  sizeSummary?: Record<string, number | undefined>;
}

const WEATHER_FRESH_MS = 10 * 60 * 1000;

export const bootstrapProjectionStore = {
  readAuthResume() {
    return readLocalStorage<AuthResumeV2>('authResume:v2')?.payload ?? null;
  },
  writeAuthResume(value: AuthResumeV2): LocalWriteResult {
    return writeLocalStorage('authResume:v2', value);
  },
  removeAuthResume() {
    return removeLocalStorage('authResume:v2');
  },

  readProfileBootstrap() {
    return readLocalStorage<ProfileBootstrapV2>('profileBootstrap:v2')?.payload ?? null;
  },
  writeProfileBootstrap(value: ProfileBootstrapV2): LocalWriteResult {
    return writeLocalStorage('profileBootstrap:v2', value);
  },
  removeProfileBootstrap() {
    return removeLocalStorage('profileBootstrap:v2');
  },

  readWeatherLastKnown(options: { allowStale?: boolean; now?: number } = {}) {
    const result = readLocalStorage<ResolvedWeatherResponse>('weatherLastKnown:v2', { now: options.now });
    if (!result) return null;
    const timestamp = options.now ?? Date.now();
    if (!options.allowStale && timestamp - result.updatedAt > WEATHER_FRESH_MS) return null;
    return result.payload;
  },
  writeWeatherLastKnown(value: ResolvedWeatherResponse): LocalWriteResult {
    if (value.source === 'fallback' || !value.weather.weather) {
      return {
        ok: false,
        status: 'cache-skipped',
        reason: 'fallback-weather',
        attempts: 0,
        bytes: 0,
        recoverability: 'recomputable',
      };
    }
    const compact: ResolvedWeatherResponse = {
      location: value.location,
      weather: value.weather,
      source: 'cache',
      cacheHit: true,
      fetchedAt: value.fetchedAt,
      observedAt: value.observedAt ?? value.weather.reportTime,
      updatedAt: value.updatedAt,
    };
    return writeLocalStorage('weatherLastKnown:v2', compact);
  },
  removeWeatherLastKnown() {
    return removeLocalStorage('weatherLastKnown:v2');
  },

  readTodayBootstrap<T>(address?: LocalStorageAddress) {
    return readLocalStorage<T>('todayBootstrap:v2', address)?.payload ?? null;
  },
  writeTodayBootstrap<T>(value: T, address?: LocalStorageAddress): LocalWriteResult {
    return writeLocalStorage('todayBootstrap:v2', value, address);
  },
  removeTodayBootstrap(address?: LocalStorageAddress) {
    return removeLocalStorage('todayBootstrap:v2', address);
  },

  readWardrobeBootstrap<T>(address?: LocalStorageAddress) {
    return readLocalStorage<T>('wardrobeBootstrap:v2', address)?.payload ?? null;
  },
  writeWardrobeBootstrap<T>(value: T, address?: LocalStorageAddress): LocalWriteResult {
    return writeLocalStorage('wardrobeBootstrap:v2', value, address);
  },
  removeWardrobeBootstrap(address?: LocalStorageAddress) {
    return removeLocalStorage('wardrobeBootstrap:v2', address);
  },

  readUploadWorkflow<T>(address?: LocalStorageAddress) {
    return readLocalStorage<T>('uploadWorkflow:v2', address)?.payload ?? null;
  },
  writeUploadWorkflow<T>(value: T, address?: LocalStorageAddress): LocalWriteResult {
    return writeLocalStorage('uploadWorkflow:v2', value, address);
  },
  removeUploadWorkflow(address?: LocalStorageAddress) {
    return removeLocalStorage('uploadWorkflow:v2', address);
  },

  readStorageMeta(entryId = 'migration') {
    return readLocalStorage<StorageMetaV2>('storageMeta:v2', { entryId })?.payload ?? null;
  },
  writeStorageMeta(value: StorageMetaV2, entryId = 'migration'): LocalWriteResult {
    return writeLocalStorage('storageMeta:v2', value, { entryId });
  },
  removeStorageMeta(entryId = 'migration') {
    return removeLocalStorage('storageMeta:v2', { entryId });
  },
};

export function readBootstrapProjection<T>(
  namespace: 'todayBootstrap:v2' | 'wardrobeBootstrap:v2',
  address?: LocalStorageAddress,
) {
  return readLocalStorage<T>(namespace, address)?.payload ?? null;
}

export function writeBootstrapProjection<T>(
  namespace: 'todayBootstrap:v2' | 'wardrobeBootstrap:v2',
  value: T,
  address?: LocalStorageAddress,
) {
  return writeLocalStorage(namespace, value, address);
}

export { WEATHER_FRESH_MS };
