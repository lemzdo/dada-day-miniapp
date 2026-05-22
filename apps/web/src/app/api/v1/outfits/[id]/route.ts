// ============================================================
// 单套穿搭 API
// GET    /api/v1/outfits/[id] - 获取详情
// PUT    /api/v1/outfits/[id] - 更新（收藏/标题等）
// DELETE /api/v1/outfits/[id] - 删除
// ============================================================

import { NextResponse } from 'next/server';
import { getUserIdFromRequest, isAuthError } from '@/lib/auth';
import {
  getOutfitWithItemsById,
  updateOutfit,
  deleteOutfit,
} from '@/lib/db/repositories';
import type { Outfit, SceneTag, TimeOfDay, ClothingCategory, WeatherSnapshot, OutfitScores, GenerationType } from '@starter-template/types';

// ── GET /api/v1/outfits/[id] ────────────────────────────────

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const userId = getUserIdFromRequest(request);
    const outfit = await getOutfitWithItemsById(id);

    if (!outfit) {
      return NextResponse.json(
        { code: 1, data: null, message: 'not found' },
        { status: 404 },
      );
    }
    if (outfit.userId !== userId) {
      return NextResponse.json(
        { code: 1, data: null, message: 'forbidden' },
        { status: 403 },
      );
    }

    const response: Outfit = {
      id: outfit.id,
      userId: outfit.userId,
      title: outfit.title ?? undefined,
      clothingIds: outfit.clothingIds,
      items: outfit.items.map((item) => ({
        clothingId: item.id,
        category: item.category as ClothingCategory,
        subcategory: item.subcategory ?? undefined,
        imageUrl: item.imageUrl,
        colorPalette: item.colorPalette as { name: string; hex: string }[] | undefined,
      })),
      scene: outfit.scene as SceneTag | undefined,
      targetDate: outfit.targetDate ?? undefined,
      timeOfDay: outfit.timeOfDay as TimeOfDay | undefined,
      weatherSnapshot: outfit.weatherSnapshot as unknown as WeatherSnapshot | undefined,
      scores: outfit.scores as unknown as OutfitScores | undefined,
      scoreExplanations: outfit.scoreExplanations as { dimension: string; score: number; text: string }[] | undefined,
      generationType: outfit.generationType as unknown as GenerationType | undefined,
      sourceItemId: outfit.sourceItemId ?? undefined,
      isFavorite: outfit.isFavorite ?? false,
      isWornToday: outfit.isWornToday ?? false,
      createdAt: outfit.createdAt.toISOString(),
      updatedAt: outfit.updatedAt.toISOString(),
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

    console.error('[outfits/[id] GET]', error);
    return NextResponse.json(
      { code: 1, data: null, message: 'internal error' },
      { status: 500 },
    );
  }
}

// ── PUT /api/v1/outfits/[id] ────────────────────────────────

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const userId = getUserIdFromRequest(request);
    const body = await request.json().catch(() => ({}));

    // 安全检查
    const outfit = await getOutfitWithItemsById(id);
    if (!outfit) {
      return NextResponse.json(
        { code: 1, data: null, message: 'not found' },
        { status: 404 },
      );
    }
    if (outfit.userId !== userId) {
      return NextResponse.json(
        { code: 1, data: null, message: 'forbidden' },
        { status: 403 },
      );
    }

    // 允许更新的字段
    const updateData: Record<string, unknown> = {};
    const allowedFields = ['title', 'isFavorite'] as const;
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field];
      }
    }

    const updated = await updateOutfit(id, updateData);

    return NextResponse.json({
      code: 0,
      data: updated ? { id: updated.id, isFavorite: updated.isFavorite } : null,
      message: 'ok',
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { code: 1, data: null, message: error.message },
        { status: 401 },
      );
    }

    console.error('[outfits/[id] PUT]', error);
    return NextResponse.json(
      { code: 1, data: null, message: 'update failed' },
      { status: 500 },
    );
  }
}

// ── DELETE /api/v1/outfits/[id] ─────────────────────────────

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const userId = getUserIdFromRequest(_request);

    // 安全检查
    const outfit = await getOutfitWithItemsById(id);
    if (!outfit) {
      return NextResponse.json(
        { code: 1, data: null, message: 'not found' },
        { status: 404 },
      );
    }
    if (outfit.userId !== userId) {
      return NextResponse.json(
        { code: 1, data: null, message: 'forbidden' },
        { status: 403 },
      );
    }

    await deleteOutfit(id);

    return NextResponse.json({
      code: 0,
      data: { id },
      message: 'ok',
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { code: 1, data: null, message: error.message },
        { status: 401 },
      );
    }

    console.error('[outfits/[id] DELETE]', error);
    return NextResponse.json(
      { code: 1, data: null, message: 'delete failed' },
      { status: 500 },
    );
  }
}
