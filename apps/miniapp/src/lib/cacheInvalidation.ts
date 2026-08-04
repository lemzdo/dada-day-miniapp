import { clearUserPageCacheByPrefix } from './userPageCache';
import { getUserStorageSync, setUserStorageSync } from './userStorage';
import type { ActiveAuthContext } from '@/stores/userStore';

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

export const TODAY_WARDROBE_INPUT_VERSION_KEY = 'today:recommendationInput:wardrobeVersion';
export const TODAY_PROFILE_INPUT_VERSION_KEY = 'today:recommendationInput:profileVersion';

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

export async function invalidateAfterWardrobeMutation(options: CacheInvalidationOptions = {}): Promise<void> {
  bumpRecommendationInputVersion(TODAY_WARDROBE_INPUT_VERSION_KEY, options);
  await safeClearPrefixes(
    [
      PAGE_CACHE_PREFIXES.wardrobe,
      PAGE_CACHE_PREFIXES.today,
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
  bumpRecommendationInputVersion(TODAY_WARDROBE_INPUT_VERSION_KEY, options);
  await safeClearPrefixes(
    [
      PAGE_CACHE_PREFIXES.uploadTasks,
      PAGE_CACHE_PREFIXES.wardrobe,
      PAGE_CACHE_PREFIXES.today,
      PAGE_CACHE_PREFIXES.profile,
    ],
    options,
  );
}

export async function invalidateAfterProfileMutation(options: CacheInvalidationOptions = {}): Promise<void> {
  bumpRecommendationInputVersion(TODAY_PROFILE_INPUT_VERSION_KEY, options);
  await safeClearPrefixes(
    [
      PAGE_CACHE_PREFIXES.profile,
      PAGE_CACHE_PREFIXES.today,
    ],
    options,
  );
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
