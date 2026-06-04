import type { ResolvedWeatherResponse, WeatherSnapshot } from '@starter-template/types';

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
