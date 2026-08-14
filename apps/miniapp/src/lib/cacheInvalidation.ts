import { clearUserPageCacheByPrefix } from './userPageCache';
import { getUserStorageSync, setUserStorageSync } from './userStorage';
import type { ActiveAuthContext } from '@/stores/userStore';
import type { Outfit, RecommendationProfile } from '@starter-template/types';
import {
  classifyRecommendationProfileInvalidationPolicy,
} from './recommendationInvalidationPolicy';

export const PAGE_CACHE_PREFIXES = {
  wardrobe: 'wardrobe',
  today: 'today',
  outfitDetail: 'outfitDetail',
  outfitStatus: 'outfitStatus',
  profile: 'profile',
  uploadTasks: 'uploadTasks',
  favorites: 'favorites',
  history: 'history',
} as const;

interface CacheInvalidationOptions {
  authContext?: ActiveAuthContext | null;
}

type RecommendationInvalidationImpact = 'hard' | 'soft';

interface RecommendationMutationOptions extends CacheInvalidationOptions {
  recommendationImpact?: RecommendationInvalidationImpact;
  dirtyReason?: TodayRecommendationDirtyReason;
}

export type TodayRecommendationDirtyReason = 'wardrobe_added' | 'preference_changed';

export interface TodayRecommendationDirtyState {
  reason: TodayRecommendationDirtyReason;
  message: string;
  createdAt: number;
}

export const TODAY_WARDROBE_INPUT_VERSION_KEY = 'today:recommendationInput:wardrobeVersion';
export const TODAY_PROFILE_INPUT_VERSION_KEY = 'today:recommendationInput:profileVersion';
export const TODAY_RECOMMENDATION_DIRTY_KEY = 'today:recommendationInput:dirty';
export const TODAY_RECOMMENDATION_HARD_INVALID_KEY = 'today:recommendationInput:hardInvalid';
const TODAY_RESTORE_SNAPSHOT_KEY = 'today:outfitReturnSnapshot:recommendation-copy-contract-v8';
const TODAY_RESTORE_SNAPSHOT_VERSION = 4;
const TODAY_RESTORE_SNAPSHOT_TTL_MS = 10 * 60 * 1000;

export async function invalidateWardrobeCache(options: CacheInvalidationOptions = {}): Promise<void> {
  await safeClearPrefix(PAGE_CACHE_PREFIXES.wardrobe, options);
}

export async function invalidateTodayRecommendationCache(options: CacheInvalidationOptions = {}): Promise<void> {
  bumpRecommendationInputVersion(TODAY_WARDROBE_INPUT_VERSION_KEY, options);
  bumpRecommendationInputVersion(TODAY_PROFILE_INPUT_VERSION_KEY, options);
  await safeClearPrefix(PAGE_CACHE_PREFIXES.today, options);
}

export async function invalidateOutfitDetailCache(options: CacheInvalidationOptions = {}): Promise<void> {
  await safeClearPrefix(PAGE_CACHE_PREFIXES.outfitDetail, options);
}

export async function invalidateOutfitStatusCache(options: CacheInvalidationOptions = {}): Promise<void> {
  await safeClearPrefix(PAGE_CACHE_PREFIXES.outfitStatus, options);
}

export async function invalidateProfileCache(options: CacheInvalidationOptions = {}): Promise<void> {
  await safeClearPrefix(PAGE_CACHE_PREFIXES.profile, options);
}

export async function invalidateUploadTasksCache(options: CacheInvalidationOptions = {}): Promise<void> {
  await safeClearPrefix(PAGE_CACHE_PREFIXES.uploadTasks, options);
}

export async function invalidateFavoritesCache(options: CacheInvalidationOptions = {}): Promise<void> {
  await safeClearPrefix(PAGE_CACHE_PREFIXES.favorites, options);
}

export async function invalidateHistoryCache(options: CacheInvalidationOptions = {}): Promise<void> {
  await safeClearPrefix(PAGE_CACHE_PREFIXES.history, options);
}

export async function invalidateAfterWardrobeMutation(options: RecommendationMutationOptions = {}): Promise<void> {
  const impact = options.recommendationImpact ?? 'hard';
  if (impact === 'hard') {
    bumpRecommendationInputVersion(TODAY_WARDROBE_INPUT_VERSION_KEY, options);
    markTodayRecommendationHardInvalid(options);
  }
  else markTodayRecommendationDirty(options.dirtyReason ?? 'wardrobe_added', options);
  await safeClearPrefixes(
    [
      PAGE_CACHE_PREFIXES.wardrobe,
      ...(impact === 'hard' ? [PAGE_CACHE_PREFIXES.today] : []),
      PAGE_CACHE_PREFIXES.outfitDetail,
      PAGE_CACHE_PREFIXES.profile,
      PAGE_CACHE_PREFIXES.favorites,
      PAGE_CACHE_PREFIXES.history,
    ],
    options,
  );
}

export async function invalidateAfterOutfitFavoriteMutation(options: CacheInvalidationOptions = {}): Promise<void> {
  await safeClearPrefixes(
    [
      PAGE_CACHE_PREFIXES.outfitStatus,
      PAGE_CACHE_PREFIXES.favorites,
    ],
    options,
  );
}

export async function invalidateAfterOutfitWornMutation(options: CacheInvalidationOptions = {}): Promise<void> {
  await safeClearPrefixes(
    [
      PAGE_CACHE_PREFIXES.outfitStatus,
      PAGE_CACHE_PREFIXES.history,
      PAGE_CACHE_PREFIXES.profile,
    ],
    options,
  );
}

export async function invalidateAfterUploadTaskMutation(options: CacheInvalidationOptions = {}): Promise<void> {
  await invalidateUploadTasksCache(options);
}

export async function invalidateAfterConfirmDraftsSaved(options: CacheInvalidationOptions = {}): Promise<void> {
  markTodayRecommendationDirty('wardrobe_added', options);
  await safeClearPrefixes(
    [
      PAGE_CACHE_PREFIXES.uploadTasks,
      PAGE_CACHE_PREFIXES.wardrobe,
      PAGE_CACHE_PREFIXES.profile,
    ],
    options,
  );
}

export async function invalidateAfterProfileMutation(options: RecommendationMutationOptions = {}): Promise<void> {
  const impact = options.recommendationImpact ?? 'hard';
  if (impact === 'hard') {
    bumpRecommendationInputVersion(TODAY_PROFILE_INPUT_VERSION_KEY, options);
    markTodayRecommendationHardInvalid(options);
  }
  else markTodayRecommendationDirty(options.dirtyReason ?? 'preference_changed', options);
  await safeClearPrefixes(
    [
      PAGE_CACHE_PREFIXES.profile,
      ...(impact === 'hard' ? [PAGE_CACHE_PREFIXES.today] : []),
    ],
    options,
  );
}

export function classifyRecommendationProfileInvalidation(
  previous: RecommendationProfile,
  next: RecommendationProfile,
  options: CacheInvalidationOptions = {},
): RecommendationInvalidationImpact {
  return classifyRecommendationProfileInvalidationPolicy(
    previous,
    next,
    readCurrentVisibleTodayBatch(options),
  ) as RecommendationInvalidationImpact;
}

export function getTodayRecommendationDirty(
  options: CacheInvalidationOptions = {},
): TodayRecommendationDirtyState | null {
  const value = getUserStorageSync<TodayRecommendationDirtyState>(
    TODAY_RECOMMENDATION_DIRTY_KEY,
    { authContext: options.authContext },
  );
  return value && typeof value === 'object' ? value : null;
}

export function clearTodayRecommendationDirty(options: CacheInvalidationOptions = {}): void {
  setUserStorageSync(TODAY_RECOMMENDATION_DIRTY_KEY, null, { authContext: options.authContext });
}

export function hasTodayRecommendationHardInvalid(options: CacheInvalidationOptions = {}): boolean {
  return Boolean(getUserStorageSync<boolean>(
    TODAY_RECOMMENDATION_HARD_INVALID_KEY,
    { authContext: options.authContext },
  ));
}

export function clearTodayRecommendationHardInvalid(options: CacheInvalidationOptions = {}): void {
  setUserStorageSync(TODAY_RECOMMENDATION_HARD_INVALID_KEY, false, { authContext: options.authContext });
}

function markTodayRecommendationDirty(
  reason: TodayRecommendationDirtyReason,
  options: CacheInvalidationOptions,
) {
  const message = reason === 'preference_changed'
    ? '偏好已保存，正在重新搭配'
    : '新衣服已加入，正在更新搭配';
  setUserStorageSync(TODAY_RECOMMENDATION_DIRTY_KEY, {
    reason,
    message,
    createdAt: Date.now(),
  }, { authContext: options.authContext });
}

function markTodayRecommendationHardInvalid(options: CacheInvalidationOptions) {
  setUserStorageSync(TODAY_RECOMMENDATION_HARD_INVALID_KEY, true, {
    authContext: options.authContext,
  });
}

async function safeClearPrefixes(prefixes: string[], options: CacheInvalidationOptions): Promise<void> {
  await Promise.all(prefixes.map((prefix) => safeClearPrefix(prefix, options)));
}

async function safeClearPrefix(prefix: string, options: CacheInvalidationOptions): Promise<void> {
  try {
    await clearUserPageCacheByPrefix(prefix, { authContext: options.authContext });
  } catch (error) {
    console.warn('[cacheInvalidation] clear cache failed', { prefix, error });
  }
}

function bumpRecommendationInputVersion(storageKey: string, options: CacheInvalidationOptions) {
  const current = Number(getUserStorageSync<number>(storageKey, { authContext: options.authContext })) || 0;
  setUserStorageSync(storageKey, Math.max(Date.now(), current + 1), { authContext: options.authContext });
}

function readCurrentVisibleTodayBatch(options: CacheInvalidationOptions): Outfit[] {
  const snapshot = getUserStorageSync<{
    version?: number;
    generatedAt?: number;
    outfits?: Outfit[];
  }>(TODAY_RESTORE_SNAPSHOT_KEY, { authContext: options.authContext });
  if (snapshot?.version !== TODAY_RESTORE_SNAPSHOT_VERSION
    || !Number.isFinite(Number(snapshot.generatedAt))
    || Date.now() - Number(snapshot.generatedAt) > TODAY_RESTORE_SNAPSHOT_TTL_MS
    || !Array.isArray(snapshot.outfits)) return [];
  return snapshot.outfits;
}
