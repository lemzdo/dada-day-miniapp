// ============================================================
// 单条穿搭历史 API
// PUT /api/v1/outfit-history/[id] - 评价历史（满意度）
// ============================================================

import { NextResponse } from 'next/server';
import { getUserIdFromRequest, isAuthError } from '@/lib/auth';
import { getHistoryWithItemsById, updateHistorySatisfaction } from '@/lib/db/repositories';
import type { OutfitHistory, SceneTag, TimeOfDay, WeatherSnapshot } from '@starter-template/types';

// ── PUT /api/v1/outfit-history/[id] ──────────────────────────

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const userId = getUserIdFromRequest(request);
    const body = await request.json().catch(() => ({}));

    // 1. 获取历史记录
    const history = await getHistoryWithItemsById(id);
    if (!history) {
      return NextResponse.json(
        { code: 1, data: null, message: 'not found' },
        { status: 404 },
      );
    }

    // 2. 权限检查
    if (history.userId !== userId) {
      return NextResponse.json(
        { code: 1, data: null, message: 'forbidden' },
        { status: 403 },
      );
    }

    // 3. 更新满意度
    const satisfaction = typeof body.satisfaction === 'number' ? body.satisfaction : undefined;
    const notes = typeof body.notes === 'string' ? body.notes : undefined;

    if (satisfaction === undefined) {
      return NextResponse.json(
        { code: 1, data: null, message: 'satisfaction is required' },
        { status: 400 },
      );
    }

    const updated = await updateHistorySatisfaction(id, satisfaction, notes);

    const response: OutfitHistory = {
      id: updated!.id,
      userId: updated!.userId,
      outfitId: updated!.outfitId ?? undefined,
      clothingIds: updated!.clothingIds,
      wearDate: updated!.wearDate,
      timeOfDay: updated!.timeOfDay as TimeOfDay | undefined,
      scene: updated!.scene as SceneTag | undefined,
      weatherSnapshot: updated!.weatherSnapshot as unknown as WeatherSnapshot | undefined,
      satisfaction: updated!.satisfaction ?? undefined,
      notes: updated!.notes ?? undefined,
      createdAt: updated!.createdAt.toISOString(),
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

    console.error('[outfit-history/[id] PUT]', error);
    return NextResponse.json(
      { code: 1, data: null, message: 'update failed' },
      { status: 500 },
    );
  }
}
