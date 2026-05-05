# Claudio Hub Contract Unification Design

**Date:** 2026-05-03  
**Status:** Proposed  
**Scope:** Unify the current player/PWA/server into a single Claudio-style local hub contract and retire the old frontend-facing `/api/cli/*` and `/api/netease/*` routes.

## Goal

Turn the current project from a mixed prototype into a coherent local-first Claudio hub:

- the frontend only talks to one stable Claudio contract
- the server owns translation to music backends and local state
- playback, queue, transcript, taste, plan, and live updates come from one shared hub model

This round does **not** implement the full long-term AI platform. It focuses on the music-centered core so the app stops feeling like a fake shell.

## Non-Goals

This design does not attempt to fully build:

- Claude orchestration logic
- scheduler automation
- Feishu, weather, Fish TTS, or UPnP integrations
- durable database-backed memory
- a full command/chat agent runtime

Those will be added later behind the same hub contract.

## Current Problems

### 1. The frontend and backend speak different languages

The PWA shell already assumes a Claudio contract:

- `GET /api/now`
- `GET /api/next`
- `GET /api/taste`
- `GET /api/plan/today`
- `POST /api/chat`
- `WS /stream`

But the current server mainly exposes:

- `/api/cli/*`
- `/api/netease/*`

This creates a split where the UI looks product-shaped, but the real data flow is still backend-specific.

### 2. State is scattered

Playback state currently lives across:

- `ncm-cli`
- frontend controller state
- ad hoc server auth/runtime variables
- static fallback track data

There is no single hub state object that can answer:

- what is playing now
- what is next
- what transcript should be shown
- what should be streamed to live listeners

### 3. Backend concerns are mixed together

`server/server.js` currently does too much:

- static file serving
- CLI integration
- NetEase token and QR auth
- track bootstrapping
- API routing

That makes the next round of features riskier than it needs to be.

### 4. The product is structurally ahead of the implementation

The new `index.html`, `api.js`, `manifest.json`, and `sw.js` clearly define a local-first Claudio shell. The server has not yet been reorganized to match that shell.

## Chosen Approach

Use a **medium refactor**:

- keep the current app and assets
- keep the working `ncm-cli` and NetEase integration logic where useful
- introduce a clean Claudio hub contract and internal module boundaries
- remove old frontend-facing `/api/cli/*` and `/api/netease/*` routes from the main app flow

This is the best balance between speed and long-term maintainability.

## Architecture Overview

The project will be reorganized into four layers:

### 1. Frontend shell

Responsibilities:

- render player, profile, settings, and chat views
- call only the Claudio contract
- subscribe to `/stream`
- never know whether music came from `ncm-cli`, NetEase, or something else

Primary files:

- `index.html`
- `styles.css`
- `api.js`
- `script.js`
- `manifest.json`
- `sw.js`

### 2. Claudio routes

Responsibilities:

- expose the public local-hub HTTP and WS contract
- validate requests
- map provider output into stable hub response shapes

Primary files:

- `server/routes/claudio.js`
- `server/services/stream.js`

### 3. Providers

Responsibilities:

- talk to external/local systems
- hide backend-specific commands and auth details
- return normalized data

Primary files:

- `server/providers/music/cli.js`
- `server/providers/music/netease.js`

### 4. Hub state

Responsibilities:

- hold the server-side source of truth for now-playing, queue preview, plan, taste, transcript, and live payloads
- produce consistent objects for both HTTP responses and stream pushes

Primary files:

- `server/state/hub.js`

## Public Claudio Contract

The frontend will use only these endpoints.

### `GET /api/now`

Returns the current hub snapshot for now-playing.

Example shape:

```json
{
  "track": {
    "id": "enc-song-id",
    "title": "Blinding Lights",
    "artist": "The Weeknd",
    "album": "After Hours",
    "duration": 200,
    "position": 37,
    "status": "playing",
    "coverUrl": "",
    "source": "ncm-cli",
    "transcript": [
      { "time": 13.1, "text": "..." }
    ]
  },
  "transport": {
    "canPlay": true,
    "canPause": true,
    "canSeek": true,
    "volume": 60
  },
  "meta": {
    "ready": true,
    "message": ""
  }
}
```

### `GET /api/next`

Returns a preview of upcoming queue items.

Example shape:

```json
{
  "items": [
    { "id": "2", "title": "Save Your Tears", "artist": "The Weeknd" },
    { "id": "3", "title": "Starboy", "artist": "The Weeknd" }
  ]
}
```

### `GET /api/taste`

Returns a lightweight local taste profile for the profile screen.

First implementation can be static or derived from local config, but the response shape must be stable.

Example shape:

```json
{
  "tags": ["night drive", "synth pop", "melancholy", "late radio"],
  "weights": {
    "night drive": 0.94,
    "synth pop": 0.88
  },
  "mood": "neon nocturne"
}
```

### `GET /api/plan/today`

Returns today's planned listening/program segments.

First implementation can be static/generated.

Example shape:

```json
{
  "items": [
    { "time": "07:00", "label": "Wake-up warm start" },
    { "time": "21:30", "label": "Late-night radio block" }
  ]
}
```

### `POST /api/chat`

Receives a user message for Claudio.

First implementation does not need a full AI runtime. It can return a structured placeholder response and optional side effects later.

Example request:

```json
{
  "message": "Play something softer",
  "context": {
    "view": "player"
  }
}
```

Example response:

```json
{
  "reply": "I can help with that soon. Music control is live first; Claudio chat is the next layer.",
  "actions": []
}
```

### `WS /stream`

Pushes normalized hub events to the frontend.

Supported message types in this round:

- `now`
- `next`
- `taste`
- `plan`
- `status`

Example `now` event:

```json
{
  "type": "now",
  "track": {
    "id": "enc-song-id",
    "title": "Blinding Lights",
    "artist": "The Weeknd",
    "album": "After Hours",
    "position": 37,
    "duration": 200,
    "status": "playing"
  }
}
```

## Internal Provider Design

### CLI music provider

`server/providers/music/cli.js` will own:

- reading `ncm-cli state`
- reading queue/list info if available
- transport commands:
  - play/pause/resume/stop
  - next/prev
  - seek
  - volume
- retrieving current-song lyrics through `ncm-cli song lyric`

It must return normalized objects, not raw CLI output.

Important constraint:

The CLI provider must become the primary playback source of truth for real playback mode. The frontend should not simulate playback when this provider is available.

### NetEase provider

`server/providers/music/netease.js` will own:

- QR login
- anonymous token bootstrap
- refresh token flow
- song detail lookup
- search
- lyric lookup when needed

It will mainly support:

- metadata hydration
- fallback/default tracks
- future search and queue workflows

In this round, it should stop being a public API surface and become an internal dependency only.

## Hub State Design

`server/state/hub.js` will provide a single in-memory state container.

State shape:

```js
{
  now: null,
  next: [],
  taste: { tags: [], weights: {}, mood: "" },
  plan: { items: [] },
  status: { ready: false, message: "" },
  lastUpdatedAt: 0
}
```

Responsibilities:

- refresh state from providers
- expose getters for routes
- publish stream events when meaningful changes happen
- cache the latest transcript alongside the current track

The hub must be able to answer `GET /api/now` without the frontend reconstructing missing pieces on its own.

## Frontend Changes

### `api.js`

Keep it as the single browser client wrapper, but make it authoritative instead of aspirational.

Responsibilities:

- keep API base URL behavior
- expose typed wrapper methods for:
  - `now()`
  - `next()`
  - `taste()`
  - `plan()`
  - `chat()`
  - `connectStream()`

No backend-specific methods should be added here.

### `script.js`

Refocus it around Claudio contract consumption:

- load `/api/now` instead of `/api/cli/player/state` as the main playback snapshot
- load `/api/taste` and `/api/plan/today` for profile/settings views
- hydrate transcript directly from `now.track.transcript`
- subscribe to `/stream` and update UI state from normalized events

The old direct dependency on `/api/cli/*` in the browser should be removed.

### UI behavior in this round

The user-facing layout should not be redesigned again. This round is structural.

Behavioral outcome:

- Player view shows real now-playing data if available
- Transcript comes back when the backend can resolve current lyrics
- Profile view uses real taste/plan/now data from the new contract
- Settings still control API base and scene tweaks

## Migration Plan

### Phase 1: Introduce new server modules

- add hub state
- add Claudio route module
- wrap existing CLI and NetEase logic in provider modules
- leave old route code available internally while wiring the new contract

### Phase 2: Switch frontend to new contract

- update `script.js` to stop calling `/api/cli/*`
- consume `/api/now`, `/api/next`, `/api/taste`, `/api/plan/today`
- keep `api.js` as the frontend contract boundary

### Phase 3: Remove old public route usage

- remove old browser dependencies on `/api/cli/*` and `/api/netease/*`
- keep any necessary internal helper functions, but not as frontend-facing endpoints

### Phase 4: Reintroduce live updates and transcript fidelity

- stream normalized `now/next/plan/taste` events
- restore transcript rendering from backend-provided lyric lines

## Error Handling

The Claudio contract should fail in product language, not backend language.

Examples:

- not logged in -> `ready: false`, message like `Login required`
- queue empty -> `ready: true`, message like `Queue empty`
- CLI unavailable -> `ready: false`, message like `Music backend unavailable`

The frontend should not need to interpret raw CLI or OpenAPI errors.

## Testing Strategy

### Unit tests

Add or extend tests for:

- CLI output normalization
- NetEase response normalization
- hub state merging and event emission
- lyric parsing and transcript mapping
- Claudio route response shapes

### Integration checks

Verify:

- `GET /api/now` returns a stable object even when nothing is playing
- `GET /api/taste` and `GET /api/plan/today` work without frontend fallbacks
- `/stream` emits normalized messages
- frontend no longer fetches `/api/cli/*` directly

### Manual verification

Smoke test in browser:

- page loads
- player reflects now-playing state
- queue-empty state is rendered cleanly
- transcript appears when available
- profile view populates
- settings API base switch still works

## Risks

### 1. CLI metadata gaps

If `ncm-cli state` does not expose enough identity for the current song, we may need an additional lookup path to recover the current song id before resolving lyrics.

### 2. WebSocket shape drift

The frontend live bridge already expects `now`, `plan`, and `taste` messages. The backend must match those shapes exactly to avoid another split-brain state.

### 3. Encoding issues

Some current files already show mojibake text. This round should avoid making that worse and should prefer UTF-8-safe edits. A dedicated encoding cleanup may still be needed after the contract migration.

## Success Criteria

This round is successful when:

- the frontend only uses the Claudio contract
- the backend exposes one coherent public API surface
- real playback state comes from the server hub, not browser guesses
- transcript can be restored through the provider pipeline
- the app feels like one local product instead of a stitched demo

