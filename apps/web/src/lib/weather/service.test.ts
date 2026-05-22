import test from 'node:test';
import assert from 'node:assert/strict';
import { createWeatherService } from './service';

interface StoredCacheValue<T> {
  weatherData: T;
  expiresAt: Date;
}

function createMemoryCache() {
  const store = new Map<string, StoredCacheValue<unknown>>();
  return {
    writes: [] as Array<{ locationKey: string; targetDate: string; weatherData: unknown; expiresAt: Date }>,
    async get<T>(locationKey: string, targetDate: string) {
      const cached = store.get(`${locationKey}:${targetDate}`) as StoredCacheValue<T> | undefined;
      return cached ? { weatherData: cached.weatherData } : null;
    },
    async set<T>(data: {
      locationKey: string;
      targetDate: string;
      weatherData: T;
      expiresAt: Date;
    }) {
      this.writes.push(data);
      store.set(`${data.locationKey}:${data.targetDate}`, {
        weatherData: data.weatherData,
        expiresAt: data.expiresAt,
      });
    },
  };
}

test('getCurrentWeatherWithCache uses cached weather before provider calls', async () => {
  const cache = createMemoryCache();
  await cache.set({
    locationKey: 'current:上海',
    targetDate: '2026-05-19',
    weatherData: {
      city: '上海',
      cityCode: '101020100',
      temp: 19,
      feelsLike: 18,
      humidity: 70,
      weather: '小雨',
      weatherIcon: 'rain',
      wind: 2,
      windDir: '东风',
      uv: 1,
      visibility: 8,
      updateTime: '2026-05-19T01:00:00.000Z',
    },
    expiresAt: new Date('2026-05-19T02:00:00.000Z'),
  });

  let fetchCalls = 0;
  const service = createWeatherService({
    cache,
    env: { QWEATHER_API_KEY: 'test-key' },
    now: () => new Date('2026-05-19T01:30:00.000Z'),
    fetcher: async () => {
      fetchCalls += 1;
      return new Response('{}');
    },
  });

  const weather = await service.getCurrentWeatherWithCache('上海');

  assert.equal(weather.temp, 19);
  assert.equal(weather.weather, '小雨');
  assert.equal(fetchCalls, 0);
});

test('getWeatherSnapshotWithCache falls back and writes cache without provider key', async () => {
  const cache = createMemoryCache();
  const originalWarn = console.warn;
  console.warn = () => {};
  const service = createWeatherService({
    cache,
    env: {},
    now: () => new Date('2026-05-19T08:00:00.000Z'),
    fetcher: async () => {
      throw new Error('should not call provider without key');
    },
  });

  let snapshot;
  try {
    snapshot = await service.getWeatherSnapshotWithCache('上海');
  } finally {
    console.warn = originalWarn;
  }

  assert.deepEqual(snapshot, {
    temp: 22,
    humidity: 65,
    weather: '多云',
    wind: 3,
    uv: 4,
  });
  assert.equal(cache.writes.length, 1);
  assert.equal(cache.writes[0]?.locationKey, 'current:上海');
  assert.equal(cache.writes[0]?.targetDate, '2026-05-19');
});

test('getDailyForecastWithCache maps QWeather daily response', async () => {
  const cache = createMemoryCache();
  const service = createWeatherService({
    cache,
    env: { QWEATHER_API_KEY: 'test-key', QWEATHER_API_HOST: 'https://weather.example' },
    now: () => new Date('2026-05-19T08:00:00.000Z'),
    fetcher: async (url) => {
      assert.equal(new URL(String(url)).hostname, 'weather.example');
      return Response.json({
        code: '200',
        daily: [
          {
            fxDate: '2026-05-19',
            tempMax: '28',
            tempMin: '18',
            textDay: '晴',
            textNight: '多云',
            humidity: '55',
            windScaleDay: '3',
            uvIndex: '6',
            precip: '0.2',
          },
        ],
      });
    },
  });

  const forecast = await service.getDailyForecastWithCache('101020100', '2026-05-19');

  assert.equal(forecast.tempHigh, 28);
  assert.equal(forecast.tempLow, 18);
  assert.equal(forecast.weatherDay, '晴');
  assert.equal(forecast.precipitation, 0.2);
  assert.equal(cache.writes[0]?.locationKey, 'forecast:101020100');
});
