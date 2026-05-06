const fs = require("node:fs");
const path = require("node:path");

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) {
    return;
  }

  const content = fs.readFileSync(envPath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(path.join(process.cwd(), ".env"));

function getConfig() {
  return {
    port: Number.parseInt(process.env.PORT ?? "3000", 10),
    musicProvider: "netease-api",
    neteaseApi: {
      baseUrl: process.env.NETEASE_API_BASE_URL ?? "http://localhost:4000",
      timeoutMs: Number.parseInt(process.env.NETEASE_API_TIMEOUT_MS ?? "15000", 10),
      defaultPlaylistName: process.env.NETEASE_API_DEFAULT_PLAYLIST_NAME ?? "账户喜欢的音乐",
      defaultQueueLimit: Number.parseInt(process.env.NETEASE_API_DEFAULT_QUEUE_LIMIT ?? "8", 10),
      defaultSongQuery: process.env.NETEASE_API_DEFAULT_SONG_QUERY ?? "Bread If",
      bitrate: Number.parseInt(process.env.NETEASE_API_BITRATE ?? "320000", 10),
      level: process.env.NETEASE_API_LEVEL ?? "",
      urlEndpoint: process.env.NETEASE_API_URL_ENDPOINT ?? "/song/url",
      proxy: process.env.NETEASE_API_PROXY ?? "",
    },
    brain: {
      baseUrl: (process.env.AICODEE_BASE_URL ?? "https://v2.aicodee.com").replace(/\/+$/, ""),
      apiKey: process.env.AICODEE_API_KEY ?? "",
      model: process.env.AICODEE_MODEL ?? "MiniMax-M2.5-highspeed",
      timeoutMs: Number.parseInt(process.env.AICODEE_TIMEOUT_MS ?? "45000", 10),
    },
    weather: {
      lat: process.env.WEATHER_LAT ? Number(process.env.WEATHER_LAT) : null,
      lon: process.env.WEATHER_LON ? Number(process.env.WEATHER_LON) : null,
      locationName: process.env.WEATHER_LOCATION ?? "",
      cacheTtlMs: Number.parseInt(process.env.WEATHER_CACHE_TTL_MS ?? "1800000", 10),
    },
    scheduler: {
      enabled: process.env.SCHEDULER_ENABLED !== "false",
      times: {
        dailyPlan: process.env.SCHEDULER_DAILY_PLAN || "07:00",
        morningGreet: process.env.SCHEDULER_MORNING_GREET || "09:00",
        nightBlock: process.env.SCHEDULER_NIGHT_BLOCK || "21:30",
        moodCheckIntervalMinutes: Number.parseInt(process.env.SCHEDULER_MOOD_CHECK_MINUTES ?? "60", 10),
      },
    },
    tts: {
      apiKey: process.env.FISH_AUDIO_API_KEY ?? "",
      baseUrl: (process.env.FISH_AUDIO_BASE_URL ?? "https://api.fish.audio").replace(/\/+$/, ""),
      model: process.env.FISH_AUDIO_MODEL ?? "fish-speech-1.5",
      voice: process.env.FISH_AUDIO_VOICE ?? "default",
    },
    upnp: {
      enabled: process.env.UPNP_ENABLED === "true",
      autoConnectDeviceName: process.env.UPNP_AUTO_CONNECT ?? "",
    },
  };
}

module.exports = {
  getConfig,
};
