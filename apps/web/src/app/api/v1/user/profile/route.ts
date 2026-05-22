// ============================================================
// GET /api/v1/user/profile
// PUT /api/v1/user/profile
// Phase 1: 接入数据库
// ============================================================

import { NextResponse } from 'next/server';
import { getUserIdFromRequest, isAuthError } from '@/lib/auth';
import { getUserProfile, updateUserProfile } from '@/lib/db/repositories';
import { normalizeRecommendationProfile } from '@starter-template/utils';

export async function GET(request: Request) {
  try {
    const userId = getUserIdFromRequest(request);
    const profile = await getUserProfile(userId);

    if (!profile) {
      return NextResponse.json(
        { code: 1, data: null, message: 'user not found' },
        { status: 404 },
      );
    }

    const styleProfile = profile.styleProfile ?? { preferredStyles: [] };
    const recommendationProfile = normalizeRecommendationProfile(styleProfile);
    const avatarType = readAvatarType(styleProfile['avatarType']);

    return NextResponse.json({
      code: 0,
      data: {
        id: profile.id,
        nickname: normalizeNickname(profile.nickname),
        avatarUrl: profile.avatarUrl ?? '',
        avatarType,
        profileCompleted: Boolean(styleProfile['profileCompleted']),
        styleProfile: {
          ...styleProfile,
          avatarType,
          profileCompleted: Boolean(styleProfile['profileCompleted']),
          preferredStyles: recommendationProfile.styleTags,
          recommendationProfile,
        },
        recommendationProfile,
        capacityTotal: profile.capacityTotal ?? 50,
        capacityUsed: profile.capacityUsed ?? 0,
        membershipTier: profile.membershipTier ?? 'free',
        updatedAt: profile.updatedAt.toISOString(),
      },
      message: 'ok',
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { code: 1, data: null, message: error.message },
        { status: 401 },
      );
    }

    console.error('[user/profile GET] error:', error);
    return NextResponse.json(
      { code: 1, data: null, message: 'internal error' },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const userId = getUserIdFromRequest(request);
    const body = await request.json().catch(() => ({}));
    const current = await getUserProfile(userId);
    const currentStyleProfile = current?.styleProfile ?? {};
    const hasProfileMeta = isAvatarType(body?.['avatarType']) || typeof body?.['profileCompleted'] === 'boolean';
    const styleProfile =
      body?.['styleProfile'] && typeof body['styleProfile'] === 'object'
        ? { ...currentStyleProfile, ...(body['styleProfile'] as Record<string, unknown>) }
        : hasProfileMeta
          ? { ...currentStyleProfile }
          : undefined;
    const avatarType = isAvatarType(body?.['avatarType']) ? body['avatarType'] : undefined;

    if (styleProfile && avatarType) styleProfile['avatarType'] = avatarType;
    if (styleProfile && typeof body?.['profileCompleted'] === 'boolean') {
      styleProfile['profileCompleted'] = body['profileCompleted'];
    }

    const updated = await updateUserProfile(userId, {
      nickname: typeof body?.['nickname'] === 'string' ? normalizeNickname(body['nickname']) : undefined,
      avatarUrl: typeof body?.['avatarUrl'] === 'string' ? body['avatarUrl'] : undefined,
      styleProfile,
    });

    return NextResponse.json({
      code: 0,
      data: { ok: !!updated },
      message: 'ok',
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { code: 1, data: null, message: error.message },
        { status: 401 },
      );
    }

    console.error('[user/profile PUT] error:', error);
    return NextResponse.json(
      { code: 1, data: null, message: 'update failed' },
      { status: 500 },
    );
  }
}

function normalizeNickname(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === '搭一搭用户' || trimmed === '新用户') return '搭搭新朋友';
  return trimmed;
}

function readAvatarType(value: unknown) {
  return isAvatarType(value) ? value : 'default';
}

function isAvatarType(value: unknown): value is 'wechat' | 'preset' | 'default' {
  return value === 'wechat' || value === 'preset' || value === 'default';
}
