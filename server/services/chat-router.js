const { buildPersonalizationSnapshot } = require("./personalization.js");
const { buildFullContext } = require("./context-builder.js");

const ZH = {
  hello: "\u4f60\u597d\uff0c\u6211\u5728\u8fd9\u91cc\u3002\u4eca\u5929\u6211\u4eec\u5c31\u8f7b\u8f7b\u542c\u6b4c\u3002",
  empty: "\u6211\u5728\u3002\u60f3\u542c\u4ec0\u4e48\uff0c\u76f4\u63a5\u544a\u8bc9\u6211\u6b4c\u540d\u6216\u6b4c\u624b\u5c31\u597d\u3002",
  fallback: "\u6211\u73b0\u5728\u5148\u4fdd\u6301\u672c\u5730\u7535\u53f0\u6a21\u5f0f\u3002\u4f60\u53ef\u4ee5\u76f4\u63a5\u8bf4\uff1a\u6765\u4e00\u9996 Bread \u7684 If\u3002",
};

function extractSongRequest(message = "") {
  const text = String(message || "").trim();
  if (!text) return "";

  const slash = text.match(/^\/play\s+(.+)$/i);
  if (slash) return slash[1].trim();

  const patterns = [
    /(?:\u6765|\u653e|\u64ad|\u542c|\u70b9|\u627e|\u641c\u7d22)\s*(?:\u4e00\u9996|\u4e00\u652f|\u9996|\u652f)?\s*(.+)$/i,
    /(?:play|search)\s+(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1]
        .replace(/\u7684\u6b4c$/i, "")
        .replace(/[\u3002.!！?？]+$/g, "")
        .replace(/\s*\u7684\s*/g, " ")
        .trim();
    }
  }

  return "";
}

function matchIntent(message = "") {
  const text = String(message).trim();
  const lower = text.toLowerCase();

  if (!text) return { type: "empty" };
  if (/^(hi|hello|hey|\u4f60\u597d|\u55e8|\u54c8\u55bd|浣犲ソ)$/i.test(text)) return { type: "hello" };
  if (/(\u73b0\u5728|\u5f53\u524d|\u6b63\u5728).*(\u64ad\u653e|\u542c)|now playing|what.*playing|鐜板湪.*鎾/i.test(lower)) return { type: "now" };
  if (/(\u6682\u505c|pause|\u5148\u505c|\u505c\u4e00\u4e0b)/i.test(lower)) return { type: "pause" };
  if (/^(\u7ee7\u7eed|resume|\u64ad\u653e|play|\u5f00\u59cb|\u63a5\u7740\u653e)$/i.test(text)) return { type: "play" };
  if (/(\u4e0b\u4e00\u9996|next|\u5207\u6b4c|涓嬩竴)/i.test(lower)) return { type: "next" };
  if (/(\u4e0a\u4e00\u9996|prev|previous)/i.test(lower)) return { type: "prev" };
  if (/(\u5929\u6c14|weather|\u6e29\u5ea6|\u4e0b\u96e8|\u4e0b\u96ea|\u6674\u5929|\u9634\u5929|\u591a\u4e91|\u51b7|\u70ed)/i.test(lower)) return { type: "weather" };
  if (/(\u7248\u6743|locked|lock|\u4e0d\u53ef\u64ad|\u4e0d\u80fd\u64ad|unavailable|鐗堟潈)/i.test(lower)) return { type: "copyright" };
  if (/(\u5931\u8d25|failed|fail|why.*fail|\u8bca\u65ad|\u539f\u56e0|error|\u9519\u8bef)/i.test(lower)) return { type: "diagnostics" };

  const query = extractSongRequest(text);
  if (query) return { type: "song-request", query };
  if (/(\u63a8\u8350|recommend|surprise|\u6362\u4e2a|\u6362\u4e00\u9996|\u5176\u4ed6|\u522b\u7684|\u968f\u4fbf|\u518d\u6765|\u4eca\u5929.*\u9002\u5408)/i.test(lower)) return { type: "recommend" };

  return { type: "brain" };
}

function summarizeBlockedSongs(store) {
  const blockedSongs = store?.get?.().blockedSongs ?? [];
  if (!blockedSongs.length) return "\u76ee\u524d\u8fd8\u6ca1\u6709\u8bb0\u5f55\u5230\u64ad\u653e\u5931\u8d25\u7684\u6b4c\u66f2\u3002";
  return blockedSongs
    .slice(-5)
    .reverse()
    .map((song) => `${song.title || "\u672a\u77e5\u6b4c\u66f2"}: ${song.reason || "\u672a\u77e5\u539f\u56e0"}`)
    .join("; ");
}

async function buildChatPersonalization(music, store) {
  const storeState = store?.get?.() ?? {};
  const [now, playlists, queue] = await Promise.all([
    music.getNow ? music.getNow().catch(() => null) : Promise.resolve(null),
    music.getPlaylists ? music.getPlaylists().catch(() => []) : Promise.resolve([]),
    music.getNext ? music.getNext().catch(() => []) : Promise.resolve([]),
  ]);

  return buildPersonalizationSnapshot({
    storeState,
    playlists: playlists ?? [],
    queue: queue ?? [],
    now,
    date: new Date(),
  });
}

function trackLabel(track = {}) {
  return [track.title, track.artist].filter(Boolean).join(" - ") || "\u8fd9\u9996\u6b4c";
}

function isSameTrack(left = {}, right = {}) {
  const leftId = String(left.originalId || left.encryptedId || left.id || "");
  const rightId = String(right.originalId || right.encryptedId || right.id || "");
  if (leftId && rightId && leftId === rightId) return true;
  const leftTitle = String(left.title || "").trim().toLowerCase();
  const rightTitle = String(right.title || "").trim().toLowerCase();
  const leftArtist = String(left.artist || "").trim().toLowerCase();
  const rightArtist = String(right.artist || "").trim().toLowerCase();
  return Boolean(leftTitle && rightTitle && leftArtist && rightArtist && leftTitle === rightTitle && leftArtist === rightArtist);
}

function buildRecommendationReply(track = {}, scene = {}) {
  const sceneText = scene?.summary ? `现在是${scene.summary}，` : "";
  return `${sceneText}我给你换一首更适合放松听的：${trackLabel(track)}。`;
}

async function findAlternativeRecommendation(music, snapshot, store) {
  const nowTrack = snapshot?.now?.track || {};
  const storeState = store?.get?.() ?? {};
  const plays = storeState.plays ?? [];

  // Collect recent titles to AVOID recommending them
  const recentTitles = new Set(
    plays.slice(-30).map((p) => String(p.title || "").toLowerCase().trim()).filter(Boolean)
  );
  if (nowTrack.title) recentTitles.add(nowTrack.title.toLowerCase().trim());

  const scene = snapshot?.scene || {};

  const queryPools = {
    "late-night": ["夜曲 周杰伦", "someone like you adele", "夜的钢琴曲", "张学友 吻别", "Coldplay Fix You", "Adele Rolling in the Deep"],
    "morning": ["早安 轻音乐", "walking on sunshine", "Bruno Mars Count on Me", "Taylor Swift Shake It Off", "孙燕姿 遇见"],
    "daytime": ["周杰伦 稻香", "Imagine Dragons Believer", "陈奕迅 十年", "Ed Sheeran Shape of You", "林俊杰 可惜没如果", "Maroon 5 Sugar"],
    "evening": ["邓紫棋 光年之外", "The Weeknd Blinding Lights", "薛之谦 演员", "Dua Lipa Levitating", "李荣浩 李白", "Post Malone Circles"],
    "night": ["Sia Unstoppable", "毛不易 消愁", "Billie Eilish Ocean Eyes", "赵雷 成都", "Lauv I Like Me Better", "王菲 红豆"],
  };

  const moodBonus = {
    "tired": ["轻音乐 放松", "Norah Jones Don't Know Why", "钢琴曲 安静"],
    "bright": ["happy hits", "欢快 流行", "Pharrell Happy", "Carly Rae Jepsen"],
    "soft": ["治愈 温暖", "James Blunt You're Beautiful", "许嵩 清明雨上", "Cigarettes After Sex"],
  };

  const timeQueries = queryPools[scene.timeBlock] || queryPools["evening"];
  const moodQueries = moodBonus[scene.mood] || [];

  // Shuffle and pick 3 diverse queries
  const allQueries = [...timeQueries, ...moodQueries];
  for (let i = allQueries.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allQueries[i], allQueries[j]] = [allQueries[j], allQueries[i]];
  }
  const selectedQueries = allQueries.slice(0, 3);

  for (const query of selectedQueries) {
    const songs = await music?.search?.(query, 10).catch(() => []);
    const candidates = (songs || []).filter((song) => {
      if (!song?.title) return false;
      if (song.canPlay === false) return false;
      return !recentTitles.has(song.title.toLowerCase().trim());
    });
    if (candidates.length) {
      const pick = candidates[Math.min(Math.floor(Math.random() * 5), candidates.length - 1)];
      return {
        ...pick,
        reason: `从「${query}」发现的新歌，适合${scene.summary || "现在"}的氛围。`,
        score: pick.matchScore || 75,
      };
    }
  }

  return snapshot?.recommendation || null;
}

async function playSongRequest(query, music) {
  if (!music?.play) {
    return { reply: "\u97f3\u4e50\u670d\u52a1\u8fd8\u6ca1\u51c6\u5907\u597d\u3002", actions: [] };
  }

  const result = await music.play({ query }).catch((error) => ({
    success: false,
    message: error.message || "Playback request failed",
  }));
  const track = result?.track || null;

  if (result?.success === false) {
    return {
      reply: track
        ? `\u6211\u627e\u5230\u4e86 ${trackLabel(track)}\uff0c\u4f46\u73b0\u5728\u62ff\u4e0d\u5230\u53ef\u64ad\u653e\u5730\u5740: ${result.message || track.blockedReason || "unknown"}`
        : `\u6211\u6ca1\u80fd\u64ad\u653e "${query}": ${result?.message || "no playable result"}`,
      actions: ["play"],
      executedActions: ["play"],
      recommendation: track,
    };
  }

  return {
    reply: track ? `\u6b63\u5728\u64ad\u653e: ${trackLabel(track)}\u3002` : `\u6b63\u5728\u5c1d\u8bd5\u64ad\u653e "${query}"\u3002`,
    actions: ["play"],
    executedActions: ["play"],
    recommendation: track,
  };
}

async function runLocalIntent(intent, message, music, store) {
  switch (intent.type) {
    case "empty":
      return { reply: ZH.empty, actions: [] };
    case "hello":
      return { reply: ZH.hello, actions: [] };
    case "song-request":
      return playSongRequest(intent.query, music);
    case "now": {
      const now = await music.getNow?.().catch(() => null);
      const track = now?.track;
      return {
        reply: track?.title
          ? `\u73b0\u5728\u662f ${track.title}${track.artist ? ` - ${track.artist}` : ""}\uff0c\u72b6\u6001: ${track.status || "unknown"}\u3002`
          : "\u73b0\u5728\u8fd8\u6ca1\u6709\u5f53\u524d\u64ad\u653e\u6b4c\u66f2\u3002",
        actions: ["now"],
      };
    }
    case "weather":
      return { reply: "\u5929\u6c14\u529f\u80fd\u5148\u653e\u5728\u540e\u9762\uff0c\u6211\u4eec\u5148\u542c\u4e00\u4f1a\u513f\u6b4c\u3002", actions: [] };
    case "pause": {
      const status = await music.status?.().catch(() => null);
      if (status?.state?.status === "playing") {
        await music.toggle?.().catch(() => null);
        return { reply: "\u5df2\u6682\u505c\u3002", actions: ["pause"], executedActions: ["pause"] };
      }
      return { reply: "\u73b0\u5728\u770b\u8d77\u6765\u5df2\u7ecf\u4e0d\u662f\u64ad\u653e\u4e2d\u3002", actions: [] };
    }
    case "play": {
      const result = await music.toggle?.().catch((error) => ({ success: false, message: error.message }));
      return {
        reply: result?.success === false ? `\u64ad\u653e\u5931\u8d25: ${result.message || "unknown"}` : "\u7ee7\u7eed\u64ad\u653e\u3002",
        actions: ["play"],
        executedActions: result?.success === false ? [] : ["play"],
        recommendation: result?.track || null,
      };
    }
    case "next":
      await music.next?.().catch(() => null);
      return { reply: "\u5207\u5230\u4e0b\u4e00\u9996\u3002", actions: ["next"], executedActions: ["next"] };
    case "prev":
      await music.prev?.().catch(() => null);
      return { reply: "\u56de\u5230\u4e0a\u4e00\u9996\u3002", actions: ["prev"], executedActions: ["prev"] };
    case "copyright":
      return {
        reply: "\u8fd9\u4e9b locked \u901a\u5e38\u662f\u7248\u6743\u3001VIP\u3001\u5730\u533a\u6216\u8d26\u53f7\u6743\u9650\u9650\u5236\u3002Claudio \u4f1a\u663e\u793a\u6b63\u786e\u6b4c\u66f2\uff0c\u4f46\u62ff\u4e0d\u5230\u64ad\u653e\u5730\u5740\u65f6\u4e0d\u4f1a\u5047\u88c5\u64ad\u6210\u529f\u3002",
        actions: [],
      };
    case "diagnostics":
      return { reply: `\u6700\u8fd1\u7684\u64ad\u653e\u5931\u8d25\u8bb0\u5f55: ${summarizeBlockedSongs(store)}`, actions: ["diagnostics"] };
    case "recommend": {
      const snapshot = await buildChatPersonalization(music, store).catch(() => null);
      const pick = await findAlternativeRecommendation(music, snapshot, store).catch(() => snapshot?.recommendation);
      // If personalization has a pick, return it as recommendation card.
      // Otherwise, build a quick recommendation from recent plays or defaults.
      if (pick?.title) {
        return {
          reply: buildRecommendationReply(pick, snapshot?.scene),
          actions: ["recommend"],
          recommendation: pick,
          segue: pick.reason || "",
        };
      }
      // Fallback: suggest something from play history or hardcoded safe picks
      const storeState = store?.get?.() ?? {};
      const plays = storeState.plays ?? [];
      if (plays.length > 3) {
        // Pick a random past play they might want to hear again
        const idx = Math.floor(Math.random() * Math.min(plays.length, 20));
        const pastPlay = plays[plays.length - 1 - idx];
        if (pastPlay?.title) {
          return {
            reply: `\u6839\u636e\u4f60\u4e4b\u524d\u7684\u64ad\u653e\u8bb0\u5f55\uff0c\u518d\u6765\u4e00\u9996 ${pastPlay.title}${pastPlay.artist ? ` - ${pastPlay.artist}` : ""} \u600e\u4e48\u6837\uff1f`,
            actions: ["recommend"],
            recommendation: { title: pastPlay.title, artist: pastPlay.artist || "", reason: "from your history" },
          };
        }
      }
      return {
        reply: "\u4f60\u53ef\u4ee5\u7528 /play \u6b4c\u540d \u76f4\u63a5\u64ad\u653e\u4efb\u4f55\u6b4c\uff0c\u6bd4\u5982 /play \u6674\u5929\u3001/play lofi chill\u3002\u542c\u51e0\u9996\u4e4b\u540e\u6211\u5c31\u80fd\u7ed9\u4f60\u66f4\u597d\u7684\u63a8\u8350\u4e86\u3002",
        actions: [],
        recommendation: null,
      };
    }
    default:
      return null;
  }
}

async function executeBrainActions(actions = [], music) {
  const executed = [];
  for (const action of actions) {
    const name = typeof action === "string" ? action : action?.type || action?.name;
    if (name === "next" && music.next) {
      await music.next().catch(() => null);
      executed.push("next");
    }
    if ((name === "prev" || name === "previous") && music.prev) {
      await music.prev().catch(() => null);
      executed.push("prev");
    }
    if ((name === "pause" || name === "play" || name === "resume" || name === "toggle") && music.toggle) {
      await music.toggle().catch(() => null);
      executed.push(name);
    }
  }
  return executed;
}

async function processChatMessage({ message, music, brain, store, weatherConfig } = {}) {
  const intent = matchIntent(message);
  store?.appendMessage("user", message, { intent: intent.type, query: intent.query || "" });

  let reply = null;
  if (intent.type !== "brain") {
    reply = await runLocalIntent(intent, message, music, store);
  }

  if (!reply && brain?.ask && brain?.tools) {
    try {
      const context = await buildFullContext({ music, store, weatherConfig }).catch(() => null);
      if (context) {
        const brainResult = await brain.ask(message, { context, tools: brain.tools, executeTool: brain.executeTool });
        if (brainResult) {
          reply = {
            reply: brainResult.reply || "",
            actions: brainResult.actions || [],
            recommendation: brainResult.recommendation || null,
          };
        }
      }
    } catch {
      reply = null;
    }
  }

  if (!reply && brain?.ask) {
    try {
      const context = await buildChatPersonalization(music, store).catch(() => null);
      const brainResult = await brain.ask(message, { context });
      if (brainResult) {
        reply = {
          reply: brainResult.reply || "",
          actions: brainResult.actions || [],
          recommendation: brainResult.recommendation || null,
        };
      }
    } catch {
      reply = null;
    }
  }

  if (!reply) reply = { reply: ZH.fallback, actions: [] };

  const alreadyExecuted = Array.isArray(reply.executedActions) ? reply.executedActions : [];
  const executedActions = alreadyExecuted.length ? alreadyExecuted : await executeBrainActions(reply.actions ?? [], music);
  const finalReply = { ...reply, executedActions };

  store?.appendMessage("assistant", finalReply.reply, {
    intent: intent.type,
    query: intent.query || "",
    actions: finalReply.actions ?? [],
    executedActions,
  });

  if (finalReply.recommendation) finalReply._recommendation = finalReply.recommendation;
  return finalReply;
}

module.exports = {
  executeBrainActions,
  extractSongRequest,
  handleChat: processChatMessage,
  processChatMessage,
  matchIntent,
  runLocalIntent,
};
