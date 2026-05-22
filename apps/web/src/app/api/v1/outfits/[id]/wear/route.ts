// ============================================================
// 确认穿着 API
// POST /api/v1/outfits/[id]/wear - 确认今日穿着此搭配
// ============================================================

import { NextResponse } from 'next/server';
import { getUserIdFromRequest, isAuthError } from '@/lib/auth';
import {
  getOutfitById,
  markAsWorn,
  createHistory,
} from '@/lib/db/repositories';
import type { OutfitHistory, SceneTag, TimeOfDay, WeatherSnapshot } from '@starter-template/types';

// ── POST /api/v1/outfits/[id]/wear ───────────────────────────

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const userId = getUserIdFromRequest(request);
    const body = await request.json().catch(() => ({}));

    // 1. 获取穿搭方案
    const outfit = await getOutfitById(id);
    if (!outfit) {
      return NextResponse.json(
        { code: 1, data: null, message: 'outfit not found' },
        { status: 404 },
      );
    }

    // 2. 权限检查
    if (outfit.userId !== userId) {
      return NextResponse.json(
        { code: 1, data: null, message: 'forbidden' },
        { status: 403 },
      );
    }

    // 3. 标记为已穿
    await markAsWorn(id);

    // 4. 创建历史记录
    const today = new Date().toISOString().split('T')[0];
    const history = await createHistory({
      userId,
      outfitId: id,
      clothingIds: outfit.clothingIds,
      wearDate: body.date ?? today,
      timeOfDay: body.timeOfDay ?? outfit.timeOfDay ?? 'all_day',
      scene: body.scene ?? outfit.scene ?? undefined,
      weatherSnapshot: body.weatherSnapshot ?? outfit.weatherSnapshot ?? undefined,
      notes: body.notes,
    });

    const response: OutfitHistory = {
      id: history.id,
      userId: history.userId,
      outfitId: history.outfitId ?? undefined,
      clothingIds: history.clothingIds,
      wearDate: history.wearDate,
      timeOfDay: history.timeOfDay as TimeOfDay | undefined,
      scene: history.scene as SceneTag | undefined,
      weatherSnapshot: history.weatherSnapshot as unknown as WeatherSnapshot | undefined,
      satisfaction: history.satisfaction ?? undefined,
      notes: history.notes ?? undefined,
      createdAt: history.createdAt.toISOString(),
    };

    return NextResponse.json({
      code: 0,
      data: response,
      message: 'ok',
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { code: 1, data: null, message: error.message },
        { status: 401 },
      );
    }

    console.error('[outfits/[id]/wear POST]', error);
    return NextResponse.json(
      { code: 1, data: null, message: 'wear record failed' },
      { status: 500 },
    );
  }
}
