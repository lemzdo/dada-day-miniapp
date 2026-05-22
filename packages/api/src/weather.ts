// ============================================================
// 天气 API 端点
// ============================================================

import { apiClient } from './client';
import type { CurrentWeather, DailyForecast } from '@starter-template/types';

/** 获取实时天气 */
export function getCurrentWeather(city: string) {
  return apiClient.get<CurrentWeather>(`/weather/current?city=${encodeURIComponent(city)}`);
}

/** 获取天气预报 */
export function getWeatherForecast(city: string, date?: string) {
  let url = `/weather/forecast?city=${encodeURIComponent(city)}`;
  if (date) url += `&date=${encodeURIComponent(date)}`;
  return apiClient.get<DailyForecast>(url);
}
