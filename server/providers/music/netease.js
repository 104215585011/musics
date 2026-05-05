const {
  fetchSongSearch,
  fetchSongDetail,
  fetchSongLyric,
  fetchAnonymousToken,
  fetchQrCodeKey,
  fetchQrCodeStatus,
  refreshUserAccessToken,
} = require("../../netease-api.js");
const { buildTrackFromNeteaseData } = require("../../../script.js");

function extractDetailItem(detailPayload) {
  if (!detailPayload) {
    return null;
  }

  if (Array.isArray(detailPayload)) {
    return detailPayload[0] ?? null;
  }

  if (Array.isArray(detailPayload.songs)) {
    return detailPayload.songs[0] ?? null;
  }

  if (Array.isArray(detailPayload.list)) {
    return detailPayload.list[0] ?? null;
  }

  return detailPayload;
}

function extractSearchItems(searchPayload) {
  if (!searchPayload) {
    return [];
  }

  if (Array.isArray(searchPayload)) {
    return searchPayload;
  }

  if (Array.isArray(searchPayload.list)) {
    return searchPayload.list;
  }

  if (Array.isArray(searchPayload.songs)) {
    return searchPayload.songs;
  }

  if (Array.isArray(searchPayload.result)) {
    return searchPayload.result;
  }

  return [];
}

function pickLyricText(lyricPayload) {
  if (!lyricPayload) {
    return "";
  }

  return lyricPayload.lyric || lyricPayload.txtLyric || "";
}

function normalizeSearchText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function artistNamesFromRecord(record) {
  return (record?.artists ?? record?.fullArtists ?? [])
    .map((artist) => artist?.name)
    .filter(Boolean);
}

function chooseBestSongMatch(records, target) {
  if (!Array.isArray(records) || !records.length) {
    return null;
  }

  const targetTitle = normalizeSearchText(target.title);
  const targetArtist = normalizeSearchText(target.artist);
  const targetAlbum = normalizeSearchText(target.album);
  const targetDuration = Number(target.duration ?? 0);

  let best = null;

  for (const record of records) {
    const recordTitle = normalizeSearchText(record?.name);
    const recordArtists = artistNamesFromRecord(record).map(normalizeSearchText);
    const recordAlbum = normalizeSearchText(record?.album?.name);
    const durationSeconds = Math.round(Number(record?.duration ?? 0) / 1000);

    let score = 0;
    if (recordTitle && targetTitle && recordTitle === targetTitle) {
      score += 5;
    } else if (recordTitle && targetTitle && (recordTitle.includes(targetTitle) || targetTitle.includes(recordTitle))) {
      score += 3;
    }

    if (targetArtist && recordArtists.some((artist) => artist === targetArtist)) {
      score += 4;
    } else if (targetArtist && recordArtists.some((artist) => artist.includes(targetArtist) || targetArtist.includes(artist))) {
      score += 2;
    }

    if (targetAlbum && recordAlbum && recordAlbum === targetAlbum) {
      score += 2;
    }

    if (targetDuration && durationSeconds) {
      const delta = Math.abs(durationSeconds - Math.round(targetDuration));
      if (delta <= 2) {
        score += 3;
      } else if (delta <= 5) {
        score += 1;
      }
    }

    if (!best || score > best.score) {
      best = {
        score,
        record,
      };
    }
  }

  if (!best || best.score < 5) {
    return null;
  }

  return {
    encryptedId: String(best.record?.id ?? ""),
    originalId: String(best.record?.originalId ?? best.record?.songId ?? best.record?.id ?? ""),
    title: best.record?.name ?? "",
    artist: artistNamesFromRecord(best.record).join(", "),
    album: best.record?.album?.name ?? "",
    duration: Number(best.record?.duration ?? 0) / 1000,
  };
}

function getActiveAccessToken(config, authState) {
  if (authState.accessToken) {
    return authState.accessToken;
  }

  if (authState.anonymousAccessToken) {
    return authState.anonymousAccessToken;
  }

  if (config.accessToken) {
    return config.accessToken;
  }

  return "";
}

function buildNeteaseConfigWithActiveToken(config, authState) {
  return {
    ...config,
    accessToken: getActiveAccessToken(config, authState),
  };
}

async function ensureAnonymousAccessToken(config, authState) {
  if (authState.anonymousAccessToken) {
    return authState.anonymousAccessToken;
  }

  if (config.anonymousAccessToken) {
    authState.anonymousAccessToken = config.anonymousAccessToken;
    return authState.anonymousAccessToken;
  }

  const payload = await fetchAnonymousToken(config);
  authState.anonymousAccessToken = payload.accessToken ?? "";
  authState.anonymousRefreshToken = payload.refreshToken ?? "";
  return authState.anonymousAccessToken;
}

function updateAuthStateFromTokenPayload(authState, tokenPayload) {
  if (!tokenPayload) {
    return;
  }

  authState.accessToken = tokenPayload.accessToken ?? authState.accessToken;
  authState.refreshToken = tokenPayload.refreshToken ?? authState.refreshToken;
  const expiresTime = tokenPayload.expiresTime ?? tokenPayload.expireTime ?? 0;
  authState.expiresAt = expiresTime ? Date.now() + Number(expiresTime) * 1000 : authState.expiresAt;
}

async function buildTrackBundle(songId, config, authState) {
  const [detailPayload, lyricPayload] = await Promise.all([
    fetchSongDetail(songId, buildNeteaseConfigWithActiveToken(config, authState)),
    fetchSongLyric(songId, buildNeteaseConfigWithActiveToken(config, authState)),
  ]);

  const detailItem = extractDetailItem(detailPayload);
  if (!detailItem) {
    throw new Error(`No song detail returned for ${songId}`);
  }

  return buildTrackFromNeteaseData({
    detailItem,
    lyricText: pickLyricText(lyricPayload),
  });
}

async function resolveSongReference(trackLike, config, authState) {
  const title = String(trackLike?.title ?? "").trim();
  const artist = String(trackLike?.artist ?? "").trim();

  if (!title) {
    return null;
  }

  const keyword = [title, artist].filter(Boolean).join(" ");
  const searchPayload = await fetchSongSearch(
    keyword,
    buildNeteaseConfigWithActiveToken(config, authState)
  );
  const records = extractSearchItems(searchPayload);
  return chooseBestSongMatch(records, trackLike);
}

async function buildSeedReferencesFromDefaultSongIds(config, authState) {
  const ids = Array.isArray(config.defaultSongIds) ? config.defaultSongIds : [];
  const references = [];

  for (const songId of ids) {
    const track = await buildTrackBundle(songId, config, authState);
    const reference = await resolveSongReference(track, config, authState);
    if (reference?.encryptedId && reference?.originalId) {
      references.push(reference);
    }
  }

  return references;
}

module.exports = {
  buildTrackBundle,
  buildSeedReferencesFromDefaultSongIds,
  buildNeteaseConfigWithActiveToken,
  chooseBestSongMatch,
  ensureAnonymousAccessToken,
  extractSearchItems,
  fetchQrCodeKey,
  fetchQrCodeStatus,
  fetchSongSearch,
  getActiveAccessToken,
  refreshUserAccessToken,
  resolveSongReference,
  normalizeSearchText,
  updateAuthStateFromTokenPayload,
};
