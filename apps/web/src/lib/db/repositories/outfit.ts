// ============================================================
// 搭一搭 · 穿搭 Repository
// 穿搭方案 + 穿搭历史的数据访问层
// ============================================================

import { eq, and, desc, asc, sql, isNull, inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import { outfits, outfitHistory, clothes } from '@/lib/db/schema';

// ── 类型定义 ─────────────────────────────────────────────────

export interface OutfitRow {
  id: string;
  userId: string;
  title: string | null;
  clothingIds: string[];
  scene: string | null;
  targetDate: string | null;
  timeOfDay: string | null;
  weatherSnapshot: Record<string, unknown> | null;
  scores: Record<string, number> | null;
  scoreExplanations: unknown[] | null;
  generationType: string | null;
  sourceItemId: string | null;
  isFavorite: boolean | null;
  isWornToday: boolean | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OutfitWithItems extends OutfitRow {
  items: Array<{
    id: string;
    category: string;
    subcategory: string | null;
    imageUrl: string;
    thumbnailUrl: string | null;
    customName: string | null;
    colorPalette: unknown;
  }>;
}

export interface OutfitListParams {
  userId: string;
  scene?: string;
  targetDate?: string;
  isFavorite?: boolean;
  page?: number;
  pageSize?: number;
}

export interface CreateOutfitData {
  userId: string;
  title?: string;
  clothingIds: string[];
  scene?: string;
  targetDate?: string;
  timeOfDay?: string;
  weatherSnapshot?: Record<string, unknown>;
  scores?: Record<string, number>;
  scoreExplanations?: unknown[];
  generationType?: string;
  sourceItemId?: string;
}

export interface FindReusableOutfitParams {
  userId: string;
  clothingIds: string[];
  targetDate: string;
  scene?: string;
  timeOfDay?: string;
}

export interface HistoryRow {
  id: string;
  userId: string;
  outfitId: string | null;
  clothingIds: string[];
  wearDate: string;
  timeOfDay: string | null;
  scene: string | null;
  weatherSnapshot: Record<string, unknown> | null;
  satisfaction: number | null;
  notes: string | null;
  createdAt: Date;
}

export interface HistoryWithItems extends HistoryRow {
  items: Array<{
    id: string;
    category: string;
    imageUrl: string;
    thumbnailUrl: string | null;
    customName: string | null;
  }>;
}

export interface HistoryListParams {
  userId: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
}

export interface CreateHistoryData {
  userId: string;
  outfitId?: string;
  clothingIds: string[];
  wearDate: string;
  timeOfDay?: string;
  scene?: string;
  weatherSnapshot?: Record<string, unknown>;
  satisfaction?: number;
  notes?: string;
}

export interface HistoryStats {
  totalDays: number;
  totalOutfits: number;
  avgSatisfaction: number | null;
  topItems: Array<{ clothingId: string; count: number }>;
}

// ── 穿搭方案 CRUD ────────────────────────────────────────────

/** 创建穿搭方案 */
export async function createOutfit(data: CreateOutfitData): Promise<OutfitRow> {
  const rows = await db
    .insert(outfits)
    .values({
      userId: data.userId,
      title: data.title,
      clothingIds: data.clothingIds,
      scene: data.scene,
      targetDate: data.targetDate,
      timeOfDay: data.timeOfDay,
      weatherSnapshot: data.weatherSnapshot,
      scores: data.scores,
      scoreExplanations: data.scoreExplanations,
      generationType: data.generationType ?? 'auto',
      sourceItemId: data.sourceItemId,
    })
    .returning();
  return rows[0]!;
}

/** 查找同一天、同场景、同衣物组合的已生成穿搭，避免重复落库 */
export async function findReusableOutfit(params: FindReusableOutfitParams): Promise<OutfitRow | null> {
  const { userId, clothingIds, targetDate, scene, timeOfDay } = params;
  const conditions = [
    eq(outfits.userId, userId),
    eq(outfits.targetDate, targetDate),
    eq(outfits.generationType, 'auto'),
  ];

  if (scene) conditions.push(eq(outfits.scene, scene));
  if (timeOfDay) conditions.push(eq(outfits.timeOfDay, timeOfDay));

  const rows = await db
    .select()
    .from(outfits)
    .where(and(...conditions))
    .orderBy(desc(outfits.createdAt));

  const targetSignature = getClothingIdsSignature(clothingIds);
  return rows.find((row) => getClothingIdsSignature(row.clothingIds) === targetSignature) ?? null;
}

/** 根据 ID 获取穿搭方案 */
export async function getOutfitById(id: string): Promise<OutfitRow | null> {
  const rows = await db.select().from(outfits).where(eq(outfits.id, id)).limit(1);
  return rows[0] ?? null;
}

/** 根据 ID 获取穿搭方案（含衣服详情） */
export async function getOutfitWithItemsById(id: string): Promise<OutfitWithItems | null> {
  const outfit = await getOutfitById(id);
  if (!outfit) return null;

  const items = await getOutfitItems(outfit.clothingIds);
  return { ...outfit, items };
}

/** 获取用户的穿搭方案列表 */
export async function getOutfitsByUser(params: OutfitListParams) {
  const { userId, scene, targetDate, isFavorite, page = 1, pageSize = 20 } = params;

  const conditions = [eq(outfits.userId, userId)];
  if (scene) conditions.push(eq(outfits.scene, scene));
  if (targetDate) conditions.push(eq(outfits.targetDate, targetDate));
  if (isFavorite !== undefined) conditions.push(eq(outfits.isFavorite, isFavorite));

  const where = and(...conditions);

  const [list, totalResult] = await Promise.all([
    db
      .select()
      .from(outfits)
      .where(where)
      .orderBy(desc(outfits.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(outfits)
      .where(where),
  ]);

  return {
    list,
    total: totalResult[0]?.count ?? 0,
    page,
    pageSize,
  };
}

/** 获取用户指定日期的穿搭方案 */
export async function getOutfitsByDate(
  userId: string,
  date: string,
): Promise<OutfitRow[]> {
  return db
    .select()
    .from(outfits)
    .where(and(eq(outfits.userId, userId), eq(outfits.targetDate, date)))
    .orderBy(desc(outfits.createdAt));
}

/** 获取用户今日穿搭 */
export async function getTodayOutfit(userId: string): Promise<OutfitRow | null> {
  const today = new Date().toISOString().split('T')[0];
  const rows = await db
    .select()
    .from(outfits)
    .where(
      and(
        eq(outfits.userId, userId),
        sql`${outfits.targetDate} = ${today}`,
        eq(outfits.isWornToday, true),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** 更新穿搭方案 */
export async function updateOutfit(
  id: string,
  data: Record<string, unknown>,
): Promise<OutfitRow | null> {
  const rows = await db
    .update(outfits)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(outfits.id, id))
    .returning();
  return rows[0] ?? null;
}

/** 删除穿搭方案 */
export async function deleteOutfit(id: string): Promise<boolean> {
  const rows = await db.delete(outfits).where(eq(outfits.id, id)).returning();
  return rows.length > 0;
}

/** 切换收藏状态 */
export async function toggleFavorite(id: string): Promise<OutfitRow | null> {
  const current = await getOutfitById(id);
  if (!current) return null;

  const rows = await db
    .update(outfits)
    .set({ isFavorite: !current.isFavorite, updatedAt: new Date() })
    .where(eq(outfits.id, id))
    .returning();
  return rows[0] ?? null;
}

/** 标记为今日已穿 */
export async function markAsWorn(id: string): Promise<OutfitRow | null> {
  const rows = await db
    .update(outfits)
    .set({ isWornToday: true, updatedAt: new Date() })
    .where(eq(outfits.id, id))
    .returning();
  return rows[0] ?? null;
}

/** 清除用户今日穿着标记（用于新的一天） */
export async function clearTodayWorn(userId: string): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  await db
    .update(outfits)
    .set({ isWornToday: false, updatedAt: new Date() })
    .where(and(eq(outfits.userId, userId), sql`${outfits.targetDate} = ${today}`));
}

// ── 穿搭历史 ──────────────────────────────────────────────────

/** 创建穿搭历史记录 */
export async function createHistory(data: CreateHistoryData): Promise<HistoryRow> {
  const rows = await db
    .insert(outfitHistory)
    .values({
      userId: data.userId,
      outfitId: data.outfitId,
      clothingIds: data.clothingIds,
      wearDate: data.wearDate,
      timeOfDay: data.timeOfDay,
      scene: data.scene,
      weatherSnapshot: data.weatherSnapshot,
      satisfaction: data.satisfaction,
      notes: data.notes,
    })
    .returning();
  return rows[0]!;
}

/** 获取穿搭历史列表 */
export async function getHistoryByUser(params: HistoryListParams) {
  const { userId, startDate, endDate, page = 1, pageSize = 20 } = params;

  const conditions = [eq(outfitHistory.userId, userId)];
  if (startDate) conditions.push(sql`${outfitHistory.wearDate} >= ${startDate}`);
  if (endDate) conditions.push(sql`${outfitHistory.wearDate} <= ${endDate}`);

  const where = and(...conditions);

  const [list, totalResult] = await Promise.all([
    db
      .select()
      .from(outfitHistory)
      .where(where)
      .orderBy(desc(outfitHistory.wearDate))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(outfitHistory)
      .where(where),
  ]);

  return {
    list,
    total: totalResult[0]?.count ?? 0,
    page,
    pageSize,
  };
}

/** 获取指定日期的穿搭历史 */
export async function getHistoryByDate(
  userId: string,
  date: string,
): Promise<HistoryRow | null> {
  const rows = await db
    .select()
    .from(outfitHistory)
    .where(and(eq(outfitHistory.userId, userId), eq(outfitHistory.wearDate, date)))
    .limit(1);
  return rows[0] ?? null;
}

/** 获取穿搭历史（含衣服详情） */
export async function getHistoryWithItemsById(id: string): Promise<HistoryWithItems | null> {
  const rows = await db
    .select()
    .from(outfitHistory)
    .where(eq(outfitHistory.id, id))
    .limit(1);

  const history = rows[0];
  if (!history) return null;

  const items = await getOutfitItems(history.clothingIds);
  return { ...history, items };
}

/** 更新历史记录满意度 */
export async function updateHistorySatisfaction(
  id: string,
  satisfaction: number,
  notes?: string,
): Promise<HistoryRow | null> {
  const updateData: Record<string, unknown> = { satisfaction };
  if (notes !== undefined) updateData.notes = notes;

  const rows = await db
    .update(outfitHistory)
    .set(updateData)
    .where(eq(outfitHistory.id, id))
    .returning();
  return rows[0] ?? null;
}

/** 获取用户穿搭统计 */
export async function getHistoryStats(userId: string): Promise<HistoryStats> {
  // 统计总天数
  const daysResult = await db
    .select({ count: sql<number>`count(distinct wear_date)::int` })
    .from(outfitHistory)
    .where(eq(outfitHistory.userId, userId));

  // 统计总套数
  const totalResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(outfitHistory)
    .where(eq(outfitHistory.userId, userId));

  // 计算平均满意度
  const avgResult = await db
    .select({ avg: sql<number>`avg(satisfaction)::numeric(3,2)` })
    .from(outfitHistory)
    .where(and(eq(outfitHistory.userId, userId), sql`satisfaction IS NOT NULL`));

  // 统计高频穿着单品
  const topItemsResult = await db
    .select({
      clothingId: sql<string>`unnest(clothing_ids) as clothing_id`,
      count: sql<number>`count(*)::int`,
    })
    .from(outfitHistory)
    .where(eq(outfitHistory.userId, userId))
    .groupBy(sql`unnest(clothing_ids)`)
    .orderBy(sql`count(*) desc`)
    .limit(5);

  return {
    totalDays: daysResult[0]?.count ?? 0,
    totalOutfits: totalResult[0]?.count ?? 0,
    avgSatisfaction: avgResult[0]?.avg ?? null,
    topItems: topItemsResult.map((row) => ({
      clothingId: row.clothingId,
      count: row.count,
    })),
  };
}

/** 获取最近 N 天已穿过的衣服 ID（用于推荐去重） */
export async function getRecentlyWornClothingIds(
  userId: string,
  days: number = 3,
): Promise<string[]> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startDateStr = startDate.toISOString().split('T')[0];

  const rows = await db
    .select({ clothingIds: outfitHistory.clothingIds })
    .from(outfitHistory)
    .where(
      and(eq(outfitHistory.userId, userId), sql`${outfitHistory.wearDate} >= ${startDateStr}`),
    );

  // 展平所有 clothingIds
  const allIds = new Set<string>();
  for (const row of rows) {
    if (row.clothingIds) {
      for (const id of row.clothingIds) {
        allIds.add(id);
      }
    }
  }

  return Array.from(allIds);
}

// ── 辅助函数 ──────────────────────────────────────────────────

/** 根据衣服 ID 列表获取衣服详情（用于穿搭展示） */
async function getOutfitItems(clothingIds: string[]) {
  if (!clothingIds || clothingIds.length === 0) return [];

  const items = await db
    .select({
      id: clothes.id,
      category: clothes.category,
      subcategory: clothes.subcategory,
      imageUrl: clothes.imageUrl,
      thumbnailUrl: clothes.thumbnailUrl,
      customName: clothes.customName,
      colorPalette: clothes.colorPalette,
    })
    .from(clothes)
    .where(inArray(clothes.id, clothingIds));

  // 按 clothingIds 的顺序返回
  const itemMap = new Map(items.map((item) => [item.id, item]));
  return clothingIds
    .map((id) => itemMap.get(id))
    .filter((item): item is NonNullable<typeof item> => item !== undefined);
}

function getClothingIdsSignature(clothingIds: string[]): string {
  return [...clothingIds].sort().join('|');
}
