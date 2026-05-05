// LRClib lyrics provider — https://lrclib.net
//
// Free, open lyrics database with synced LRC support. No auth, no API key,
// no scary quotas. Returns timed lyrics that the frontend can render as a
// scrolling transcript.

const { parseTimedLyrics } = require("../../../script.js");

const BASE_URL = "https://lrclib.net/api";
// Per-request timeout. LRClib /api/get can be slow (~5s); /api/search is faster.
// We give each individual call a generous budget and let the overall lookup
// take as long as needed across multiple candidates.
const PER_REQUEST_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 200;

const cache = new Map();

function stripNoise(raw) {
  // Drops decorative junk but PRESERVES the artist/title separators (- — | etc.)
  // so splitArtistAndTitle can find them.
  if (!raw) return "";
  return String(raw)
    .replace(/【[^】]*】/g, " ")
    .replace(/「[^」]*」/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(
      /official\s*(music\s*)?(video|audio|mv|lyric[s]?\s*video|m\/v)?/gi,
      " "
    )
    .replace(/\b(hd|hq|4k|1080p|720p|remaster(ed)?)\b/gi, " ")
    .replace(/官方|高清|歌词版|MV版?/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanForSearch(raw) {
  // Final cleanup that also removes separators — used after splitting.
  return stripNoise(raw)
    .replace(/[-–—|·]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Detect mixed CJK + Latin content (e.g. "晴天 Sunny Day") and return the
// CJK-only portion. Returns the input unchanged if it's not mixed.
function stripLatinIfMixed(s) {
  if (!s) return "";
  const hasCjk = /[一-鿿぀-ヿ가-힯]/.test(s);
  const hasLatin = /[A-Za-z]/.test(s);
  if (!hasCjk || !hasLatin) return s;
  // Drop runs of Latin letters and the spaces around them.
  return s
    .replace(/[A-Za-z][A-Za-z'\s]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitArtistAndTitle(rawTitle, fallbackArtist) {
  if (!rawTitle) {
    return { artist: cleanForSearch(fallbackArtist || ""), title: "" };
  }
  const raw = String(rawTitle).trim();

  // Pattern A — CJK bracket: "Artist 【Title ...】..." or "Artist 「Title」"
  // The bracketed segment is the song title; everything before it is the artist.
  const cjkMatch = raw.match(/^(.+?)\s*[【「](.+?)[】」]/);
  if (cjkMatch) {
    return {
      artist: cleanForSearch(cjkMatch[1]),
      title: cleanForSearch(cjkMatch[2]),
    };
  }

  // Pattern B — dashed: "Artist - Title" / "Artist – Title (Official Video)"
  const stripped = stripNoise(raw);
  const parts = stripped.split(/\s+[-–—|]\s+/);
  if (parts.length >= 2) {
    const left = cleanForSearch(parts[0]);
    const right = cleanForSearch(parts.slice(1).join(" "));
    const fallback = cleanForSearch(fallbackArtist || "").toLowerCase();
    // If the fallback artist appears on the right side, the artist/title got
    // swapped relative to the usual convention.
    if (fallback && right.toLowerCase().includes(fallback)) {
      return { artist: right, title: left };
    }
    return { artist: left, title: right };
  }

  return {
    artist: cleanForSearch(fallbackArtist) || "",
    title: cleanForSearch(rawTitle),
  };
}

function cacheKey(parts) {
  return JSON.stringify(parts).toLowerCase();
}

function rememberCache(key, value) {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

function lookupCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  cache.delete(key);
  cache.set(key, entry);
  return entry.value;
}

async function fetchJson(url) {
  // Each call gets its own AbortController so a slow first request doesn't
  // poison subsequent ones.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PER_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Claudio/0.1 (https://github.com/local)",
        Accept: "application/json",
      },
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`LRClib HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function exactMatch({ title, artist, duration }) {
  if (!title) return null;
  const params = new URLSearchParams({ track_name: title });
  if (artist) params.set("artist_name", artist);
  if (duration && Number.isFinite(duration) && duration > 0) {
    params.set("duration", String(Math.round(duration)));
  }
  return fetchJson(`${BASE_URL}/get?${params.toString()}`);
}

async function fuzzySearch({ title, artist }) {
  const q = [title, artist].filter(Boolean).join(" ").trim();
  if (!q) return null;
  const params = new URLSearchParams({ q });
  const list = await fetchJson(`${BASE_URL}/search?${params.toString()}`);
  if (!Array.isArray(list) || list.length === 0) return null;
  // Prefer entries with synced lyrics
  const synced = list.find((item) => item && item.syncedLyrics);
  return synced || list[0];
}

function pickLyricText(payload) {
  if (!payload) return "";
  if (payload.syncedLyrics && payload.syncedLyrics.trim()) return payload.syncedLyrics;
  if (payload.plainLyrics && payload.plainLyrics.trim()) return payload.plainLyrics;
  return "";
}

/**
 * Resolve lyrics for a track. Tries an exact match first (artist/title/duration),
 * falls back to fuzzy search. Returns parsed transcript ([{time, text}]) plus
 * the raw payload metadata for debugging.
 */
async function fetchTranscript({ title, artist, duration } = {}) {
  if (!title) return { transcript: [], source: null, matched: null };

  // Derive better artist/title using common heuristics, but try multiple
  // candidate combos because YouTube titles are messy.
  const split = splitArtistAndTitle(title, artist);

  const candidates = [];
  function pushCandidate(c) {
    if (!c || !c.title) return;
    const key = (c.title + "|" + (c.artist || "")).trim();
    if (candidates.some((existing) => (existing.title + "|" + (existing.artist || "")).trim() === key)) return;
    candidates.push(c);
  }

  pushCandidate({ title: split.title, artist: split.artist });
  // For bilingual CJK content like "晴天 Sunny Day" / "周杰倫 Jay Chou", LRClib
  // indexes the CJK form. Add a pure-CJK variant to widen the funnel.
  const cjkOnlyTitle = stripLatinIfMixed(split.title);
  const cjkOnlyArtist = stripLatinIfMixed(split.artist);
  if (cjkOnlyTitle !== split.title || cjkOnlyArtist !== split.artist) {
    pushCandidate({ title: cjkOnlyTitle, artist: cjkOnlyArtist });
    pushCandidate({ title: cjkOnlyTitle, artist: "" });
  }
  pushCandidate({ title: cleanForSearch(title), artist: cleanForSearch(artist) });
  pushCandidate({ title: cleanForSearch(title), artist: "" });

  const cacheHash = cacheKey({ candidates, duration: Math.round(duration || 0) });
  const cached = lookupCache(cacheHash);
  if (cached !== null) return cached;

  // Run an exact-match (cheap when it hits) for the cleanest candidate, plus
  // a fuzzy search for every candidate, all in parallel. First hit with usable
  // lyrics wins. Total latency ≈ single slowest network round-trip.
  const probes = [
    exactMatch({ ...candidates[0], duration }).catch(() => null),
    ...candidates.map((c) => fuzzySearch(c).catch(() => null)),
  ];

  const results = await Promise.all(probes);
  const matched = results.find((r) => r && pickLyricText(r)) || null;

  const lrcText = pickLyricText(matched);
  const transcript = lrcText ? parseTimedLyrics(lrcText) : [];
  const result = {
    transcript,
    source: matched ? "lrclib" : null,
    matched: matched
      ? {
          id: matched.id,
          title: matched.trackName,
          artist: matched.artistName,
          duration: matched.duration,
          instrumental: Boolean(matched.instrumental),
          synced: Boolean(matched.syncedLyrics),
        }
      : null,
  };
  rememberCache(cacheHash, result);
  return result;
}

module.exports = {
  fetchTranscript,
  __internal: { cleanForSearch, splitArtistAndTitle, pickLyricText, cache },
};
