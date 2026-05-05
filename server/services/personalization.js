function countBy(items, pick) {
  const map = new Map();
  items.forEach((item) => {
    const key = String(pick(item) ?? "").trim();
    if (!key) return;
    map.set(key, (map.get(key) ?? 0) + 1);
  });
  return [...map.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([name, count]) => ({ name, count }));
}

function inferScene({ now = new Date(), messages = [] } = {}) {
  const hour = now.getHours();
  const recentText = messages
    .slice(-8)
    .map((message) => message.text ?? "")
    .join(" ")
    .toLowerCase();

  const timeBlock =
    hour < 6 ? "late-night" :
    hour < 11 ? "morning" :
    hour < 18 ? "daytime" :
    hour < 22 ? "evening" :
    "night";

  const mood =
    /(累|疲|困|tired|exhausted)/.test(recentText) ? "tired" :
    /(开心|高兴|happy|excited)/.test(recentText) ? "bright" :
    /(难过|焦虑|sad|anxious)/.test(recentText) ? "soft" :
    "steady";

  const activity =
    /(代码|coding|code|工作|study|学习|写)/.test(recentText) ? "coding" :
    /(放松|休息|relax|chill)/.test(recentText) ? "rest" :
    /(跑步|运动|workout|run)/.test(recentText) ? "move" :
    "listening";

  return {
    timeBlock,
    mood,
    activity,
    summary: `${timeBlock} · ${mood} · ${activity}`,
  };
}

function buildTasteProfile({ storeState = {}, playlists = [], now = null } = {}) {
  const plays = Array.isArray(storeState.plays) ? storeState.plays : [];
  const messages = Array.isArray(storeState.messages) ? storeState.messages : [];
  const topArtists = countBy(plays, (play) => play.artist).slice(0, 5);
  const topAlbums = countBy(plays, (play) => play.album).slice(0, 4);
  const selectedPlaylist = playlists.find((playlist) => playlist.selected) ?? playlists[0] ?? null;

  const tags = [
    selectedPlaylist?.title,
    topArtists[0]?.name,
    now?.track?.artist,
    messages.some((message) => /(代码|coding|工作|学习)/.test(String(message.text ?? ""))) ? "focus" : "",
    "local memory",
  ].filter(Boolean).slice(0, 5);

  const recentTrackIds = new Set(
    plays.slice(0, 20).map((p) => String(p.id || p.originalId || ""))
  );

  return {
    tags,
    topArtists,
    topAlbums,
    selectedPlaylist: selectedPlaylist
      ? {
          title: selectedPlaylist.title,
          trackCount: selectedPlaylist.trackCount,
        }
      : null,
    memoryDepth: {
      plays: plays.length,
      messages: messages.length,
      blocked: Array.isArray(storeState.blockedSongs) ? storeState.blockedSongs.length : 0,
    },
    recentTrackIds: [...recentTrackIds],
  };
}

function buildRadioPlan(profile, scene) {
  const anchor = profile.selectedPlaylist?.title || profile.tags[0] || "liked music";
  const focusLabel =
    scene.activity === "coding" ? "Low-lyric focus block" :
    scene.activity === "rest" ? "Soft landing block" :
    scene.activity === "move" ? "Momentum block" :
    "Taste anchor block";

  return {
    items: [
      { time: "now", label: `${focusLabel} from ${anchor}` },
      { time: "+20", label: `Keep ${scene.mood} energy, avoid recent failed tracks` },
      { time: "+45", label: `Open up with ${profile.topArtists[0]?.name || "a familiar artist"}` },
    ],
  };
}

function pickRecommendation({ queue = [], profile, scene }) {
  const items = Array.isArray(queue) ? queue : [];
  const recentIds = new Set(profile?.recentTrackIds ?? []);

  const scored = items
    .filter((item) => item && item.canPlay !== false && !item.blockedReason)
    .map((item) => {
      let score = 50;

      // Freshness
      if (recentIds.has(String(item.encryptedId ?? item.id ?? ""))) {
        score -= 25;
      }

      // Artist preference
      const topArtists = profile?.topArtists ?? [];
      if (topArtists.some((a) => item.artist?.toLowerCase().includes(a.name?.toLowerCase() ?? ""))) {
        score += 15;
      }

      // Available
      if (item.canPlay) score += 10;

      return { item, score: Math.max(0, score) };
    })
    .sort((a, b) => b.score - a.score);

  const candidate = scored[0]?.item ?? null;

  if (!candidate) {
    return {
      title: "",
      artist: "",
      reason: `No clearly playable queue item yet. Use ${profile?.selectedPlaylist?.title || "Profile"} with Hide locked / Hide failed.`,
    };
  }

  return {
    title: candidate.title,
    artist: candidate.artist || "",
    album: candidate.album || "",
    encryptedId: candidate.encryptedId || candidate.id || "",
    originalId: candidate.originalId || candidate.encryptedId || candidate.id || "",
    duration: candidate.duration || 0,
    reason: `Fits ${scene?.summary ?? "current scene"}; scored ${scored[0]?.score ?? 50}/100 based on freshness and preference.`,
  };
}

function buildPersonalizationSnapshot({
  storeState = {},
  playlists = [],
  queue = [],
  now = null,
  date = new Date(),
} = {}) {
  const messages = Array.isArray(storeState.messages) ? storeState.messages : [];
  const scene = inferScene({ now: date, messages });
  const profile = buildTasteProfile({ storeState, playlists, now });
  const plan = buildRadioPlan(profile, scene);
  const recommendation = pickRecommendation({ queue, profile, scene });

  return {
    profile,
    scene,
    plan,
    recommendation,
  };
}

module.exports = {
  buildPersonalizationSnapshot,
  buildRadioPlan,
  buildTasteProfile,
  inferScene,
  pickRecommendation,
};
