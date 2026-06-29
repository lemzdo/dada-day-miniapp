// ============================================================
// 用户 API 端点
// ============================================================

import { apiClient } from './client';
import type { LoginResult, RecommendationProfile, WardrobeCapacity } from '@starter-template/types';

/** 微信登录 */
export function wechatLogin(code: string) {
  return apiClient.post<LoginResult>('/auth/wechat-login', { code });
}

/** 获取用户信息 */
export function getUserProfile() {
  return apiClient.get<{
    id: string;
    nickname: string;
    avatarUrl?: string;
    avatarType?: 'wechat' | 'preset' | 'default';
    profileCompleted?: boolean;
    styleProfile: Record<string, unknown>;
    recommendationProfile: RecommendationProfile;
    capacity?: WardrobeCapacity & { total?: number };
    capacityTotal: number;
    capacityUsed: number;
    membershipTier: string;
    updatedAt?: string;
  }>('/user/profile');
}

/** 更新用户资料与风格偏好 */
export function updateUserProfile(data: {
  nickname?: string;
  avatarUrl?: string;
  avatarType?: 'wechat' | 'preset' | 'default';
  profileCompleted?: boolean;
  styleProfile?: Record<string, unknown>;
}) {
  return apiClient.put<{ ok: boolean }>('/user/profile', data);
}

/** 获取容量信息 */
export function getUserCapacity() {
  return apiClient.get<WardrobeCapacity & { total?: number }>('/user/capacity');
}
