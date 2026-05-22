// ============================================================
// 穿搭方案 API
// GET  /api/v1/outfits - 穿搭列表
// ============================================================

import { NextResponse } from 'next/server';
import { getUserIdFromRequest, isAuthError } from '@/lib/auth';
import { getOutfitsByUser } from '@/lib/db/repositories';
import type { Outfit, SceneTag, TimeOfDay, WeatherSnapshot, OutfitScores, GenerationType } from '@starter-template/types';

// ── GET /api/v1/outfits ─────────────────────────────────────

export async function GET(request: Request) {
  try {
    const userId = getUserIdFromRequest(request);
    const { searchParams } = new URL(request.url);

    const scene = searchParams.get('scene') ?? undefined;
    const isFavorite = searchParams.get('isFavorite');
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
    const pageSize = Math.min(50, Math.max(1, parseInt(searchParams.get('pageSize') ?? '20', 10)));

    const result = await getOutfitsByUser({
      userId,
      scene,
      isFavorite: isFavorite === 'true' ? true : isFavorite === 'false' ? false : undefined,
      page,
      pageSize,
    });

    const outfits: Outfit[] = result.list.map((o) => ({
      id: o.id,
      userId: o.userId,
      title: o.title ?? undefined,
      clothingIds: o.clothingIds,
      scene: o.scene as SceneTag | undefined,
      targetDate: o.targetDate ?? undefined,
      timeOfDay: o.timeOfDay as TimeOfDay | undefined,
      weatherSnapshot: o.weatherSnapshot as unknown as WeatherSnapshot | undefined,
      scores: o.scores as unknown as OutfitScores | undefined,
      scoreExplanations: o.scoreExplanations as { dimension: string; score: number; text: string }[] | undefined,
      generationType: o.generationType as unknown as GenerationType | undefined,
      sourceItemId: o.sourceItemId ?? undefined,
      isFavorite: o.isFavorite ?? false,
      isWornToday: o.isWornToday ?? false,
      createdAt: o.createdAt.toISOString(),
      updatedAt: o.updatedAt.toISOString(),
    }));

    return NextResponse.json({
      code: 0,
      data: {
        list: outfits,
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

    console.error('[outfits GET]', error);
    return NextResponse.json(
      { code: 1, data: null, message: 'internal error' },
      { status: 500 },
    );
  }
}
