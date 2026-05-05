# Claudio Hub Contract Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current split frontend/backend API model with a single Claudio hub contract so the PWA talks only to `/api/now`, `/api/next`, `/api/taste`, `/api/plan/today`, `/api/chat`, and `/stream`.

**Architecture:** Introduce a thin route layer for the public Claudio contract, move backend-specific logic behind provider modules, centralize normalized app state in a hub state module, and migrate the browser from direct `/api/cli/*` usage to the unified contract. Keep the existing UI layout intact while making the data flow real.

**Tech Stack:** Plain HTML/CSS/JS, Node.js HTTP server, `@music163/ncm-cli`, existing NetEase OpenAPI helpers, Node test runner

---

### Task 1: Create the Claudio server boundaries

**Files:**
- Create: `server/routes/claudio.js`
- Create: `server/state/hub.js`
- Create: `server/services/stream.js`
- Modify: `server/server.js`
- Test: `tests/server.test.js`

- [ ] **Step 1: Write the failing route-shape tests**

```js
test("GET /api/now returns Claudio-shaped snapshot", async () => {
  const { createHubState } = require("../server/state/hub");
  const { createClaudioRouter } = require("../server/routes/claudio");

  const hub = createHubState();
  hub.replace({
    now: {
      track: {
        id: "song-1",
        title: "Blinding Lights",
        artist: "The Weeknd",
        album: "After Hours",
        duration: 200,
        position: 12,
        status: "playing",
        transcript: [],
      },
      transport: { canPlay: true, canPause: true, canSeek: true, volume: 60 },
      meta: { ready: true, message: "" },
    },
    next: [],
    taste: { tags: [], weights: {}, mood: "" },
    plan: { items: [] },
    status: { ready: true, message: "" },
  });

  const router = createClaudioRouter({ hub, stream: { broadcast() {} } });
  const handled = await router.handle(new URL("http://localhost/api/now"), { method: "GET" }, {
    json(status, body) {
      assert.equal(status, 200);
      assert.equal(body.track.title, "Blinding Lights");
      assert.equal(body.meta.ready, true);
    },
  });

  assert.equal(handled, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test .\tests\server.test.js`  
Expected: FAIL with missing `createHubState` or `createClaudioRouter`

- [ ] **Step 3: Add a minimal hub state module**

```js
function createHubState() {
  let snapshot = {
    now: null,
    next: [],
    taste: { tags: [], weights: {}, mood: "" },
    plan: { items: [] },
    status: { ready: false, message: "" },
    lastUpdatedAt: 0,
  };

  return {
    get() {
      return snapshot;
    },
    replace(next) {
      snapshot = { ...snapshot, ...next, lastUpdatedAt: Date.now() };
      return snapshot;
    },
  };
}

module.exports = { createHubState };
```

- [ ] **Step 4: Add a minimal Claudio route module**

```js
function createClaudioRouter({ hub, stream }) {
  return {
    async handle(requestUrl, request, response) {
      if (requestUrl.pathname === "/api/now") {
        response.json(200, hub.get().now ?? {
          track: null,
          transport: { canPlay: false, canPause: false, canSeek: false, volume: 0 },
          meta: { ready: false, message: "No active track" },
        });
        return true;
      }

      if (requestUrl.pathname === "/api/next") {
        response.json(200, { items: hub.get().next });
        return true;
      }

      if (requestUrl.pathname === "/api/taste") {
        response.json(200, hub.get().taste);
        return true;
      }

      if (requestUrl.pathname === "/api/plan/today") {
        response.json(200, hub.get().plan);
        return true;
      }

      if (requestUrl.pathname === "/api/chat" && request.method === "POST") {
        response.json(200, {
          reply: "I can help with that soon. Music control is live first; Claudio chat is the next layer.",
          actions: [],
        });
        return true;
      }

      return false;
    },
  };
}

module.exports = { createClaudioRouter };
```

- [ ] **Step 5: Add a minimal stream service**

```js
function createStreamService() {
  const listeners = new Set();

  return {
    add(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    broadcast(payload) {
      for (const listener of listeners) {
        listener(payload);
      }
    },
  };
}

module.exports = { createStreamService };
```

- [ ] **Step 6: Mount the router in `server/server.js`**

```js
const { createHubState } = require("./state/hub");
const { createClaudioRouter } = require("./routes/claudio");
const { createStreamService } = require("./services/stream");

const hub = createHubState();
const stream = createStreamService();
const claudioRouter = createClaudioRouter({ hub, stream });

async function handleApi(requestUrl, request, response, config) {
  const routeResponse = {
    json(status, body) {
      sendJson(response, status, body);
    },
  };

  if (await claudioRouter.handle(requestUrl, request, routeResponse)) {
    return true;
  }

  // existing legacy handling stays below temporarily during migration
}
```

- [ ] **Step 7: Run tests to verify the route layer passes**

Run: `node --test .\tests\server.test.js`  
Expected: PASS for new route-shape tests

- [ ] **Step 8: Commit**

```bash
git add server/routes/claudio.js server/state/hub.js server/services/stream.js server/server.js tests/server.test.js
git commit -m "refactor: add Claudio hub route and state boundaries"
```

### Task 2: Isolate music providers behind normalized interfaces

**Files:**
- Create: `server/providers/music/cli.js`
- Create: `server/providers/music/netease.js`
- Modify: `server/ncm-cli.js`
- Modify: `server/netease-api.js`
- Modify: `server/server.js`
- Test: `tests/ncm-cli.test.js`
- Test: `tests/server.test.js`

- [ ] **Step 1: Write the failing provider normalization tests**

```js
test("CLI provider normalizes playback snapshot", async () => {
  const { normalizeCliNow } = require("../server/providers/music/cli");

  const snapshot = normalizeCliNow({
    state: {
      status: "playing",
      position: 42,
      duration: 200,
      volume: 55,
      track: {
        id: "song-1",
        title: "Blinding Lights",
        artist: "The Weeknd",
        album: "After Hours",
      },
    },
  });

  assert.equal(snapshot.track.title, "Blinding Lights");
  assert.equal(snapshot.transport.volume, 55);
  assert.equal(snapshot.meta.ready, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test .\tests\ncm-cli.test.js .\tests\server.test.js`  
Expected: FAIL with missing provider exports

- [ ] **Step 3: Add a CLI provider with normalization helpers**

```js
function normalizeCliNow(payload) {
  const state = payload?.state ?? {};
  const track = state.track ?? {};

  return {
    track: {
      id: track.id ?? "",
      title: track.title ?? "Nothing playing",
      artist: track.artist ?? "",
      album: track.album ?? "",
      duration: Number(state.duration ?? 0),
      position: Number(state.position ?? 0),
      status: state.status ?? "stopped",
      coverUrl: track.coverUrl ?? "",
      source: "ncm-cli",
      transcript: track.transcript ?? [],
    },
    transport: {
      canPlay: true,
      canPause: true,
      canSeek: true,
      volume: Number(state.volume ?? 0),
    },
    meta: {
      ready: Boolean(track.id || track.title),
      message: state.queueLength === 0 ? "Queue empty" : "",
    },
  };
}

module.exports = { normalizeCliNow };
```

- [ ] **Step 4: Add a NetEase provider for metadata and transcript normalization**

```js
function normalizeNeteaseTrack(track) {
  return {
    id: track.id ?? "",
    title: track.title ?? "Untitled",
    artist: track.artist ?? "",
    album: track.album ?? "",
    duration: Number(track.duration ?? 0),
    coverUrl: track.coverImgUrl ?? track.coverUrl ?? "",
    transcript: Array.isArray(track.transcript) ? track.transcript : [],
    source: "netease",
  };
}

module.exports = { normalizeNeteaseTrack };
```

- [ ] **Step 5: Refactor `server/server.js` to use providers instead of inline shaping**

```js
const cliMusicProvider = require("./providers/music/cli");
const neteaseMusicProvider = require("./providers/music/netease");

// replace direct shape-building in server.js with provider calls
const normalizedNow = cliMusicProvider.normalizeCliNow(cliPayload);
const normalizedFallback = neteaseMusicProvider.normalizeNeteaseTrack(trackPayload);
```

- [ ] **Step 6: Run tests to verify provider normalization passes**

Run: `node --test .\tests\ncm-cli.test.js .\tests\server.test.js`  
Expected: PASS for provider normalization tests

- [ ] **Step 7: Commit**

```bash
git add server/providers/music/cli.js server/providers/music/netease.js server/server.js server/ncm-cli.js server/netease-api.js tests/ncm-cli.test.js tests/server.test.js
git commit -m "refactor: move music shaping behind provider modules"
```

### Task 3: Make the hub state the source of truth for now, next, taste, and plan

**Files:**
- Modify: `server/state/hub.js`
- Modify: `server/routes/claudio.js`
- Modify: `server/server.js`
- Test: `tests/server.test.js`

- [ ] **Step 1: Write the failing hub-refresh tests**

```js
test("hub replace updates lastUpdatedAt and preserves response shape", () => {
  const { createHubState } = require("../server/state/hub");
  const hub = createHubState();

  const before = hub.get().lastUpdatedAt;
  const next = hub.replace({
    now: {
      track: { id: "song-1", title: "Blinding Lights", transcript: [] },
      transport: { canPlay: true, canPause: true, canSeek: true, volume: 40 },
      meta: { ready: true, message: "" },
    },
  });

  assert.equal(next.now.track.id, "song-1");
  assert.ok(next.lastUpdatedAt >= before);
});
```

- [ ] **Step 2: Run test to verify it fails or is incomplete**

Run: `node --test .\tests\server.test.js`  
Expected: FAIL on missing richer hub semantics

- [ ] **Step 3: Extend hub state with explicit setters**

```js
function createHubState() {
  let snapshot = {
    now: {
      track: null,
      transport: { canPlay: false, canPause: false, canSeek: false, volume: 0 },
      meta: { ready: false, message: "Not ready" },
    },
    next: [],
    taste: { tags: ["night drive", "late radio"], weights: {}, mood: "nocturne" },
    plan: { items: [{ time: "21:30", label: "Late-night radio block" }] },
    status: { ready: false, message: "Not ready" },
    lastUpdatedAt: 0,
  };

  function stamp(next) {
    snapshot = { ...snapshot, ...next, lastUpdatedAt: Date.now() };
    return snapshot;
  }

  return {
    get() {
      return snapshot;
    },
    replace: stamp,
    setNow(now) {
      return stamp({ now, status: { ready: now?.meta?.ready ?? false, message: now?.meta?.message ?? "" } });
    },
    setNext(next) {
      return stamp({ next });
    },
    setTaste(taste) {
      return stamp({ taste });
    },
    setPlan(plan) {
      return stamp({ plan });
    },
  };
}
```

- [ ] **Step 4: Refresh the hub from playback bootstrap logic**

```js
hub.setNow(normalizedNow);
hub.setNext(queueItems);
hub.setTaste({
  tags: ["night drive", "synth pop", "late radio"],
  weights: { "night drive": 0.94, "synth pop": 0.88 },
  mood: "neon nocturne",
});
hub.setPlan({
  items: [
    { time: "07:00", label: "Wake-up warm start" },
    { time: "21:30", label: "Late-night radio block" },
  ],
});
```

- [ ] **Step 5: Run tests to verify hub state behavior passes**

Run: `node --test .\tests\server.test.js`  
Expected: PASS for hub state tests

- [ ] **Step 6: Commit**

```bash
git add server/state/hub.js server/routes/claudio.js server/server.js tests/server.test.js
git commit -m "feat: make hub state the source of truth for Claudio routes"
```

### Task 4: Migrate the frontend to the Claudio contract

**Files:**
- Modify: `api.js`
- Modify: `script.js`
- Modify: `index.html`
- Test: `tests/script.test.js`

- [ ] **Step 1: Write the failing frontend contract tests**

```js
test("buildTrackFromClaudioNow uses /api/now response shape", () => {
  const { buildTrackFromClaudioNow } = require("../script");

  const track = buildTrackFromClaudioNow({
    track: {
      id: "song-1",
      title: "Blinding Lights",
      artist: "The Weeknd",
      album: "After Hours",
      duration: 200,
      position: 20,
      status: "playing",
      transcript: [{ time: 10, text: "hello" }],
    },
    transport: { volume: 60 },
    meta: { ready: true, message: "" },
  });

  assert.equal(track.title, "Blinding Lights");
  assert.equal(track.transcript.length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test .\tests\script.test.js`  
Expected: FAIL with missing `buildTrackFromClaudioNow`

- [ ] **Step 3: Add a Claudio-specific frontend mapper**

```js
function buildTrackFromClaudioNow(snapshot) {
  const track = snapshot?.track ?? {};
  return {
    id: track.id ?? "",
    title: track.title ?? "Nothing playing",
    artist: track.artist ?? "",
    album: track.album ?? "",
    subtitle: [track.artist, track.album].filter(Boolean).join(" • "),
    duration: Number(track.duration ?? 0),
    currentTime: Number(track.position ?? 0),
    transcript: Array.isArray(track.transcript) ? track.transcript : [],
    waveform: Array.isArray(track.waveform) ? track.waveform : TRACKS[0].waveform,
    src: "",
  };
}
```

- [ ] **Step 4: Replace direct `/api/cli/*` browser calls with Claudio contract calls**

```js
async function fetchNow() {
  return window.claudio.api.now();
}

async function fetchNext() {
  return window.claudio.api.next();
}

async function fetchTaste() {
  return window.claudio.api.taste();
}

async function fetchPlan() {
  return window.claudio.api.plan();
}
```

- [ ] **Step 5: Rework bootstrap flow to hydrate from `/api/now`**

```js
fetchNow()
  .then((payload) => {
    const track = buildTrackFromClaudioNow(payload);
    replaceTrackList([track]);
    controller.syncDuration(track.duration);
    controller.syncCurrentTime(track.currentTime);
    controller.syncPlaying(payload.track?.status === "playing");
    render();
  })
  .catch(() => {
    if (!fallbackAudioBooted && audioEl) {
      fallbackAudioBooted = true;
      loadCurrentTrack();
    }
  });
```

- [ ] **Step 6: Keep layout intact and remove hidden dependency on browser-side CLI routes**

```js
// remove fetch("/api/cli/status") and fetch("/api/cli/player/state")
// keep the existing DOM structure and control bindings
```

- [ ] **Step 7: Run tests to verify frontend mapping passes**

Run: `node --test .\tests\script.test.js`  
Expected: PASS for Claudio-contract mapping tests

- [ ] **Step 8: Commit**

```bash
git add api.js script.js index.html tests/script.test.js
git commit -m "refactor: switch frontend to Claudio hub contract"
```

### Task 5: Restore live updates and transcript hydration through the new hub

**Files:**
- Modify: `server/services/stream.js`
- Modify: `server/routes/claudio.js`
- Modify: `server/providers/music/cli.js`
- Modify: `script.js`
- Test: `tests/ncm-cli.test.js`
- Test: `tests/script.test.js`
- Test: `tests/server.test.js`

- [ ] **Step 1: Write the failing transcript and stream tests**

```js
test("CLI provider transcript becomes Claudio transcript lines", () => {
  const { normalizeCliTranscript } = require("../server/providers/music/cli");

  const transcript = normalizeCliTranscript([
    { time: 13.1, text: "hello" },
    { time: 18.2, text: "world" },
  ]);

  assert.equal(transcript[0].text, "hello");
  assert.equal(transcript.length, 2);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test .\tests\ncm-cli.test.js .\tests\script.test.js .\tests\server.test.js`  
Expected: FAIL with missing transcript/stream helpers

- [ ] **Step 3: Normalize transcript inside the CLI provider**

```js
function normalizeCliTranscript(lines) {
  if (!Array.isArray(lines)) return [];
  return lines
    .filter((line) => Number.isFinite(Number(line.time)) && typeof line.text === "string")
    .map((line) => ({ time: Number(line.time), text: line.text.trim() }))
    .filter((line) => line.text.length > 0);
}
```

- [ ] **Step 4: Broadcast normalized hub events**

```js
stream.broadcast({
  type: "now",
  track: {
    id: now.track.id,
    title: now.track.title,
    artist: now.track.artist,
    album: now.track.album,
    position: now.track.position,
    duration: now.track.duration,
    status: now.track.status,
  },
});
```

- [ ] **Step 5: Update the frontend live bridge to treat stream events as authoritative**

```js
window.claudio.api.live.on(function (msg) {
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "now" && msg.track) {
    controller.syncCurrentTime(Number(msg.track.position || 0));
    controller.syncDuration(Number(msg.track.duration || 0));
    controller.syncPlaying(msg.track.status === "playing");
    render();
  }
});
```

- [ ] **Step 6: Run tests to verify transcript and stream behavior passes**

Run: `node --test .\tests\ncm-cli.test.js .\tests\script.test.js .\tests\server.test.js`  
Expected: PASS for transcript normalization and stream event tests

- [ ] **Step 7: Commit**

```bash
git add server/services/stream.js server/routes/claudio.js server/providers/music/cli.js script.js tests/ncm-cli.test.js tests/script.test.js tests/server.test.js
git commit -m "feat: restore Claudio live updates and transcript hydration"
```

### Task 6: Remove legacy public route usage and verify the app end to end

**Files:**
- Modify: `server/server.js`
- Modify: `api.js`
- Modify: `script.js`
- Modify: `tests/server.test.js`
- Modify: `tests/script.test.js`

- [ ] **Step 1: Write the failing regression checks**

```js
test("frontend no longer references /api/cli public endpoints", () => {
  const fs = require("node:fs");
  const source = fs.readFileSync(require("node:path").join(__dirname, "..", "script.js"), "utf8");
  assert.equal(source.includes("/api/cli/"), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test .\tests\script.test.js .\tests\server.test.js`  
Expected: FAIL while legacy browser endpoint strings remain

- [ ] **Step 3: Remove legacy public route branches from the main server flow**

```js
// delete browser-facing /api/cli/* and /api/netease/* branches from handleApi
// keep internal helper imports only where used by providers
```

- [ ] **Step 4: Make `api.js` the only browser API boundary**

```js
window.claudio = window.claudio || {};
window.claudio.api = {
  getBase: readBase,
  setBase: writeBase,
  url: joinUrl,
  chat,
  now,
  next,
  taste,
  plan,
  connectStream,
  live,
};
```

- [ ] **Step 5: Run the full test suite**

Run: `node --test .\tests\script.test.js .\tests\server.test.js .\tests\ncm-cli.test.js`  
Expected: PASS

- [ ] **Step 6: Run a manual smoke check**

Run:

```bash
node server/server.js
```

Then verify in browser:

- player loads
- `/api/now` populates state
- profile screen shows taste and plan
- queue-empty displays cleanly
- transcript renders when available
- no frontend requests hit `/api/cli/*`

- [ ] **Step 7: Commit**

```bash
git add server/server.js api.js script.js tests/server.test.js tests/script.test.js
git commit -m "refactor: retire legacy public routes in favor of Claudio contract"
```

## Self-Review

### Spec coverage

- Public Claudio contract coverage: Task 1, Task 3, Task 4, Task 6
- Provider isolation: Task 2
- Hub state centralization: Task 3
- Frontend migration: Task 4
- Stream and transcript restoration: Task 5
- Retirement of old public routes: Task 6

No major spec requirement is currently uncovered.

### Placeholder scan

- No `TODO`, `TBD`, or “similar to Task N” placeholders remain
- Tasks reference exact files and exact verification commands
- The one deliberate “delete” step in Task 6 is paired with the precise behavior being removed

### Type consistency

- Public `now` snapshot consistently uses:
  - `track`
  - `transport`
  - `meta`
- Stream `now` event uses a reduced `track` payload
- Frontend mapper consistently expects `track.position` and `track.duration`

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-03-claudio-hub-implementation.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?

