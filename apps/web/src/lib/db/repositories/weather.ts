// ============================================================
// 搭一搭 · 天气缓存 Repository
// ============================================================

import { and, eq, gt } from 'drizzle-orm';
import { db } from '../index';
import { weatherCache } from '../schema';

export interface WeatherCacheRow<T> {
  id: string;
  locationKey: string;
  targetDate: string;
  weatherData: T;
  expiresAt: Date;
  createdAt: Date;
}

export async function getValidWeatherCache<T>(
  locationKey: string,
  targetDate: string,
): Promise<WeatherCacheRow<T> | null> {
  const rows = await db
    .select()
    .from(weatherCache)
    .where(
      and(
        eq(weatherCache.locationKey, locationKey),
        eq(weatherCache.targetDate, targetDate),
        gt(weatherCache.expiresAt, new Date()),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id,
    locationKey: row.locationKey,
    targetDate: row.targetDate,
    weatherData: row.weatherData as T,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}

export async function upsertWeatherCache<T>(data: {
  locationKey: string;
  targetDate: string;
  weatherData: T;
  expiresAt: Date;
}) {
  const rows = await db
    .insert(weatherCache)
    .values({
      locationKey: data.locationKey,
      targetDate: data.targetDate,
      weatherData: data.weatherData,
      expiresAt: data.expiresAt,
    })
    .onConflictDoUpdate({
      target: [weatherCache.locationKey, weatherCache.targetDate],
      set: {
        weatherData: data.weatherData,
        expiresAt: data.expiresAt,
      },
    })
    .returning();

  return rows[0] ?? null;
}
