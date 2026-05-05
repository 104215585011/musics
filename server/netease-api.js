const crypto = require("node:crypto");

function compareAscii(left, right) {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

function createQueryString(params) {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    searchParams.set(key, String(value));
  }
  return searchParams.toString();
}

function createSignaturePayload(params) {
  return Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .sort(([left], [right]) => compareAscii(left, right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

function signPayload(payload, config) {
  const { signType, privateKey, appSecret } = config;

  if (signType !== "RSA_SHA256") {
    throw new Error(`Unsupported signType: ${signType}`);
  }

  if (privateKey) {
    return crypto.createSign("RSA-SHA256").update(payload, "utf8").sign(privateKey, "base64");
  }

  throw new Error("Missing NETEASE_PRIVATE_KEY_PATH content for RSA_SHA256 signing");
}

function buildOpenApiUrl(baseUrl, endpoint, config, bizContent) {
  const timestamp = Date.now().toString();
  const unsignedParams = {
    bizContent: JSON.stringify(bizContent),
    appId: config.appId,
    appSecret: config.appSecret,
    accessToken: config.accessToken,
    signType: config.signType,
    timestamp,
    device: config.deviceJson,
  };

  const sign = signPayload(createSignaturePayload(unsignedParams), config);
  return `${baseUrl}${endpoint}?${createQueryString({ ...unsignedParams, sign })}`;
}

async function readJsonResponse(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON response: ${text.slice(0, 300)}`);
  }
}

async function fetchOpenApiJson(endpoint, bizContent, config, options = {}) {
  const accessToken = options.accessToken ?? config.accessToken;

  const url = buildOpenApiUrl(
    config.baseUrl,
    endpoint,
    {
      ...config,
      accessToken: accessToken ?? "",
    },
    bizContent
  );
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  const payload = await readJsonResponse(response);

  if (!response.ok || payload.code !== 200) {
    throw new Error(payload.message || `Netease API request failed for ${endpoint}`);
  }

  return payload.data;
}

async function fetchSongSearch(keyword, config) {
  return fetchOpenApiJson(
    "/openapi/music/basic/search/song/get/v3",
    {
      keyword,
      limit: 10,
      offset: 0,
      qualityFlag: true,
    },
    config
  );
}

async function fetchAnonymousToken(config) {
  return fetchOpenApiJson(
    "/openapi/music/basic/oauth2/login/anonymous",
    {
      clientId: config.appId,
    },
    config,
    {
      accessToken: "",
    }
  );
}

async function fetchSongDetail(songId, config) {
  return fetchOpenApiJson(
    "/openapi/music/basic/song/detail/get/v2",
    {
      songId,
      withUrl: true,
      qualityFlag: true,
      extFlags: "{\"hqScene\":\"normal\"}",
    },
    config
  );
}

async function fetchSongLyric(songId, config) {
  return fetchOpenApiJson(
    "/openapi/music/basic/song/lyric/get/v2",
    {
      songId,
    },
    config
  );
}

async function fetchQrCodeKey(config) {
  return fetchOpenApiJson(
    "/openapi/music/basic/user/oauth2/qrcodekey/get/v2",
    {
      type: 2,
      expiredKey: "300",
    },
    config,
    {
      accessToken: config.anonymousAccessToken,
    }
  );
}

async function fetchQrCodeStatus(key, config) {
  return fetchOpenApiJson(
    "/openapi/music/basic/oauth2/device/login/qrcode/get",
    {
      key,
      clientId: config.appId,
    },
    config,
    {
      accessToken: config.anonymousAccessToken,
    }
  );
}

async function refreshUserAccessToken(refreshToken, config) {
  return fetchOpenApiJson(
    "/openapi/music/basic/user/oauth2/token/refresh/v2",
    {
      clientId: config.appId,
      clientSecret: config.appSecret,
      refreshToken,
    },
    config,
    {
      accessToken: config.anonymousAccessToken,
    }
  );
}

module.exports = {
  buildOpenApiUrl,
  fetchSongSearch,
  fetchSongDetail,
  fetchSongLyric,
  fetchAnonymousToken,
  fetchQrCodeKey,
  fetchQrCodeStatus,
  refreshUserAccessToken,
};
