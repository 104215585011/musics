// yt-dlp music provider — search YouTube/YouTube Music and resolve a direct
// audio URL the browser <audio> element can stream from.
//
// Intentionally tiny: shells out to the `yt-dlp` binary, parses one
// tab-delimited line per result, caches resolved URLs by normalized query
// until their CDN expiry.

const { spawn } = require("node:child_process");
const path = require("node:path");

const COMMAND = process.env.YTDLP_COMMAND || "yt-dlp";
const FORMAT = "bestaudio[ext=m4a]/bestaudio";
// Tab-separated print template — order is fixed and explicit so we can split.
const PRINT_TEMPLATE = "%(title)s\t%(uploader)s\t%(duration)s\t%(id)s\t%(webpage_url)s\t%(url)s";

const DEFAULT_TIMEOUT_MS = 25_000;
// CDN URLs typically last ~6h; refresh slightly earlier so playback doesn't
// die mid-track.
const REFRESH_BUFFER_MS = 5 * 60_000;
const MAX_CACHE_ENTRIES = 200;

const cache = new Map(); // normalizedKey -> { resolvedAt, expiresAt, ...track }

function normalizeKey(input) {
  return String(input ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function parseExpiryFromUrl(url) {
  if (!url) return 0;
  const match = url.match(/[?&]expire=(\d+)/);
  if (!match) return 0;
  return Number(match[1]) * 1000;
}

function rememberInCache(key, payload) {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    // Drop the oldest entry (first key in insertion order).
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, payload);
}

function lookupCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt && entry.expiresAt - REFRESH_BUFFER_MS <= Date.now()) {
    cache.delete(key);
    return null;
  }
  // Bump recency.
  cache.delete(key);
  cache.set(key, entry);
  return entry;
}

function runYtDlp(args, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    // Crucially we DO NOT use shell: true — on Windows, `%` and spaces inside
    // the print template would be mangled by cmd.exe's variable expansion and
    // tokenization. Direct spawn passes args verbatim.
    //
    // PYTHONIOENCODING=utf-8 forces yt-dlp's stdout to emit UTF-8 even when
    // the Windows console codepage is GBK/cp936 — without this, Chinese titles
    // come back as mojibake.
    const child = spawn(COMMAND, args, {
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`yt-dlp timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const friendly = /ENOENT/i.test(error.message)
        ? new Error(`yt-dlp binary not found (looked for "${COMMAND}"). Install via "pip install yt-dlp" or set YTDLP_COMMAND.`)
        : error;
      reject(friendly);
    });

    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        const message = (stderr || stdout || `yt-dlp exited with code ${code}`).trim();
        reject(new Error(message.slice(0, 600)));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function parsePrintLine(line) {
  if (!line) return null;
  const parts = line.split("\t");
  if (parts.length < 6) return null;
  const [title, uploader, durationRaw, id, webpageUrl, url] = parts;
  const duration = Number(durationRaw);
  return {
    title: title?.trim() || "",
    artist: uploader?.trim() || "",
    duration: Number.isFinite(duration) ? duration : 0,
    videoId: id?.trim() || "",
    pageUrl: webpageUrl?.trim() || "",
    audioUrl: url?.trim() || "",
  };
}

/**
 * Search YouTube and resolve a streamable audio URL.
 *
 * @param {string} query  Free-form text — title, "title artist", a YouTube URL,
 *                        or a video id (yt-dlp accepts all of them).
 * @param {{ refresh?: boolean }} [options]
 * @returns {Promise<{
 *   provider: "ytdlp",
 *   title: string,
 *   artist: string,
 *   duration: number,
 *   videoId: string,
 *   pageUrl: string,
 *   audioUrl: string,
 *   expiresAt: number,
 *   resolvedAt: number,
 *   query: string,
 * }>}
 */
async function searchTrack(query, options = {}) {
  const trimmed = String(query ?? "").trim();
  if (!trimmed) {
    throw new Error("yt-dlp: empty query");
  }

  const key = normalizeKey(trimmed);
  if (!options.refresh) {
    const cached = lookupCache(key);
    if (cached) return cached;
  }

  // Pass the raw URL/id through unchanged; otherwise fall back to ytsearch1:.
  const looksLikeUrlOrId = /^https?:\/\//i.test(trimmed) || /^[a-zA-Z0-9_-]{11}$/.test(trimmed);
  const target = looksLikeUrlOrId ? trimmed : `ytsearch1:${trimmed}`;

  const args = [
    "--no-playlist",
    "--no-warnings",
    "-f", FORMAT,
    "--print", PRINT_TEMPLATE,
    target,
  ];

  const { stdout } = await runYtDlp(args);
  const firstLine = stdout.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
  const parsed = parsePrintLine(firstLine);
  if (!parsed || !parsed.audioUrl) {
    throw new Error("yt-dlp: no audio URL in result");
  }

  const expiresAt = parseExpiryFromUrl(parsed.audioUrl) || (Date.now() + 6 * 60 * 60_000);
  const resolvedAt = Date.now();
  const payload = {
    provider: "ytdlp",
    ...parsed,
    expiresAt,
    resolvedAt,
    query: trimmed,
  };

  rememberInCache(key, payload);
  return payload;
}

/** Force-refresh a cached entry (e.g. after a 403 from the CDN). */
function invalidate(query) {
  cache.delete(normalizeKey(query));
}

function isAvailable() {
  return runYtDlp(["--version"], { timeoutMs: 5_000 })
    .then(() => true)
    .catch(() => false);
}

module.exports = {
  searchTrack,
  invalidate,
  isAvailable,
  // exposed for tests
  __internal: {
    parsePrintLine,
    parseExpiryFromUrl,
    normalizeKey,
    cache,
  },
};
