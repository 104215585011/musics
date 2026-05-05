const { handleChat } = require("../services/chat-router.js");
const { buildPersonalizationSnapshot } = require("../services/personalization.js");

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk.toString("utf8");
    });
    request.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function createClaudioRouter({ hub, stream, music, brain, store, onAfterNowUpdate, config, upnp }) {
  async function refreshNowAfterTransport() {
    const now = await music.getNow().catch(() => null);
    if (!now) {
      return;
    }
    hub.setNow(now);
    onAfterNowUpdate?.(hub.get());
  }

  async function getPersonalization() {
    const hubState = hub.get();
    const storeState = store?.get?.() ?? {};
    const [playlists, queue] = await Promise.all([
      music.getPlaylists ? music.getPlaylists().catch(() => []) : Promise.resolve([]),
      music.getNext ? music.getNext().catch(() => hubState.next ?? []) : Promise.resolve(hubState.next ?? []),
    ]);

    return buildPersonalizationSnapshot({
      storeState,
      playlists: playlists ?? [],
      queue: queue ?? hubState.next ?? [],
      now: hubState.now,
      date: new Date(),
    });
  }

  return {
    async handle(requestUrl, request, response) {
      if (requestUrl.pathname === "/stream" && request.method === "GET") {
        response.sse();
        const unsubscribe = stream.addClient(response.raw);
        request.on("close", unsubscribe);
        response.raw.write(`data: ${JSON.stringify({ type: "status", state: "open" })}\n\n`);
        return true;
      }

      if (requestUrl.pathname === "/api/now" && request.method === "GET") {
        const now = await music.getNow();
        hub.setNow(now);
        onAfterNowUpdate?.(hub.get());
        response.json(200, hub.get().now);
        return true;
      }

      if (requestUrl.pathname === "/api/next" && request.method === "GET") {
        const next = await music.getNext();
        hub.setNext(next);
        response.json(200, { items: hub.get().next });
        return true;
      }

      if (requestUrl.pathname === "/api/playlists" && request.method === "GET") {
        try {
          const limit = Math.min(Math.max(Number(requestUrl.searchParams.get("limit") ?? 8), 1), 50);
          const items = await music.getPlaylists();
          response.json(200, { items: items.slice(0, limit), error: null });
        } catch (error) {
          const code = error?.neteaseCode ?? error?.code ?? null;
          response.json(200, {
            items: [],
            error: {
              message: error?.message || "Failed to load playlists",
              code,
              kind: code === -461 ? "rate-limited" : code ? "netease-error" : "transport",
            },
          });
        }
        return true;
      }

      if (requestUrl.pathname === "/api/search" && request.method === "GET") {
        const q = requestUrl.searchParams.get("q") ?? "";
        const limit = Math.min(Number(requestUrl.searchParams.get("limit") || "8"), 20);
        if (!q.trim()) {
          response.json(200, { songs: [] });
          return true;
        }
        try {
          if (music?.search) {
            const songs = await music.search(q, limit);
            response.json(200, {
              songs: songs.map((song) => ({
                id: song.id || song.originalId || song.encryptedId || "",
                name: song.title || song.name || "",
                title: song.title || song.name || "",
                artist: song.artist || "",
                album: song.album || "",
                duration: song.duration || 0,
                canPlay: song.canPlay !== false,
                matchScore: song.matchScore || 0,
              })),
            });
            return true;
          }

          const apiBase = config?.neteaseApi?.baseUrl ?? "http://localhost:4000";
          const searchUrl = `${apiBase}/search?keywords=${encodeURIComponent(q)}&limit=${limit}&timestamp=${Date.now()}`;
          const resp = await fetch(searchUrl, { signal: AbortSignal.timeout(8000) });
          const payload = await resp.json().catch(() => ({}));
          const rawList = payload?.result?.songs ?? [];
          if (!rawList.length) { response.json(200, { songs: [] }); return true; }

          // Enrich with song details for artist/album info
          const ids = rawList.slice(0, limit).map((s) => s.id).filter(Boolean).join(",");
          let detailMap = {};
          if (ids) {
            try {
              const dr = await fetch(`${apiBase}/song/detail?ids=${ids}&timestamp=${Date.now()}`, { signal: AbortSignal.timeout(5000) });
              const dp = await dr.json().catch(() => ({}));
              for (const ds of (dp?.songs ?? [])) {
                detailMap[ds.id] = {
                  artist: (ds.ar || []).map((a) => a.name).filter(Boolean).join(" / "),
                  album: ds.al?.name || "",
                  duration: ds.dt || 0,
                };
              }
            } catch (_) {}
          }

          const songs = rawList.slice(0, limit).map((s) => {
            const e = detailMap[s.id] || {};
            return {
              id: s.id ?? "",
              name: s.name ?? "",
              artist: e.artist || (s.ar && s.ar[0]?.name) || "",
              album: e.album || (s.al && s.al.name) || "",
              duration: e.duration || (s.dt || 0),
            };
          });
          response.json(200, { songs });
        } catch (e) {
          response.json(200, { songs: [], error: e.message });
        }
        return true;
      }

      if (requestUrl.pathname === "/api/memory" && request.method === "GET") {
        const state = store?.get?.() ?? {};
        response.json(200, {
          messages: (state.messages ?? []).slice(-12),
          plays: (state.plays ?? []).slice(-12).reverse(),
          blockedSongs: (state.blockedSongs ?? []).slice(-12).reverse(),
          updatedAt: state.updatedAt ?? "",
        });
        return true;
      }

      if (requestUrl.pathname === "/api/brain/status" && request.method === "GET") {
        const status = brain?.status?.() ?? { configured: false };
        response.json(200, {
          configured: Boolean(status.configured),
          baseUrl: status.baseUrl ?? "",
          model: status.model ?? "",
        });
        return true;
      }

      if (requestUrl.pathname === "/api/weather" && request.method === "GET") {
        const weatherService = require("../services/weather.js");
        try {
          const raw = await weatherService.getCachedWeather(config?.weather ?? {}).catch(() => null);
          if (raw) {
            const condition = weatherService.getWeatherCondition(raw);
            response.json(200, { available: true, ...condition, fetchedAt: raw.fetchedAt });
          } else {
            response.json(200, { available: false, message: "Weather data unavailable" });
          }
        } catch {
          response.json(200, { available: false, message: "Weather service error" });
        }
        return true;
      }

      if (requestUrl.pathname === "/api/tts" && request.method === "POST") {
        const body = await readJsonBody(request).catch(() => ({}));
        const text = String(body.text || "").trim();
        if (!text) {
          response.json(400, { error: "Missing text" });
          return true;
        }
        try {
          const { speak } = require("../services/tts.js");
          const audioBuffer = await speak(text, config?.tts ?? {});
          if (!audioBuffer) {
            response.json(502, { error: "TTS service unavailable" });
          } else {
            response.raw.writeHead(200, {
              "Content-Type": "audio/mpeg",
              "Content-Length": audioBuffer.length,
              "Cache-Control": "public, max-age=3600",
            });
            response.raw.end(audioBuffer);
          }
        } catch (e) {
          response.json(500, { error: e.message });
        }
        return true;
      }

      if (requestUrl.pathname === "/api/recommend" && request.method === "POST") {
        const body = await readJsonBody(request).catch(() => ({}));
        try {
          const { buildFullContext } = require("../services/context-builder.js");
          const weatherService = require("../services/weather.js");
          const { createToolRegistry, executeToolCall } = require("../services/tools.js");
          const personalization = require("../services/personalization.js");
          const tools = createToolRegistry({ music, store, weatherService, personalization, config });
          const context = await buildFullContext({ music, store, weatherConfig: config?.weather ?? {} });

          const result = await executeToolCall(tools, "recommend", { mood: body.mood, activity: body.activity }, { fullContext: context });

          response.json(200, {
            recommendation: result?.result ?? null,
            scene: context?.scene ?? null,
            weather: context?.weather ?? null,
          });
        } catch (error) {
          response.json(200, { recommendation: null, error: error.message });
        }
        return true;
      }

      // User persona files
      if (requestUrl.pathname === "/api/user/files" && request.method === "GET") {
        try {
          const { listUserFiles } = require("../services/user-files.js");
          response.json(200, { files: listUserFiles() });
        } catch (e) {
          response.json(500, { error: e.message });
        }
        return true;
      }

      if (requestUrl.pathname.startsWith("/api/user/files/") && request.method === "GET") {
        const name = requestUrl.pathname.replace("/api/user/files/", "");
        try {
          const { readUserFile } = require("../services/user-files.js");
          const content = readUserFile(name);
          if (content === null) {
            response.json(404, { error: "File not found" });
          } else {
            response.json(200, { name, content });
          }
        } catch (e) {
          response.json(500, { error: e.message });
        }
        return true;
      }

      if (requestUrl.pathname.startsWith("/api/user/files/") && request.method === "PUT") {
        const name = requestUrl.pathname.replace("/api/user/files/", "");
        const body = await readJsonBody(request).catch(() => ({}));
        try {
          const { writeUserFile } = require("../services/user-files.js");
          const ok = writeUserFile(name, body.content ?? "");
          response.json(ok ? 200 : 400, { ok });
        } catch (e) {
          response.json(500, { error: e.message });
        }
        return true;
      }

      // UPnP
      if (requestUrl.pathname === "/api/upnp/devices" && request.method === "GET") {
        try {
          const devices = await upnp?.discover?.().catch(() => []) ?? [];
          response.json(200, { devices });
        } catch (e) {
          response.json(200, { devices: [], error: e.message });
        }
        return true;
      }

      if (requestUrl.pathname === "/api/upnp/connect" && request.method === "POST") {
        const body = await readJsonBody(request).catch(() => ({}));
        try {
          const ok = await upnp?.connect?.(body) ?? false;
          response.json(ok ? 200 : 400, { ok });
        } catch (e) {
          response.json(500, { error: e.message });
        }
        return true;
      }

      if (requestUrl.pathname === "/api/upnp/disconnect" && request.method === "POST") {
        try {
          upnp?.disconnect?.();
          response.json(200, { ok: true });
        } catch (e) {
          response.json(500, { error: e.message });
        }
        return true;
      }

      if (requestUrl.pathname === "/api/upnp/status" && request.method === "GET") {
        try {
          const status = upnp?.isConnected?.()
            ? { connected: true, device: upnp.currentDevice?.() ?? null, state: await (upnp.getStatus?.() ?? Promise.resolve({})) }
            : { connected: false, device: null, state: {} };
          response.json(200, status);
        } catch (e) {
          response.json(200, { connected: false });
        }
        return true;
      }

      if (requestUrl.pathname === "/api/personalization" && request.method === "GET") {
        response.json(200, await getPersonalization());
        return true;
      }

      // ─── Favorites ───
      if (requestUrl.pathname === "/api/favorites" && request.method === "GET") {
        const items = store?.getFavorites?.() ?? [];
        response.json(200, { items });
        return true;
      }

      if (requestUrl.pathname === "/api/favorites" && request.method === "POST") {
        const body = await readJsonBody(request).catch(() => ({}));
        const added = store?.addFavorite?.(body) ?? false;
        response.json(200, { ok: added });
        return true;
      }

      if (requestUrl.pathname === "/api/favorites" && request.method === "DELETE") {
        const body = await readJsonBody(request).catch(() => ({}));
        const removed = store?.removeFavorite?.(body.query || body.title || "") ?? false;
        response.json(200, { ok: removed });
        return true;
      }

      // ─── History (recent plays with enough info to replay via yt-dlp) ───
      if (requestUrl.pathname === "/api/history" && request.method === "GET") {
        const state = store?.get?.() ?? {};
        const plays = (state.plays ?? []).slice(-30).reverse();
        response.json(200, { items: plays });
        return true;
      }

      if (requestUrl.pathname === "/api/playlist/tracks" && request.method === "GET") {
        try {
          const items = await music.getPlaylistTracks(
            requestUrl.searchParams.get("id"),
            Number(requestUrl.searchParams.get("limit") ?? 8)
          );
          response.json(200, { items, error: null });
        } catch (error) {
          const code = error?.neteaseCode ?? error?.code ?? null;
          response.json(200, {
            items: [],
            error: {
              message: error?.message || "Failed to load playlist tracks",
              code,
              kind: code === -461 ? "rate-limited" : code ? "netease-error" : "transport",
            },
          });
        }
        return true;
      }

      if (requestUrl.pathname === "/api/taste" && request.method === "GET") {
        const snapshot = await getPersonalization().catch(() => null);
        response.json(
          200,
          snapshot
            ? {
                ...hub.get().taste,
                tags: snapshot.profile.tags,
                profile: snapshot.profile,
                scene: snapshot.scene,
              }
            : hub.get().taste
        );
        return true;
      }

      if (requestUrl.pathname === "/api/plan/today" && request.method === "GET") {
        const snapshot = await getPersonalization().catch(() => null);
        response.json(200, snapshot ? snapshot.plan : hub.get().plan);
        return true;
      }

      if (requestUrl.pathname === "/api/stats" && request.method === "GET") {
        const now = hub.get().now;
        const state = store?.get?.() ?? {};
        const plays = state.plays ?? [];
        const blockedSongs = state.blockedSongs ?? [];
        const topMap = new Map();
        plays.forEach((play) => {
          const key = `${play.title ?? ""}::${play.artist ?? ""}`;
          if (!play.title || !key.trim()) return;
          const current = topMap.get(key) ?? {
            title: play.title,
            artist: play.artist,
            plays: 0,
          };
          current.plays += 1;
          topMap.set(key, current);
        });
        const topTracks = [...topMap.values()].sort((left, right) => right.plays - left.plays).slice(0, 5);
        response.json(200, {
          todayMinutes: now?.track?.duration ? Math.round(now.track.duration / 60) : 0,
          weekMinutes: now?.track?.duration ? Math.round((now.track.duration * 3) / 60) : 0,
          tracks: plays.length || (now?.track?.id ? 1 : 0),
          blocked: blockedSongs.length,
          top: topTracks.length
            ? topTracks
            : now?.track?.title
            ? [{ title: now.track.title, artist: now.track.artist }]
            : [],
        });
        return true;
      }

      if (requestUrl.pathname === "/api/chat" && request.method === "POST") {
        const body = await readJsonBody(request).catch(() => ({}));
        const weatherConfig = request.weatherConfig || {};
        const result = await handleChat({
          message: body.message,
          music,
          brain,
          store,
          weatherConfig: config?.weather ?? {},
        });
        if (Array.isArray(result.executedActions) && result.executedActions.length) {
          await refreshNowAfterTransport();
        }
        response.json(200, result);
        return true;
      }

      if (requestUrl.pathname === "/api/transport/toggle" && request.method === "POST") {
        const result = await music.toggle();
        await refreshNowAfterTransport();
        response.json(200, result);
        return true;
      }

      if (requestUrl.pathname === "/api/transport/play" && request.method === "POST") {
        const body = await readJsonBody(request).catch(() => ({}));
        const result = await music.play(body);
        await refreshNowAfterTransport();
        response.json(200, result);
        return true;
      }

      if (requestUrl.pathname === "/api/transport/prev" && request.method === "POST") {
        const result = await music.prev();
        await refreshNowAfterTransport();
        response.json(200, result);
        return true;
      }

      if (requestUrl.pathname === "/api/transport/next" && request.method === "POST") {
        const result = await music.next();
        await refreshNowAfterTransport();
        response.json(200, result);
        return true;
      }

      if (requestUrl.pathname === "/api/transport/seek" && request.method === "POST") {
        const body = await readJsonBody(request).catch(() => ({}));
        const result = await music.seek(body.seconds ?? 0);
        await refreshNowAfterTransport();
        response.json(200, result);
        return true;
      }

      if (requestUrl.pathname === "/api/transport/volume" && request.method === "POST") {
        const body = await readJsonBody(request).catch(() => ({}));
        const result = await music.volume(body.level ?? 0);
        await refreshNowAfterTransport();
        response.json(200, result);
        return true;
      }

      if (requestUrl.pathname === "/api/transport/login" && request.method === "POST") {
        response.json(200, await music.login());
        return true;
      }

      if (requestUrl.pathname === "/api/transport/logout" && request.method === "POST") {
        response.json(200, await music.logout());
        return true;
      }

      if (requestUrl.pathname === "/api/transport/status" && request.method === "GET") {
        response.json(200, await music.status());
        return true;
      }

      return false;
    },
  };
}

module.exports = {
  createClaudioRouter,
};
