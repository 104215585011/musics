// Claudio service worker: shell cache + audio prefetch + offline chat queue
const VERSION = "claudio-v46";
const AUDIO_CACHE = "claudio-audio-v2";
const PREFETCH_CHUNK_BYTES = 160 * 1024; // ~160KB = ~10s at 128kbps
const CHAT_QUEUE_KEY = "/__claudio-chat-queue__";

const SHELL = [
  "./",
  "./index.html",
  "./api.js",
  "./app.js",
  "./styles.css",
  "./script.js",
  "./manifest.json",
  "./assets/icons/icon.svg",
];

// ---- Install: precache shell ----
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

// ---- Activate: purge old caches ----
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== VERSION && key !== AUDIO_CACHE && key !== "claudio-sync-v1")
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// ---- Fetch: hybrid strategy ----
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (!["http:", "https:"].includes(url.protocol)) return;

  // Network-first for API + SSE endpoints
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/stream")) {
    event.respondWith(
      fetch(request).catch(
        () =>
          new Response(JSON.stringify({ offline: true }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          })
      )
    );
    return;
  }

  // Audio files: network-only for now. Large media caches were causing memory
  // pressure during long local testing sessions.
  if (request.destination === "audio" || url.pathname.match(/\.(mp3|m4a|ogg|wav|flac|aac|opus)(\?|$)/i)) {
    event.respondWith(fetch(request));
    return;
  }

  // Navigations / documents / scripts / styles: network-first + cache update
  if (
    request.mode === "navigate" ||
    ["document", "script", "style"].includes(request.destination)
  ) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (url.origin === self.location.origin && response && response.ok && response.type === "basic") {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Everything else: cache-first with background refresh
  event.respondWith(
    caches.match(request).then((cached) => {
      const networked = fetch(request)
        .then((response) => {
          if (url.origin === self.location.origin && response && response.ok && response.type === "basic") {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || networked;
    })
  );
});

// ---- Audio request handler ----
async function handleAudioRequest(request) {
  const url = new URL(request.url);

  // Try cache first
  const cached = await caches.match(request);
  if (cached) {
    // Check if this is a range request beyond prefetched chunk
    const rangeHeader = request.headers.get("range");
    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d+)-/);
      if (match && parseInt(match[1]) >= PREFETCH_CHUNK_BYTES) {
        // Beyond prefetched range, go to network
        return fetch(request);
      }
    }
    return cached;
  }

  // Not cached — fetch from network
  const response = await fetch(request);
  // Cache the first chunk for future playback
  if (response.status === 200 || response.status === 206) {
    const clone = response.clone();
    caches.open(AUDIO_CACHE).then((cache) => {
      cache.put(request, clone);
    }).catch(() => {});
  }
  return response;
}

// ---- Prefetch helpers ----
async function prefetchAudioChunk(url) {
  try {
    const cache = await caches.open(AUDIO_CACHE);
    const request = new Request(url);
    const cached = await cache.match(request);
    if (cached) return;

    // Range request for first PREFETCH_CHUNK_BYTES bytes
    const response = await fetch(url, {
      headers: { Range: `bytes=0-${PREFETCH_CHUNK_BYTES - 1}` },
    });

    if (response.ok || response.status === 206) {
      await cache.put(request, response.clone());
    }
  } catch (_) {
    // Best-effort — silently ignore
  }
}

async function prefetchApiResponse(url) {
  try {
    const cache = await caches.open("claudio-api-prefetch-v1");
    const request = new Request(url);
    const cached = await cache.match(request);
    if (cached) return;

    const response = await fetch(url);
    if (response.ok) {
      await cache.put(request, response.clone());
      // Auto-expire after 5 minutes
      setTimeout(async () => {
        const c = await caches.open("claudio-api-prefetch-v1");
        await c.delete(request);
      }, 300000);
    }
  } catch (_) {}
}

// ---- Offline chat queue ----
async function getQueuedMessages() {
  try {
    const cache = await caches.open("claudio-sync-v1");
    const request = new Request(CHAT_QUEUE_KEY);
    const match = await cache.match(request);
    if (!match) return [];
    const text = await match.text();
    return JSON.parse(text);
  } catch {
    return [];
  }
}

async function saveQueuedMessages(messages) {
  try {
    const cache = await caches.open("claudio-sync-v1");
    const request = new Request(CHAT_QUEUE_KEY);
    const body = JSON.stringify(messages);
    const response = new Response(body, {
      headers: { "Content-Type": "application/json" },
    });
    await cache.put(request, response);
  } catch {}
}

async function queueChatMessage(message) {
  const messages = await getQueuedMessages();
  messages.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    message,
    queuedAt: new Date().toISOString(),
  });
  await saveQueuedMessages(messages);
  // Try to flush immediately
  await flushChatQueue();
}

async function flushChatQueue() {
  const messages = await getQueuedMessages();
  if (!messages.length) return;

  const remaining = [];
  for (const msg of messages) {
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg.message }),
      });
      if (!response.ok) {
        remaining.push(msg);
      }
    } catch {
      remaining.push(msg);
    }
  }
  await saveQueuedMessages(remaining);
}

// ---- Message handler ----
self.addEventListener("message", (event) => {
  const data = event.data;

  if (data === "skip-waiting") {
    self.skipWaiting();
    return;
  }

  if (data?.type === "prefetch-audio" && data.url) {
    return;
  }

  if (data?.type === "prefetch-playlist" && data.url) {
    event.waitUntil(prefetchApiResponse(data.url));
    return;
  }

  if (data?.type === "queue-chat" && data.message) {
    event.waitUntil(queueChatMessage(data.message));
    return;
  }

  if (data === "online-flush" || data?.type === "flush-chat") {
    event.waitUntil(flushChatQueue());
    return;
  }
});

// ---- Background sync ----
self.addEventListener("sync", (event) => {
  if (event.tag === "claudio-chat-flush") {
    event.waitUntil(flushChatQueue());
  }
});
