// ============================================================
// 用户状态管理 — Zustand store
// ============================================================

import { create } from 'zustand';
import Taro from '@tarojs/taro';
import { loginWithCloud, updateCloudUserProfile } from '@/lib/cloud';
import type { RecommendationProfile } from '@starter-template/types';
import { DEFAULT_RECOMMENDATION_PROFILE } from '@/constants/recommendationProfile';

const USER_ID_KEY = 'userId';
const DEFAULT_NICKNAME = '搭搭新朋友';
type AvatarType = 'wechat' | 'preset' | 'default';

interface UserState {
  userId: string | null;
  openid: string | null;
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

export const useUserStore = create<UserState>((set, get) => ({
  userId: Taro.getStorageSync(USER_ID_KEY) || null,
  openid: Taro.getStorageSync('openid') || null,
  nickname: DEFAULT_NICKNAME,
  avatarUrl: '',
  avatarType: 'default',
  profileCompleted: false,
  preferredStyles: [],
  recommendationProfile: DEFAULT_RECOMMENDATION_PROFILE,
  capacityTotal: 50,
  capacityUsed: 0,
  membershipTier: 'free',
  isLoggedIn: false,

  login: async () => {
    try {
      const user = await loginWithCloud();
      set({
        recommendationProfile: normalizeRecommendationProfile(user.styleProfile),
        userId: user.id,
        openid: user.openid,
        nickname: normalizeNickname(user.nickname),
        avatarUrl: user.avatarUrl ?? '',
        avatarType: normalizeAvatarType(user.avatarType ?? user.styleProfile?.['avatarType']),
        profileCompleted: Boolean(user.profileCompleted ?? user.styleProfile?.['profileCompleted']),
        preferredStyles: normalizeRecommendationProfile(user.styleProfile).styleTags,
        capacityTotal: user.capacityTotal,
        capacityUsed: user.capacityUsed,
        membershipTier: user.membershipTier,
        isLoggedIn: true,
      });
      Taro.setStorageSync(USER_ID_KEY, user.id);
      Taro.setStorageSync('openid', user.openid);
    } catch (err) {
      console.error('Login error:', err);
      get().logout();
      throw err;
    }
  },

  logout: () => {
    Taro.removeStorageSync(USER_ID_KEY);
    Taro.removeStorageSync('openid');
    set({
      userId: null,
      openid: null,
      nickname: DEFAULT_NICKNAME,
      avatarUrl: '',
      avatarType: 'default',
      profileCompleted: false,
      preferredStyles: [],
      recommendationProfile: DEFAULT_RECOMMENDATION_PROFILE,
      isLoggedIn: false,
    });
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
    try {
      const p = await loginWithCloud();
      const recommendationProfile = normalizeRecommendationProfile(p.styleProfile);
      set({
        userId: p.id,
        nickname: normalizeNickname(p.nickname),
        avatarUrl: p.avatarUrl ?? '',
        avatarType: normalizeAvatarType(p.avatarType ?? p.styleProfile?.['avatarType']),
        profileCompleted: Boolean(p.profileCompleted ?? p.styleProfile?.['profileCompleted']),
        preferredStyles: recommendationProfile.styleTags,
        recommendationProfile,
        capacityTotal: p.capacityTotal,
        capacityUsed: p.capacityUsed,
        membershipTier: p.membershipTier,
        isLoggedIn: true,
      });
      Taro.setStorageSync(USER_ID_KEY, p.id);
      Taro.setStorageSync('openid', p.openid);
    } catch (err) {
      console.error('Fetch profile error:', err);
      get().logout();
      throw err;
    }
  },
}));

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
