// ============================================================
// 搭一搭 · 用户 Repository
// ============================================================

import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { clothes, users } from '@/lib/db/schema';
import { buildWardrobeCapacity, resolveWardrobeEntitlement } from '@/lib/wardrobe-capacity';
import type { WardrobeCapacity } from '@starter-template/types';

export interface UserProfileRow {
  id: string;
  nickname: string | null;
  avatarUrl: string | null;
  styleProfile: Record<string, unknown> | null;
  capacityTotal: number | null;
  capacityUsed: number | null;
  membershipTier: string | null;
  updatedAt: Date;
}

export interface UserCapacityRow extends WardrobeCapacity {
  total: number;
}

// ── 查询 ──

/** 根据 wechat_openid 查找用户 */
export async function findUserByOpenid(openid: string) {
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.wechatOpenid, openid))
    .limit(1);
  return rows[0] ?? null;
}

/** 根据 ID 查找用户 */
export async function findUserById(id: string) {
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/** 获取用户 profile 信息 */
export async function getUserProfile(userId: string): Promise<UserProfileRow | null> {
  const rows = await db
    .select({
      id: users.id,
      nickname: users.nickname,
      avatarUrl: users.avatarUrl,
      styleProfile: users.styleProfile,
      capacityTotal: users.capacityTotal,
      capacityUsed: users.capacityUsed,
      membershipTier: users.membershipTier,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0] ?? null;
}

/** 获取用户容量信息 */
export async function getUserCapacity(userId: string): Promise<UserCapacityRow | null> {
  const [userRows, usedRows] = await Promise.all([
    db
      .select({
        id: users.id,
        membershipTier: users.membershipTier,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(clothes)
      .where(and(eq(clothes.userId, userId), eq(clothes.status, 'active'))),
  ]);

  if (!userRows[0]) return null;
  const entitlement = resolveWardrobeEntitlement(userRows[0]);
  const capacity = buildWardrobeCapacity({
    used: usedRows[0]?.count ?? 0,
    ...entitlement,
  });
  return {
    ...capacity,
    total: capacity.limit,
  };
}

// ── 写入 ──

/** 创建用户（微信登录） */
export async function createUser(data: {
  wechatOpenid: string;
  unionid?: string;
  nickname?: string;
  avatarUrl?: string;
}) {
  const rows = await db
    .insert(users)
    .values({
      wechatOpenid: data.wechatOpenid,
      unionid: data.unionid,
      nickname: data.nickname,
      avatarUrl: data.avatarUrl,
    })
    .returning();
  return rows[0] ?? null;
}

/** 更新用户 profile */
export async function updateUserProfile(
  userId: string,
  data: {
    nickname?: string;
    avatarUrl?: string;
    styleProfile?: Record<string, unknown>;
  },
) {
  const rows = await db
    .update(users)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId))
    .returning();
  return rows[0] ?? null;
}

/** 更新容量使用量 */
export async function updateUserCapacity(userId: string, used: number) {
  const rows = await db
    .update(users)
    .set({
      capacityUsed: used,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId))
    .returning();
  return rows[0] ?? null;
}
