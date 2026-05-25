const https = require('https');
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const AMAP_HOST = 'https://restapi.amap.com';
const WEATHER_CACHE_TTL_MS = Number(process.env.WEATHER_CACHE_TTL_MS || 10 * 60 * 1000);

exports.main = async (event = {}) => {
  try {
    const latitude = Number(event.latitude);
    const longitude = Number(event.longitude);
    const forceRefresh = event.forceRefresh === true;

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new Error('latitude and longitude are required');
    }

    const locationKey = getLocationKey(latitude, longitude);
    if (!forceRefresh) {
      const cached = await getCachedWeather(locationKey);
      if (cached) return ok(cached);
    }

    const amapKey = process.env.AMAP_KEY;
    if (!amapKey) {
      throw new Error('AMAP_KEY is not configured');
    }

    const location = await withTimeout(reverseGeocodeByAmap(latitude, longitude, amapKey), 3500);
    const weather = await withTimeout(fetchWeatherByAmap(location.adcode, amapKey), 3500);
    const fetchedAt = new Date().toISOString();
    const observedAt = weather.reportTime || undefined;

    const data = {
      location,
      weather,
      source: 'amap',
      cacheHit: false,
      fetchedAt,
      observedAt,
      updatedAt: fetchedAt,
    };
    await setCachedWeather(locationKey, data);

    return ok(data);
  } catch (error) {
    console.error('[getWeather] failed', error);
    return fail(error);
  }
};

async function getCachedWeather(locationKey) {
  try {
    const res = await db
      .collection('weather_cache')
      .where({
        locationKey,
        expiresAt: _.gt(new Date()),
      })
      .limit(1)
      .get();
    const cache = res.data && res.data[0];
    if (!cache || !cache.weatherData) return null;

    return normalizeCachedWeather(cache.weatherData, cache.updatedAt);
  } catch (error) {
    console.warn('[getWeather] read cache failed', error);
    return null;
  }
}

function normalizeCachedWeather(weatherData, cacheUpdatedAt) {
  const fetchedAt =
    weatherData.fetchedAt ||
    toIsoString(cacheUpdatedAt) ||
    weatherData.updatedAt ||
    new Date().toISOString();
  return {
    ...weatherData,
    source: 'cache',
    cacheHit: true,
    fetchedAt,
    observedAt: weatherData.observedAt || weatherData.weather?.reportTime || undefined,
    updatedAt: weatherData.updatedAt || fetchedAt,
  };
}

async function setCachedWeather(locationKey, weatherData) {
  try {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + WEATHER_CACHE_TTL_MS);
    const collection = db.collection('weather_cache');
    const existing = await collection.where({ locationKey }).limit(1).get();
    const data = {
      locationKey,
      weatherData,
      expiresAt,
      updatedAt: now,
    };

    if (existing.data && existing.data[0]) {
      await collection.doc(existing.data[0]._id).update({ data });
      return;
    }

    await collection.add({ data });
  } catch (error) {
    console.warn('[getWeather] write cache failed', error);
  }
}

function getLocationKey(latitude, longitude) {
  return `${roundCoordinate(latitude)},${roundCoordinate(longitude)}`;
}

function roundCoordinate(value) {
  return Math.round(value * 100) / 100;
}

async function reverseGeocodeByAmap(latitude, longitude, key) {
  const url =
    `${AMAP_HOST}/v3/geocode/regeo` +
    `?key=${encodeURIComponent(key)}` +
    `&location=${encodeURIComponent(`${longitude},${latitude}`)}` +
    '&extensions=base' +
    '&radius=1000' +
    '&roadlevel=0';

  const data = await requestJson(url);
  assertAmapOk(data, 'reverse geocoding');

  const component = data.regeocode && data.regeocode.addressComponent;
  if (!component) {
    throw new Error('reverse geocoding returned empty location');
  }

  const province = normalizeAmapText(component.province);
  const city = normalizeAmapText(component.city) || province;
  const district = normalizeAmapText(component.district);
  const adcode = normalizeAmapText(component.adcode);

  if (!adcode) {
    throw new Error('reverse geocoding returned empty adcode');
  }

  return {
    province,
    city,
    district,
    adcode,
    displayName: district || city || province || '当前位置',
  };
}

async function fetchWeatherByAmap(adcode, key) {
  const url =
    `${AMAP_HOST}/v3/weather/weatherInfo` +
    `?key=${encodeURIComponent(key)}` +
    `&city=${encodeURIComponent(adcode)}` +
    '&extensions=base';

  const data = await requestJson(url);
  assertAmapOk(data, 'weather');

  const live = data.lives && data.lives[0];
  if (!live) {
    throw new Error('weather returned empty live data');
  }

  return {
    weather: normalizeAmapText(live.weather) || '未知',
    temperature: toNumber(live.temperature, 0),
    windDirection: normalizeAmapText(live.winddirection) || undefined,
    windPower: normalizeAmapText(live.windpower) || undefined,
    humidity: live.humidity === undefined ? undefined : toNumber(live.humidity, 0),
    reportTime: normalizeAmapText(live.reporttime) || undefined,
  };
}

function assertAmapOk(data, action) {
  if (!data || data.status !== '1') {
    const info = data && (data.info || data.infocode);
    throw new Error(`Amap ${action} failed${info ? `: ${getAmapErrorMessage(info)}` : ''}`);
  }
}

function getAmapErrorMessage(info) {
  const messages = {
    USERKEY_PLAT_NOMATCH: 'AMAP_KEY 平台类型不匹配，请使用“Web服务”Key，而不是小程序/JS API Key',
    INVALID_USER_KEY: 'AMAP_KEY 无效，请检查云函数环境变量',
    USERKEY_NOT_MATCH: 'AMAP_KEY 与当前应用不匹配',
    DAILY_QUERY_OVER_LIMIT: '高德接口今日调用量已达上限',
    SERVICE_NOT_AVAILABLE: '高德服务不可用或当前 Key 未开通该服务',
  };
  return messages[info] || info;
}

function normalizeAmapText(value) {
  if (Array.isArray(value)) return '';
  return typeof value === 'string' ? value.trim() : '';
}

function toNumber(value, fallback) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function toIsoString(value) {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function withTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('weather service timeout'));
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

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const req = https
      .get(url, (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(error);
          }
        });
      })
      .on('error', reject);

    req.setTimeout(5000, () => {
      req.destroy(new Error('weather provider timeout'));
    });
  });
}

function ok(data) {
  return { code: 0, data, message: 'ok' };
}

function fail(error) {
  return {
    code: 1,
    data: null,
    message: error && error.message ? error.message : 'unknown error',
  };
}
