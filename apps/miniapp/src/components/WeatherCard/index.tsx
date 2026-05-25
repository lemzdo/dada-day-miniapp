import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useEffect, useState } from 'react';
import { getCloudWeather, getFallbackResolvedWeather, WEATHER_CACHE_KEY, writeLocalWeatherCache } from '@/lib/cloud';
import { toWeatherSnapshot } from '@/utils/weather';
import type { ResolvedWeatherResponse, WeatherSnapshot } from '@starter-template/types';
import './index.scss';

interface WeatherCardProps {
  city?: string;
  onWeatherChange?: (weather: WeatherSnapshot, options?: { forceRefresh?: boolean }) => void;
}

type WeatherStatus = 'locating' | 'loading' | 'success' | 'fallback';

export function WeatherCard({ city = '当前位置', onWeatherChange }: WeatherCardProps) {
  const [weather, setWeather] = useState<ResolvedWeatherResponse>(() => readCachedWeather() ?? getFallbackResolvedWeather(city));
  const [status, setStatus] = useState<WeatherStatus>(weather.source === 'cache' ? 'fallback' : 'locating');
  const [hint, setHint] = useState(weather.source === 'cache' ? `缓存天气刷新于 ${formatRefreshTime(weather)}` : '正在获取你所在位置...');
  const [refreshing, setRefreshing] = useState(false);
  const hasWeather = Boolean(weather.weather.weather);

  useEffect(() => {
    fetchWeather();
  }, [city]);

  async function fetchWeather(options: { forceRefresh?: boolean } = {}) {
    const forceRefresh = options.forceRefresh === true;
    if (forceRefresh && refreshing) return;
    const previousStatus = status;
    const previousHint = hint;
    if (forceRefresh) setRefreshing(true);
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
        }, { forceRefresh }),
        9000,
        '天气服务响应超时，请稍后重试',
      );

      console.log('[WeatherCard] getWeather success', data);
      setWeather(data);
      writeLocalWeatherCache(data);
      setStatus('success');
      setHint(data.cacheHit ? `缓存天气刷新于 ${formatRefreshTime(data)}` : `天气刷新于 ${formatRefreshTime(data)}`);
      notifyWeatherChange(data, { forceRefresh });
    } catch (error) {
      const message = getErrorMessage(error);
      console.warn('[WeatherCard] real weather failed', error);

      if (forceRefresh) {
        setStatus(previousStatus);
        setHint(previousHint);
        Taro.showToast({ title: '天气刷新失败，已显示上次天气', icon: 'none' });
        return;
      }

      const cached = readCachedWeather();
      if (cached) {
        setWeather(cached);
        setStatus('fallback');
        setHint(`天气获取失败，已展示缓存 ${formatRefreshTime(cached)}`);
        notifyWeatherChange(cached);
        return;
      }

      setWeather(getFallbackResolvedWeather(city));
      setStatus('fallback');
      setHint(message.includes('getLocation') || message.includes('定位') ? '逆地理编码失败：当前位置' : '天气获取失败，稍后重试');
    } finally {
      if (forceRefresh) setRefreshing(false);
    }
  }

  function notifyWeatherChange(value: ResolvedWeatherResponse, options?: { forceRefresh?: boolean }) {
    const snapshot = toWeatherSnapshot(value);
    if (snapshot) onWeatherChange?.(snapshot, options);
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
            {hasWeather ? `刷新于 ${formatRefreshTime(weather)}` : '请稍后重试'}
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
        <View className="weather-actions">
          {status === 'fallback' && (
            <View className="weather-retry" onClick={() => fetchWeather()}>
              <Text className="weather-retry-text">重新定位</Text>
            </View>
          )}
          <View
            className={`weather-refresh ${refreshing ? 'disabled' : ''}`}
            onClick={() => fetchWeather({ forceRefresh: true })}
          >
            <Text className="weather-refresh-text">{refreshing ? '刷新中...' : '刷新天气'}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

function readCachedWeather(): ResolvedWeatherResponse | null {
  try {
    const cached = Taro.getStorageSync(WEATHER_CACHE_KEY) as ResolvedWeatherResponse | '';
    if (!cached || typeof cached !== 'object') return null;
    return { ...cached, source: 'cache', cacheHit: true };
  } catch {
    return null;
  }
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
  const date = new Date(value.includes('T') ? value : value.replace(/-/g, '/'));
  if (Number.isNaN(date.getTime())) return '刚刚';
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatRefreshTime(value: ResolvedWeatherResponse) {
  return formatUpdateTime(value.fetchedAt ?? value.updatedAt);
}

function pad(value: number) {
  return String(value).padStart(2, '0');
}
