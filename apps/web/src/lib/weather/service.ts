// ============================================================
// 搭一搭 · 天气服务
// ============================================================

import { getValidWeatherCache, upsertWeatherCache } from '../db/repositories/weather';
import type { CurrentWeather, DailyForecast, WeatherSnapshot } from '@starter-template/types';

const DEFAULT_CITY = '上海';
const DEFAULT_CITY_CODE = '101020100';
const CURRENT_TTL_MS = 60 * 60 * 1000;
const FORECAST_TTL_MS = 3 * 60 * 60 * 1000;

interface QWeatherNowResponse {
  code: string;
  now?: {
    temp?: string;
    feelsLike?: string;
    humidity?: string;
    text?: string;
    icon?: string;
    windScale?: string;
    windDir?: string;
    vis?: string;
    obsTime?: string;
  };
}

interface QWeatherDailyResponse {
  code: string;
  daily?: Array<{
    fxDate?: string;
    tempMax?: string;
    tempMin?: string;
    textDay?: string;
    textNight?: string;
    humidity?: string;
    windScaleDay?: string;
    uvIndex?: string;
    precip?: string;
  }>;
}

interface WeatherCacheAdapter {
  get<T>(locationKey: string, targetDate: string): Promise<{ weatherData: T } | null>;
  set<T>(data: {
    locationKey: string;
    targetDate: string;
    weatherData: T;
    expiresAt: Date;
  }): Promise<unknown>;
}

interface WeatherServiceOptions {
  cache: WeatherCacheAdapter;
  fetcher: typeof fetch;
  env: Record<string, string | undefined>;
  now: () => Date;
}

export function createWeatherService(options: WeatherServiceOptions) {
  async function getCurrentWeatherWithCache(city = DEFAULT_CITY): Promise<CurrentWeather> {
    const targetDate = getDateString(options.now());
    const cityKey = normalizeLocationKey(city);
    const locationKey = `current:${cityKey}`;
    const cached = await options.cache.get<CurrentWeather>(locationKey, targetDate);

    if (cached) return cached.weatherData;

    const weather = await fetchCurrentWeather(city, options).catch((error) => {
      console.warn('[weather/current] provider fallback:', error);
      return getMockCurrentWeather(city, options.now());
    });

    await options.cache.set({
      locationKey,
      targetDate,
      weatherData: weather,
      expiresAt: new Date(options.now().getTime() + CURRENT_TTL_MS),
    });

    return weather;
  }

  async function getDailyForecastWithCache(
    city = DEFAULT_CITY,
    date = getDateString(options.now()),
  ): Promise<DailyForecast> {
    const cityKey = normalizeLocationKey(city);
    const locationKey = `forecast:${cityKey}`;
    const cached = await options.cache.get<DailyForecast>(locationKey, date);

    if (cached) return cached.weatherData;

    const forecast = await fetchDailyForecast(city, date, options).catch((error) => {
      console.warn('[weather/forecast] provider fallback:', error);
      return getMockDailyForecast(date);
    });

    await options.cache.set({
      locationKey,
      targetDate: date,
      weatherData: forecast,
      expiresAt: new Date(options.now().getTime() + FORECAST_TTL_MS),
    });

    return forecast;
  }

  async function getWeatherSnapshotWithCache(city?: string, _date?: string): Promise<WeatherSnapshot> {
    const weather = await getCurrentWeatherWithCache(city ?? DEFAULT_CITY);
    return {
      temp: weather.temp,
      humidity: weather.humidity,
      weather: weather.weather,
      wind: weather.wind,
      uv: weather.uv,
    };
  }

  return {
    getCurrentWeatherWithCache,
    getDailyForecastWithCache,
    getWeatherSnapshotWithCache,
  };
}

const defaultWeatherService = createWeatherService({
  cache: {
    get: getValidWeatherCache,
    set: upsertWeatherCache,
  },
  fetcher: fetch,
  env: process.env,
  now: () => new Date(),
});

export const getCurrentWeatherWithCache = defaultWeatherService.getCurrentWeatherWithCache;
export const getDailyForecastWithCache = defaultWeatherService.getDailyForecastWithCache;
export const getWeatherSnapshotWithCache = defaultWeatherService.getWeatherSnapshotWithCache;

async function fetchCurrentWeather(
  city: string,
  options: WeatherServiceOptions,
): Promise<CurrentWeather> {
  const apiKey = options.env['QWEATHER_API_KEY'];
  if (!apiKey) throw new Error('QWEATHER_API_KEY is not configured');

  const response = await fetchQWeather<QWeatherNowResponse>('/v7/weather/now', {
    location: city,
    key: apiKey,
  }, options);

  if (response.code !== '200' || !response.now) {
    throw new Error(`QWeather now failed: ${response.code}`);
  }

  const now = response.now;
  return {
    city,
    cityCode: city,
    temp: toNumber(now.temp, 22),
    feelsLike: toNumber(now.feelsLike, 22),
    humidity: toNumber(now.humidity, 60),
    weather: now.text ?? '多云',
    weatherIcon: now.icon ?? 'cloudy',
    wind: toNumber(now.windScale, 2),
    windDir: now.windDir ?? '',
    uv: 3,
    visibility: toNumber(now.vis, 10),
    updateTime: now.obsTime ?? new Date().toISOString(),
  };
}

async function fetchDailyForecast(
  city: string,
  date: string,
  options: WeatherServiceOptions,
): Promise<DailyForecast> {
  const apiKey = options.env['QWEATHER_API_KEY'];
  if (!apiKey) throw new Error('QWEATHER_API_KEY is not configured');

  const response = await fetchQWeather<QWeatherDailyResponse>('/v7/weather/3d', {
    location: city,
    key: apiKey,
  }, options);

  if (response.code !== '200' || !response.daily?.length) {
    throw new Error(`QWeather forecast failed: ${response.code}`);
  }

  const daily = response.daily.find((item) => item.fxDate === date) ?? response.daily[0]!;
  return {
    date: daily.fxDate ?? date,
    tempHigh: toNumber(daily.tempMax, 26),
    tempLow: toNumber(daily.tempMin, 16),
    weatherDay: daily.textDay ?? '多云',
    weatherNight: daily.textNight ?? '晴',
    humidity: toNumber(daily.humidity, 60),
    wind: toNumber(daily.windScaleDay, 3),
    uv: toNumber(daily.uvIndex, 5),
    precipitation: toNumber(daily.precip, 0),
  };
}

async function fetchQWeather<T>(
  path: string,
  params: Record<string, string>,
  options: WeatherServiceOptions,
): Promise<T> {
  const host = options.env['QWEATHER_API_HOST'] ?? 'https://devapi.qweather.com';
  const url = new URL(path, host);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  const response = await options.fetcher(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`QWeather request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

function getMockCurrentWeather(city: string, now: Date): CurrentWeather {
  return {
    city,
    cityCode: city === DEFAULT_CITY ? DEFAULT_CITY_CODE : city,
    temp: 22,
    feelsLike: 20,
    humidity: 65,
    weather: '多云',
    weatherIcon: 'cloudy',
    wind: 3,
    windDir: '东南风',
    uv: 4,
    visibility: 10,
    updateTime: now.toISOString(),
  };
}

function getMockDailyForecast(date: string): DailyForecast {
  return {
    date,
    tempHigh: 26,
    tempLow: 16,
    weatherDay: '多云',
    weatherNight: '晴',
    humidity: 60,
    wind: 3,
    uv: 5,
    precipitation: 0,
  };
}

function normalizeLocationKey(location: string) {
  return location.trim().toLowerCase() || DEFAULT_CITY;
}

function getDateString(date: Date) {
  return date.toISOString().slice(0, 10);
}

function toNumber(value: string | number | undefined, fallback: number) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (!value) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
