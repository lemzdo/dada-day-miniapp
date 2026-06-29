// ============================================================
// 用户状态管理 — Zustand store
// ============================================================

import { create } from 'zustand';
import Taro from '@tarojs/taro';
import { loginWithCloud, updateCloudUserProfile } from '@/lib/cloud';
import { CLOUD_ENV_ID } from '@/config/cloud';
import { buildUserScope } from '@/lib/userScope';
import type { RecommendationProfile } from '@starter-template/types';
import { DEFAULT_RECOMMENDATION_PROFILE } from '@/constants/recommendationProfile';
import { DEFAULT_WARDROBE_LIMIT } from '@/constants/wardrobeCapacity';

const USER_ID_KEY = 'userId';
const DEFAULT_NICKNAME = '搭搭新朋友';
const FREE_WARDROBE_LIMIT = DEFAULT_WARDROBE_LIMIT;
type AvatarType = 'wechat' | 'preset' | 'default';
export type AuthStatus = 'initializing' | 'authenticated' | 'anonymous' | 'failed';

export interface ActiveAuthContext {
  userScope: string;
  confirmedOpenid: string;
  authEpoch: number;
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

export const useUserStore = create<UserState>((set, get) => ({
  userId: Taro.getStorageSync(USER_ID_KEY) || null,
  openid: Taro.getStorageSync('openid') || null,
  authStatus: 'initializing',
  confirmedOpenid: null,
  userScope: null,
  authEpoch: 0,
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

  login: async () => {
    await runAuthenticatedProfileRequest('Login error:', set, get);
  },

  logout: () => {
    authRequestVersion += 1;
    initializeAuthPromise = null;
    Taro.removeStorageSync(USER_ID_KEY);
    Taro.removeStorageSync('openid');
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
  },

  saveRecommendationProfile: async (profile: RecommendationProfile) => {
    const normalized = normalizeRecommendationProfile({ recommendationProfile: profile });
    await updateCloudUserProfile(normalized);
    set({ recommendationProfile: normalized, preferredStyles: normalized.styleTags });
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

    const recommendationProfile = normalizeRecommendationProfile(user.styleProfile);
    set({
      recommendationProfile,
      userId: user.id,
      openid: confirmedOpenid,
      authStatus: 'authenticated',
      confirmedOpenid,
      userScope,
      authEpoch: get().authEpoch + 1,
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
    Taro.setStorageSync(USER_ID_KEY, user.id);
    Taro.setStorageSync('openid', confirmedOpenid);
  } catch (err) {
    if (requestVersion === authRequestVersion) {
      console.error(errorLabel, err);
      clearFailedAuthState(set, get);
    }
    throw err;
  }
}

function clearFailedAuthState(set: (partial: Partial<UserState>) => void, get: () => UserState) {
  Taro.removeStorageSync(USER_ID_KEY);
  Taro.removeStorageSync('openid');
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
