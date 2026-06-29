// ============================================================
// 搭一搭 · 衣服 Repository
// ============================================================

import { eq, and, desc, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { clothes } from '@/lib/db/schema';
import {
  buildWardrobeCapacity,
  createWardrobeCapacityExceeded,
  resolveWardrobeEntitlement,
} from '@/lib/wardrobe-capacity';

export interface ClothesListParams {
  userId: string;
  category?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}

// ── 查询 ──

/** 获取衣服列表（分页 + 筛选） */
export async function getClothesList(params: ClothesListParams) {
  const { userId, category, status, page = 1, pageSize = 20 } = params;

  const conditions = [eq(clothes.userId, userId)];
  if (category) conditions.push(eq(clothes.category, category));
  if (status) conditions.push(eq(clothes.status, status));

  const where = and(...conditions);

  const [list, totalResult] = await Promise.all([
    db
      .select()
      .from(clothes)
      .where(where)
      .orderBy(desc(clothes.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(clothes)
      .where(where),
  ]);

  return {
    list,
    total: totalResult[0]?.count ?? 0,
    page,
    pageSize,
  };
}

/** 获取衣服详情 */
export async function getClothingById(id: string) {
  const rows = await db.select().from(clothes).where(eq(clothes.id, id)).limit(1);
  return rows[0] ?? null;
}

/** 获取用户衣服总数 */
export async function getClothesCount(userId: string) {
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(clothes)
    .where(eq(clothes.userId, userId));
  return result[0]?.count ?? 0;
}

export async function getActiveClothesCount(userId: string) {
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(clothes)
    .where(and(eq(clothes.userId, userId), eq(clothes.status, 'active')));
  return result[0]?.count ?? 0;
}

// ── 写入 ──

/** 创建衣服 */
export async function createClothing(data: {
  userId: string;
  imageUrl: string;
  thumbnailUrl?: string;
  category: string;
  subcategory?: string;
  colorPalette?: Array<{ name: string; hex: string; ratio: number }>;
  styleTags?: string[];
  seasonTags?: string[];
  material?: string;
  sceneTags?: string[];
  aiRawResult?: unknown;
  brand?: string;
  batchId?: string;
  sourceBatchId?: string;
  sourceItemId?: string;
  sourceImageId?: string;
  cropBox?: { x: number; y: number; width: number; height: number };
  confidence?: number;
}) {
  const rows = await db
    .insert(clothes)
    .values({
      userId: data.userId,
      imageUrl: data.imageUrl,
      thumbnailUrl: data.thumbnailUrl,
      category: data.category,
      subcategory: data.subcategory,
      colorPalette: data.colorPalette,
      styleTags: data.styleTags,
      seasonTags: data.seasonTags,
      material: data.material,
      sceneTags: data.sceneTags,
      aiRawResult: data.aiRawResult,
      brand: data.brand,
      batchId: data.batchId,
      sourceBatchId: data.sourceBatchId,
      sourceItemId: data.sourceItemId,
      sourceImageId: data.sourceImageId,
      cropBox: data.cropBox,
      confidence: data.confidence,
    })
    .returning();
  return rows[0];
}

export async function createClothingWithCapacityGate(data: Parameters<typeof createClothing>[0]) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select id from users where id = ${data.userId} for update`);
    const usedRows = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(clothes)
      .where(and(eq(clothes.userId, data.userId), eq(clothes.status, 'active')));
    const entitlement = resolveWardrobeEntitlement();
    const capacity = buildWardrobeCapacity({
      used: usedRows[0]?.count ?? 0,
      ...entitlement,
    });

    if (capacity.used + 1 > capacity.limit) {
      throw createWardrobeCapacityExceeded({ capacity, requested: 1 });
    }

    const rows = await tx
      .insert(clothes)
      .values({
        userId: data.userId,
        imageUrl: data.imageUrl,
        thumbnailUrl: data.thumbnailUrl,
        category: data.category,
        subcategory: data.subcategory,
        colorPalette: data.colorPalette,
        styleTags: data.styleTags,
        seasonTags: data.seasonTags,
        material: data.material,
        sceneTags: data.sceneTags,
        aiRawResult: data.aiRawResult,
        brand: data.brand,
        batchId: data.batchId,
        sourceBatchId: data.sourceBatchId,
        sourceItemId: data.sourceItemId,
        sourceImageId: data.sourceImageId,
        cropBox: data.cropBox,
        confidence: data.confidence,
        status: 'active',
      })
      .returning();

    return {
      clothing: rows[0],
      capacity: withLegacyTotal(buildWardrobeCapacity({
        used: capacity.used + (rows[0] ? 1 : 0),
        ...entitlement,
      })),
    };
  });
}

function withLegacyTotal<T extends { limit: number }>(capacity: T): T & { total: number } {
  return {
    ...capacity,
    total: capacity.limit,
  };
}

/** 更新衣服 */
export async function updateClothing(id: string, data: Record<string, unknown>) {
  const rows = await db
    .update(clothes)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(clothes.id, id))
    .returning();
  return rows[0] ?? null;
}

/** 删除衣服（软删除 → 归档） */
export async function archiveClothing(id: string) {
  const rows = await db
    .update(clothes)
    .set({ status: 'archived', updatedAt: new Date() })
    .where(eq(clothes.id, id))
    .returning();
  return rows[0] ?? null;
}

/** 硬删除衣服 */
export async function deleteClothing(id: string) {
  const rows = await db
    .delete(clothes)
    .where(eq(clothes.id, id))
    .returning();
  return rows[0] ?? null;
}
