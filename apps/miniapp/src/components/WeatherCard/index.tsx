import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useEffect, useRef, useState } from 'react';
import { getCloudWeather, getFallbackResolvedWeather, WEATHER_CACHE_KEY } from '@/lib/cloud';
import { toWeatherSnapshot } from '@/utils/weather';
import type { ResolvedWeatherResponse, WeatherSnapshot } from '@starter-template/types';
import './index.scss';

interface WeatherCardProps {
  city?: string;
  onWeatherChange?: (weather: WeatherSnapshot, options?: { forceRefresh?: boolean }) => void | Promise<void>;
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

export function WeatherCard({ city = '当前位置', onWeatherChange }: WeatherCardProps) {
  const [weather, setWeather] = useState<ResolvedWeatherResponse>(() => readCachedWeather() ?? getFallbackResolvedWeather(city));
  const [status, setStatus] = useState<WeatherStatus>('checkingAuth');
  const [permission, setPermission] = useState<LocationPermission>('unknown');
  const [refreshing, setRefreshing] = useState(false);
  const busyRef = useRef(false);
  const lastNotifiedKeyRef = useRef('');

  const hasUsableWeather = Boolean(toWeatherSnapshot(weather));

  useEffect(() => {
    const cached = readCachedWeather();
    const nextWeather = cached ?? getFallbackResolvedWeather(city);
    setWeather(nextWeather);

    checkAuthAndMaybeFetch(nextWeather);
  }, [city]);

  async function checkAuthAndMaybeFetch(currentWeather = weather) {
    const currentHasUsableWeather = Boolean(toWeatherSnapshot(currentWeather));

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
        return;
      }

      setStatus(currentHasUsableWeather ? 'ready' : 'needPermission');
    } catch (error) {
      console.warn('[WeatherCard] getSetting failed', error);
      setStatus(currentHasUsableWeather ? 'ready' : 'needPermission');
    }
  }

  async function handleWeatherAction() {
    if (busyRef.current || status === 'locating' || status === 'loadingWeather') return;

    if (permission === 'denied' || status === 'denied') {
      await requestReauthorize();
      return;
    }

    const forceRefresh = permission === 'authorized' || hasUsableWeather;
    await fetchWeather({ forceRefresh, source: 'manual' });
  }

  async function requestReauthorize() {
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
      Taro.showToast({ title: '没关系，先按当前推荐搭～', icon: 'none' });
    } catch (error) {
      console.warn('[WeatherCard] openSetting failed', error);
      setStatus('denied');
      Taro.showToast({ title: '没关系，先按当前推荐搭～', icon: 'none' });
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
      const notified = await notifyWeatherChange(data, { forceRefresh });

      if (source === 'manual' && notified) {
        Taro.showToast({ title: '天气同步好啦，已为你重新搭配～', icon: 'none' });
      }
    } catch (error) {
      const message = getErrorMessage(error);
      console.warn('[WeatherCard] real weather failed', error);

      if (isPermissionDeniedError(message)) {
        setPermission('denied');
        setStatus('denied');
        if (source === 'manual') {
          Taro.showToast({ title: '没关系，先按当前推荐搭～', icon: 'none' });
        }
        return;
      }

      const cached = readCachedWeather();
      if (cached) {
        setWeather(cached);
        setStatus('ready');
        notifyWeatherChange(cached, { forceRefresh: false });
        if (source === 'manual') {
          Taro.showToast({ title: '天气没刷新成功，先按刚才的推荐搭～', icon: 'none' });
        }
        return;
      }

      if (hadUsableWeather) {
        setWeather(previousWeather);
        setStatus('ready');
        if (source === 'manual') {
          Taro.showToast({ title: '天气没刷新成功，先按刚才的推荐搭～', icon: 'none' });
        }
        return;
      }

      setWeather(getFallbackResolvedWeather(city));
      setStatus('failed');
      if (source === 'manual') {
        Taro.showToast({ title: '天气暂时没同步，先按当前推荐搭～', icon: 'none' });
      }
    } finally {
      busyRef.current = false;
      setRefreshing(false);
    }
  }

  async function notifyWeatherChange(value: ResolvedWeatherResponse, options?: { forceRefresh?: boolean }) {
    const snapshot = toWeatherSnapshot(value);
    if (!snapshot) return false;

    const notifyKey = `${snapshot.temp}:${snapshot.humidity}:${snapshot.weather}:${snapshot.wind}:${snapshot.uv}`;
    if (!options?.forceRefresh && notifyKey === lastNotifiedKeyRef.current) return false;

    lastNotifiedKeyRef.current = notifyKey;
    await onWeatherChange?.(snapshot, options);
    return true;
  }

  const text = getWeatherCapsuleText({ status, permission, refreshing, weather });
  const statusClass = `weather-card ${status}`;

  return (
    <View className={`${statusClass} ${refreshing ? 'disabled' : ''}`} onClick={handleWeatherAction}>
      <Text className="weather-capsule-text">{text}</Text>
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

function getWeatherCapsuleText({
  status,
  permission,
  refreshing,
  weather,
}: {
  status: WeatherStatus;
  permission: LocationPermission;
  refreshing: boolean;
  weather: ResolvedWeatherResponse;
}) {
  const snapshot = toWeatherSnapshot(weather);
  const isBusy = refreshing || status === 'locating' || status === 'loadingWeather';

  if (isBusy) return '同步中…';
  if (permission === 'denied' || status === 'denied') return '去开启';
  if (snapshot && status !== 'failed') return `${getWeatherIcon(snapshot.weather)} ${snapshot.temp}° ${snapshot.weather} ↻`;
  if (status === 'failed') return '再试试';

  return '开启天气';
}

function getWeatherIcon(weather: string) {
  if (/雨|阵雨|雷/.test(weather)) return '🌧';
  if (/雪|冰/.test(weather)) return '❄';
  if (/阴/.test(weather)) return '☁';
  if (/云/.test(weather)) return '☁';
  if (/晴/.test(weather)) return '☀';
  return '☁';
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
