import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useEffect, useState } from 'react';
import { getCloudWeather, getFallbackResolvedWeather } from '@/lib/cloud';
import type { ResolvedWeatherResponse } from '@starter-template/types';
import './index.scss';

interface WeatherCardProps {
  city?: string;
}

type WeatherStatus = 'locating' | 'loading' | 'success' | 'fallback';

const WEATHER_CACHE_KEY = 'd1d:lastWeather';

export function WeatherCard({ city = '当前位置' }: WeatherCardProps) {
  const [weather, setWeather] = useState<ResolvedWeatherResponse>(() => readCachedWeather() ?? getFallbackResolvedWeather(city));
  const [status, setStatus] = useState<WeatherStatus>(weather.source === 'cache' ? 'fallback' : 'locating');
  const [hint, setHint] = useState(weather.source === 'cache' ? `缓存天气更新于 ${formatUpdateTime(weather.updatedAt)}` : '正在获取你所在位置...');
  const hasWeather = Boolean(weather.weather.weather);

  useEffect(() => {
    fetchWeather();
  }, [city]);

  async function fetchWeather() {
    setStatus('locating');
    setHint('正在获取你所在位置...');
    console.log('[WeatherCard] start getLocation');

    try {
      const location = await withTimeout(
        Taro.getLocation({
          type: 'gcj02',
          isHighAccuracy: false,
        }),
        8000,
        '定位超时，请确认手机定位服务已开启',
      );
      console.log('[WeatherCard] getLocation success', location);
      setStatus('loading');
      setHint('已获取位置，正在同步实时天气...');

      const data = await withTimeout(
        getCloudWeather({
          latitude: location.latitude,
          longitude: location.longitude,
        }),
        9000,
        '天气服务响应超时，请稍后重试',
      );

      console.log('[WeatherCard] getWeather success', data);
      setWeather(data);
      writeCachedWeather(data);
      setStatus('success');
      setHint(`实时天气更新于 ${formatUpdateTime(data.updatedAt)}`);
    } catch (error) {
      const message = getErrorMessage(error);
      const cached = readCachedWeather();
      console.warn('[WeatherCard] real weather failed', error);

      if (cached) {
        setWeather(cached);
        setStatus('fallback');
        setHint(`天气获取失败，已展示缓存 ${formatUpdateTime(cached.updatedAt)}`);
        return;
      }

      setWeather(getFallbackResolvedWeather(city));
      setStatus('fallback');
      setHint(message.includes('getLocation') || message.includes('定位') ? '逆地理编码失败：当前位置' : '天气获取失败，稍后重试');
    }
  }

  const displayLocation = weather.location.district || weather.location.city || weather.location.displayName || '当前位置';
  const headline = hasWeather
    ? `${displayLocation} · ${weather.weather.weather} ${weather.weather.temperature}℃`
    : displayLocation;

  return (
    <View className={`weather-card ${status === 'fallback' ? 'fallback' : ''}`}>
      <View className="weather-main">
        <View className="weather-left">
          <Text className="weather-city">{headline}</Text>
          <Text className="weather-desc">{hasWeather ? weather.location.city || weather.location.province : '天气获取失败，稍后重试'}</Text>
          <Text className="weather-update">
            {hasWeather ? `更新于 ${formatUpdateTime(weather.updatedAt)}` : '请稍后重试'}
          </Text>
        </View>
        <View className="weather-right">
          <Text className="weather-temp">{hasWeather ? `${weather.weather.temperature}℃` : '--'}</Text>
        </View>
      </View>
      <View className="weather-detail">
        <View className="detail-item">
          <Text className="detail-label">湿度</Text>
          <Text className="detail-value">{weather.weather.humidity === undefined ? '--' : `${weather.weather.humidity}%`}</Text>
        </View>
        <View className="detail-item">
          <Text className="detail-label">风向</Text>
          <Text className="detail-value">{weather.weather.windDirection || '--'}</Text>
        </View>
        <View className="detail-item">
          <Text className="detail-label">风力</Text>
          <Text className="detail-value">{weather.weather.windPower || '--'}</Text>
        </View>
      </View>
      <View className="weather-footer">
        <Text className="weather-hint">{hint}</Text>
        {status === 'fallback' && (
          <View className="weather-retry" onClick={fetchWeather}>
            <Text className="weather-retry-text">重新定位</Text>
          </View>
        )}
      </View>
    </View>
  );
}

function readCachedWeather(): ResolvedWeatherResponse | null {
  try {
    const cached = Taro.getStorageSync(WEATHER_CACHE_KEY) as ResolvedWeatherResponse | '';
    if (!cached || typeof cached !== 'object') return null;
    return { ...cached, source: 'cache' };
  } catch {
    return null;
  }
}

function writeCachedWeather(value: ResolvedWeatherResponse) {
  const cacheValue: ResolvedWeatherResponse = {
    location: value.location,
    weather: value.weather,
    source: 'cache',
    updatedAt: value.updatedAt,
  };
  Taro.setStorageSync(WEATHER_CACHE_KEY, cacheValue);
}

function getErrorMessage(error: unknown) {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const maybeError = error as { errMsg?: string; message?: string };
    return maybeError.errMsg || maybeError.message || '未知错误';
  }
  return '未知错误';
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function formatUpdateTime(value?: string) {
  if (!value) return '刚刚';
  const date = new Date(value.replace(/-/g, '/'));
  if (Number.isNaN(date.getTime())) return '刚刚';
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function pad(value: number) {
  return String(value).padStart(2, '0');
}
