const {
  parseTimedLyrics,
} = require("../../../script.js");

const {
  parseCliConfigOutput,
  runCliJson,
  runCliText,
  startCliLogin,
} = require("../../ncm-cli.js");

function isCliMissingError(error) {
  return /not recognized|ENOENT|not found/i.test(String(error?.message ?? error));
}

function isCliQueueEmptyError(error) {
  return /播放列表为空|queue.*empty|empty queue/i.test(String(error?.message ?? error));
}

// NetEase API responses carry an in-band `code` field. ncm-cli prints them as
// successful JSON, so the upstream `runCliJson` resolves even when the request
// failed. Throw a typed error so callers can distinguish rate-limits, auth
// failures, etc. from "actually empty".
function ensureNeteaseOk(payload, label) {
  if (!payload || typeof payload !== "object" || !("code" in payload)) {
    return payload;
  }
  const code = Number(payload.code);
  if (code === 200 || code === 0 || Number.isNaN(code)) {
    return payload;
  }
  const message = payload.msg || payload.message || `${label} failed (code ${code})`;
  const error = new Error(message);
  error.code = code;
  error.label = label;
  error.neteaseCode = code;
  return Promise.reject(error);
}

function normalizeCliTranscript(lines) {
  if (!Array.isArray(lines)) {
    return [];
  }

  return lines
    .map((line) => ({
      time: Number(line?.time ?? line?.startTime ?? line?.timestamp),
      text: typeof line?.text === "string" ? line.text.trim() : "",
    }))
    .filter((line) => Number.isFinite(line.time) && line.text);
}

function pickCliTrack(state = {}, fallbackTrack = {}) {
  const rawTrack = state.track ?? state.currentTrack ?? {};
  const title = rawTrack.title ?? state.title ?? fallbackTrack.title ?? "Nothing playing";
  const artist =
    rawTrack.artist ??
    rawTrack.subtitle ??
    state.artist ??
    state.subtitle ??
    state.author ??
    fallbackTrack.artist ??
    "";
  const album = rawTrack.album ?? state.album ?? fallbackTrack.album ?? "";
  const id = String(
    rawTrack.id ??
      rawTrack.songId ??
      state.id ??
      state.songId ??
      fallbackTrack.id ??
      ""
  );
  const duration = Number(rawTrack.duration ?? state.duration ?? fallbackTrack.duration ?? 0);
  const position = Number(state.position ?? rawTrack.position ?? fallbackTrack.currentTime ?? 0);
  const transcript = normalizeCliTranscript(rawTrack.transcript ?? state.transcript ?? []);

  return {
    id,
    title,
    artist,
    album,
    duration: Number.isFinite(duration) ? duration : 0,
    position: Number.isFinite(position) ? position : 0,
    status: state.status ?? "stopped",
    coverUrl: rawTrack.coverUrl ?? rawTrack.coverImgUrl ?? "",
    source: "ncm-cli",
    transcript,
  };
}

function normalizeCliNow(payload, fallbackTrack = null) {
  const state = payload?.state ?? payload ?? {};
  const track = pickCliTrack(state, fallbackTrack ?? {});
  const queueLength = Number(state.queueLength ?? 0);
  const volume = Number(state.volume ?? 0);
  const ready = Boolean(track.id || track.title !== "Nothing playing");

  return {
    track,
    transport: {
      canPlay: true,
      canPause: true,
      canSeek: true,
      volume: Number.isFinite(volume) ? volume : 0,
    },
    meta: {
      ready,
      message: queueLength === 0 ? "Queue empty" : "",
    },
    queueLength,
  };
}

function extractEncryptedId(value) {
  const match = String(value ?? "").match(/\b([A-F0-9]{32})\b/i);
  return match ? match[1].toUpperCase() : "";
}

function normalizeQueueItem(item) {
  const artists = Array.isArray(item?.artists) ? item.artists.map((artist) => artist?.name).filter(Boolean) : [];
  const encryptedId = String(item?.id ?? item?.encryptedId ?? extractEncryptedId(item?.label) ?? "");
  const title =
    item?.name ??
    item?.title ??
    (typeof item?.label === "string" ? item.label.split("|")[0].trim() : "") ??
    "Untitled";
  const normalized = {
    encryptedId,
    originalId: String(item?.originalId ?? item?.songId ?? item?.original_id ?? ""),
    title,
    artist: artists.join(", ") || item?.artist || "",
    album: item?.album?.name ?? item?.album ?? "",
    duration: Number(item?.duration ?? 0) / 1000,
    coverImgUrl: item?.coverImgUrl ?? "",
  };

  if (item?.playFlag != null || item?.visible != null || item?.vipPlayFlag != null) {
    normalized.canPlay = Boolean((item?.playFlag ?? true) && (item?.visible ?? true));
  }

  if (item?.current != null || item?.isCurrent != null || item?.prefix != null) {
    normalized.current = Boolean(item?.current ?? item?.isCurrent ?? item?.prefix === "▶");
  }

  if (item?.index != null) {
    normalized.index = Number(item.index);
  }

  return normalized;
}

function normalizePlaylistItem(item) {
  return {
    encryptedId: String(item?.id ?? ""),
    originalId: String(item?.originalId ?? ""),
    title: item?.name ?? "Untitled Playlist",
    trackCount: Number(item?.trackCount ?? 0),
    specialType: Number(item?.specialType ?? 0),
  };
}

function normalizeQueueItems(payload) {
  const records =
    payload?.data?.records ??
    payload?.data ??
    payload?.records ??
    payload?.items ??
    payload?.queue ??
    [];

  if (!Array.isArray(records)) {
    return [];
  }

  return records.map(normalizeQueueItem).filter((item) => item.encryptedId || item.title !== "Untitled");
}

function mergeQueueItems(queueItems, metadataItems = []) {
  if (!Array.isArray(queueItems) || queueItems.length === 0) {
    return [];
  }

  const metadataByEncryptedId = new Map(
    (Array.isArray(metadataItems) ? metadataItems : [])
      .filter((item) => item?.encryptedId)
      .map((item) => [String(item.encryptedId).toUpperCase(), item])
  );

  return queueItems.map((item) => {
    const metadata = metadataByEncryptedId.get(String(item.encryptedId).toUpperCase());
    if (!metadata) {
      return item;
    }

    return {
      ...item,
      originalId: item.originalId || metadata.originalId || "",
      title:
        item.title && item.title !== item.encryptedId
          ? item.title
          : metadata.title || item.title,
      artist: item.artist || metadata.artist || "",
      album: item.album || metadata.album || "",
      duration: item.duration || metadata.duration || 0,
      coverImgUrl: item.coverImgUrl || metadata.coverImgUrl || "",
      canPlay: typeof item.canPlay === "boolean" ? item.canPlay : metadata.canPlay,
    };
  });
}

function getCurrentQueueItem(queueItems = []) {
  if (!Array.isArray(queueItems) || queueItems.length === 0) {
    return null;
  }

  return queueItems.find((item) => item.current) ?? queueItems[0] ?? null;
}

async function getCliStatus(command, runtime) {
  let configInfo;
  try {
    configInfo = parseCliConfigOutput(await runCliText(command, ["config", "list"], { timeoutMs: 10000 }));
  } catch (error) {
    if (isCliMissingError(error)) {
      return {
        available: false,
        configured: false,
        loggedIn: false,
        playerConfigured: false,
        state: null,
        qrCodeUrl: "",
        message: "ncm-cli is not installed",
        readyForRemotePlayback: false,
      };
    }
    throw error;
  }

  let loginInfo = { success: false, message: "Not logged in. Run ncm-cli login first." };
  try {
    loginInfo = await runCliJson(command, ["login", "--check"], { timeoutMs: 10000 });
  } catch (error) {
    loginInfo = {
      success: false,
      message: error.message,
    };
  }

  let playbackState = null;
  try {
    const statePayload = await runCliJson(command, ["state"], { timeoutMs: 10000 });
    playbackState = statePayload.state ?? null;
  } catch {
    playbackState = null;
  }

  return {
    available: true,
    configured: Boolean(configInfo.hasAppId && configInfo.hasPrivateKey),
    loggedIn: Boolean(loginInfo.success),
    playerConfigured: Boolean(configInfo.playerConfigured),
    state: playbackState,
    qrCodeUrl: runtime.qrCodeUrl,
    message: loginInfo.message || "",
    config: configInfo,
    readyForRemotePlayback: Boolean(configInfo.playerConfigured && loginInfo.success),
  };
}

async function getCliNow(command, fallbackTrack = null) {
  const payload = await runCliJson(command, ["state"], { timeoutMs: 10000 });
  return normalizeCliNow(payload, fallbackTrack);
}

async function getCliQueue(command) {
  const payload = await runCliJson(command, ["queue"], { timeoutMs: 10000 });
  if (payload?.success === false && isCliQueueEmptyError(payload.message)) {
    return [];
  }
  return normalizeQueueItems(payload);
}

async function getCliCreatedPlaylists(command) {
  const payload = await runCliJson(command, ["playlist", "created"], { timeoutMs: 15000 });
  await ensureNeteaseOk(payload, "playlist.created");
  const records = payload?.data?.records ?? [];
  return Array.isArray(records) ? records.map(normalizePlaylistItem) : [];
}

async function getCliPlaylistTracks(command, playlistId, limit = 30) {
  if (!playlistId) {
    return [];
  }

  const payload = await runCliJson(
    command,
    ["playlist", "tracks", "--playlistId", String(playlistId), "--limit", String(limit)],
    { timeoutMs: 20000 }
  );
  await ensureNeteaseOk(payload, "playlist.tracks");
  return normalizeQueueItems(payload);
}

function pickDefaultPlaylist(playlists, preferredName = "") {
  if (!Array.isArray(playlists) || playlists.length === 0) {
    return null;
  }

  const normalizedPreferred = String(preferredName ?? "").trim().toLowerCase();
  if (normalizedPreferred) {
    const exact = playlists.find((playlist) => String(playlist.title).trim().toLowerCase() === normalizedPreferred);
    if (exact) {
      return exact;
    }
  }

  const liked = playlists.find((playlist) => playlist.specialType === 5 || String(playlist.title).includes("喜欢的音乐"));
  if (liked) {
    return liked;
  }

  return playlists[0];
}

async function getCliDailyRecommendations(command, limit = 5) {
  const payload = await runCliJson(command, ["recommend", "daily", "--limit", String(limit)], { timeoutMs: 15000 });
  return normalizeQueueItems(payload);
}

function pickCliLyricPayload(payload) {
  return payload?.data ?? payload?.lyric ?? payload ?? {};
}

function pickCliLyricText(payload) {
  const lyricPayload = pickCliLyricPayload(payload);
  if (typeof lyricPayload === "string") {
    return lyricPayload;
  }

  return lyricPayload.lyric ?? lyricPayload.txtLyric ?? "";
}

async function getCliSongLyric(command, encryptedId) {
  if (!encryptedId) {
    return { transcript: [], originalId: "" };
  }

  const payload = await runCliJson(command, ["song", "lyric", "--songId", String(encryptedId)], {
    timeoutMs: 15000,
  });
  const lyricPayload = pickCliLyricPayload(payload);
  const lyricText = pickCliLyricText(payload);

  return {
    transcript: parseTimedLyrics(lyricText),
    originalId: String(lyricPayload.originalId ?? lyricPayload.songId ?? ""),
  };
}

async function runTransport(command, action, value = "") {
  const args =
    value === ""
      ? [action]
      : [action, String(value)];
  return runCliJson(command, args, { timeoutMs: 10000 });
}

async function playCliSong(command, item) {
  return runCliJson(
    command,
    ["play", "--song", "--encrypted-id", item.encryptedId, "--original-id", item.originalId],
    { timeoutMs: 15000 }
  );
}

async function playCliPlaylist(command, playlist) {
  return runCliJson(
    command,
    ["play", "--playlist", "--encrypted-id", playlist.encryptedId, "--original-id", playlist.originalId],
    { timeoutMs: 20000 }
  );
}

async function addCliQueueItem(command, item, next = false) {
  const args = ["queue", "add", "--encrypted-id", item.encryptedId, "--original-id", item.originalId];
  if (next) {
    args.push("--next");
  }
  return runCliJson(command, args, { timeoutMs: 15000 });
}

async function ensureQueueSeeded(command, seedItems = []) {
  const statePayload = await runCliJson(command, ["state"], { timeoutMs: 10000 });
  if (Number(statePayload?.state?.queueLength ?? 0) > 0) {
    return { seeded: false, items: await getCliQueue(command) };
  }

  const items = Array.isArray(seedItems) && seedItems.length ? seedItems : await getCliDailyRecommendations(command, 5);
  if (!items.length) {
    return { seeded: false, items: [] };
  }

  await playCliSong(command, items[0]);
  for (const item of items.slice(1)) {
    await addCliQueueItem(command, item);
  }

  return {
    seeded: true,
    items: await getCliQueue(command).catch(() => items),
  };
}

function startCliLoginFlow(command, runtime) {
  if (runtime.loginProcess && !runtime.loginProcess.killed) {
    return Promise.resolve({
      success: true,
      qrCodeUrl: runtime.qrCodeUrl,
      clickableUrl: runtime.qrCodeUrl,
      message: runtime.loginMessage || "CLI login is already running.",
    });
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    runtime.loginProcess = startCliLogin(
      command,
      (error, payload) => {
        if (settled) {
          return;
        }

        if (error) {
          settled = true;
          reject(error);
          return;
        }

        runtime.qrCodeUrl = payload.qrCodeUrl ?? payload.clickableUrl ?? "";
        runtime.loginMessage = payload.message ?? "";
        settled = true;
        resolve(payload);
      },
      () => {
        runtime.loginProcess = null;
      }
    );

    setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      reject(new Error("Timed out waiting for ncm-cli login QR code"));
    }, 15000);
  });
}

module.exports = {
  addCliQueueItem,
  ensureQueueSeeded,
  extractEncryptedId,
  getCurrentQueueItem,
  getCliNow,
  getCliCreatedPlaylists,
  getCliPlaylistTracks,
  getCliQueue,
  getCliSongLyric,
  getCliStatus,
  getCliDailyRecommendations,
  isCliMissingError,
  isCliQueueEmptyError,
  mergeQueueItems,
  normalizeCliNow,
  normalizePlaylistItem,
  normalizeQueueItems,
  normalizeCliTranscript,
  pickDefaultPlaylist,
  playCliPlaylist,
  playCliSong,
  runTransport,
  startCliLoginFlow,
};
