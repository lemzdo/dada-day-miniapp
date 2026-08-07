import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useEffect, useRef, useState } from 'react';
import { getCloudWeather, getFallbackResolvedWeather, WEATHER_CACHE_KEY } from '@/lib/cloud';
import { toWeatherSnapshot } from '@/utils/weather';
import type { ResolvedWeatherResponse, WeatherMode, WeatherSnapshot } from '@starter-template/types';
import './index.scss';

export type WeatherRecommendationRefreshResult = 'unchanged' | 'refreshed' | 'failed';

interface WeatherCardProps {
  city?: string;
  onLocationPermissionPrompt?: () => void;
  onLocationPermissionResolved?: () => void;
  onWeatherChange?: (
    weather: WeatherSnapshot | undefined,
    options: { forceRefresh?: boolean; weatherMode: WeatherMode },
  ) => WeatherRecommendationRefreshResult | void | Promise<WeatherRecommendationRefreshResult | void>;
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
type WeatherFailureReason = 'permission_denied' | 'location_unavailable' | 'service_unavailable' | null;

interface LocationAuthSetting {
  'scope.userLocation'?: boolean;
}

interface TaroLocationResult {
  latitude: number;
  longitude: number;
}

export function WeatherCard({ city = '当前位置', onLocationPermissionPrompt, onLocationPermissionResolved, onWeatherChange }: WeatherCardProps) {
  const [weather, setWeather] = useState<ResolvedWeatherResponse>(() => readCachedWeather() ?? getFallbackResolvedWeather(city));
  const [status, setStatus] = useState<WeatherStatus>('checkingAuth');
  const [permission, setPermission] = useState<LocationPermission>('unknown');
  const [failureReason, setFailureReason] = useState<WeatherFailureReason>(null);
  const [refreshing, setRefreshing] = useState(false);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const lastNotifiedKeyRef = useRef('');

  const hasUsableWeather = Boolean(toWeatherSnapshot(weather));

  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  useEffect(() => {
    const cached = readCachedWeather();
    const nextWeather = cached ?? getFallbackResolvedWeather(city);
    setWeather(nextWeather);
    if (cached) {
      void notifyWeatherChange(cached, { forceRefresh: false, weatherMode: 'cached' });
    }

    checkAuthAndMaybeFetch(nextWeather);
  }, [city]);

  async function checkAuthAndMaybeFetch(currentWeather = weather) {
    const currentHasUsableWeather = Boolean(toWeatherSnapshot(currentWeather));

    setStatus('checkingAuth');

    try {
      const nextPermission = await getLocationPermission();
      if (!mountedRef.current) return;
      setPermission(nextPermission);

      if (nextPermission === 'authorized') {
        await fetchWeather({ forceRefresh: false, source: 'auto' });
        return;
      }

      if (nextPermission === 'denied') {
        setFailureReason('permission_denied');
        setStatus('denied');
        await notifyWeatherModeChange('disabled');
        return;
      }

      setFailureReason('service_unavailable');
      setStatus(currentHasUsableWeather ? 'fallback' : 'needPermission');
      if (!currentHasUsableWeather) await notifyWeatherModeChange('disabled');
    } catch (error) {
      if (!mountedRef.current) return;
      console.warn('[WeatherCard] getSetting failed', error);
      setStatus(currentHasUsableWeather ? 'ready' : 'needPermission');
      if (!currentHasUsableWeather) await notifyWeatherModeChange('unavailable');
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
      if (!mountedRef.current) return;
      const nextPermission = readLocationPermission(setting.authSetting as LocationAuthSetting | undefined);
      setPermission(nextPermission);

      if (nextPermission === 'authorized') {
        await fetchWeather({ forceRefresh: true, source: 'manual', skipBusyGuard: true });
        return;
      }

      setStatus('denied');
      setFailureReason('permission_denied');
      await notifyWeatherModeChange('disabled');
      Taro.showToast({ title: '没关系，先按当前推荐搭～', icon: 'none' });
    } catch (error) {
      if (!mountedRef.current) return;
      console.warn('[WeatherCard] openSetting failed', error);
      setStatus('denied');
      setFailureReason('permission_denied');
      await notifyWeatherModeChange('disabled');
      Taro.showToast({ title: '没关系，先按当前推荐搭～', icon: 'none' });
    } finally {
      busyRef.current = false;
      if (mountedRef.current) {
        setRefreshing(false);
      }
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
    let failureStage: 'location' | 'service' = 'location';

    try {
      busyRef.current = true;
      if (source === 'manual' || forceRefresh) setRefreshing(true);
      setStatus('locating');

      onLocationPermissionPrompt?.();
      let location: TaroLocationResult;
      try {
        location = await withTimeout(
          Taro.getLocation({
            type: 'gcj02',
            isHighAccuracy: false,
          }) as Promise<TaroLocationResult>,
          8000,
          '定位超时，请确认手机定位服务已开启',
        );
      } finally {
        onLocationPermissionResolved?.();
      }
      if (!mountedRef.current) return;

      setPermission('authorized');
      setStatus('loadingWeather');
      failureStage = 'service';

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
      if (!mountedRef.current) return;

      setWeather(data);
      setFailureReason(null);
      setStatus('ready');
      const notifyResult = await notifyWeatherChange(data, {
        forceRefresh,
        weatherMode: data.source === 'cache' ? 'cached' : 'live',
      });

      if (source === 'manual') {
        showManualWeatherSuccessToast(notifyResult);
        return;
      }
    } catch (error) {
      if (!mountedRef.current) return;
      const message = getErrorMessage(error);
      console.warn('[WeatherCard] real weather failed', error);

      if (isPermissionDeniedError(message)) {
        setPermission('denied');
        setFailureReason('permission_denied');
        setStatus('denied');
        await notifyWeatherModeChange('disabled');
        if (source === 'manual') {
          Taro.showToast({ title: '没关系，先按当前推荐搭～', icon: 'none' });
        }
        return;
      }

      const cached = readCachedWeather();
      if (cached) {
        setWeather(cached);
        setFailureReason(failureStage === 'location' ? 'location_unavailable' : 'service_unavailable');
        setStatus('fallback');
        void notifyWeatherChange(cached, { forceRefresh: false, weatherMode: 'cached' });
        if (source === 'manual') {
          Taro.showToast({ title: '天气没刷新成功，先按刚才的推荐搭～', icon: 'none' });
        }
        return;
      }

      if (hadUsableWeather) {
        setWeather(previousWeather);
        setFailureReason(failureStage === 'location' ? 'location_unavailable' : 'service_unavailable');
        setStatus('fallback');
        if (source === 'manual') {
          Taro.showToast({ title: '天气没刷新成功，先按刚才的推荐搭～', icon: 'none' });
        }
        return;
      }

      setWeather(getFallbackResolvedWeather(city));
      setFailureReason(failureStage === 'location' ? 'location_unavailable' : 'service_unavailable');
      setStatus('failed');
      await notifyWeatherModeChange('unavailable');
      if (source === 'manual') {
        Taro.showToast({ title: '天气暂时没同步，先按当前推荐搭～', icon: 'none' });
      }
    } finally {
      busyRef.current = false;
      if (mountedRef.current) {
        setRefreshing(false);
      }
    }
  }

  async function notifyWeatherChange(
    value: ResolvedWeatherResponse,
    options: { forceRefresh?: boolean; weatherMode: 'live' | 'cached' },
  ) {
    const snapshot = toWeatherSnapshot(value);
    if (!snapshot) return false;

    const notifyKey = getWeatherSnapshotNotifyKey(snapshot);
    if (!options?.forceRefresh && notifyKey === lastNotifiedKeyRef.current) return false;

    const result = await callWeatherChange(snapshot, options);
    if (result !== 'failed') {
      lastNotifiedKeyRef.current = notifyKey;
    }
    return result;
  }

  async function notifyWeatherModeChange(weatherMode: 'disabled' | 'unavailable') {
    const notifyKey = `${weatherMode}|none`;
    if (notifyKey === lastNotifiedKeyRef.current) return 'unchanged';
    const result = await callWeatherChange(undefined, { weatherMode });
    if (result !== 'failed') lastNotifiedKeyRef.current = notifyKey;
    return result;
  }

  async function callWeatherChange(
    snapshot: WeatherSnapshot | undefined,
    options: { forceRefresh?: boolean; weatherMode: WeatherMode },
  ) {
    try {
      return (await onWeatherChange?.(snapshot, options)) ?? 'unchanged';
    } catch (error) {
      console.warn('[WeatherCard] onWeatherChange failed', error);
      return 'failed';
    }
  }

  function showManualWeatherSuccessToast(result: WeatherRecommendationRefreshResult | false) {
    if (!mountedRef.current) return;

    if (result === 'refreshed') {
      Taro.showToast({ title: '天气更新啦，小搭也重新搭好了', icon: 'none' });
      return;
    }

    if (result === 'failed') {
      Taro.showToast({ title: '天气已更新，先按刚才这套推荐', icon: 'none' });
      return;
    }

    Taro.showToast({ title: '天气已更新', icon: 'none' });
  }

  const text = getWeatherCapsuleText({ status, permission, refreshing, weather, failureReason });
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
    const cachedAt = Date.parse(cached.fetchedAt || cached.updatedAt || cached.observedAt || '');
    if (!Number.isFinite(cachedAt) || Date.now() - cachedAt > 10 * 60 * 1000) return null;
    return { ...cached, source: 'cache', cacheHit: true };
  } catch {
    return null;
  }
}

function getWeatherSnapshotNotifyKey(snapshot: WeatherSnapshot) {
  return [
    snapshot.temp,
    snapshot.weather,
    snapshot.humidity,
    snapshot.wind,
    snapshot.uv,
  ].join('|');
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
  failureReason,
}: {
  status: WeatherStatus;
  permission: LocationPermission;
  refreshing: boolean;
  weather: ResolvedWeatherResponse;
  failureReason: WeatherFailureReason;
}) {
  const snapshot = toWeatherSnapshot(weather);
  const isBusy = refreshing || status === 'locating' || status === 'loadingWeather';

  if (isBusy) return '同步中…';
  if (permission === 'denied' || status === 'denied') return '未获定位权限，去开启';
  if (status === 'fallback' && failureReason === 'location_unavailable') return '定位不可用，使用上次天气';
  if (status === 'fallback' && failureReason === 'service_unavailable') return '天气服务不可用，使用上次天气';
  if (status === 'failed' && failureReason === 'location_unavailable') return '定位不可用，再试试';
  if (status === 'failed' && failureReason === 'service_unavailable') return '天气服务不可用，再试试';
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
