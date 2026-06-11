import { clearPageCacheByPrefix } from './pageCache';

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
  namespace?: string;
}

export async function invalidateWardrobeCache(options: CacheInvalidationOptions = {}): Promise<void> {
  await safeClearPrefix(PAGE_CACHE_PREFIXES.wardrobe, options.namespace);
}

export async function invalidateTodayRecommendationCache(options: CacheInvalidationOptions = {}): Promise<void> {
  await safeClearPrefix(PAGE_CACHE_PREFIXES.today, options.namespace);
}

export async function invalidateOutfitDetailCache(options: CacheInvalidationOptions = {}): Promise<void> {
  await safeClearPrefix(PAGE_CACHE_PREFIXES.outfitDetail, options.namespace);
}

export async function invalidateOutfitStatusCache(options: CacheInvalidationOptions = {}): Promise<void> {
  await safeClearPrefix(PAGE_CACHE_PREFIXES.outfitStatus, options.namespace);
}

export async function invalidateProfileCache(options: CacheInvalidationOptions = {}): Promise<void> {
  await safeClearPrefix(PAGE_CACHE_PREFIXES.profile, options.namespace);
}

export async function invalidateUploadTasksCache(options: CacheInvalidationOptions = {}): Promise<void> {
  await safeClearPrefix(PAGE_CACHE_PREFIXES.uploadTasks, options.namespace);
}

export async function invalidateFavoritesCache(options: CacheInvalidationOptions = {}): Promise<void> {
  await safeClearPrefix(PAGE_CACHE_PREFIXES.favorites, options.namespace);
}

export async function invalidateHistoryCache(options: CacheInvalidationOptions = {}): Promise<void> {
  await safeClearPrefix(PAGE_CACHE_PREFIXES.history, options.namespace);
}

export async function invalidateAfterWardrobeMutation(options: CacheInvalidationOptions = {}): Promise<void> {
  await safeClearPrefixes(
    [
      PAGE_CACHE_PREFIXES.wardrobe,
      PAGE_CACHE_PREFIXES.today,
      PAGE_CACHE_PREFIXES.outfitDetail,
      PAGE_CACHE_PREFIXES.profile,
      PAGE_CACHE_PREFIXES.favorites,
      PAGE_CACHE_PREFIXES.history,
    ],
    options.namespace,
  );
}

export async function invalidateAfterOutfitFavoriteMutation(options: CacheInvalidationOptions = {}): Promise<void> {
  await safeClearPrefixes(
    [
      PAGE_CACHE_PREFIXES.outfitStatus,
      PAGE_CACHE_PREFIXES.favorites,
      PAGE_CACHE_PREFIXES.profile,
    ],
    options.namespace,
  );
}

export async function invalidateAfterOutfitWornMutation(options: CacheInvalidationOptions = {}): Promise<void> {
  await safeClearPrefixes(
    [
      PAGE_CACHE_PREFIXES.outfitStatus,
      PAGE_CACHE_PREFIXES.history,
      PAGE_CACHE_PREFIXES.profile,
    ],
    options.namespace,
  );
}

export async function invalidateAfterUploadTaskMutation(options: CacheInvalidationOptions = {}): Promise<void> {
  await invalidateUploadTasksCache(options);
}

export async function invalidateAfterConfirmDraftsSaved(options: CacheInvalidationOptions = {}): Promise<void> {
  await safeClearPrefixes(
    [
      PAGE_CACHE_PREFIXES.uploadTasks,
      PAGE_CACHE_PREFIXES.wardrobe,
      PAGE_CACHE_PREFIXES.today,
      PAGE_CACHE_PREFIXES.profile,
    ],
    options.namespace,
  );
}

export async function invalidateAfterProfileMutation(options: CacheInvalidationOptions = {}): Promise<void> {
  await safeClearPrefixes(
    [
      PAGE_CACHE_PREFIXES.profile,
      PAGE_CACHE_PREFIXES.today,
    ],
    options.namespace,
  );
}

async function safeClearPrefixes(prefixes: string[], namespace?: string): Promise<void> {
  await Promise.all(prefixes.map((prefix) => safeClearPrefix(prefix, namespace)));
}

async function safeClearPrefix(prefix: string, namespace?: string): Promise<void> {
  try {
    await clearPageCacheByPrefix(prefix, { namespace });
  } catch (error) {
    console.warn('[cacheInvalidation] clear cache failed', { prefix, namespace, error });
  }
}
