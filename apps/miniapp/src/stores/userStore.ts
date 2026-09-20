// ============================================================
// 用户状态管理 — Zustand store
// ============================================================

import { create } from 'zustand';
import Taro from '@tarojs/taro';
import { loginWithCloud, updateCloudUserProfile, type CloudUserProfile } from '@/lib/cloud';
import { CLOUD_ENV_ID } from '@/config/cloud';
import { buildUserScope } from '@/lib/userScope';
import type { RecommendationProfile } from '@starter-template/types';
import { DEFAULT_RECOMMENDATION_PROFILE } from '@/constants/recommendationProfile';
import { DEFAULT_WARDROBE_LIMIT } from '@/constants/wardrobeCapacity';
import {
  bootstrapProjectionStore,
  type AuthResumeV2,
  type ProfileBootstrapV2,
} from '@/lib/localStorage';

const DEFAULT_NICKNAME = '搭搭新朋友';
const FREE_WARDROBE_LIMIT = DEFAULT_WARDROBE_LIMIT;
type AvatarType = 'wechat' | 'preset' | 'default';
export type AuthStatus = 'initializing' | 'authenticated' | 'anonymous' | 'failed';

export interface ActiveAuthContext {
  userScope: string;
  confirmedOpenid: string;
  authEpoch: number;
}

interface CachedUserIdentity {
  auth: AuthResumeV2;
  profile: ProfileBootstrapV2 | null;
}

interface UserState {
  userId: string | null;
  openid: string | null;
  authStatus: AuthStatus;
  confirmedOpenid: string | null;
  userScope: string | null;
  authEpoch: number;
  nickname: string;
  avatarUrl: string;
  avatarType: AvatarType;
  profileCompleted: boolean;
  preferredStyles: string[];
  recommendationProfile: RecommendationProfile;
  capacityTotal: number;
  capacityUsed: number;
  membershipTier: string;
  isLoggedIn: boolean;

  login: () => Promise<void>;
  logout: () => void;
  initializeAuth: () => Promise<void>;
  setStyles: (styles: string[]) => void;
  saveUserProfile: (profile: {
    nickname: string;
    avatarUrl: string;
    avatarType: AvatarType;
    profileCompleted?: boolean;
  }) => Promise<void>;
  saveRecommendationProfile: (profile: RecommendationProfile) => Promise<void>;
  fetchProfile: () => Promise<void>;
}

let authRequestVersion = 0;
let initializeAuthPromise: Promise<void> | null = null;

const cachedIdentity = readCachedUserIdentity();

export const useUserStore = create<UserState>((set, get) => ({
  userId: cachedIdentity?.auth.userId ?? null,
  openid: cachedIdentity?.auth.confirmedOpenid ?? null,
  authStatus: cachedIdentity ? 'authenticated' : 'initializing',
  confirmedOpenid: cachedIdentity?.auth.confirmedOpenid ?? null,
  userScope: cachedIdentity?.auth.userScope ?? null,
  authEpoch: 0,
  nickname: cachedIdentity?.profile ? normalizeNickname(cachedIdentity.profile.nickname) : DEFAULT_NICKNAME,
  avatarUrl: cachedIdentity?.profile?.avatarUrl ?? '',
  avatarType: cachedIdentity?.profile ? normalizeAvatarType(cachedIdentity.profile.avatarType) : 'default',
  profileCompleted: Boolean(cachedIdentity?.profile?.profileCompleted),
  preferredStyles: cachedIdentity?.profile?.recommendationProfile.styleTags ?? [],
  recommendationProfile: cachedIdentity?.profile?.recommendationProfile ?? DEFAULT_RECOMMENDATION_PROFILE,
  capacityTotal: cachedIdentity?.profile ? normalizeCapacityTotal(cachedIdentity.profile.capacityTotal) : FREE_WARDROBE_LIMIT,
  capacityUsed: cachedIdentity?.profile ? normalizeCapacityUsed(cachedIdentity.profile.capacityUsed) : 0,
  membershipTier: cachedIdentity?.profile?.membershipTier ?? 'free',
  isLoggedIn: Boolean(cachedIdentity),

  login: async () => {
    await runAuthenticatedProfileRequest('Login error:', set, get);
  },

  logout: () => {
    authRequestVersion += 1;
    initializeAuthPromise = null;
    clearUserScopedRecovery(get().userScope);
    bootstrapProjectionStore.removeAuthResume();
    bootstrapProjectionStore.removeProfileBootstrap();
    set({
      userId: null,
      openid: null,
      authStatus: 'anonymous',
      confirmedOpenid: null,
      userScope: null,
      authEpoch: get().authEpoch + 1,
      nickname: DEFAULT_NICKNAME,
      avatarUrl: '',
      avatarType: 'default',
      profileCompleted: false,
      preferredStyles: [],
      recommendationProfile: DEFAULT_RECOMMENDATION_PROFILE,
      capacityTotal: FREE_WARDROBE_LIMIT,
      capacityUsed: 0,
      membershipTier: 'free',
      isLoggedIn: false,
    });
  },

  initializeAuth: async () => {
    if (initializeAuthPromise) return initializeAuthPromise;

    const authPromise = get()
      .login()
      .finally(() => {
        if (initializeAuthPromise !== authPromise) return;
        initializeAuthPromise = null;
      });
    initializeAuthPromise = authPromise;

    return initializeAuthPromise;
  },

  setStyles: (styles: string[]) => {
    const current = get().recommendationProfile;
    set({ preferredStyles: styles, recommendationProfile: { ...current, styleTags: styles } });
  },

  saveUserProfile: async (profile) => {
    const nickname = normalizeNickname(profile.nickname);
    const updated = await updateCloudUserProfile({
      nickname,
      avatarUrl: profile.avatarUrl,
      avatarType: profile.avatarType,
      profileCompleted: profile.profileCompleted ?? true,
    });
    set({
      nickname: updated.nickname ? normalizeNickname(updated.nickname) : nickname,
      avatarUrl: updated.avatarUrl ?? profile.avatarUrl,
      avatarType: normalizeAvatarType(updated.avatarType ?? profile.avatarType),
      profileCompleted: Boolean(updated.profileCompleted ?? profile.profileCompleted ?? true),
    });
    persistCurrentProfileBootstrap(get());
  },

  saveRecommendationProfile: async (profile: RecommendationProfile) => {
    const normalized = normalizeRecommendationProfile({ recommendationProfile: profile });
    await updateCloudUserProfile(normalized);
    set({ recommendationProfile: normalized, preferredStyles: normalized.styleTags });
    persistCurrentProfileBootstrap(get());
  },

  fetchProfile: async () => {
    await runAuthenticatedProfileRequest('Fetch profile error:', set, get);
  },
}));

export function getActiveAuthContext(): ActiveAuthContext | null {
  const state = useUserStore.getState();
  if (state.authStatus !== 'authenticated' || !state.confirmedOpenid || !state.userScope) return null;

  return {
    userScope: state.userScope,
    confirmedOpenid: state.confirmedOpenid,
    authEpoch: state.authEpoch,
  };
}

export function captureAuthContext(): ActiveAuthContext | null {
  return getActiveAuthContext();
}

export function isAuthContextCurrent(context: ActiveAuthContext): boolean {
  const active = getActiveAuthContext();
  return Boolean(active && active.userScope === context.userScope && active.authEpoch === context.authEpoch);
}

async function runAuthenticatedProfileRequest(
  errorLabel: string,
  set: (partial: Partial<UserState>) => void,
  get: () => UserState,
) {
  const requestVersion = authRequestVersion + 1;
  authRequestVersion = requestVersion;

  try {
    const user = await loginWithCloud();
    if (requestVersion !== authRequestVersion) return;

    const confirmedOpenid = typeof user.openid === 'string' ? user.openid : '';
    const userScope = buildUserScope({
      envVersion: getMiniProgramEnvVersion(),
      cloudEnvId: CLOUD_ENV_ID,
      confirmedOpenid,
    });

    if (!confirmedOpenid || !userScope) {
      throw new Error('Cloud login did not return a confirmed openid');
    }

    const previousState = get();
    const ownerChanged = previousState.confirmedOpenid !== confirmedOpenid
      || previousState.userScope !== userScope;
    if (ownerChanged) clearUserScopedRecovery(previousState.userScope);
    const recommendationProfile = normalizeRecommendationProfile(user.styleProfile);
    set({
      recommendationProfile,
      userId: user.id,
      openid: confirmedOpenid,
      authStatus: 'authenticated',
      confirmedOpenid,
      userScope,
      // Remote identity hydration for the same owner must not invalidate a
      // snapshot captured from the trusted local identity. A real owner
      // change still advances the epoch and invalidates the old context.
      authEpoch: ownerChanged ? previousState.authEpoch + 1 : previousState.authEpoch,
      nickname: normalizeNickname(user.nickname),
      avatarUrl: user.avatarUrl ?? '',
      avatarType: normalizeAvatarType(user.avatarType ?? user.styleProfile?.['avatarType']),
      profileCompleted: Boolean(user.profileCompleted ?? user.styleProfile?.['profileCompleted']),
      preferredStyles: recommendationProfile.styleTags,
      capacityTotal: normalizeCapacityTotal(user.capacity?.limit ?? user.capacityTotal),
      capacityUsed: normalizeCapacityUsed(user.capacity?.used ?? user.capacityUsed),
      membershipTier: user.membershipTier,
      isLoggedIn: true,
    });
    // Remote login is the business result. Local persistence is a bounded
    // recoverability enhancement and never reverses an authenticated runtime.
    bootstrapProjectionStore.writeAuthResume({
      userId: user.id,
      confirmedOpenid,
      userScope,
      updatedAt: new Date().toISOString(),
    });
    bootstrapProjectionStore.writeProfileBootstrap(toProfileBootstrap(user, userScope));
  } catch (err) {
    if (requestVersion === authRequestVersion) {
      console.error(errorLabel, err);
      clearFailedAuthState(set, get);
    }
    throw err;
  }
}

function clearFailedAuthState(set: (partial: Partial<UserState>) => void, get: () => UserState) {
  bootstrapProjectionStore.removeAuthResume();
  bootstrapProjectionStore.removeProfileBootstrap();
  set({
    userId: null,
    openid: null,
    authStatus: 'failed',
    confirmedOpenid: null,
    userScope: null,
    authEpoch: get().authEpoch + 1,
    nickname: DEFAULT_NICKNAME,
    avatarUrl: '',
    avatarType: 'default',
    profileCompleted: false,
    preferredStyles: [],
    recommendationProfile: DEFAULT_RECOMMENDATION_PROFILE,
    capacityTotal: FREE_WARDROBE_LIMIT,
    capacityUsed: 0,
    membershipTier: 'free',
    isLoggedIn: false,
  });
}

function normalizeRecommendationProfile(styleProfile?: Record<string, unknown>): RecommendationProfile {
  const raw = styleProfile?.['recommendationProfile'] as Partial<RecommendationProfile> | undefined;
  const legacyStyles = Array.isArray(styleProfile?.['preferredStyles'])
    ? (styleProfile?.['preferredStyles'] as string[])
    : [];

  return {
    genderPreference: isOneOf(raw?.genderPreference, ['male_style', 'female_style', 'neutral_style', 'all', 'unknown'])
      ? raw.genderPreference
      : DEFAULT_RECOMMENDATION_PROFILE.genderPreference,
    styleTags: Array.isArray(raw?.styleTags) ? raw.styleTags : legacyStyles,
    fitPreference: isOneOf(raw?.fitPreference, ['loose', 'regular', 'slim', 'oversize', 'unknown'])
      ? raw.fitPreference
      : DEFAULT_RECOMMENDATION_PROFILE.fitPreference,
    colorPreference: Array.isArray(raw?.colorPreference) ? raw.colorPreference : [],
    avoidTags: Array.isArray(raw?.avoidTags) ? raw.avoidTags : [],
    temperatureSensitivity: isOneOf(raw?.temperatureSensitivity, ['cold_sensitive', 'normal', 'heat_sensitive'])
      ? raw.temperatureSensitivity
      : DEFAULT_RECOMMENDATION_PROFILE.temperatureSensitivity,
  };
}

function isOneOf<T extends string>(value: unknown, options: T[]): value is T {
  return options.includes(value as T);
}

function normalizeNickname(value?: string): string {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === '搭一搭用户' || trimmed === '新用户') return DEFAULT_NICKNAME;
  return trimmed;
}

function normalizeAvatarType(value: unknown): AvatarType {
  return value === 'wechat' || value === 'preset' || value === 'default' ? value : 'default';
}

function normalizeCapacityTotal(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return FREE_WARDROBE_LIMIT;
  return Math.max(FREE_WARDROBE_LIMIT, Math.floor(number));
}

function normalizeCapacityUsed(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.floor(number);
}

function getMiniProgramEnvVersion(): string {
  const taroWithAccountInfo = Taro as typeof Taro & {
    getAccountInfoSync?: () => { miniProgram?: { envVersion?: string } };
  };
  const envVersion = taroWithAccountInfo.getAccountInfoSync?.().miniProgram?.envVersion;
  return typeof envVersion === 'string' && envVersion ? envVersion : 'unknown';
}

function readCachedUserIdentity(): CachedUserIdentity | null {
  const auth = bootstrapProjectionStore.readAuthResume();
  if (!auth?.confirmedOpenid || !auth.userId) return null;

  const expectedScope = buildUserScope({
    envVersion: getMiniProgramEnvVersion(),
    cloudEnvId: CLOUD_ENV_ID,
    confirmedOpenid: auth.confirmedOpenid,
  });
  if (!expectedScope || auth.userScope !== expectedScope) return null;

  const profile = bootstrapProjectionStore.readProfileBootstrap();
  return {
    auth,
    profile: profile?.userScope === expectedScope && profile.userId === auth.userId ? profile : null,
  };
}

function toProfileBootstrap(user: CloudUserProfile, userScope: string): ProfileBootstrapV2 {
  return {
    userScope,
    userId: user.id,
    nickname: normalizeNickname(user.nickname),
    avatarUrl: user.avatarUrl ?? '',
    avatarType: normalizeAvatarType(user.avatarType ?? user.styleProfile?.['avatarType']),
    profileCompleted: Boolean(user.profileCompleted ?? user.styleProfile?.['profileCompleted']),
    recommendationProfile: normalizeRecommendationProfile(user.styleProfile),
    capacityTotal: normalizeCapacityTotal(user.capacity?.limit ?? user.capacityTotal),
    capacityUsed: normalizeCapacityUsed(user.capacity?.used ?? user.capacityUsed),
    membershipTier: user.membershipTier,
    profileRevision: user.updatedAt,
  };
}

function persistCurrentProfileBootstrap(state: UserState) {
  if (!state.userId || !state.userScope || state.authStatus !== 'authenticated') return;
  bootstrapProjectionStore.writeProfileBootstrap({
    userScope: state.userScope,
    userId: state.userId,
    nickname: state.nickname,
    avatarUrl: state.avatarUrl,
    avatarType: state.avatarType,
    profileCompleted: state.profileCompleted,
    recommendationProfile: state.recommendationProfile,
    capacityTotal: state.capacityTotal,
    capacityUsed: state.capacityUsed,
    membershipTier: state.membershipTier,
  });
}

function clearUserScopedRecovery(userScope: string | null) {
  if (!userScope) return;
  const address = { scope: userScope };
  bootstrapProjectionStore.removeTodayBootstrap(address);
  bootstrapProjectionStore.removeWardrobeBootstrap(address);
  bootstrapProjectionStore.removeUploadWorkflow(address);
}
