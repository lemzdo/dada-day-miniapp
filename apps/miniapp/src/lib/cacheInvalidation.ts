import { clearUserPageCacheByPrefix } from './userPageCache';
import type { ActiveAuthContext } from '@/stores/userStore';
import {
  clearRecommendationInputHardInvalid,
  hasRecommendationInputHardInvalid,
  recommendationInputChanged,
  type RecommendationMutationSource,
} from './recommendationMutationCoordinator';
export {
  TODAY_PROFILE_INPUT_VERSION_KEY,
  TODAY_RECOMMENDATION_HARD_INVALID_KEY,
  TODAY_WARDROBE_INPUT_VERSION_KEY,
} from './recommendationInputKeys';

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

interface RecommendationMutationOptions extends CacheInvalidationOptions {
  source?: RecommendationMutationSource;
}

export async function invalidateWardrobeCache(options: CacheInvalidationOptions = {}): Promise<void> {
  await safeClearPrefix(PAGE_CACHE_PREFIXES.wardrobe, options);
}

export async function invalidateTodayRecommendationCache(options: CacheInvalidationOptions = {}): Promise<void> {
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
  if (options.authContext) recommendationInputChanged({
    authContext: options.authContext,
    source: options.source ?? 'wardrobe_edit',
  });
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
  if (options.authContext) recommendationInputChanged({
    authContext: options.authContext,
    source: 'wardrobe_add',
  });
  await safeClearPrefixes(
    [
      PAGE_CACHE_PREFIXES.uploadTasks,
      PAGE_CACHE_PREFIXES.wardrobe,
      PAGE_CACHE_PREFIXES.profile,
      PAGE_CACHE_PREFIXES.today,
    ],
    options,
  );
}

export async function invalidateAfterProfileMutation(options: RecommendationMutationOptions = {}): Promise<void> {
  if (options.authContext) recommendationInputChanged({
    authContext: options.authContext,
    source: options.source ?? 'style_preference_save',
  });
  await safeClearPrefixes(
    [
      PAGE_CACHE_PREFIXES.profile,
      PAGE_CACHE_PREFIXES.today,
    ],
    options,
  );
}

export function hasTodayRecommendationHardInvalid(options: CacheInvalidationOptions = {}): boolean {
  return options.authContext ? hasRecommendationInputHardInvalid(options.authContext) : false;
}

export function clearTodayRecommendationHardInvalid(
  options: CacheInvalidationOptions & { identity?: string } = {},
): void {
  if (options.authContext) {
    clearRecommendationInputHardInvalid(options.authContext, options.identity);
  }
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
