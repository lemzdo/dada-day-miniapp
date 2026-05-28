// ============================================================
// 单件衣服 API
// GET    /api/v1/clothes/[id] - 获取详情
// PUT    /api/v1/clothes/[id] - 更新信息
// DELETE /api/v1/clothes/[id] - 删除（归档）
// ============================================================

import { NextResponse } from 'next/server';
import { getUserIdFromRequest, isAuthError } from '@/lib/auth';
import {
  getClothingById,
  updateClothing,
  archiveClothing,
} from '@/lib/db/repositories';
import type { ClothingCategory } from '@starter-template/types';

// 数据库行类型
interface ClothingRow {
  id: string;
  userId: string;
  imageUrl: string;
  thumbnailUrl: string | null;
  batchId: string | null;
  sourceBatchId: string | null;
  sourceItemId: string | null;
  sourceImageId: string | null;
  cropBox: { x: number; y: number; width: number; height: number } | null;
  confidence: number | null;
  category: string;
  subcategory: string | null;
  colorPalette: Array<{ name: string; hex: string; ratio: number }> | null;
  styleTags: string[] | null;
  seasonTags: string[] | null;
  material: string | null;
  sceneTags: string[] | null;
  aiRawResult: unknown | null;
  customName: string | null;
  customCategory: string | null;
  customTags: string[] | null;
  capacityCost: number | null;
  status: string | null;
  brand: string | null;
  purchaseDate: string | null;
  usageCount: number | null;
  lastWornAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// ── GET /api/v1/clothes/[id] ────────────────────────────────

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const userId = getUserIdFromRequest(request);
    const clothing = await getClothingById(id);

    if (!clothing) {
      return NextResponse.json(
        { code: 1, data: null, message: 'not found' },
        { status: 404 },
      );
    }
    if (clothing.userId !== userId) {
      return NextResponse.json(
        { code: 1, data: null, message: 'forbidden' },
        { status: 403 },
      );
    }

    return NextResponse.json({
      code: 0,
      data: formatClothingResponse(clothing),
      message: 'ok',
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { code: 1, data: null, message: error.message },
        { status: 401 },
      );
    }

    console.error('[clothes/[id] GET]', error);
    return NextResponse.json(
      { code: 1, data: null, message: 'internal error' },
      { status: 500 },
    );
  }
}

// ── PUT /api/v1/clothes/[id] ────────────────────────────────

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const userId = getUserIdFromRequest(request);
    const body = await request.json().catch(() => ({}));

    // 安全检查
    const clothing = await getClothingById(id);
    if (!clothing) {
      return NextResponse.json(
        { code: 1, data: null, message: 'not found' },
        { status: 404 },
      );
    }
    if (clothing.userId !== userId) {
      return NextResponse.json(
        { code: 1, data: null, message: 'forbidden' },
        { status: 403 },
      );
    }

    // 允许更新的字段
    const updateData: Record<string, unknown> = {};
    const allowedFields = [
      'customName', 'customCategory', 'customTags', 'category', 'brand', 'purchaseDate',
    ] as const;
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field];
      }
    }

    const updated = await updateClothing(id, updateData);

    return NextResponse.json({
      code: 0,
      data: updated ? formatClothingResponse(updated) : null,
      message: 'ok',
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { code: 1, data: null, message: error.message },
        { status: 401 },
      );
    }

    console.error('[clothes/[id] PUT]', error);
    return NextResponse.json(
      { code: 1, data: null, message: 'update failed' },
      { status: 500 },
    );
  }
}

// ── DELETE /api/v1/clothes/[id] ─────────────────────────────

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const userId = getUserIdFromRequest(_request);

    // 安全检查
    const clothing = await getClothingById(id);
    if (!clothing) {
      return NextResponse.json(
        { code: 1, data: null, message: 'not found' },
        { status: 404 },
      );
    }
    if (clothing.userId !== userId) {
      return NextResponse.json(
        { code: 1, data: null, message: 'forbidden' },
        { status: 403 },
      );
    }

    // 软删除（归档）
    await archiveClothing(id);

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

    console.error('[clothes/[id] DELETE]', error);
    return NextResponse.json(
      { code: 1, data: null, message: 'delete failed' },
      { status: 500 },
    );
  }
}

// ── 辅助函数 ─────────────────────────────────────────────────

function formatClothingResponse(c: ClothingRow) {
  return {
    id: c.id,
    userId: c.userId,
    imageUrl: c.imageUrl,
    thumbnailUrl: c.thumbnailUrl ?? undefined,
    batchId: c.batchId ?? undefined,
    sourceBatchId: c.sourceBatchId ?? undefined,
    sourceItemId: c.sourceItemId ?? undefined,
    sourceImageId: c.sourceImageId ?? undefined,
    cropBox: c.cropBox ?? undefined,
    confidence: c.confidence ?? undefined,
    category: c.category as ClothingCategory,
    subcategory: c.subcategory ?? undefined,
    colorPalette: c.colorPalette,
    styleTags: c.styleTags ?? [],
    seasonTags: c.seasonTags ?? [],
    material: c.material ?? undefined,
    sceneTags: c.sceneTags ?? [],
    customName: c.customName ?? undefined,
    customCategory: c.customCategory ?? undefined,
    customTags: c.customTags ?? [],
    capacityCost: c.capacityCost ?? 1,
    status: c.status ?? 'active',
    brand: c.brand ?? undefined,
    purchaseDate: c.purchaseDate ?? undefined,
    usageCount: c.usageCount ?? 0,
    lastWornAt: c.lastWornAt instanceof Date ? c.lastWornAt.toISOString() : c.lastWornAt ?? undefined,
    createdAt: c.createdAt instanceof Date ? c.createdAt.toISOString() : c.createdAt,
    updatedAt: c.updatedAt instanceof Date ? c.updatedAt.toISOString() : c.updatedAt,
  };
}
