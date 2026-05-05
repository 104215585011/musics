const WEATHER_CACHE_MS = 30 * 60 * 1000;
const IP_CACHE_MS = 24 * 60 * 60 * 1000;

let weatherCache = { data: null, at: 0 };
let ipCache = { data: null, at: 0 };

function isCacheValid(cache, ttl) {
  return cache.data !== null && Date.now() - cache.at < ttl;
}

async function fetchWithTimeout(url, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok ? response.json() : null;
  } finally {
    clearTimeout(timer);
  }
}

function openMeteoUrl(lat, lon) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: "temperature_2m,relative_humidity_2m,weather_code,is_day",
    timezone: "auto",
  });
  return `https://api.open-meteo.com/v1/forecast?${params}`;
}

const WEATHER_DESCRIPTIONS = {
  0: "晴天",
  1: "多云",
  2: "多云",
  3: "阴天",
  45: "有雾",
  48: "有雾",
  51: "小雨",
  53: "小雨",
  55: "中雨",
  56: "冻雨",
  57: "冻雨",
  61: "小雨",
  63: "中雨",
  65: "大雨",
  66: "冻雨",
  67: "冻雨",
  71: "小雪",
  73: "中雪",
  75: "大雪",
  77: "雪粒",
  80: "阵雨",
  81: "中阵雨",
  82: "大阵雨",
  85: "小阵雪",
  86: "大阵雪",
  95: "雷暴",
  96: "雷暴",
  99: "雷暴",
};

function describeWeather(code) {
  return WEATHER_DESCRIPTIONS[code] ?? "未知";
}

async function getLocationByIP() {
  if (isCacheValid(ipCache, IP_CACHE_MS)) {
    return ipCache.data;
  }

  try {
    const data = await fetchWithTimeout("http://ip-api.com/json/");
    if (data && data.status === "success") {
      const result = { lat: data.lat, lon: data.lon, city: data.city, region: data.regionName };
      ipCache = { data: result, at: Date.now() };
      return result;
    }
  } catch {
    // IP geolocation failed, return null
  }
  return null;
}

async function getWeatherByCoords(lat, lon) {
  try {
    const data = await fetchWithTimeout(openMeteoUrl(lat, lon));
    if (!data?.current) return null;

    const current = data.current;
    const code = current.weather_code ?? 0;

    return {
      temperature: current.temperature_2m,
      humidity: current.relative_humidity_2m,
      conditionCode: code,
      condition: describeWeather(code),
      isDay: current.is_day === 1,
      description: `${current.temperature_2m}°C · ${describeWeather(code)}`,
      fetchedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

async function getWeather(config = {}) {
  const lat = config.lat;
  const lon = config.lon;

  // Use configured coordinates, or try auto-detect
  if (lat != null && lon != null) {
    return getWeatherByCoords(lat, lon);
  }

  const location = await getLocationByIP();
  if (!location) return null;

  const weather = await getWeatherByCoords(location.lat, location.lon);
  if (weather) {
    weather.city = location.city;
    weather.locationName = config.locationName || location.city || location.region || "";
  }
  return weather;
}

async function getCachedWeather(config = {}) {
  if (isCacheValid(weatherCache, WEATHER_CACHE_MS)) {
    return weatherCache.data;
  }

  const data = await getWeather(config);
  if (data) {
    weatherCache = { data, at: Date.now() };
  }
  return data;
}

function getWeatherCondition(weather) {
  if (!weather) return null;
  return {
    temperature: weather.temperature,
    condition: weather.condition,
    conditionCode: weather.conditionCode,
    isDay: weather.isDay,
    description: weather.description,
    city: weather.city ?? "",
    locationName: weather.locationName ?? "",
    humidity: weather.humidity,
  };
}

module.exports = {
  getCachedWeather,
  getWeatherByCoords,
  getLocationByIP,
  getWeatherCondition,
  describeWeather,
};
