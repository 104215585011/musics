const fs = require("node:fs");
const path = require("node:path");

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) {
    return;
  }

  const content = fs.readFileSync(envPath, "utf8");
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (
      (key === "NETEASE_PRIVATE_KEY" || key === "NETEASE_PUBLIC_KEY") &&
      value.startsWith("-----BEGIN") &&
      !value.includes("-----END")
    ) {
      const pemLines = [value];
      while (index + 1 < lines.length) {
        index += 1;
        pemLines.push(lines[index]);
        if (lines[index].includes("-----END")) {
          break;
        }
      }
      value = pemLines.join("\n");
    }

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseDefaultSongIds(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function optionalFile(pathValue) {
  if (!pathValue) {
    return "";
  }

  if (pathValue.includes("-----BEGIN")) {
    return decodeInlinePem(pathValue);
  }

  if (!fs.existsSync(pathValue)) {
    return "";
  }

  return fs.readFileSync(pathValue, "utf8");
}

function decodeInlinePem(value) {
  if (!value) {
    return "";
  }

  return value.replace(/\\n/g, "\n");
}

function wrapBase64Pem(value, label) {
  if (!value) {
    return "";
  }

  const normalized = value.replace(/\s+/g, "");
  if (!normalized) {
    return "";
  }

  const lines = normalized.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----`;
}

function normalizeDeviceJsonString(value) {
  const fallbackDevice = {
    deviceType: "andrwear",
    os: "otos",
    appVer: "0.1",
    channel: "hm",
    model: "kys",
    deviceId: "357",
    brand: "hm",
    osVer: "8.1.0",
    clientIp: "192.168.0.1",
  };

  if (!value) {
    return JSON.stringify(fallbackDevice);
  }

  let parsedDevice;
  try {
    parsedDevice = JSON.parse(value);
  } catch {
    return JSON.stringify(fallbackDevice);
  }

  const mergedDevice = {
    ...fallbackDevice,
    ...parsedDevice,
  };

  if (!mergedDevice.deviceType || mergedDevice.deviceType === "openapi") {
    mergedDevice.deviceType = fallbackDevice.deviceType;
  }
  if (!mergedDevice.os || mergedDevice.os === "openapi") {
    mergedDevice.os = fallbackDevice.os;
  }
  if (!mergedDevice.channel || mergedDevice.channel === "codex") {
    mergedDevice.channel = fallbackDevice.channel;
  }
  if (!mergedDevice.brand || mergedDevice.brand === "codex") {
    mergedDevice.brand = fallbackDevice.brand;
  }
  if (!mergedDevice.model || mergedDevice.model === "desktop") {
    mergedDevice.model = fallbackDevice.model;
  }
  if (!mergedDevice.deviceId || mergedDevice.deviceId === "local-player") {
    mergedDevice.deviceId = fallbackDevice.deviceId;
  }
  if (!mergedDevice.osVer || mergedDevice.osVer === "1.0.0") {
    mergedDevice.osVer = fallbackDevice.osVer;
  }
  if (!mergedDevice.clientIp || mergedDevice.clientIp === "127.0.0.1") {
    mergedDevice.clientIp = fallbackDevice.clientIp;
  }

  return JSON.stringify(mergedDevice);
}

function resolveKeyMaterial(inlineValue, pathValue, label) {
  const decodedInline = decodeInlinePem(inlineValue);
  if (decodedInline) {
    return decodedInline.includes("-----BEGIN")
      ? decodedInline
      : wrapBase64Pem(decodedInline, label);
  }

  if (pathValue && !fs.existsSync(pathValue)) {
    const decodedPathValue = decodeInlinePem(pathValue);
    return decodedPathValue.includes("-----BEGIN")
      ? decodedPathValue
      : wrapBase64Pem(decodedPathValue, label);
  }

  const fallbackValue = optionalFile(pathValue);
  if (!fallbackValue) {
    return "";
  }

  return fallbackValue.includes("-----BEGIN")
    ? fallbackValue
    : wrapBase64Pem(fallbackValue, label);
}

loadEnvFile(path.join(process.cwd(), ".env"));

function getConfig() {
  return {
    port: Number.parseInt(process.env.PORT ?? "3000", 10),
    musicProvider: process.env.MUSIC_PROVIDER ?? "netease-api",
    cli: {
      command: process.env.NCM_CLI_COMMAND ?? "ncm-cli",
      defaultPlaylistName: process.env.NCM_DEFAULT_PLAYLIST_NAME ?? "账户已注笑喜欢的音乐",
    },
    neteaseApi: {
      baseUrl: process.env.NETEASE_API_BASE_URL ?? "http://localhost:4000",
      timeoutMs: Number.parseInt(process.env.NETEASE_API_TIMEOUT_MS ?? "15000", 10),
      defaultPlaylistName: process.env.NETEASE_API_DEFAULT_PLAYLIST_NAME ?? process.env.NCM_DEFAULT_PLAYLIST_NAME ?? "账户已注笑喜欢的音乐",
      defaultQueueLimit: Number.parseInt(process.env.NETEASE_API_DEFAULT_QUEUE_LIMIT ?? "8", 10),
      defaultSongQuery: process.env.NETEASE_API_DEFAULT_SONG_QUERY ?? "Bread If",
      bitrate: Number.parseInt(process.env.NETEASE_API_BITRATE ?? "320000", 10),
      level: process.env.NETEASE_API_LEVEL ?? "",
      urlEndpoint: process.env.NETEASE_API_URL_ENDPOINT ?? "/song/url",
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
    netease: {
      baseUrl: process.env.NETEASE_OPENAPI_BASE_URL ?? "https://openapi.music.163.com",
      appId: requiredEnv("NETEASE_APP_ID"),
      accessToken: process.env.NETEASE_ACCESS_TOKEN ?? "",
      anonymousAccessToken: process.env.NETEASE_ANONYMOUS_ACCESS_TOKEN ?? process.env.NETEASE_ACCESS_TOKEN ?? "",
      appSecret: requiredEnv("NETEASE_APP_SECRET"),
      signType: process.env.NETEASE_SIGN_TYPE ?? "RSA_SHA256",
      deviceJson: normalizeDeviceJsonString(requiredEnv("NETEASE_DEVICE_JSON")),
      defaultSongIds: parseDefaultSongIds(process.env.NETEASE_DEFAULT_SONG_IDS ?? ""),
      privateKey: resolveKeyMaterial(
        process.env.NETEASE_PRIVATE_KEY,
        process.env.NETEASE_PRIVATE_KEY_PATH,
        "PRIVATE KEY"
      ),
      publicKey: resolveKeyMaterial(
        process.env.NETEASE_PUBLIC_KEY,
        process.env.NETEASE_PUBLIC_KEY_PATH,
        "PUBLIC KEY"
      ),
    },
  };
}

module.exports = {
  getConfig,
  parseDefaultSongIds,
  decodeInlinePem,
  optionalFile,
  resolveKeyMaterial,
  wrapBase64Pem,
  normalizeDeviceJsonString,
};
