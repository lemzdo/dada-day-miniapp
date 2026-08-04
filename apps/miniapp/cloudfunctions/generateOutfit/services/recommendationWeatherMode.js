const WEATHER_MODES = new Set(['live', 'cached', 'disabled', 'unavailable']);

function normalizeRecommendationWeather(weather, rawMode) {
  const mode = normalizeWeatherMode(rawMode || weather?.mode || weather?.weatherMode, weather);
  if (!['live', 'cached'].includes(mode)) return emptyRecommendationWeather(mode);
  const temperature = readFinite(weather?.temp ?? weather?.temperature);
  if (temperature === null) return emptyRecommendationWeather('unavailable');
  return {
    mode,
    weatherMode: mode,
    temp: temperature,
    temperature,
    humidity: readFinite(weather?.humidity),
    weather: readString(weather?.weather || weather?.condition),
    condition: readString(weather?.condition || weather?.weather),
    wind: readFinite(weather?.wind),
    uv: readFinite(weather?.uv),
    source: mode,
  };
}

function emptyRecommendationWeather(mode = 'unavailable') {
  const normalizedMode = ['disabled', 'unavailable'].includes(mode) ? mode : 'unavailable';
  return {
    mode: normalizedMode,
    weatherMode: normalizedMode,
    temp: null,
    temperature: null,
    humidity: null,
    weather: null,
    condition: null,
    isHot: false,
    isCool: false,
    isCold: false,
    isHumidHot: false,
    source: 'none',
  };
}

function hasRealRecommendationWeather(weather) {
  return Boolean(
    weather
      && ['live', 'cached'].includes(weather.mode || weather.weatherMode)
      && Number.isFinite(Number(weather.temp ?? weather.temperature)),
  );
}

function toWeatherSnapshot(weather) {
  if (!hasRealRecommendationWeather(weather)) return undefined;
  return {
    temp: Number(weather.temp ?? weather.temperature),
    humidity: readFinite(weather.humidity),
    weather: readString(weather.weather || weather.condition),
    wind: readFinite(weather.wind),
    uv: readFinite(weather.uv),
  };
}

function normalizeWeatherMode(value, weather) {
  const mode = readString(value).toLowerCase();
  if (WEATHER_MODES.has(mode)) return mode;
  return Number.isFinite(Number(weather?.temp ?? weather?.temperature)) ? 'live' : 'unavailable';
}

function readFinite(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function readString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

module.exports = {
  emptyRecommendationWeather,
  hasRealRecommendationWeather,
  normalizeRecommendationWeather,
  normalizeWeatherMode,
  toWeatherSnapshot,
};
