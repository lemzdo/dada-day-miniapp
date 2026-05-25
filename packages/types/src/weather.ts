// ── 天气数据类型 ──

/** 实时天气 */
export interface CurrentWeather {
  city: string;
  cityCode: string;
  temp: number;
  feelsLike: number;
  humidity: number;
  weather: string;
  weatherIcon: string;
  wind: number;
  windDir: string;
  uv: number;
  visibility: number;
  updateTime: string;
}

export interface ResolvedWeatherLocation {
  province: string;
  city: string;
  district: string;
  adcode: string;
  displayName: string;
}

export interface ResolvedWeather {
  weather: string;
  temperature: number;
  windDirection?: string;
  windPower?: string;
  humidity?: number;
  reportTime?: string;
}

export interface ResolvedWeatherResponse {
  location: ResolvedWeatherLocation;
  weather: ResolvedWeather;
  source: 'amap' | 'cache' | 'fallback';
  cacheHit?: boolean;
  fetchedAt?: string;
  observedAt?: string;
  updatedAt: string;
}

/** 天气预报（单日） */
export interface DailyForecast {
  date: string;
  tempHigh: number;
  tempLow: number;
  weatherDay: string;
  weatherNight: string;
  humidity: number;
  wind: number;
  uv: number;
  precipitation: number;
}

/** 天气预报查询参数 */
export interface WeatherQuery {
  city?: string;
  lat?: number;
  lng?: number;
}

/** 天气快照（存入穿搭方案） */
export interface WeatherSnapshot {
  temp: number;
  humidity: number;
  weather: string;
  wind: number;
  uv: number;
}
