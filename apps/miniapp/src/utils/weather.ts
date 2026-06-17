import type { ResolvedWeatherResponse, WeatherSnapshot } from '@starter-template/types';

export type RecommendationWeatherFingerprint = string;
export type WeatherConditionBucket = 'thunder' | 'snow' | 'rain' | 'clear' | 'cloudy' | 'overcast' | 'other';

const UNRESOLVED_RECOMMENDATION_WEATHER_FINGERPRINT = 'unresolved|none|other';

export function toWeatherSnapshot(value: ResolvedWeatherResponse | null | undefined): WeatherSnapshot | undefined {
  if (!value?.weather) return undefined;
  if (value.source === 'fallback') return undefined;
  if (!value.weather.weather.trim()) return undefined;

  const temp = Number(value.weather.temperature);
  if (!Number.isFinite(temp)) return undefined;

  return {
    temp,
    humidity: normalizeNumber(value.weather.humidity, 65),
    weather: value.weather.weather || '多云',
    wind: normalizeWind(value.weather.windPower),
    uv: 4,
  };
}

export function getRecommendationWeatherFingerprint(
  weather: WeatherSnapshot | null | undefined,
): RecommendationWeatherFingerprint {
  if (!isUsableWeatherSnapshot(weather)) return UNRESOLVED_RECOMMENDATION_WEATHER_FINGERPRINT;

  return [
    'resolved',
    getRecommendationTempBand(weather.temp),
    getWeatherConditionBucket(weather.weather),
  ].join('|');
}

export function getRecommendationTempBand(temp: number) {
  if (temp < 5) return '< 5';
  if (temp <= 14) return '5 - 14';
  if (temp <= 19) return '15 - 19';
  if (temp <= 25) return '20 - 25';
  if (temp <= 31) return '26 - 31';
  return '>= 32';
}

export function getWeatherConditionBucket(weather: string): WeatherConditionBucket {
  const normalized = weather.trim().toLowerCase();
  if (!normalized) return 'other';

  if (/雷|thunder|storm/.test(normalized)) return 'thunder';
  if (/雪|snow|sleet/.test(normalized)) return 'snow';
  if (/雨|rain|shower|drizzle/.test(normalized)) return 'rain';
  if (/晴|clear|sunny/.test(normalized)) return 'clear';
  if (/多云|少云|cloudy|partly cloudy/.test(normalized)) return 'cloudy';
  if (/阴|overcast/.test(normalized)) return 'overcast';
  return 'other';
}

function isUsableWeatherSnapshot(weather: WeatherSnapshot | null | undefined): weather is WeatherSnapshot {
  return Boolean(
    weather
      && Number.isFinite(weather.temp)
      && weather.weather.trim(),
  );
}

function normalizeNumber(value: number | undefined, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeWind(value: string | undefined) {
  if (!value) return 3;
  const matched = value.match(/\d+/);
  if (!matched) return 3;
  const wind = Number(matched[0]);
  return Number.isFinite(wind) ? wind : 3;
}
