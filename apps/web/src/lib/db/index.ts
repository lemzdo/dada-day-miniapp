// ============================================================
// 搭一搭 · 数据库连接 — postgres.js + Drizzle ORM
// ============================================================

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema';

declare let process: undefined | { env: Record<string, string | undefined> };

const connectionString =
  process?.env?.['DATABASE_URL'] ?? 'postgresql://postgres:postgres@localhost:5432/d1d';

// postgres.js 连接实例（用于迁移等原始 SQL 操作）
export const sql = postgres(connectionString, {
  max: 10, // 最大连接数
  idle_timeout: 20,
  connect_timeout: 10,
});

// Drizzle ORM 实例（类型安全查询）
export const db = drizzle(sql, { schema });

export type Database = typeof db;
