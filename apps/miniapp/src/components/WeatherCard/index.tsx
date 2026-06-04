import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useEffect, useRef, useState } from 'react';
import { getCloudWeather, getFallbackResolvedWeather, WEATHER_CACHE_KEY } from '@/lib/cloud';
import { toWeatherSnapshot } from '@/utils/weather';
import type { ResolvedWeatherResponse, WeatherSnapshot } from '@starter-template/types';
import './index.scss';

interface WeatherCardProps {
  city?: string;
  onWeatherChange?: (weather: WeatherSnapshot, options?: { forceRefresh?: boolean }) => void;
}

type WeatherStatus =
  | 'checkingAuth'
  | 'needPermission'
  | 'denied'
  | 'locating'
  | 'loadingWeather'
  | 'ready'
  | 'fallback'
  | 'failed';

type LocationPermission = 'unknown' | 'authorized' | 'denied';

interface LocationAuthSetting {
  'scope.userLocation'?: boolean;
}

interface TaroLocationResult {
  latitude: number;
  longitude: number;
}

const DEFAULT_HINT = '今天先按默认天气搭～ 开启本地天气后，小搭会按你所在城市的温度推荐更合适的衣服。';
const DENIED_HINT = '还没开启本地天气。没关系，先用默认天气也能搭；想更准一点，可以重新开启定位。';
const LOCATING_HINT = '小搭正在看看你那边的天气…';
const LOADING_HINT = '位置拿到啦，正在同步本地天气…';
const FAILED_HINT = '天气暂时没拿到，先按默认天气给你搭，稍后可以再试一次。';

export function WeatherCard({ city = '当前位置', onWeatherChange }: WeatherCardProps) {
  const [weather, setWeather] = useState<ResolvedWeatherResponse>(() => readCachedWeather() ?? getFallbackResolvedWeather(city));
  const [status, setStatus] = useState<WeatherStatus>('checkingAuth');
  const [hint, setHint] = useState(DEFAULT_HINT);
  const [permission, setPermission] = useState<LocationPermission>('unknown');
  const [refreshing, setRefreshing] = useState(false);
  const busyRef = useRef(false);
  const lastNotifiedKeyRef = useRef('');

  const hasWeather = Boolean(weather.weather.weather);
  const hasUsableWeather = Boolean(toWeatherSnapshot(weather));

  useEffect(() => {
    const cached = readCachedWeather();
    if (cached) {
      setWeather(cached);
      setHint(`缓存天气刷新于 ${formatRefreshTime(cached)}，也可以再同步一次本地天气。`);
    } else {
      setWeather(getFallbackResolvedWeather(city));
      setHint(DEFAULT_HINT);
    }

    checkAuthAndMaybeFetch();
  }, [city]);

  async function checkAuthAndMaybeFetch() {
    setStatus('checkingAuth');

    try {
      const nextPermission = await getLocationPermission();
      setPermission(nextPermission);

      if (nextPermission === 'authorized') {
        await fetchWeather({ forceRefresh: false, source: 'auto' });
        return;
      }

      if (nextPermission === 'denied') {
        setStatus('denied');
        setHint(DENIED_HINT);
        return;
      }

      setStatus(hasUsableWeather ? 'ready' : 'needPermission');
      if (!hasUsableWeather) setHint(DEFAULT_HINT);
    } catch (error) {
      console.warn('[WeatherCard] getSetting failed', error);
      setStatus(hasUsableWeather ? 'ready' : 'needPermission');
      setHint(DEFAULT_HINT);
    }
  }

  async function handleWeatherAction() {
    if (busyRef.current) return;

    if (permission === 'denied' || status === 'denied') {
      await requestReauthorize();
      return;
    }

    const forceRefresh = permission === 'authorized' || status === 'ready' || status === 'failed';
    await fetchWeather({ forceRefresh, source: 'manual' });
  }

  async function requestReauthorize() {
    const confirmed = await showReauthorizeModal();
    if (!confirmed) return;

    try {
      busyRef.current = true;
      setRefreshing(true);
      const setting = await Taro.openSetting();
      const nextPermission = readLocationPermission(setting.authSetting as LocationAuthSetting | undefined);
      setPermission(nextPermission);

      if (nextPermission === 'authorized') {
        await fetchWeather({ forceRefresh: true, source: 'manual', skipBusyGuard: true });
        return;
      }

      setStatus('denied');
      setHint(DENIED_HINT);
    } catch (error) {
      console.warn('[WeatherCard] openSetting failed', error);
      setStatus('denied');
      setHint(DENIED_HINT);
    } finally {
      busyRef.current = false;
      setRefreshing(false);
    }
  }

  async function fetchWeather({
    forceRefresh = false,
    source,
    skipBusyGuard = false,
  }: {
    forceRefresh?: boolean;
    source: 'auto' | 'manual';
    skipBusyGuard?: boolean;
  }) {
    if (!skipBusyGuard && busyRef.current) return;

    const previousWeather = weather;
    const hadUsableWeather = Boolean(toWeatherSnapshot(previousWeather));

    try {
      busyRef.current = true;
      if (source === 'manual' || forceRefresh) setRefreshing(true);
      setStatus('locating');
      setHint(LOCATING_HINT);

      const location = await withTimeout(
        Taro.getLocation({
          type: 'gcj02',
          isHighAccuracy: false,
        }) as Promise<TaroLocationResult>,
        8000,
        '定位超时，请确认手机定位服务已开启',
      );

      setPermission('authorized');
      setStatus('loadingWeather');
      setHint(LOADING_HINT);

      const data = await withTimeout(
        getCloudWeather(
          {
            latitude: location.latitude,
            longitude: location.longitude,
          },
          { forceRefresh },
        ),
        9000,
        '天气服务响应超时，请稍后重试',
      );

      setWeather(data);
      setStatus('ready');
      setHint(data.cacheHit ? `缓存天气刷新于 ${formatRefreshTime(data)}，适合先参考一下。` : `本地天气刷新于 ${formatRefreshTime(data)}`);
      notifyWeatherChange(data, { forceRefresh });

      if (source === 'manual' && !data.cacheHit) {
        Taro.showToast({ title: '已切换为本地天气，今天的推荐会更准啦', icon: 'none' });
      }
    } catch (error) {
      const message = getErrorMessage(error);
      console.warn('[WeatherCard] real weather failed', error);

      if (isPermissionDeniedError(message)) {
        setPermission('denied');
        setStatus('denied');
        setHint(DENIED_HINT);
        return;
      }

      const cached = readCachedWeather();
      if (cached) {
        setWeather(cached);
        setStatus('ready');
        setHint(`天气暂时没拿到，先展示缓存 ${formatRefreshTime(cached)}。`);
        notifyWeatherChange(cached, { forceRefresh: false });
        return;
      }

      if (hadUsableWeather) {
        setWeather(previousWeather);
        setStatus('failed');
        setHint('天气暂时没拿到，先保留上次天气，稍后可以再试一次。');
        return;
      }

      setWeather(getFallbackResolvedWeather(city));
      setStatus('failed');
      setHint(FAILED_HINT);
    } finally {
      busyRef.current = false;
      setRefreshing(false);
    }
  }

  function notifyWeatherChange(value: ResolvedWeatherResponse, options?: { forceRefresh?: boolean }) {
    const snapshot = toWeatherSnapshot(value);
    if (!snapshot) return;

    const notifyKey = `${snapshot.temp}:${snapshot.humidity}:${snapshot.weather}:${snapshot.wind}:${snapshot.uv}`;
    if (!options?.forceRefresh && notifyKey === lastNotifiedKeyRef.current) return;

    lastNotifiedKeyRef.current = notifyKey;
    onWeatherChange?.(snapshot, options);
  }

  const displayLocation = weather.location.district || weather.location.city || weather.location.displayName || '当前位置';
  const temperature = hasWeather ? `${weather.weather.temperature}℃` : '--';
  const weatherText = hasWeather ? weather.weather.weather : '默认天气';
  const actionText = getActionText(status, permission, refreshing);
  const statusClass = `weather-card ${status}`;

  return (
    <View className={statusClass}>
      <View className="weather-main">
        <View className="weather-info">
          <View className="weather-temp-wrap">
            <Text className="weather-temp">{temperature}</Text>
            <Text className="weather-status">{weatherText}</Text>
          </View>
          <View className="weather-location">
            <Text className="location-text">{displayLocation}</Text>
            <Text className="weather-hint">{hint}</Text>
          </View>
        </View>
        <View className={`weather-action ${refreshing ? 'disabled' : ''}`} onClick={handleWeatherAction}>
          <Text className="weather-action-text">{actionText}</Text>
        </View>
      </View>
    </View>
  );
}

function readCachedWeather(): ResolvedWeatherResponse | null {
  try {
    const cached = Taro.getStorageSync(WEATHER_CACHE_KEY) as ResolvedWeatherResponse | '';
    if (!cached || typeof cached !== 'object') return null;
    if (cached.source === 'fallback' || !cached.weather?.weather) return null;
    return { ...cached, source: 'cache', cacheHit: true };
  } catch {
    return null;
  }
}

async function getLocationPermission(): Promise<LocationPermission> {
  const setting = await Taro.getSetting();
  return readLocationPermission(setting.authSetting as LocationAuthSetting | undefined);
}

function readLocationPermission(authSetting: LocationAuthSetting | undefined): LocationPermission {
  const value = authSetting?.['scope.userLocation'];
  if (value === true) return 'authorized';
  if (value === false) return 'denied';
  return 'unknown';
}

function showReauthorizeModal() {
  return Taro.showModal({
    title: '开启本地天气',
    content: '小搭只会用定位获取本地天气，让穿搭推荐更贴近今天温度。',
    confirmText: '去开启',
    cancelText: '先不用',
  }).then((result) => result.confirm);
}

function getActionText(status: WeatherStatus, permission: LocationPermission, refreshing: boolean) {
  if (refreshing || status === 'locating' || status === 'loadingWeather') return '同步中';
  if (status === 'checkingAuth') return '检查中';
  if (permission === 'denied' || status === 'denied') return '重新授权';
  if (status === 'failed') return '再试一次';
  if (permission === 'unknown' || status === 'needPermission' || status === 'fallback') return '开启本地天气';
  return '刷新天气';
}

function getErrorMessage(error: unknown) {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const maybeError = error as { errMsg?: string; message?: string };
    return maybeError.errMsg || maybeError.message || '未知错误';
  }
  return '未知错误';
}

function isPermissionDeniedError(message: string) {
  return /auth deny|authorize no response|permission denied|auth denied|deny|denied|未授权|拒绝/.test(message);
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
