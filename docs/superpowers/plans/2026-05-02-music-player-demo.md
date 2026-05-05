# Music Player Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a polished fake HTML music player demo with simulated playback, clickable waveform/progress, transcript syncing, track switching, and volume/toggle controls.

**Architecture:** Use a small JavaScript playback controller that owns track/time/toggle state and a separate rendering/bootstrap layer that binds DOM events and paints the UI. Keep controller logic pure enough to test with Node's built-in test runner so we can preserve the same API when real audio is added later.

**Tech Stack:** HTML, CSS, vanilla JavaScript (ES modules), Node `--test`

---

## File Map

- Create `C:\Users\10421\musics\index.html` for the player markup and module entry point.
- Create `C:\Users\10421\musics\styles.css` for the Claudio FM-inspired visual system and responsive layout.
- Create `C:\Users\10421\musics\script.js` for track data, pure helpers, playback controller, and DOM bootstrap.
- Create `C:\Users\10421\musics\tests\script.test.js` for controller/helper behavior tests.

### Task 1: Test Core Helpers

**Files:**
- Create: `C:\Users\10421\musics\tests\script.test.js`

- [ ] **Step 1: Write the failing test**

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  clamp,
  formatTime,
  getActiveTranscriptIndex,
  getNextTrackIndex,
} from "../script.js";

test("clamp limits values to the provided range", () => {
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(4, 0, 10), 4);
  assert.equal(clamp(12, 0, 10), 10);
});

test("formatTime renders m:ss values", () => {
  assert.equal(formatTime(0), "0:00");
  assert.equal(formatTime(9), "0:09");
  assert.equal(formatTime(200), "3:20");
});

test("getActiveTranscriptIndex returns the latest started line", () => {
  const transcript = [
    { time: 0, text: "line 1" },
    { time: 22, text: "line 2" },
    { time: 48, text: "line 3" },
  ];

  assert.equal(getActiveTranscriptIndex(transcript, 0), 0);
  assert.equal(getActiveTranscriptIndex(transcript, 35), 1);
  assert.equal(getActiveTranscriptIndex(transcript, 70), 2);
});

test("getNextTrackIndex respects repeat-off and shuffle-off order", () => {
  assert.equal(getNextTrackIndex(0, 3, false, 0.2), 1);
  assert.equal(getNextTrackIndex(2, 3, false, 0.2), 0);
});

test("getNextTrackIndex avoids the current track in shuffle mode", () => {
  assert.equal(getNextTrackIndex(1, 3, true, 0.0), 0);
  assert.equal(getNextTrackIndex(1, 3, true, 0.99), 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test .\tests\script.test.js`
Expected: FAIL with import or missing export errors from `script.js`

- [ ] **Step 3: Write minimal implementation**

```js
export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function formatTime(seconds) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export function getActiveTranscriptIndex(transcript, currentTime) {
  let activeIndex = 0;
  for (let index = 0; index < transcript.length; index += 1) {
    if (transcript[index].time <= currentTime) {
      activeIndex = index;
    }
  }
  return activeIndex;
}

export function getNextTrackIndex(currentIndex, totalTracks, shuffleEnabled, randomValue) {
  if (totalTracks <= 1) return 0;
  if (!shuffleEnabled) {
    return (currentIndex + 1) % totalTracks;
  }

  const candidate = Math.floor(randomValue * totalTracks);
  return candidate === currentIndex ? (candidate + 1) % totalTracks : candidate;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test .\tests\script.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/script.test.js script.js
git commit -m "test: add music player helper coverage"
```

### Task 2: Test and Build Playback Controller

**Files:**
- Modify: `C:\Users\10421\musics\tests\script.test.js`
- Modify: `C:\Users\10421\musics\script.js`

- [ ] **Step 1: Write the failing test**

```js
import { createPlayerController } from "../script.js";

test("controller toggles play state and seeks within track duration", () => {
  const controller = createPlayerController([
    { duration: 120, transcript: [], waveform: [0.2] },
    { duration: 200, transcript: [], waveform: [0.4] },
  ]);

  assert.equal(controller.state.isPlaying, false);
  controller.togglePlay();
  assert.equal(controller.state.isPlaying, true);

  controller.seekTo(250);
  assert.equal(controller.state.currentTime, 120);
});

test("controller advances to a new track in shuffle mode", () => {
  const controller = createPlayerController([
    { duration: 120, transcript: [], waveform: [0.2] },
    { duration: 200, transcript: [], waveform: [0.4] },
    { duration: 180, transcript: [], waveform: [0.3] },
  ], { random: () => 0.99 });

  controller.toggleShuffle();
  controller.nextTrack();

  assert.equal(controller.state.trackIndex, 2);
  assert.equal(controller.state.currentTime, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test .\tests\script.test.js`
Expected: FAIL because `createPlayerController` does not exist yet

- [ ] **Step 3: Write minimal implementation**

```js
export function createPlayerController(tracks, options = {}) {
  const random = options.random ?? Math.random;
  const state = {
    trackIndex: 0,
    currentTime: 0,
    isPlaying: false,
    isShuffleOn: false,
    isRepeatOn: false,
    volume: 0.7,
    muted: false,
    previousVolume: 0.7,
  };

  function getCurrentTrack() {
    return tracks[state.trackIndex];
  }

  function seekTo(seconds) {
    state.currentTime = clamp(seconds, 0, getCurrentTrack().duration);
  }

  return {
    state,
    getCurrentTrack,
    togglePlay() {
      state.isPlaying = !state.isPlaying;
    },
    seekTo,
    setTrack(index) {
      if (index < 0 || index >= tracks.length) return;
      state.trackIndex = index;
      state.currentTime = 0;
    },
    nextTrack() {
      state.trackIndex = getNextTrackIndex(
        state.trackIndex,
        tracks.length,
        state.isShuffleOn,
        random()
      );
      state.currentTime = 0;
    },
    toggleShuffle() {
      state.isShuffleOn = !state.isShuffleOn;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test .\tests\script.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/script.test.js script.js
git commit -m "feat: add simulated player controller"
```

### Task 3: Build the Player UI

**Files:**
- Create: `C:\Users\10421\musics\index.html`
- Create: `C:\Users\10421\musics\styles.css`
- Modify: `C:\Users\10421\musics\script.js`

- [ ] **Step 1: Write the failing test**

There is no practical browser automation harness in scope for this static demo, so the failing-test equivalent is to preserve the existing controller tests and use them as the behavioral safety net while building the DOM layer around that tested core.

- [ ] **Step 2: Run tests to keep the safety net green before UI work**

Run: `node --test .\tests\script.test.js`
Expected: PASS

- [ ] **Step 3: Write minimal implementation**

Add:
- semantic player markup in `index.html`
- dark, polished Claudio FM-inspired styling in `styles.css`
- three sample tracks, waveform rendering, event binding, transcript auto-scroll, status pill updates, toggle states, and simulated clock in `script.js`

- [ ] **Step 4: Run tests and manual verification**

Run: `node --test .\tests\script.test.js`
Expected: PASS

Manual checks:
- open `index.html` in browser
- verify play/pause, seek, transcript jump, next/prev, shuffle/repeat, and volume interactions

- [ ] **Step 5: Commit**

```bash
git add index.html styles.css script.js tests/script.test.js
git commit -m "feat: build music player demo UI"
```

## Self-Review

- Spec coverage check: waveform, progress, transcript syncing, three tracks, toggles, and volume are all covered across Tasks 2 and 3.
- Placeholder scan: no TODO/TBD placeholders remain.
- Type consistency: helper names and controller method names are consistent between tests and implementation.
