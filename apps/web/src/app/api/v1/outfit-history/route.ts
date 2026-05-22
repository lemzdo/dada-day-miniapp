// ============================================================
// 穿搭历史 API
// GET /api/v1/outfit-history - 历史列表
// ============================================================

import { NextResponse } from 'next/server';
import { getUserIdFromRequest, isAuthError } from '@/lib/auth';
import { getHistoryByUser, getHistoryStats } from '@/lib/db/repositories';
import type { OutfitHistory, HistoryStats, SceneTag, TimeOfDay, WeatherSnapshot } from '@starter-template/types';

// ── GET /api/v1/outfit-history ───────────────────────────────

export async function GET(request: Request) {
  try {
    const userId = getUserIdFromRequest(request);
    const { searchParams } = new URL(request.url);

    const startDate = searchParams.get('startDate') ?? undefined;
    const endDate = searchParams.get('endDate') ?? undefined;
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
    const pageSize = Math.min(50, Math.max(1, parseInt(searchParams.get('pageSize') ?? '20', 10)));

    const [result, stats] = await Promise.all([
      getHistoryByUser({ userId, startDate, endDate, page, pageSize }),
      getHistoryStats(userId),
    ]);

    const histories: OutfitHistory[] = result.list.map((h) => ({
      id: h.id,
      userId: h.userId,
      outfitId: h.outfitId ?? undefined,
      clothingIds: h.clothingIds,
      wearDate: h.wearDate,
      timeOfDay: h.timeOfDay as TimeOfDay | undefined,
      scene: h.scene as SceneTag | undefined,
      weatherSnapshot: h.weatherSnapshot as unknown as WeatherSnapshot | undefined,
      satisfaction: h.satisfaction ?? undefined,
      notes: h.notes ?? undefined,
      createdAt: h.createdAt.toISOString(),
    }));

    const historyStats: HistoryStats = {
      totalDays: stats.totalDays,
      avgSatisfaction: stats.avgSatisfaction as unknown as number,
      topItems: stats.topItems.map((item) => item.clothingId),
    };

    return NextResponse.json({
      code: 0,
      data: {
        list: histories,
        stats: historyStats,
        pagination: {
          total: result.total,
          page: result.page,
          pageSize: result.pageSize,
          totalPages: Math.ceil(result.total / result.pageSize),
        },
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

    console.error('[outfit-history GET]', error);
    return NextResponse.json(
      { code: 1, data: null, message: 'internal error' },
      { status: 500 },
    );
  }
}
