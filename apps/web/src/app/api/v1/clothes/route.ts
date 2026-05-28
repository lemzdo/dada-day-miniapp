// ============================================================
// 琛ｆ湇 API
// GET  /api/v1/clothes          - 琛ｆ湇鍒楄〃锛堝垎椤?绛涢€夛級
// POST /api/v1/clothes          - 涓婁紶琛ｆ湇 + AI 璇嗗埆
// ============================================================

import { NextResponse } from 'next/server';
import { getUserIdFromRequest, isAuthError } from '@/lib/auth';
import { getClothesList, createClothing } from '@/lib/db/repositories';
import { storage } from '@/lib/storage';
import { smartProvider } from '@starter-template/ai';
import type { ClothingCategory, RecognizedClothingItem } from '@starter-template/types';

// 鏁版嵁搴撹绫诲瀷锛堜笌 Drizzle schema 涓€鑷达級
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

// 鈹€鈹€ GET /api/v1/clothes 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

export async function GET(request: Request) {
  try {
    const userId = getUserIdFromRequest(request);
    const { searchParams } = new URL(request.url);

    const category = searchParams.get('category') ?? undefined;
    const status = searchParams.get('status') ?? 'active';
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
    const pageSize = Math.min(50, Math.max(1, parseInt(searchParams.get('pageSize') ?? '20', 10)));

    const result = await getClothesList({ userId, category, status, page, pageSize });

    return NextResponse.json({
      code: 0,
      data: {
        list: result.list.map(formatClothingResponse),
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

    console.error('[clothes GET]', error);
    return NextResponse.json(
      { code: 1, data: null, message: 'internal error' },
      { status: 500 },
    );
  }
}

// 鈹€鈹€ POST /api/v1/clothes 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

export async function POST(request: Request) {
  let tempUploadUrl: string | undefined;

  try {
    const userId = getUserIdFromRequest(request);
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const category = formData.get('category') as string | null;

    if (!file) {
      return NextResponse.json(
        { code: 1, data: null, message: 'file is required' },
        { status: 400 },
      );
    }

    if (!category) {
      return NextResponse.json(
        { code: 1, data: null, message: 'category is required' },
        { status: 400 },
      );
    }

    const originalBuffer = Buffer.from(await file.arrayBuffer());
    const tempUpload = await storage.upload(originalBuffer, {
      dir: 'temp_uploads',
      originalName: file.name,
      mimeType: file.type,
    });
    tempUploadUrl = tempUpload.url;

    const baseUrl = process.env['NEXT_PUBLIC_BASE_URL'] || 'http://localhost:3000';
    const fullImageUrl = tempUpload.url.startsWith('http')
      ? tempUpload.url
      : `${baseUrl}${tempUpload.url}`;

    let recognitionItems: RecognizedClothingItem[];
    try {
      const recognition = await smartProvider.recognizeClothing({
        imageUrl: fullImageUrl,
        hint: category,
      });
      recognitionItems = recognition.items?.length ? recognition.items : [recognition];
    } catch (aiError) {
      console.error('[AI Recognition] Failed:', aiError);
      return NextResponse.json(
        {
          code: 2,
          data: {
            reason: 'recognition_failed',
            manualCropRequired: true,
          },
          message: 'recognition failed, please crop manually or upload again',
        },
        { status: 422 },
      );
    }

    const usableItems = recognitionItems.filter((item) => isUsableBBox(item.bbox));
    if (usableItems.length === 0) {
      return NextResponse.json(
        {
          code: 2,
          data: {
            reason: 'bbox_low_confidence',
            manualCropRequired: true,
            items: recognitionItems,
          },
          message: 'clothing bbox is not reliable, please crop manually or upload again',
        },
        { status: 422 },
      );
    }

    const created = [];
    for (const [index, item] of usableItems.entries()) {
      const bbox = item.bbox;
      if (!isUsableBBox(bbox)) continue;

      const clothingUpload = await storage.upload(originalBuffer, {
        dir: `wardrobe/${userId}/clothes`,
        originalName: `${file.name.replace(/\.[^.]+$/, '')}-${index + 1}-${file.name}`,
        mimeType: file.type,
        thumbnail: true,
      });

      const clothing = await createClothing({
        userId,
        imageUrl: clothingUpload.url,
        thumbnailUrl: clothingUpload.thumbnailUrl,
        category: item.category || category,
        subcategory: item.subcategory,
        colorPalette: item.colors,
        styleTags: item.styleTags ?? [],
        seasonTags: item.seasonTags ?? [],
        material: item.material,
        sceneTags: item.sceneTags ?? [],
        aiRawResult: {
          ...item,
          source: 'original_from_temp_upload',
          bbox,
          privacy: {
            originalImagePersisted: false,
          },
        },
        batchId: undefined,
        sourceImageId: undefined,
        cropBox: bbox,
        confidence: item.confidence ? Math.round(item.confidence * 100) : undefined,
      });

      if (clothing) {
        created.push(formatClothingResponse(clothing));
      }
    }

    if (created.length === 0) {
      return NextResponse.json(
        { code: 1, data: null, message: 'create failed' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      code: 0,
      data: created.length === 1 ? created[0] : { list: created },
      message: 'ok',
    });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { code: 1, data: null, message: error.message },
        { status: 401 },
      );
    }

    console.error('[clothes POST]', error);
    return NextResponse.json(
      { code: 1, data: null, message: 'upload failed' },
      { status: 500 },
    );
  } finally {
    if (tempUploadUrl) {
      await storage.delete(tempUploadUrl);
    }
  }
}

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

function isUsableBBox(bbox: RecognizedClothingItem['bbox']) {
  if (!bbox) return false;
  return Number.isFinite(bbox.x)
    && Number.isFinite(bbox.y)
    && Number.isFinite(bbox.width)
    && Number.isFinite(bbox.height)
    && bbox.width > 0
    && bbox.height > 0;
}
