const { inferScene, buildTasteProfile, buildRadioPlan } = require("./personalization.js");
const { getWeatherCondition, getCachedWeather } = require("./weather.js");

function getTimeContext(date = new Date()) {
  const hour = date.getHours();
  const dayOfWeek = date.getDay(); // 0=Sunday
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  const period =
    hour < 6 ? "late-night" :
    hour < 9 ? "early-morning" :
    hour < 12 ? "morning" :
    hour < 14 ? "afternoon" :
    hour < 18 ? "afternoon" :
    hour < 22 ? "evening" :
    "night";

  return { hour, dayOfWeek, isWeekend, period };
}

async function buildFullContext({ music, store, weatherConfig } = {}) {
  const [storeState, now, playlists, queue] = await Promise.all([
    store?.get?.() ?? Promise.resolve({}),
    music?.getNow?.().catch(() => null) ?? null,
    music?.getPlaylists?.().catch(() => []) ?? [],
    music?.getNext?.().catch(() => []) ?? [],
  ]);

  const messages = Array.isArray(storeState.messages) ? storeState.messages : [];
  const plays = Array.isArray(storeState.plays) ? storeState.plays : [];

  const date = new Date();
  const scene = inferScene({ now: date, messages });
  const time = getTimeContext(date);
  const profile = buildTasteProfile({ storeState, playlists, now });
  const plan = buildRadioPlan(profile, scene);

  // Best-effort weather
  let weather = null;
  try {
    const rawWeather = await getCachedWeather(weatherConfig ?? {});
    if (rawWeather) {
      weather = getWeatherCondition(rawWeather);
    }
  } catch {
    weather = null;
  }

  const recentTrackIds = new Set(
    plays.slice(0, 20).map((p) => String(p.id || p.originalId || ""))
  );

  // Best-effort user persona files
  let userFiles = {};
  try {
    const { readAllUserFiles } = require("./user-files.js");
    userFiles = readAllUserFiles();
  } catch (_) { /* user files are optional */ }

  let userPlaylistAnnotations = {};
  try {
    if (userFiles["playlists.json"]) {
      const parsed = JSON.parse(userFiles["playlists.json"]);
      userPlaylistAnnotations = parsed?.annotations ?? parsed ?? {};
    }
  } catch (_) { /* ignore parse errors */ }

  return {
    now: now?.track
      ? {
          id: now.track.id ?? "",
          title: now.track.title ?? "",
          artist: now.track.artist ?? "",
          album: now.track.album ?? "",
          duration: now.track.duration ?? 0,
          position: now.track.position ?? 0,
          status: now.track.status ?? "stopped",
          coverUrl: now.track.coverUrl ?? "",
          source: now.track.source ?? "",
        }
      : null,
    scene,
    time,
    weather,
    taste: profile,
    playlists: (Array.isArray(playlists) ? playlists : []).slice(0, 20).map((p) => ({
      title: p.title ?? "",
      trackCount: p.trackCount ?? 0,
      encryptedId: p.encryptedId ?? "",
      selected: Boolean(p.selected),
    })),
    queue: (Array.isArray(queue) ? queue : []).slice(0, 30).map((item) => ({
      title: item.title ?? item.name ?? "",
      artist: item.artist ?? "",
      album: item.album ?? "",
      encryptedId: item.encryptedId ?? item.id ?? "",
      canPlay: item.canPlay !== false,
      blockedReason: item.blockedReason ?? "",
      current: Boolean(item.current),
    })),
    history: {
      recentPlays: plays.slice(0, 10),
      recentTrackIds: [...recentTrackIds],
      blockedSongs: (Array.isArray(storeState.blockedSongs) ? storeState.blockedSongs : []).slice(-5),
    },
    plan,
    storeState,
    userTaste: userFiles["taste.md"] || "",
    userRoutines: userFiles["routines.md"] || "",
    userMoodRules: userFiles["mood-rules.md"] || "",
    userPlaylistAnnotations,
  };
}

module.exports = {
  buildFullContext,
  getTimeContext,
};
