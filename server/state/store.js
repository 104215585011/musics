const fs = require("node:fs");
const path = require("node:path");

function createDefaultStore() {
  const state = {
    version: 1,
    messages: [],
    plays: [],
    blockedSongs: [],
    updatedAt: new Date(0).toISOString(),
  };
  Object.defineProperty(state, "favorites", {
    value: [],
    writable: true,
    enumerable: false,
    configurable: true,
  });
  return state;
}

function readStore(filePath) {
  if (!fs.existsSync(filePath)) {
    return createDefaultStore();
  }

  try {
    return Object.assign(createDefaultStore(), JSON.parse(fs.readFileSync(filePath, "utf8")));
  } catch {
    return createDefaultStore();
  }
}

function createPersistentStore(filePath = path.join(process.cwd(), "server", "state", "store.json")) {
  let state = readStore(filePath);
  let _persistTimer = null;

  function doPersist() {
    state.updatedAt = new Date().toISOString();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmpPath = filePath + ".tmp";
    fs.writeFileSync(tmpPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    try {
      fs.renameSync(tmpPath, filePath);
    } catch (_e) {
      fs.copyFileSync(tmpPath, filePath);
      try { fs.unlinkSync(tmpPath); } catch (_) {}
    }
  }

  function persist() {
    if (_persistTimer) clearTimeout(_persistTimer);
    _persistTimer = setTimeout(() => {
      _persistTimer = null;
      doPersist();
    }, 500);
  }

  function keepRecent(items, limit) {
    return items.slice(Math.max(0, items.length - limit));
  }

  return {
    get() {
      return state;
    },
    flushSync() {
      if (_persistTimer) { clearTimeout(_persistTimer); _persistTimer = null; }
      doPersist();
    },
    appendMessage(role, text, meta = {}) {
      state.messages.push({
        role,
        text: String(text ?? ""),
        meta,
        at: new Date().toISOString(),
      });
      state.messages = keepRecent(state.messages, 80);
      persist();
    },
    recordPlay(track = {}) {
      if (!track.title && !track.id && !track.query) {
        return;
      }
      state.plays.push({
        id: track.id ?? "",
        originalId: track.originalId ?? "",
        title: track.title ?? "",
        artist: track.artist ?? "",
        album: track.album ?? "",
        query: track.query ?? "",
        source: track.source ?? "unknown",
        at: new Date().toISOString(),
      });
      state.plays = keepRecent(state.plays, 200);
      persist();
    },
    recordBlockedSong(track = {}, reason = "") {
      if (!track.title && !track.id) {
        return;
      }
      state.blockedSongs.push({
        id: track.id ?? track.encryptedId ?? "",
        originalId: track.originalId ?? "",
        title: track.title ?? "",
        artist: track.artist ?? "",
        reason,
        at: new Date().toISOString(),
      });
      state.blockedSongs = keepRecent(state.blockedSongs, 120);
      persist();
    },
    addFavorite(track = {}) {
      if (!track.title && !track.query) return false;
      const key = (track.query || track.title || "").toLowerCase().trim();
      const exists = state.favorites.some(
        (f) => (f.query || f.title || "").toLowerCase().trim() === key
      );
      if (exists) return false;
      state.favorites.push({
        query: track.query || track.title || "",
        title: track.title || track.query || "",
        artist: track.artist || "",
        album: track.album || "",
        videoId: track.videoId || "",
        duration: track.duration || 0,
        addedAt: new Date().toISOString(),
      });
      state.favorites = keepRecent(state.favorites, 200);
      persist();
      return true;
    },
    removeFavorite(query) {
      const key = (query || "").toLowerCase().trim();
      const before = state.favorites.length;
      state.favorites = state.favorites.filter(
        (f) => (f.query || f.title || "").toLowerCase().trim() !== key
      );
      if (state.favorites.length !== before) {
        persist();
        return true;
      }
      return false;
    },
    getFavorites() {
      return (state.favorites || []).slice().reverse();
    },
    saveCookie(cookie) {
      if (!cookie) return;
      state.neteaseCookie = String(cookie);
      persist();
    },
    getCookie() {
      return state.neteaseCookie || "";
    },
    clearCookie() {
      state.neteaseCookie = "";
      persist();
    },
    getBlockedSongIds() {
      return new Set(
        state.blockedSongs
          .flatMap((song) => [song.id, song.originalId])
          .filter(Boolean)
          .map(String)
      );
    },
    getBlockedSongMap() {
      const map = new Map();
      state.blockedSongs.forEach((song) => {
        const reason = song.reason || "previous play attempt failed";
        [song.id, song.originalId].filter(Boolean).forEach((id) => {
          map.set(String(id), reason);
        });
      });
      return map;
    },
  };
}

module.exports = {
  createDefaultStore,
  createPersistentStore,
};
