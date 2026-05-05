// Search NetEase API and pick the best result (used by both search_songs and recommend)
async function searchAndPick(query, limit = 5) {
  try {
    const apiBase = process.env.NETEASE_API_BASE_URL ?? "http://localhost:4000";
    const q = encodeURIComponent(String(query));
    const searchUrl = `${apiBase}/search?keywords=${q}&limit=${limit}&timestamp=${Date.now()}`;
    const resp = await fetch(searchUrl, { signal: AbortSignal.timeout(8000) }).catch(() => null);
    if (!resp || !resp.ok) return { title: "", artist: "", reason: "搜索请求失败" };
    const payload = await resp.json().catch(() => ({}));
    const rawList = payload?.result?.songs ?? [];
    if (!rawList.length) return { title: "", artist: "", reason: `未找到"${query}"的结果` };

    const best = rawList[0];
    // Enrich with song detail for artist info
    let artist = "";
    let album = "";
    try {
      const id = best.id;
      if (id) {
        const dr = await fetch(`${apiBase}/song/detail?ids=${id}`, { signal: AbortSignal.timeout(4000) }).catch(() => null);
        if (dr) {
          const dp = await dr.json().catch(() => ({}));
          const detail = (dp?.songs ?? [])[0];
          if (detail) {
            artist = (detail.ar || []).map((a) => a.name).filter(Boolean).join(" / ");
            album = detail.al?.name || "";
          }
        }
      }
    } catch (_) {}

    return {
      title: best.name ?? "",
      artist: artist || (best.ar && best.ar[0]?.name) || "",
      album: album || (best.al && best.al.name) || "",
      encryptedId: String(best.id ?? ""),
      originalId: String(best.id ?? ""),
      duration: (best.dt || 0),
      reason: `来自网易云搜索"${query}"，共${rawList.length}个结果`,
      score: 40,
    };
  } catch (e) {
    return { title: "", artist: "", reason: `搜索失败: ${e.message}` };
  }
}

function createToolRegistry({ music, store, weatherService, personalization, config } = {}) {
  const tools = {};

  tools.get_weather = {
    description: "获取当前天气信息，包括温度、天气状况、城市等。用于根据天气推荐合适的音乐。",
    parameters: {},
    async handler() {
      if (!weatherService) return { available: false, message: "天气服务未配置" };
      try {
        const raw = await weatherService.getCachedWeather(config?.weather ?? {});
        if (!raw) return { available: false, message: "暂时无法获取天气数据" };
        return weatherService.getWeatherCondition(raw);
      } catch {
        return { available: false, message: "天气服务暂时不可用" };
      }
    },
  };

  tools.get_playlists = {
    description: "获取用户的网易云歌单列表。可以根据关键词搜索歌单名称。",
    parameters: {
      query: { type: "string", description: "搜索关键词，按歌单名称筛选，可选" },
      limit: { type: "number", description: "返回数量，默认10", default: 10 },
    },
    async handler(args) {
      if (!music?.getPlaylists) return [];
      const playlists = await music.getPlaylists().catch(() => []);
      if (!Array.isArray(playlists)) return [];

      let filtered = playlists;
      if (args?.query) {
        const q = String(args.query).toLowerCase();
        filtered = playlists.filter((p) => String(p.title ?? "").toLowerCase().includes(q));
      }
      const limit = Math.min(Math.max(Number(args?.limit) || 10, 1), 50);
      return filtered.slice(0, limit).map((p) => ({
        title: p.title ?? "",
        trackCount: p.trackCount ?? 0,
        encryptedId: p.encryptedId ?? "",
        selected: Boolean(p.selected),
        specialType: p.specialType ?? 0,
      }));
    },
  };

  tools.get_playlist_tracks = {
    description: "获取指定歌单中的歌曲列表。需要歌单的 encryptedId。",
    parameters: {
      playlistId: { type: "string", description: "歌单 encryptedId，必填", required: true },
      limit: { type: "number", description: "返回数量，默认30", default: 30 },
    },
    async handler(args) {
      if (!args?.playlistId) return [];
      if (!music?.getPlaylistTracks) return [];
      const limit = Math.min(Math.max(Number(args?.limit) || 30, 1), 100);
      const tracks = await music.getPlaylistTracks(args.playlistId, limit).catch(() => []);
      return (Array.isArray(tracks) ? tracks : []).map((t) => ({
        title: t.title ?? t.name ?? "",
        artist: t.artist ?? "",
        album: t.album ?? "",
        duration: t.duration ?? 0,
        encryptedId: t.encryptedId ?? t.id ?? "",
        originalId: t.originalId ?? "",
        canPlay: t.canPlay !== false,
        blockedReason: t.blockedReason ?? "",
      }));
    },
  };

  tools.search_songs = {
    description: "在网易云音乐曲库中搜索歌曲。当用户想找特定歌手、风格、心情或关键词的歌曲时使用。返回歌曲列表（含id、歌名、歌手）。",
    parameters: {
      query: { type: "string", description: "搜索关键词，如 周杰伦、轻音乐、摇滚、晚安", required: true },
      limit: { type: "number", description: "返回数量，默认5", default: 5 },
    },
    async handler(args) {
      if (!args?.query) return [];
      try {
        const apiBase = config?.neteaseApi?.baseUrl ?? "http://localhost:4000";
        const q = encodeURIComponent(String(args.query));
        const limit = Math.min(Number(args.limit) || 5, 20);
        const searchUrl = `${apiBase}/search?keywords=${q}&limit=${limit}&timestamp=${Date.now()}`;
        const resp = await fetch(searchUrl, { signal: AbortSignal.timeout(8000) }).catch(() => null);
        if (!resp) return [];
        const payload = await resp.json().catch(() => ({}));
        const rawList = payload?.result?.songs ?? [];
        if (!rawList.length) return [];

        // Enrich with song details to get artist names
        const ids = rawList.slice(0, limit).map((s) => s.id).filter(Boolean).join(",");
        let detailMap = {};
        if (ids) {
          try {
            const detailResp = await fetch(
              `${apiBase}/song/detail?ids=${ids}&timestamp=${Date.now()}`,
              { signal: AbortSignal.timeout(5000) }
            ).catch(() => null);
            if (detailResp) {
              const detailPayload = await detailResp.json().catch(() => ({}));
              const detailSongs = detailPayload?.songs ?? [];
              for (const ds of detailSongs) {
                const artistNames = (ds.ar || []).map((a) => a.name).filter(Boolean);
                detailMap[ds.id] = {
                  artist: artistNames.join(" / "),
                  album: ds.al?.name || "",
                  duration: ds.dt || 0,
                };
              }
            }
          } catch (_) { /* enrichment is best-effort */ }
        }

        return rawList.slice(0, limit).map((s) => {
          const enriched = detailMap[s.id] || {};
          return {
            id: s.id ?? "",
            name: s.name ?? "",
            artist: enriched.artist || (s.ar && s.ar[0]?.name) || "",
            album: enriched.album || (s.al && s.al.name) || "",
            duration: enriched.duration || (s.dt || 0),
          };
        });
      } catch {
        return [];
      }
    },
  };

  tools.recommend = {
    description: "根据当前场景（天气、时间、情绪、活动）智能推荐一首歌。优先从用户歌单中选，歌单不足时自动搜索网易云曲库。也可以指定关键词搜索推荐。",
    parameters: {
      mood: { type: "string", description: "指定情绪：steady/tired/bright/soft，可选" },
      activity: { type: "string", description: "指定活动：coding/rest/move/listening，可选" },
      query: { type: "string", description: "搜索关键词，如 周杰伦、轻音乐、摇滚、晚安。不传则从用户歌单推荐", optional: true },
    },
    parameters: {
      mood: { type: "string", description: "指定情绪：steady/tired/bright/soft，可选" },
      activity: { type: "string", description: "指定活动：coding/rest/move/listening，可选" },
      fromPlaylist: { type: "string", description: "指定从哪个歌单推荐（歌单名称或关键词），可选" },
    },
    async handler(args, ctx) {
      const context = ctx?.fullContext;
      if (!context) return { title: "", artist: "", reason: "暂无上下文数据" };

      const scene = context.scene ?? {};
      const taste = context.taste ?? {};
      const weather = context.weather;

      // If user provided a query, search NetEase directly
      if (args?.query) {
        return await searchAndPick(args.query, context, 5);
      }

      // Try local queue candidates first
      const queue = context.queue ?? [];
      const playlists = context.playlists ?? [];
      const history = context.history ?? {};
      const recentIds = new Set(history.recentTrackIds ?? []);

      let candidates = queue.filter((item) => item.canPlay);
      if (args?.fromPlaylist && playlists.length) {
        const target = playlists.find((p) =>
          String(p.title ?? "").toLowerCase().includes(String(args.fromPlaylist).toLowerCase())
        );
        if (target?.encryptedId && music?.getPlaylistTracks) {
          const tracks = await music.getPlaylistTracks(target.encryptedId, 50).catch(() => []);
          candidates = (Array.isArray(tracks) ? tracks : []).filter((t) => t.canPlay);
        }
      }

      // If local candidates are empty or only 1-2 items, broaden with NetEase search
      if (candidates.length < 3) {
        const searchQuery = args?.mood || scene.mood || taste.tags?.[0] || "推荐";
        const fromSearch = await searchAndPick(searchQuery, context, 3);
        if (fromSearch.title) return fromSearch;
      }

      // Score local candidates
      if (candidates.length > 0) {
        const scored = candidates.map((item) => {
          let score = 50;
          if (recentIds.has(String(item.encryptedId ?? item.id ?? ""))) score -= 25;
          const topArtists = taste.topArtists ?? [];
          if (topArtists.some((a) => item.artist?.toLowerCase().includes(a.name?.toLowerCase() ?? ""))) score += 15;
          const activity = args?.activity || scene.activity || "";
          if (activity === "coding" && (item.album?.toLowerCase().includes("focus") || item.album?.toLowerCase().includes("study"))) score += 10;
          if (item.canPlay) score += 10;
          if (item.blockedReason) score -= 30;
          return { item, score: Math.max(0, score) };
        });
        scored.sort((a, b) => b.score - a.score);
        const best = scored[0];
        if (best && best.score > 0) {
          const weatherNote = weather ? `当前天气${weather.description}` : "";
          const timeNote = `${scene.summary ?? ""}`;
          const parts = [timeNote, weatherNote].filter(Boolean);
          let reason = `来自你的歌单，评分${best.score}/100`;
          if (parts.length) reason += `（${parts.join("，")}）`;
          return {
            title: best.item.title ?? "",
            artist: best.item.artist ?? "",
            album: best.item.album ?? "",
            encryptedId: best.item.encryptedId ?? best.item.id ?? "",
            originalId: best.item.originalId || best.item.encryptedId || best.item.id || "",
            duration: best.item.duration ?? 0,
            reason,
            score: best.score,
          };
        }
      }

      // Final fallback: search NetEase with taste tags
      const fallbackQuery = taste.tags?.[0] || "流行";
      return await searchAndPick(fallbackQuery, 3);
    },
  };

  tools.get_taste = {
    description: "获取用户的听歌品味画像，包括风格标签、常听艺人、专辑等。",
    parameters: {},
    async handler() {
      if (!personalization?.buildTasteProfile) return {};
      const storeState = store?.get?.() ?? {};
      const playlists = await music?.getPlaylists?.().catch(() => []) ?? [];
      const now = await music?.getNow?.().catch(() => null) ?? null;
      return personalization.buildTasteProfile({ storeState, playlists, now });
    },
  };

  tools.get_now = {
    description: "获取当前正在播放的歌曲信息。",
    parameters: {},
    async handler() {
      const now = await music?.getNow?.().catch(() => null);
      if (!now?.track) return { title: "", artist: "", status: "stopped" };
      return {
        title: now.track.title ?? "",
        artist: now.track.artist ?? "",
        album: now.track.album ?? "",
        duration: now.track.duration ?? 0,
        position: now.track.position ?? 0,
        status: now.track.status ?? "stopped",
        coverUrl: now.track.coverUrl ?? "",
      };
    },
  };

  tools.get_queue = {
    description: "获取即将播放的队列列表。",
    parameters: {
      limit: { type: "number", description: "返回数量，默认10", default: 10 },
    },
    async handler(args) {
      const queue = await music?.getNext?.().catch(() => []) ?? [];
      const limit = Math.min(Math.max(Number(args?.limit) || 10, 1), 30);
      return (Array.isArray(queue) ? queue : []).slice(0, limit).map((item) => ({
        title: item.title ?? "",
        artist: item.artist ?? "",
        album: item.album ?? "",
        canPlay: item.canPlay !== false,
        current: Boolean(item.current),
        blockedReason: item.blockedReason ?? "",
      }));
    },
  };

  tools.get_history = {
    description: "获取最近的播放历史。",
    parameters: {
      limit: { type: "number", description: "返回数量，默认5", default: 5 },
    },
    async handler(args) {
      const storeState = store?.get?.() ?? {};
      const plays = Array.isArray(storeState.plays) ? storeState.plays : [];
      const limit = Math.min(Math.max(Number(args?.limit) || 5, 1), 30);
      return plays.slice(-limit).reverse().map((p) => ({
        title: p.title ?? "",
        artist: p.artist ?? "",
        album: p.album ?? "",
        at: p.at ?? "",
      }));
    },
  };

  // Transport tools
  async function transportAction(name, args) {
    switch (name) {
      case "next": await music?.next?.(); break;
      case "prev": await music?.prev?.(); break;
      case "pause":
        const s = await music?.status?.().catch(() => ({}));
        if (s?.state?.status === "playing") await music?.toggle?.();
        break;
      case "play":
      case "resume":
        const s2 = await music?.status?.().catch(() => ({}));
        if (s2?.state?.status !== "playing") await music?.toggle?.();
        break;
      case "toggle": await music?.toggle?.(); break;
    }
    return { success: true, action: name };
  }

  tools.speak = {
    description: "让 Claudio 用语音朗读一段话（TTS）。用于DJ播报、问候、换歌串词等场景。文本不要超过200字。",
    parameters: {
      text: { type: "string", description: "要朗读的文本内容（中文），不超过200字", required: true },
    },
    async handler(args) {
      if (!args?.text) return { error: "缺少文本" };
      // TTS is a side-effect action — the server broadcasts via SSE
      // The actual audio playback happens on the frontend
      return {
        spoken: true,
        text: String(args.text).slice(0, 200),
        note: "语音将通过前端播放",
      };
    },
  };

  tools.get_user_files = {
    description: "读取用户的个性化配置文件（音乐品味、日常习惯、心情规则、歌单备注）。可以指定文件名或读取全部。",
    parameters: {
      name: { type: "string", description: "文件名，如 taste.md, routines.md, mood-rules.md, playlists.json。不传则返回文件列表。" },
    },
    async handler(args) {
      try {
        const { listUserFiles, readUserFile, ensureUserDir } = require("./user-files.js");
        ensureUserDir();
        if (args?.name) {
          const content = readUserFile(String(args.name));
          return content != null ? { name: args.name, content } : { error: "文件不存在" };
        }
        const files = listUserFiles();
        return { files: files.filter(f => f.exists).map(f => f.name) };
      } catch (e) {
        return { error: e.message };
      }
    },
  };

  tools.transport_next = {
    description: "切换到下一首歌曲。",
    parameters: {},
    async handler() { return transportAction("next"); },
  };

  tools.transport_prev = {
    description: "切换到上一首歌曲。",
    parameters: {},
    async handler() { return transportAction("prev"); },
  };

  tools.transport_pause = {
    description: "暂停当前播放。",
    parameters: {},
    async handler() { return transportAction("pause"); },
  };

  tools.transport_play = {
    description: "继续/开始播放音乐。",
    parameters: {},
    async handler() { return transportAction("play"); },
  };

  return tools;
}

async function executeToolCall(tools, toolName, args, context) {
  const tool = tools[toolName];
  if (!tool) return { error: `未知工具: ${toolName}` };
  try {
    const result = await tool.handler(args || {}, context);
    return { tool: toolName, result };
  } catch (error) {
    return { tool: toolName, error: error.message };
  }
}

module.exports = { createToolRegistry, executeToolCall };
