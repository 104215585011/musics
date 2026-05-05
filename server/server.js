const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");
const { spawn } = require("node:child_process");

const { getConfig } = require("./config.js");
const { createHubState } = require("./state/hub.js");
const { createHubStore } = require("./state/hub-store.js");
const { createPersistentStore } = require("./state/store.js");
const { createStreamService } = require("./services/stream.js");
const { createWebSocketServer } = require("./services/websocket.js");
const { processChatMessage, matchIntent } = require("./services/chat-router.js");
const { startScheduler } = require("./services/scheduler.js");
const { createUPnPService } = require("./services/upnp.js");
const { createClaudioRouter } = require("./routes/claudio.js");
const { askAicodeeBrain } = require("./providers/brain/aicodee.js");
const {
  classifyPlaybackFailure,
  getFailureReasonLabel,
  isMatchingPlaybackTrack,
} = require("./services/playback.js");
const {
  ensureQueueSeeded,
  getCurrentQueueItem,
  getCliCreatedPlaylists,
  getCliNow,
  getCliPlaylistTracks,
  getCliQueue,
  getCliSongLyric,
  getCliStatus,
  isCliQueueEmptyError,
  getCliDailyRecommendations,
  mergeQueueItems,
  pickDefaultPlaylist,
  playCliPlaylist,
  playCliSong,
  runTransport,
  startCliLoginFlow,
} = require("./providers/music/cli.js");
const {
  buildTrackBundle,
  buildSeedReferencesFromDefaultSongIds,
  ensureAnonymousAccessToken,
  resolveSongReference,
} = require("./providers/music/netease.js");
const { createNeteaseApiProvider } = require("./providers/music/ncma.js");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

const authState = {
  accessToken: "",
  refreshToken: "",
  expiresAt: 0,
  anonymousAccessToken: "",
  anonymousRefreshToken: "",
};

const cliRuntime = {
  loginProcess: null,
  qrCodeUrl: "",
  loginMessage: "",
};

const fallbackRuntime = {
  primaryTrack: null,
  defaultPlaylist: null,
  seedItems: null,
  lyrics: new Map(),
};

function playbackFailure(error) {
  const reason = classifyPlaybackFailure(error);
  return {
    success: false,
    reason,
    message: String(error?.message ?? getFailureReasonLabel(reason) ?? error ?? "Playback request failed").slice(0, 240),
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function sendFile(response, filePath) {
  if (!fs.existsSync(filePath)) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  response.writeHead(200, {
    "Content-Type": MIME_TYPES[ext] ?? "application/octet-stream",
  });
  fs.createReadStream(filePath).pipe(response);
}

function getStaticFilePath(urlPath) {
  const safePath = urlPath === "/" ? "/index.html" : urlPath;
  const resolvedPath = path.normalize(path.join(process.cwd(), safePath));
  if (!resolvedPath.startsWith(process.cwd())) {
    return null;
  }
  return resolvedPath;
}

function createResponseHelpers(response) {
  return {
    raw: response,
    json(status, body) {
      sendJson(response, status, body);
    },
    sse() {
      response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
      });
      response.write("\n");
    },
  };
}

function buildFallbackNow(track, message) {
  return {
    track: track
      ? {
          id: track.id ?? "",
          title: track.title ?? "Nothing playing",
          artist: track.artist ?? "",
          album: track.album ?? "",
          duration: Number(track.duration ?? 0),
          position: 0,
          status: "stopped",
          coverUrl: track.coverImgUrl ?? "",
          source: track.source ?? "netease",
          transcript: Array.isArray(track.transcript) ? track.transcript : [],
        }
      : null,
    transport: {
      canPlay: false,
      canPause: false,
      canSeek: false,
      volume: 0,
    },
    meta: {
      ready: false,
      message,
    },
  };
}

async function loadPrimaryFallbackTrack(config) {
  if (fallbackRuntime.primaryTrack) {
    return fallbackRuntime.primaryTrack;
  }

  if (!config.netease.defaultSongIds.length) {
    return null;
  }

  await ensureAnonymousAccessToken(config.netease, authState);
  fallbackRuntime.primaryTrack = await buildTrackBundle(
    config.netease.defaultSongIds[0],
    config.netease,
    authState
  );
  return fallbackRuntime.primaryTrack;
}

async function loadSeedItems(config) {
  if (fallbackRuntime.seedItems) {
    return fallbackRuntime.seedItems;
  }

  if (config.netease.defaultSongIds.length) {
    await ensureAnonymousAccessToken(config.netease, authState);
    fallbackRuntime.seedItems = await buildSeedReferencesFromDefaultSongIds(config.netease, authState);
    if (fallbackRuntime.seedItems.length) {
      return fallbackRuntime.seedItems;
    }
  }

  fallbackRuntime.seedItems = await getCliDailyRecommendations(config.cli.command, 5).catch(() => []);
  return fallbackRuntime.seedItems;
}

async function loadDefaultPlaylist(config) {
  if (fallbackRuntime.defaultPlaylist) {
    return fallbackRuntime.defaultPlaylist;
  }

  const playlists = await getCliCreatedPlaylists(config.cli.command).catch(() => []);
  fallbackRuntime.defaultPlaylist = pickDefaultPlaylist(playlists, config.cli.defaultPlaylistName);
  return fallbackRuntime.defaultPlaylist;
}

async function loadDefaultPlaylistSeedItems(config) {
  const defaultPlaylist = await loadDefaultPlaylist(config).catch(() => null);
  if (!defaultPlaylist?.encryptedId) {
    return [];
  }

  return getCliPlaylistTracks(config.cli.command, defaultPlaylist.encryptedId, 30).catch(() => []);
}

async function buildQueueSnapshot(config) {
  const rawQueue = await getCliQueue(config.cli.command).catch(() => []);
  if (!rawQueue.length) {
    return [];
  }

  const seedItems = await loadSeedItems(config).catch(() => []);
  const playlistSeedItems = await loadDefaultPlaylistSeedItems(config).catch(() => []);
  const merged = mergeQueueItems(rawQueue, [...seedItems, ...playlistSeedItems]);

  fallbackRuntime.seedItems = mergeQueueItems(seedItems, merged);
  return merged;
}

function markBlockedItems(items = [], store) {
  const blockedIds = store?.getBlockedSongIds?.() ?? new Set();
  const blockedReasons = store?.getBlockedSongMap?.() ?? new Map();
  return items.map((item) => {
    const encryptedId = String(item.encryptedId ?? "");
    const originalId = String(item.originalId ?? "");
    const isBlocked = blockedIds.has(encryptedId) || blockedIds.has(originalId);
    if (!isBlocked) {
      return item;
    }
    return {
      ...item,
      canPlay: false,
      blockedReason:
        blockedReasons.get(encryptedId) ||
        blockedReasons.get(originalId) ||
        "previous play attempt failed",
    };
  });
}

async function getCachedCliLyric(config, trackId) {
  if (!trackId) {
    return null;
  }
  const key = String(trackId);
  if (fallbackRuntime.lyrics.has(key)) {
    return fallbackRuntime.lyrics.get(key);
  }
  const lyric = await getCliSongLyric(config.cli.command, key).catch(() => null);
  if (lyric?.transcript?.length || lyric?.originalId) {
    fallbackRuntime.lyrics.set(key, lyric);
  }
  return lyric;
}

async function confirmCliSongPlayback(config, item) {
  await wait(700);
  const now = await getCliNow(config.cli.command, null).catch(() => null);
  if (now?.track?.status === "playing" && isMatchingPlaybackTrack(now, item)) {
    return { success: true, confirmed: true, now };
  }

  return {
    success: false,
    confirmed: false,
    reason: "playback-not-confirmed",
    message: getFailureReasonLabel("playback-not-confirmed"),
    now,
  };
}

function wrapUPnP(provider, upnp) {
  if (!upnp) return provider;
  const _play = provider.play?.bind(provider);
  if (!_play) return provider;

  provider.play = async function (item) {
    if (upnp.isConnected()) {
      const result = await _play(item);
      const audioUrl = result?.url || result?.audioUrl || item?.audioUrl || item?.url;
      if (audioUrl) {
        const ok = await upnp.play(audioUrl, {
          title: item?.title || result?.title || "",
          artist: item?.artist || result?.artist || "",
        });
        return { success: ok, via: "upnp", ...result };
      }
      return { success: false, message: "No audio URL to send to UPnP" };
    }
    return _play(item);
  };

  return provider;
}

function createMusicFacade(config, store, upnp) {
  if (config.musicProvider === "netease-api") {
    const provider = createNeteaseApiProvider(config.neteaseApi, store);
    return wrapUPnP(provider, upnp);
  }

  const cliProvider = {
    async status() {
      return getCliStatus(config.cli.command, cliRuntime);
    },
    async login() {
      return startCliLoginFlow(config.cli.command, cliRuntime);
    },
    async logout() {
      return { success: true, message: "Not supported via CLI provider. Restart ncm-cli to clear session." };
    },
    async getNow() {
      const status = await this.status();
      const fallbackTrack = await loadPrimaryFallbackTrack(config).catch(() => null);

      if (!status.available) {
        return buildFallbackNow(fallbackTrack, "Music backend unavailable");
      }

      if (!status.configured) {
        return buildFallbackNow(fallbackTrack, "CLI setup needed");
      }

      if (!status.loggedIn) {
        return buildFallbackNow(fallbackTrack, "Login required");
      }

      if (!status.playerConfigured) {
        return buildFallbackNow(fallbackTrack, "Player setup needed");
      }

      if (Number(status.state?.queueLength ?? 0) === 0) {
        const defaultPlaylist = await loadDefaultPlaylist(config).catch(() => null);
        if (defaultPlaylist?.encryptedId && defaultPlaylist?.originalId) {
          await playCliPlaylist(config.cli.command, defaultPlaylist).catch(() => {});
        } else {
          const seedItems = await loadSeedItems(config).catch(() => []);
          if (seedItems.length) {
            await ensureQueueSeeded(config.cli.command, seedItems).catch(() => {});
          }
        }
      }

      const now = await getCliNow(config.cli.command, fallbackTrack);
      const queueItems = await buildQueueSnapshot(config).catch(() => []);
      const currentQueueItem = getCurrentQueueItem(queueItems);

      if (
        currentQueueItem &&
        (!now.track?.id || now.track.title === "Nothing playing" || !now.track.title)
      ) {
        now.track = {
          ...(now.track ?? {}),
          id: currentQueueItem.encryptedId || now.track?.id || "",
          originalId: currentQueueItem.originalId || "",
          title: currentQueueItem.title || now.track?.title || "Nothing playing",
          artist: currentQueueItem.artist || now.track?.artist || "",
          album: currentQueueItem.album || now.track?.album || "",
          duration: currentQueueItem.duration || now.track?.duration || 0,
          coverUrl: currentQueueItem.coverImgUrl || now.track?.coverUrl || "",
        };
      }

      if (currentQueueItem && currentQueueItem.canPlay === false && now.track?.status !== "playing") {
        now.meta.message = "Current track unavailable for playback";
      }

      if (!now.track) {
        return now;
      }

      try {
        await ensureAnonymousAccessToken(config.netease, authState);
        const reference = await resolveSongReference(now.track, config.netease, authState);
        if (reference?.originalId) {
          const lyricTrack = await buildTrackBundle(reference.originalId, config.netease, authState);
          now.track.id = now.track.id || reference.encryptedId || lyricTrack.id || reference.originalId;
          now.track.originalId = reference.originalId;
          now.track.title = now.track.title || lyricTrack.title;
          now.track.artist = now.track.artist || lyricTrack.artist;
          now.track.album = now.track.album || lyricTrack.album;
          now.track.coverUrl = now.track.coverUrl || lyricTrack.coverImgUrl || "";
          if ((!now.track.duration || now.track.duration <= 0) && lyricTrack.duration) {
            now.track.duration = lyricTrack.duration;
          }
          if ((!now.track.transcript || now.track.transcript.length === 0) && lyricTrack.transcript?.length) {
            now.track.transcript = lyricTrack.transcript;
          }
        }
      } catch {
        // lyric enrichment is best-effort; transport state should still render
      }

      if ((!now.track.transcript || now.track.transcript.length === 0) && (now.track.id || currentQueueItem?.encryptedId)) {
        const lyric = await getCachedCliLyric(
          config,
          currentQueueItem?.encryptedId || now.track.id
        );
        if (lyric?.transcript?.length) {
          now.track.transcript = lyric.transcript;
        }
        if (!now.track.originalId && lyric?.originalId) {
          now.track.originalId = lyric.originalId;
        }
      }

      return now;
    },
    async getNext() {
      const status = await this.status();
      if (!status.readyForRemotePlayback) {
        return [];
      }

      if (Number(status.state?.queueLength ?? 0) === 0) {
        const defaultPlaylist = await loadDefaultPlaylist(config).catch(() => null);
        if (defaultPlaylist?.encryptedId && defaultPlaylist?.originalId) {
          await playCliPlaylist(config.cli.command, defaultPlaylist).catch(() => {});
        } else {
          const seedItems = await loadSeedItems(config).catch(() => []);
          const seeded = await ensureQueueSeeded(config.cli.command, seedItems).catch(() => ({ items: [] }));
          return seeded.items ?? [];
        }
      }

      const queue = await buildQueueSnapshot(config).catch(() => []);
      return markBlockedItems(queue, store);
    },
    async getPlaylists() {
      // Let NetEase / CLI errors propagate so the route can surface them.
      const playlists = await getCliCreatedPlaylists(config.cli.command);
      const selected = pickDefaultPlaylist(playlists, config.cli.defaultPlaylistName);
      return playlists.map((playlist) => ({
        ...playlist,
        selected: Boolean(selected?.encryptedId && playlist.encryptedId === selected.encryptedId),
      }));
    },
    async getPlaylistTracks(playlistId, limit = 30) {
      // Let errors propagate (e.g. NetEase rate-limit, auth failure).
      const tracks = await getCliPlaylistTracks(
        config.cli.command,
        playlistId,
        Math.min(Math.max(Number(limit) || 30, 1), 100)
      );
      return markBlockedItems(tracks, store);
    },
    async toggle() {
      const status = await this.status();
      const currentStatus = status.state?.status;
      if (currentStatus === "playing") {
        return runTransport(config.cli.command, "pause");
      }

      if (currentStatus === "paused") {
        return runTransport(config.cli.command, "resume");
      }

      const queueItems = await buildQueueSnapshot(config).catch(() => []);
      const currentQueueItem = getCurrentQueueItem(queueItems);
      const playableItem =
        currentQueueItem?.encryptedId && currentQueueItem?.originalId
          ? currentQueueItem
          : queueItems.find((item) => item.encryptedId && item.originalId);

      if (currentStatus === "stopped" && playableItem?.encryptedId) {
        const resumed = await runTransport(config.cli.command, "resume").catch(() => null);
        if (resumed?.success !== false) {
          return resumed ?? { success: true, message: "Resume requested" };
        }
      }

      if (playableItem?.encryptedId && playableItem?.originalId) {
        const result = await playCliSong(config.cli.command, playableItem).catch(playbackFailure);
        if (result?.success === false) {
          return result;
        }
        return confirmCliSongPlayback(config, playableItem).catch(() => result);
      }

      return {
        success: false,
        message: "Current queue has no playable song. Try another playlist or search result.",
      };
    },
    async play(item) {
      if (!item?.encryptedId || !item?.originalId) {
        return {
          success: false,
          message: "This song is missing the encryptedId/originalId needed by ncm-cli.",
        };
      }
      const result = await playCliSong(config.cli.command, item).catch(playbackFailure);
      if (result?.success === false) {
        const reason = result.reason || classifyPlaybackFailure(result);
        store?.recordBlockedSong?.(item, getFailureReasonLabel(reason));
        return {
          ...result,
          reason,
          message: result.message || getFailureReasonLabel(reason),
        };
      }

      const confirmation = await confirmCliSongPlayback(config, item).catch(() => ({
        success: true,
        confirmed: false,
        message: "Playback request sent; confirmation unavailable.",
      }));
      if (confirmation.success === false) {
        store?.recordBlockedSong?.(item, confirmation.message || getFailureReasonLabel(confirmation.reason));
        return confirmation;
      }

      store?.recordPlay?.(item);
      return {
        ...result,
        confirmed: Boolean(confirmation.confirmed),
      };
    },
    async prev() {
      return runTransport(config.cli.command, "prev");
    },
    async next() {
      return runTransport(config.cli.command, "next");
    },
    async seek(seconds) {
      return runTransport(config.cli.command, "seek", seconds);
    },
    async volume(level) {
      return runTransport(config.cli.command, "volume", level);
    },
  };

  return wrapUPnP(cliProvider, upnp);
}

function createBrainFacade(config) {
  let toolRegistry = null;
  let _tools = null;

  function initToolRegistry(music, store) {
    const personalization = require("./services/personalization.js");
    const weatherService = require("./services/weather.js");
    const tools = require("./services/tools.js");
    _tools = tools.createToolRegistry({ music, store, weatherService, personalization, config });
    return _tools;
  }

  return {
    status() {
      return {
        configured: Boolean(config.brain.apiKey && config.brain.baseUrl && config.brain.model),
        baseUrl: config.brain.baseUrl,
        model: config.brain.model,
      };
    },
    get tools() {
      return _tools;
    },
    setMusicStore(music, store) {
      if (music && store) {
        initToolRegistry(music, store);
      }
    },
    executeTool: null, // set dynamically in createServer
    async ask(message, options) {
      // options may contain { context, tools, executeTool } from chat-router,
      // or be the old-style music facade (ignored in tool mode).
      if (options && typeof options === "object" && (options.context || options.tools)) {
        return askAicodeeBrain(config.brain, {
          message,
          context: options.context ?? null,
          tools: options.tools ?? null,
          executeTool: options.executeTool ?? null,
        });
      }
      return askAicodeeBrain(config.brain, { message, context: null, tools: null, executeTool: null });
    },
  };
}

function createServer(config) {
  const hub = createHubState();
  const hubStore = createHubStore();

  // Restore hub state from disk
  const storedHub = hubStore.load();
  hub.replace(storedHub);

  // Auto-persist hub on mutation
  const _hubSetNow = hub.setNow.bind(hub);
  const _hubSetNext = hub.setNext.bind(hub);
  const _hubSetTaste = hub.setTaste.bind(hub);
  const _hubSetPlan = hub.setPlan.bind(hub);
  const _hubReplace = hub.replace.bind(hub);
  hub.setNow = (now) => { const r = _hubSetNow(now); hubStore.save(hub.get()); return r; };
  hub.setNext = (next) => { const r = _hubSetNext(next); hubStore.save(hub.get()); return r; };
  hub.setTaste = (taste) => { const r = _hubSetTaste(taste); hubStore.save(hub.get()); return r; };
  hub.setPlan = (plan) => { const r = _hubSetPlan(plan); hubStore.save(hub.get()); return r; };
  hub.replace = (next) => { const r = _hubReplace(next); hubStore.save(hub.get()); return r; };

  const store = createPersistentStore();
  const stream = createStreamService();
  const upnp = config?.upnp?.enabled ? createUPnPService() : null;
  const music = createMusicFacade(config, store, upnp);
  const brain = createBrainFacade(config);
  brain.setMusicStore(music, store);
  const { executeToolCall } = require("./services/tools.js");
  brain.executeTool = async (toolName, args, ctx) => {
    return executeToolCall(brain.tools || {}, toolName, args, ctx);
  };
  const claudioRouter = createClaudioRouter({
    hub,
    stream,
    music,
    brain,
    store,
    config,
    upnp,
    onAfterNowUpdate(snapshot) {
      stream.broadcast({
        type: "now",
        track: snapshot.now?.track ?? null,
      });
    },
  });

  const httpServer = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url, `http://${request.headers.host}`);
    const routeResponse = createResponseHelpers(response);

    if (requestUrl.pathname === "/api/health") {
      sendJson(response, 200, { status: "ok" });
      return;
    }

    try {
      if (await claudioRouter.handle(requestUrl, request, routeResponse)) {
        return;
      }
    } catch (error) {
      const queueEmpty = isCliQueueEmptyError(error);
      sendJson(response, queueEmpty ? 409 : 500, {
        error: "Claudio hub request failed",
        detail: error.message,
        reason: queueEmpty ? "queue-empty" : "unknown",
      });
      return;
    }

    const filePath = getStaticFilePath(requestUrl.pathname);
    if (!filePath) {
      sendJson(response, 400, { error: "Invalid path" });
      return;
    }

    sendFile(response, filePath);
  });

  // WebSocket streaming chat
  const wss = createWebSocketServer(httpServer, { path: "/chat-ws" });

  async function streamChatResponse(socketId, message) {
    // Send typing indicator
    wss.send(socketId, JSON.stringify({ type: "chat-typing", status: "thinking" }));

    // Process the message using the same pipeline as POST /api/chat
    const result = await processChatMessage({
      message,
      music,
      brain,
      store,
      weatherConfig: config?.weather ?? {},
    });

    // Update hub state + broadcast SSE after transport actions (mirrors POST /api/chat)
    if (Array.isArray(result?.executedActions) && result.executedActions.length) {
      const now = await music.getNow().catch(() => null);
      if (now) {
        hub.setNow(now);
        stream.broadcast({ type: "now", track: now?.track ?? null });
      }
    }

    const replyText = result?.reply || "抱歉，我现在无法回复。";
    const chars = [...replyText];

    // Stream characters with small delays for natural feel
    for (let i = 0; i < chars.length; i++) {
      const delay = 15 + Math.random() * 25; // 15-40ms per char
      await new Promise(r => setTimeout(r, delay));
      wss.send(socketId, JSON.stringify({
        type: "chat-chunk",
        chunk: chars[i],
        index: i,
        total: chars.length,
      }));
    }

    // Send completion
    wss.send(socketId, JSON.stringify({
      type: "chat-done",
      fullReply: replyText,
      actions: result?.actions || [],
      recommendation: result?.recommendation || result?._recommendation || null,
      executedActions: result?.executedActions || [],
    }));
  }

  wss.onMessage(async (socketId, rawMessage) => {
    let parsed;
    try { parsed = JSON.parse(rawMessage); } catch { return; }

    if (parsed.type === "chat") {
      const message = String(parsed.message || "").trim();
      if (!message) return;
      streamChatResponse(socketId, message).catch(e => {
        console.log(`[ws] stream error: ${e.message}`);
        try {
          wss.send(socketId, JSON.stringify({
            type: "chat-done",
            fullReply: "抱歉，处理消息时出错了：" + e.message,
            actions: [],
            recommendation: null,
            executedActions: [],
          }));
        } catch (_) {}
      });
    }
  });

  // Spawn NetEase Cloud Music API as a child process
  let neteaseProcess = null;
  const neteaseApiPort = config?.neteaseApi?.baseUrl
    ? new URL(config.neteaseApi.baseUrl).port
    : 4000;

  try {
    neteaseProcess = spawn("npx", ["NeteaseCloudMusicApi"], {
      cwd: process.cwd(),
      env: { ...process.env, PORT: String(neteaseApiPort) },
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    });
    neteaseProcess.stdout?.on("data", (d) => {
      process.stdout.write(`[netease-api] ${d}`);
    });
    neteaseProcess.stderr?.on("data", (d) => {
      process.stderr.write(`[netease-api:err] ${d}`);
    });
    neteaseProcess.on("exit", (code) => {
      console.log(`[netease-api] exited with code ${code}`);
    });
    console.log(`[server] NetEase API spawned on port ${neteaseApiPort}, pid=${neteaseProcess.pid}`);
  } catch (e) {
    console.log(`[server] Failed to spawn NetEase API: ${e.message}`);
  }

  // Start scheduler
  const scheduler = startScheduler({
    hub, store, music, brain, stream,
    weatherConfig: config?.weather ?? {},
    schedulerConfig: config?.scheduler ?? {},
  });

  // Graceful shutdown: flush persistent state
  function shutdown() {
    console.log("[server] Shutting down, flushing state...");
    try { scheduler.stop(); } catch (e) {}
    try { hubStore.flushSync(hub.get()); } catch (e) { console.log("[server] hub flush error:", e.message); }
    try { store.flushSync(); } catch (e) { console.log("[server] store flush error:", e.message); }
    if (neteaseProcess && neteaseProcess.exitCode == null) {
      try {
        if (process.platform === "win32") {
          spawn("taskkill", ["/PID", String(neteaseProcess.pid), "/T", "/F"]);
        } else {
          neteaseProcess.kill("SIGTERM");
        }
      } catch (e) {}
    }
    process.exit(0);
  }
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  return httpServer;
}

const config = getConfig();
const server = createServer(config);

server.listen(config.port, () => {
  console.log(`Claudio hub listening on http://localhost:${config.port}`);
});

module.exports = {
  createMusicFacade,
  createResponseHelpers,
  createServer,
  getStaticFilePath,
  sendFile,
  sendJson,
};
