function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatTime(seconds) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function getActiveTranscriptIndex(transcript, currentTime) {
  if (!transcript.length) {
    return -1;
  }

  let activeIndex = 0;
  for (let index = 0; index < transcript.length; index += 1) {
    if (transcript[index].time <= currentTime) {
      activeIndex = index;
    }
  }

  return activeIndex;
}

function getNextTrackIndex(currentIndex, totalTracks, shuffleEnabled, randomValue) {
  if (totalTracks <= 1) {
    return 0;
  }

  if (!shuffleEnabled) {
    return (currentIndex + 1) % totalTracks;
  }

  const candidate = Math.floor(randomValue * totalTracks);
  return candidate === currentIndex ? (candidate + 1) % totalTracks : candidate;
}

function getPrevTrackIndex(currentIndex, totalTracks) {
  if (totalTracks <= 1) {
    return 0;
  }

  return (currentIndex - 1 + totalTracks) % totalTracks;
}

function createWaveform(seedA, seedB, count) {
  const values = [];

  for (let index = 0; index < count; index += 1) {
    // slow envelope shapes the macro peaks/valleys across the whole track
    const envelope = (Math.sin(index * seedA * 0.45 + seedB) * 0.5 + 0.5) * 0.7 + 0.3;
    // mid-frequency detail
    const mid = Math.sin(index * seedA * 1.6 + seedB * 3.1) * 0.5 + 0.5;
    // fast oscillation for jaggedness
    const fast = Math.cos(index * (seedA + seedB) * 3.4) * 0.5 + 0.5;
    // pseudo-random per-bar jitter (deterministic from index + seeds)
    const hash = Math.sin(index * 12.9898 + seedA * 78.233 + seedB * 37.719) * 43758.5453;
    const jitter = hash - Math.floor(hash);

    let value = envelope * (mid * 0.55 + fast * 0.25 + jitter * 0.45);
    // sharpen peaks so tall bars feel taller and quiet sections drop closer to zero
    value = Math.pow(value, 0.7);

    values.push(clamp(value, 0.04, 1));
  }

  return values;
}

function parseTimedLyrics(lyricText) {
  if (!lyricText) {
    return [];
  }

  const lines = lyricText.split(/\r?\n/);
  const transcript = [];

  for (const line of lines) {
    const matches = [...line.matchAll(/\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]/g)];
    const text = line.replace(/\[[^\]]+\]/g, "").trim();

    if (!matches.length || !text) {
      continue;
    }

    for (const match of matches) {
      const minutes = Number.parseInt(match[1], 10);
      const seconds = Number.parseInt(match[2], 10);
      let fraction = 0;
      if (match[3]) {
        // Normalise to 3 digits and divide by 1000: .32 → 320ms, .960 → 960ms
        fraction = Number.parseInt(match[3].padEnd(3, "0"), 10) / 1000;
      }
      transcript.push({
        time: minutes * 60 + seconds + fraction,
        text,
      });
    }
  }

  transcript.sort((left, right) => left.time - right.time);
  return transcript;
}

function pickPrimaryArtist(artists) {
  if (!Array.isArray(artists) || artists.length === 0) {
    return "Unknown Artist";
  }

  return artists.map((artist) => artist.name).filter(Boolean).join(", ") || "Unknown Artist";
}

function buildTrackFromNeteaseData({ searchItem = null, detailItem = null, lyricText = "" }) {
  const source = detailItem ?? searchItem ?? {};
  const artists = source.artists ?? source.fullArtists ?? [];
  const album = source.album ?? {};
  const title = source.name ?? "Untitled";
  const durationMs = detailItem?.duration ?? searchItem?.duration ?? 0;
  const transcript = parseTimedLyrics(lyricText);
  const id = String(source.songId ?? source.id ?? "");

  return {
    id,
    title,
    artist: pickPrimaryArtist(artists),
    album: album.name ?? "Unknown Album",
    duration: durationMs / 1000,
    accent: "#4ade80",
    waveform: createWaveform(0.61 + id.length * 0.01, 0.37 + title.length * 0.01, 68),
    transcript,
    src: detailItem?.url ?? "",
    coverImgUrl: source.coverImgUrl ?? "",
    canPlay: Boolean(
      (detailItem?.playFlag ?? searchItem?.playFlag ?? true) &&
        (detailItem?.visible ?? searchItem?.visible ?? true) &&
        !(detailItem?.vipPlayFlag ?? searchItem?.vipPlayFlag ?? false)
    ),
  };
}

function buildTrackFromCliState(cliState = {}, fallbackTrack = null) {
  const title = cliState.title || fallbackTrack?.title || "CLI Playback";
  const artist =
    cliState.artist || cliState.subtitle || cliState.author || fallbackTrack?.artist || "ncm-cli";
  const album = cliState.album || fallbackTrack?.album || "Remote Queue";
  const duration = Number.isFinite(cliState.duration) ? cliState.duration : fallbackTrack?.duration ?? 0;
  const accent = fallbackTrack?.accent || "#7dd3fc";
  const waveform =
    Array.isArray(fallbackTrack?.waveform) && fallbackTrack.waveform.length
      ? fallbackTrack.waveform
      : createWaveform(0.59 + title.length * 0.01, 0.41 + artist.length * 0.01, 68);

  return {
    id: `cli-${title}-${artist}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-"),
    title,
    artist,
    album,
    duration,
    accent,
    waveform,
    transcript: [],
    src: "",
    coverImgUrl: "",
    canPlay: true,
  };
}

function buildTrackFromClaudioNow(snapshot = {}, fallbackTrack = null) {
  const remoteTrack = snapshot.track ?? {};
  const fallback = fallbackTrack ?? {};
  const title = remoteTrack.title || fallback.title || "Nothing playing";
  const artist = remoteTrack.artist || fallback.artist || "";
  const album = remoteTrack.album || fallback.album || "";
  const duration = Number.isFinite(remoteTrack.duration) ? remoteTrack.duration : fallback.duration ?? 0;
  const currentTime = Number.isFinite(remoteTrack.position) ? remoteTrack.position : 0;
  const waveform =
    Array.isArray(remoteTrack.waveform) && remoteTrack.waveform.length
      ? remoteTrack.waveform
      : Array.isArray(fallback.waveform) && fallback.waveform.length
        ? fallback.waveform
        : createWaveform(0.57 + title.length * 0.01, 0.39 + artist.length * 0.01, 68);

  return {
    id: String(remoteTrack.id ?? fallback.id ?? ""),
    title,
    artist,
    album,
    subtitle: [artist, album].filter(Boolean).join(" • "),
    duration,
    currentTime,
    accent: fallback.accent || "#7dd3fc",
    waveform,
    transcript: Array.isArray(remoteTrack.transcript) ? remoteTrack.transcript : fallback.transcript ?? [],
    src: remoteTrack.audioUrl || remoteTrack.url || remoteTrack.src || "",
    coverImgUrl: remoteTrack.coverUrl || fallback.coverImgUrl || "",
    canPlay: snapshot.transport?.canPlay ?? true,
  };
}

function getPlaylistTrackStatus(track = {}) {
  if (track.playState === "sending") {
    return "sending";
  }
  if (track.playState === "sent") {
    return "sent";
  }
  if (track.blockedReason) {
    return "failed";
  }
  if (track.canPlay === false) {
    return "locked";
  }
  return "try";
}

function shouldShowPlaylistTrack(track = {}, filters = {}) {
  if (filters.hideFailed && getPlaylistTrackStatus(track) === "failed") {
    return false;
  }
  if (filters.hideLocked && getPlaylistTrackStatus(track) === "locked") {
    return false;
  }
  return true;
}

function getChatReplyText(payload = {}) {
  return String(payload.reply || payload.say || payload.text || payload.message || "(no response)");
}

function getChatMetaText(payload = {}) {
  const parts = [];
  if (payload.reason) {
    parts.push(String(payload.reason));
  }
  if (payload.segue) {
    parts.push(`→ ${payload.segue}`);
  }
  if (Array.isArray(payload.executedActions) && payload.executedActions.length) {
    parts.push(`ran ${payload.executedActions.join(", ")}`);
  } else if (Array.isArray(payload.actions) && payload.actions.length) {
    parts.push(payload.actions.join(", "));
  }
  return parts.join(" · ");
}

const TRACKS = [
  {
    id: "bread-if",
    title: "If",
    artist: "Bread",
    album: "Manna",
    src: "",
    duration: 158,
    accent: "#4ade80",
    waveform: createWaveform(0.71, 0.43, 68),
    transcript: [
      { time: 0, text: "Waiting for NetEase lyrics for Bread - If." },
      { time: 16, text: "Claudio keeps the room quiet while the song loads." },
      { time: 35, text: "If lyrics are unavailable, this calm placeholder stays here." },
    ],
  },
  {
    id: "save-your-tears",
    title: "Save Your Tears",
    artist: "The Weeknd",
    album: "After Hours",
    src: "assets/audio/save-your-tears.mp3",
    duration: 215,
    accent: "#9d7dff",
    waveform: createWaveform(0.53, 0.31, 68),
    transcript: [
      { time: 0, text: "A cleaner groove steps in first, polished and a little bittersweet." },
      { time: 21, text: "The rhythm keeps smiling while the mood stays just left of heartbreak." },
      { time: 47, text: "The hook lands like a flash of chrome under soft club lights." },
      { time: 75, text: "There is space in the arrangement, which makes the chorus feel taller." },
      { time: 108, text: "The second pass turns warmer, almost conversational, then snaps back to shine." },
      { time: 146, text: "A bright melodic loop carries the whole section without losing its ache." },
      { time: 184, text: "The ending coasts rather than crashes, confident and smooth." },
    ],
  },
  {
    id: "starboy",
    title: "Starboy",
    artist: "The Weeknd",
    album: "Starboy",
    src: "assets/audio/starboy.mp3",
    duration: 230,
    accent: "#7d88ff",
    waveform: createWaveform(0.64, 0.27, 68),
    transcript: [
      { time: 0, text: "The low-end arrives first, minimal and deliberate, with room around every hit." },
      { time: 24, text: "A colder edge cuts through the mix and gives the verse its swagger." },
      { time: 52, text: "The refrain answers with a sharper silhouette, sleek instead of sentimental." },
      { time: 84, text: "There is a measured confidence here, more strut than sprint." },
      { time: 119, text: "The center section strips back again, letting the groove do the heavy work." },
      { time: 156, text: "When the hook returns, it feels even more sculpted and cinematic." },
      { time: 196, text: "The close keeps the pulse locked in until the very last second." },
    ],
  },
];

function createPlayerController(tracks, options = {}) {
  const random = options.random ?? Math.random;
  const state = {
    trackIndex: 0,
    currentTime: 0,
    isPlaying: false,
    isShuffleOn: false,
    isRepeatOn: false,
    volume: 0.72,
    muted: false,
    previousVolume: 0.72,
  };

  function getCurrentTrack() {
    return tracks[state.trackIndex];
  }

  function seekTo(seconds) {
    const track = getCurrentTrack();
    state.currentTime = clamp(seconds, 0, track.duration);
  }

  return {
    state,
    getCurrentTrack,
    togglePlay() {
      state.isPlaying = !state.isPlaying;
    },
    seekTo,
    setTrack(index) {
      if (index < 0 || index >= tracks.length) {
        return;
      }

      state.trackIndex = index;
      state.currentTime = 0;
      state.isPlaying = false;
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
    prevTrack() {
      state.trackIndex = getPrevTrackIndex(state.trackIndex, tracks.length);
      state.currentTime = 0;
    },
    toggleShuffle() {
      state.isShuffleOn = !state.isShuffleOn;
    },
    toggleRepeat() {
      state.isRepeatOn = !state.isRepeatOn;
    },
    setVolume(value) {
      const nextVolume = clamp(value, 0, 1);
      state.volume = nextVolume;
      if (nextVolume > 0) {
        state.previousVolume = nextVolume;
        state.muted = false;
      } else {
        state.muted = true;
      }
    },
    toggleMute() {
      if (state.muted || state.volume === 0) {
        state.muted = false;
        state.volume = state.previousVolume || 0.72;
        return;
      }

      state.muted = true;
      state.previousVolume = state.volume;
      state.volume = 0;
    },
    finishTrack() {
      if (state.isRepeatOn) {
        state.currentTime = 0;
        state.isPlaying = true;
        return;
      }

      state.currentTime = getCurrentTrack().duration;
      state.isPlaying = false;
    },
    step(deltaSeconds) {
      if (!state.isPlaying) {
        return false;
      }

      const track = getCurrentTrack();
      const nextTime = state.currentTime + deltaSeconds;

      if (nextTime >= track.duration) {
        this.finishTrack();
        return true;
      }

      state.currentTime = nextTime;
      return false;
    },
    syncDuration(seconds) {
      const safeDuration = Number.isFinite(seconds) && seconds > 0 ? seconds : getCurrentTrack().duration;
      getCurrentTrack().duration = safeDuration;
      state.currentTime = clamp(state.currentTime, 0, safeDuration);
    },
    syncCurrentTime(seconds) {
      state.currentTime = clamp(seconds, 0, getCurrentTrack().duration);
    },
    syncPlaying(isPlaying) {
      state.isPlaying = Boolean(isPlaying);
    },
  };
}

function getSpeakerGlyph(state) {
  if (state.muted || state.volume === 0) {
    return "Muted";
  }

  if (state.volume < 0.45) {
    return "Low";
  }

  return "High";
}

function seekFromPointer(event, element, duration) {
  const rect = element.getBoundingClientRect();
  const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
  return ratio * duration;
}

function wireElectronTitlebar() {
  const electronAPI = window.electronAPI;
  if (!electronAPI?.isElectron) return;
  document.body.classList.add("is-electron");
  if (location.hash !== "#player") {
    history.replaceState(null, "", "#player");
  }
  const titlebar = document.getElementById("electronTitlebar");
  if (titlebar) titlebar.hidden = false;
  document.getElementById("btnMin")?.addEventListener("click", () => electronAPI.minimize());
  document.getElementById("btnMax")?.addEventListener("click", () => electronAPI.maximize());
  document.getElementById("btnClose")?.addEventListener("click", () => electronAPI.close());

  const storedTheme = localStorage.getItem("claudioDesktopTheme");
  const initialTheme = storedTheme === "light" ? "light" : "dark";
  function applyDesktopTheme(theme) {
    document.body.dataset.desktopMode = theme;
    localStorage.setItem("claudioDesktopTheme", theme);
    document.querySelectorAll(".terminal__theme-btn[data-desktop-theme]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.desktopTheme === theme);
    });
  }

  applyDesktopTheme(initialTheme);
  document.querySelectorAll(".terminal__theme-btn[data-desktop-theme]").forEach((button) => {
    if (button.dataset.themeWired === "1") return;
    button.dataset.themeWired = "1";
    button.addEventListener("click", () => applyDesktopTheme(button.dataset.desktopTheme || "dark"));
  });
}

function bootstrapPlayer() {
  wireElectronTitlebar();
  const root = document.querySelector("[data-player]");
  if (!root) {
    return;
  }

  const titleEl = root.querySelector("[data-title]");
  const subtitleEl = root.querySelector("[data-subtitle]");
  const statusEl = root.querySelector("[data-status]");
  const statusDotEl = root.querySelector("[data-status-dot]");
  const currentTimeEl = root.querySelector("[data-current-time]");
  const durationEl = root.querySelector("[data-duration]");
  const waveformEl = root.querySelector("[data-waveform]");
  const transcriptEl = root.querySelector("[data-transcript]");
  const progressFillEl = root.querySelector("[data-progress-fill]");
  const progressThumbEl = root.querySelector("[data-progress-thumb]");
  const progressRailEl = root.querySelector("[data-progress-rail]");
  const playButtonEl = root.querySelector("[data-play]");
  const prevButtonEl = root.querySelector("[data-prev]");
  const nextButtonEl = root.querySelector("[data-next]");
  const shuffleButtonEl = root.querySelector("[data-shuffle]");
  const repeatButtonEl = root.querySelector("[data-repeat]");
  const volumeRailEl = root.querySelector("[data-volume-rail]");
  const volumeFillEl = root.querySelector("[data-volume-fill]");
  const volumeThumbEl = root.querySelector("[data-volume-thumb]");
  const volumeButtonEl = root.querySelector("[data-volume-button]");
  const artistBadgeEl = root.querySelector("[data-artist-badge]");
  const albumBadgeEl = root.querySelector("[data-album-badge]");
  const tweakInputs = root.querySelectorAll("[data-tweak]");
  const audioEl = document.querySelector("[data-audio]");
  const loginModalEl = document.querySelector("[data-login-modal]");
  const loginQrEl = document.querySelector("[data-login-qr]");
  const loginMessageEl = document.querySelector("[data-login-message]");
  const loginCloseEl = document.querySelector("[data-login-close]");
  const nowLoginEl = document.querySelector("[data-now-login]");
  const nowLogoutEl = document.querySelector("[data-now-logout]");
  const desktopQueueEl = root.querySelector("[data-desktop-queue]");
  const desktopQueueListEl = root.querySelector("[data-desktop-queue-list]");
  const queueToggleEl = root.querySelector("[data-queue-toggle]");
  const queueCloseEl = root.querySelector("[data-queue-close]");
  const favoriteButtonEl = root.querySelector("[data-favorite]");

  const tasteTagsEl = document.querySelector("[data-taste-tags]");
  const planListEl = document.querySelector("[data-plan-list]");
  const statsGridEl = document.querySelector("[data-stats-grid]");
  const topListEl = document.querySelector("[data-stats-top]");
  const nowTitleEl = document.querySelector("[data-now-title]");
  const nowSubEl = document.querySelector("[data-now-sub]");
  const api = window.claudio?.api ?? null;
  const controller = createPlayerController(TRACKS);
  let lastFrame = performance.now();
  let previousTrackId = "";
  let activeTranscriptIndex = -1;
  let lastWaveformRenderId = "";
  let _waveformTrackId = null;
  let _waveformClipEl = null;

  // ─── Real-time audio visualizer (Web Audio API) ───
  let _audioCtx = null;
  let _analyser = null;
  let _audioSourceConnected = false;
  let _vizBars = [];
  let _vizRAF = 0;
  const VIZ_BAR_COUNT = 64;
  const ENABLE_LIVE_ANALYSER = false;
  let _waveCanvas = null;
  let _waveCtx = null;
  let _waveDpr = 1;
  let _waveW = 0;
  let _waveH = 0;
  let _wavePhase = 0;
  let _waveLastMeasure = 0;
  let _lastDomRenderAt = 0;
  let _isProgressDragging = false;
  let _suppressProgressClick = false;

  function ensureAnalyser() {
    if (!ENABLE_LIVE_ANALYSER) return null;
    if (_analyser) return _analyser;
    if (!audioEl) return null;
    try {
      _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      _analyser = _audioCtx.createAnalyser();
      _analyser.fftSize = 256;
      _analyser.smoothingTimeConstant = 0.7;
      _analyser.minDecibels = -85;
      _analyser.maxDecibels = -10;
    } catch (e) {
      return null;
    }
    return _analyser;
  }

  function connectAudioSource() {
    if (!ENABLE_LIVE_ANALYSER) return;
    if (_audioSourceConnected || !audioEl || !_audioCtx || !_analyser) return;
    try {
      const source = _audioCtx.createMediaElementSource(audioEl);
      source.connect(_analyser);
      _analyser.connect(_audioCtx.destination);
      _audioSourceConnected = true;
    } catch (e) {
      // Already connected or CORS issue — ignore
    }
  }

  function buildVizBars() {
    if (_waveCanvas) return;
    waveformEl.innerHTML = "";
    _waveCanvas = document.createElement("canvas");
    _waveCanvas.className = "waveform-canvas";
    _waveCtx = _waveCanvas.getContext("2d");
    waveformEl.appendChild(_waveCanvas);
    resizeWaveCanvas();
  }

  function resizeWaveCanvas() {
    if (!_waveCanvas || !_waveCtx) return;
    const rect = waveformEl.getBoundingClientRect();
    _waveDpr = window.devicePixelRatio || 1;
    _waveW = Math.max(1, rect.width);
    _waveH = Math.max(1, rect.height);
    _waveCanvas.width = Math.round(_waveW * _waveDpr);
    _waveCanvas.height = Math.round(_waveH * _waveDpr);
    _waveCanvas.style.width = `${_waveW}px`;
    _waveCanvas.style.height = `${_waveH}px`;
    _waveCtx.setTransform(1, 0, 0, 1, 0, 0);
    _waveCtx.scale(_waveDpr, _waveDpr);
  }

  function waveRand(seed) {
    const x = Math.sin(seed * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  }

  function drawCanvasWave(track, progressRatio, isPlaying) {
    buildVizBars();
    if (!_waveCanvas || !_waveCtx) return;

    const now = performance.now();
    if (now - _waveLastMeasure > 1000) {
      _waveLastMeasure = now;
      const rect = waveformEl.getBoundingClientRect();
      if (Math.abs(rect.width - _waveW) > 1 || Math.abs(rect.height - _waveH) > 1) {
        resizeWaveCanvas();
      }
    }

    if (!_waveW || !_waveH) {
      resizeWaveCanvas();
    }

    const ctx = _waveCtx;
    const cw = _waveW;
    const ch = _waveH;
    ctx.clearRect(0, 0, cw, ch);

    const barGap = 3;
    const barWidth = 2;
    const step = barGap + barWidth;
    const count = Math.floor(cw / step);
    const left = (cw - count * step) / 2;
    const trackSeed = String(track?.id || track?.title || "claudio").length;
    const playedRatio = clamp(Number.isFinite(progressRatio) ? progressRatio : 0, 0, 1);
    _wavePhase += isPlaying ? 0.010 : 0.0015;

    for (let i = 0; i < count; i++) {
      const x = left + i * step;
      const center = i / Math.max(1, count);
      const env = 0.55 + 0.45 * Math.sin(center * Math.PI);
      const n1 = Math.sin(i * 0.18 + _wavePhase * 2.2 + trackSeed * 0.05) * 0.5 + 0.5;
      const n2 = Math.sin(i * 0.42 + _wavePhase * 1.1 + waveRand(i + trackSeed) * 6) * 0.5 + 0.5;
      const n3 = Math.sin(i * 0.08 + _wavePhase * 0.8) * 0.5 + 0.5;
      const isPlayed = i / Math.max(1, count - 1) <= playedRatio;
      const progressLift = isPlayed ? 0.1 : 0;
      const noise = waveRand(i + Math.floor(_wavePhase * 2) + trackSeed) * (isPlaying ? 4 : 8);
      const amp = n1 * 0.55 + n2 * 0.35 + n3 * 0.1 + progressLift;
      let h = amp * env * ch * (isPlaying ? 1.22 : 1.05);
      h += noise;
      h = Math.max(4, Math.min(ch - 4, h));
      const y = ch - h;
      const alpha = Math.min(0.92, 0.55 + 0.4 * (1 - Math.pow(center - 0.5, 2) * 2));
      ctx.fillStyle = isPlayed
        ? `rgba(82, 183, 255, ${Math.min(0.96, alpha + 0.08)})`
        : `rgba(255,255,255,${alpha})`;
      ctx.fillRect(x, y, barWidth, h);
    }
  }

  function animateVisualizer() {
    if (!_analyser || !_vizBars.length) return;

    const bufferLength = _analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    _analyser.getByteFrequencyData(dataArray);

    // Map frequency bins to our bar count
    const binStep = bufferLength / VIZ_BAR_COUNT;
    for (let i = 0; i < VIZ_BAR_COUNT; i++) {
      // Average a range of frequency bins per bar
      const start = Math.floor(i * binStep);
      const end = Math.floor((i + 1) * binStep);
      let sum = 0;
      for (let j = start; j < end; j++) {
        sum += dataArray[j];
      }
      const avg = sum / (end - start);
      // Normalize to 0–1, apply power curve for visual drama
      const normalized = Math.pow(avg / 255, 0.8);
      // Min height so bars are always visible
      const h = Math.max(3, normalized * 100);
      _vizBars[i].style.height = h + "%";
    }
  }

  function animateIdleVisualizer(time) {
    if (!_vizBars.length) return;
    for (let i = 0; i < _vizBars.length; i++) {
      const phase = (time / 1400) + (i / _vizBars.length) * Math.PI * 2;
      const h = 12 + Math.sin(phase) * 10 + Math.sin(phase * 2.7 + 0.8) * 6 + Math.sin(phase * 0.3 + 2.1) * 4;
      _vizBars[i].style.height = Math.max(4, h) + "%";
    }
  }
  const remoteSession = {
    available: false,
    configured: false,
    loggedIn: false,
    playerConfigured: false,
    ready: false,
    snapshot: null,
    track: null,
    message: "",
    queue: [],
    desktopQueueTracks: [],
    desktopQueueVisible: 10,
    favoriteActive: false,
    statusTimer: 0,
    nowTimer: 0,
    loginTimer: 0,
  };
  var _fetchNowPending = false;

  function isRemoteMode() {
    return Boolean(remoteSession.ready && remoteSession.snapshot);
  }

  function getDisplayVolume() {
    if (isRemoteMode() && Number.isFinite(remoteSession.snapshot?.transport?.volume)) {
      return clamp(remoteSession.snapshot.transport.volume / 100, 0, 1);
    }
    return controller.state.volume;
  }

  function getDisplayMuted() {
    if (isRemoteMode()) {
      return getDisplayVolume() === 0;
    }
    return controller.state.muted;
  }

  function getStatusLabel(isPlaying, duration) {
    if (remoteSession.message && remoteSession.available) {
      return remoteSession.message;
    }
    if (remoteSession.available && !remoteSession.configured) {
      return "Music API Setup Needed";
    }
    if (remoteSession.available && remoteSession.configured && !remoteSession.loggedIn) {
      return "Login Required";
    }
    if (remoteSession.available && remoteSession.loggedIn && !remoteSession.playerConfigured) {
      return "Player Setup Needed";
    }
    if (isRemoteMode()) {
      return isPlaying ? "Playing" : duration > 0 ? "Paused" : "Stopped";
    }
    return isPlaying ? "Speaking..." : "Paused";
  }

  function syncRemoteSnapshot(snapshot) {
    if (!snapshot) {
      return;
    }

    remoteSession.snapshot = snapshot;
    remoteSession.track = buildTrackFromClaudioNow(snapshot, controller.getCurrentTrack());

    if (audioEl && remoteSession.track.src) {
      if (audioEl.getAttribute("src") !== remoteSession.track.src) {
        audioEl.setAttribute("src", remoteSession.track.src);
        audioEl.load();
      }
      audioEl.volume = controller.state.volume;
      audioEl.muted = controller.state.muted;
      // Only sync time from backend on initial load (when src changed),
      // not on every poll — the browser tracks actual playback time locally.
      if (remoteSession._lastSrc !== remoteSession.track.src) {
        remoteSession._lastSrc = remoteSession.track.src;
        if (Number.isFinite(remoteSession.track.currentTime) && remoteSession.track.currentTime > 0) {
          audioEl.currentTime = remoteSession.track.currentTime;
        }
      }
      if (snapshot.track?.status === "playing" && audioEl.paused) {
        const playPromise = audioEl.play();
        if (playPromise && typeof playPromise.catch === "function") {
          playPromise.catch(() => {
            remoteSession.message = "Browser blocked autoplay; press Play once.";
            controller.syncPlaying(false);
            render();
          });
        }
      }
      if (snapshot.track?.status !== "playing") {
        if (!audioEl.paused) {
          remoteSession._nonPlayingCount = (remoteSession._nonPlayingCount || 0) + 1;
          if (remoteSession._nonPlayingCount >= 3) {
            audioEl.pause();
          }
        }
      } else {
        remoteSession._nonPlayingCount = 0;
      }
    } else if (audioEl && !audioEl.paused) {
      remoteSession._nonPlayingCount = (remoteSession._nonPlayingCount || 0) + 1;
      if (remoteSession._nonPlayingCount >= 3) {
        audioEl.pause();
      }
    }

    if (Number.isFinite(remoteSession.track.duration) && remoteSession.track.duration > 0) {
      controller.syncDuration(remoteSession.track.duration);
    }

    // Only sync position from backend when audio plays remotely (no local src).
    // When audio plays locally, the timeupdate handler tracks actual progress.
    if (!remoteSession.track.src && Number.isFinite(remoteSession.track.currentTime) && remoteSession.track.currentTime >= 0) {
      controller.syncCurrentTime(remoteSession.track.currentTime);
    }

    controller.syncPlaying(snapshot.track?.status === "playing");

    if (Number.isFinite(snapshot.transport?.volume)) {
      controller.setVolume(clamp(snapshot.transport.volume / 100, 0, 1));
    }
  }

  function showLoginModal(payload = {}) {
    if (!loginModalEl) return;
    loginModalEl.hidden = false;
    if (loginQrEl) {
      loginQrEl.src = payload.qrImg || payload.qrCodeUrl || "";
      loginQrEl.hidden = !loginQrEl.src;
    }
    if (loginMessageEl) {
      loginMessageEl.textContent = payload.message || "Scan the QR code in NetEase Cloud Music.";
    }
  }

  function hideLoginModal() {
    if (loginModalEl) loginModalEl.hidden = true;
    if (remoteSession.loginTimer) {
      clearInterval(remoteSession.loginTimer);
      remoteSession.loginTimer = 0;
    }
  }

  function startLoginPolling() {
    if (remoteSession.loginTimer || !api) return;
    remoteSession.loginTimer = window.setInterval(async () => {
      try {
        const payload = await api.transportStatus();
        // Auto-update QR if it changed (server auto-refreshes expired QR)
        var newQr = payload?.login?.qrImg || "";
        if (newQr && loginQrEl && loginQrEl.src !== newQr) {
          loginQrEl.src = newQr;
          loginQrEl.hidden = false;
        }
        if (loginMessageEl && payload?.login?.message) {
          loginMessageEl.textContent = payload.login.message;
        }
      } catch (_) {}

      await fetchTransportStatus();
      if (remoteSession.loggedIn) {
        if (loginMessageEl) loginMessageEl.textContent = "Logged in. Loading your playlists...";
        setTimeout(hideLoginModal, 650);
        fetchNowSnapshot({ force: true });
      }
    }, 2500);
  }

  if (loginCloseEl) {
    loginCloseEl.addEventListener("click", hideLoginModal);
  }

  // Click status bar to trigger login when "Login Required" is shown
  if (statusEl) {
    statusEl.style.cursor = "default";
    statusEl.addEventListener("click", () => {
      if (
        remoteSession.available &&
        remoteSession.configured &&
        !remoteSession.loggedIn &&
        api
      ) {
        triggerLogin();
      }
    });
  }

  // Profile Now section login/logout buttons
  if (nowLoginEl) {
    nowLoginEl.addEventListener("click", () => triggerLogin());
  }
  if (nowLogoutEl) {
    nowLogoutEl.addEventListener("click", async () => {
      if (!api) return;
      try {
        await api.logout();
        remoteSession.loggedIn = false;
        remoteSession.ready = false;
        remoteSession.snapshot = null;
        remoteSession.track = null;
        remoteSession.message = "";
        remoteSession.queue = [];
        stopNowPolling();
        render();
        if (nowLoginEl) nowLoginEl.hidden = false;
        if (nowLogoutEl) nowLogoutEl.hidden = true;
      } catch {}
    });
  }

  function triggerLogin() {
    if (!api) return;
    api.login()
      .then((payload) => {
        showLoginModal(payload);
        startLoginPolling();
        if (payload.clickableUrl && !payload.qrImg) {
          window.open(payload.clickableUrl, "_blank", "noopener");
        }
        fetchTransportStatus();
      })
      .catch(() => {});
  }

  function startStatusPolling() {
    if (remoteSession.statusTimer || !api) {
      return;
    }
    remoteSession.statusTimer = window.setInterval(fetchTransportStatus, 10000);
  }

  function startNowPolling() {
    if (remoteSession.nowTimer || !api) {
      return;
    }
    remoteSession.nowTimer = window.setInterval(fetchNowSnapshot, 1500);
  }

  function stopNowPolling() {
    if (!remoteSession.nowTimer) {
      return;
    }
    window.clearInterval(remoteSession.nowTimer);
    remoteSession.nowTimer = 0;
  }

  function renderTaste(taste) {
    if (!tasteTagsEl || !taste) {
      return;
    }
    const tags = Array.isArray(taste.tags) ? taste.tags : [];
    tasteTagsEl.innerHTML = "";
    if (!tags.length) {
      tasteTagsEl.innerHTML = '<span class="taste-tag">quiet mode</span>';
      return;
    }
    tags.forEach((tag) => {
      const item = document.createElement("span");
      item.className = "taste-tag";
      item.textContent = tag;
      tasteTagsEl.appendChild(item);
    });
  }

  function renderPlan(plan) {
    if (!planListEl || !plan) {
      return;
    }
    const items = Array.isArray(plan.items) ? plan.items : [];
    planListEl.innerHTML = "";
    items.forEach((item) => {
      const row = document.createElement("li");
      row.className = "plan-item";
      row.innerHTML =
        '<span class="plan-item__time">' +
        (item.time || "") +
        '</span><span class="plan-item__label">' +
        (item.label || "") +
        "</span>";
      planListEl.appendChild(row);
    });
  }

  function renderStats(stats) {
    if (!statsGridEl || !topListEl || !stats) {
      return;
    }

    const [todayEl, weekEl, tracksEl] = statsGridEl.querySelectorAll(".stat__value");
    if (todayEl) todayEl.textContent = String(stats.todayMinutes ?? 0);
    if (weekEl) weekEl.textContent = String(stats.weekMinutes ?? 0);
    if (tracksEl) tracksEl.textContent = String(stats.tracks ?? 0);

    topListEl.innerHTML = "";
    const topItems = Array.isArray(stats.top) ? stats.top : [];
    if (!topItems.length) {
      topListEl.innerHTML = '<li class="top-item">No listening history yet</li>';
      return;
    }

    topItems.forEach((item) => {
      const row = document.createElement("li");
      row.className = "top-item";
      row.textContent = [item.title, item.artist].filter(Boolean).join(" — ");
      topListEl.appendChild(row);
    });
  }

  async function hydrateProfile() {
    if (!api) {
      return;
    }
    try {
      const [taste, plan, stats, now] = await Promise.all([
        api.taste(),
        api.plan(),
        api.stats(),
        api.now(),
      ]);
      renderTaste(taste);
      renderPlan(plan);
      renderStats(stats);
      if (nowTitleEl) {
        nowTitleEl.textContent = now?.track?.title || "Nothing playing";
      }
      if (nowSubEl) {
        nowSubEl.textContent = [now?.track?.artist, now?.track?.album].filter(Boolean).join(" • ") || "not connected";
      }
    } catch {}
  }

  async function fetchTransportStatus() {
    if (!api) {
      return;
    }

    try {
      const payload = await api.transportStatus();
      remoteSession.available = Boolean(payload.available);
      remoteSession.configured = Boolean(payload.configured);
      remoteSession.loggedIn = Boolean(payload.loggedIn);
      remoteSession.playerConfigured = Boolean(payload.playerConfigured);
      remoteSession.ready = Boolean(payload.readyForRemotePlayback);
      remoteSession.message = payload.message || "";

      if (payload.readyForRemotePlayback) {
        startNowPolling();
        await fetchNowSnapshot();
      } else if (payload.available) {
        // Even without login, try to fetch default track (server resolves
        // it via anonymous NetEase search so "If" is playable on first open).
        await fetchNowSnapshot({ force: true });
      } else {
        stopNowPolling();
      }

      render();
    } catch {
      remoteSession.available = false;
      remoteSession.ready = false;
      stopNowPolling();
      render();
    }
  }

  async function fetchNowSnapshot(options = {}) {
    if (_fetchNowPending) return;
    if (!api || (!remoteSession.ready && !options.force)) {
      return;
    }

    _fetchNowPending = true;
    try {
      const payload = await api.now();
      if (payload?.track) {
        remoteSession.available = true;
        remoteSession.ready = true;
        remoteSession.configured = true;
        remoteSession.loggedIn = true;
        remoteSession.playerConfigured = true;
        startNowPolling();
      }
      syncRemoteSnapshot(payload);
      remoteSession.message = payload?.meta?.message || "";
      render();
      if (nowTitleEl) {
        nowTitleEl.textContent = payload?.track?.title || "Nothing playing";
      }
      if (nowSubEl) {
        nowSubEl.textContent = [payload?.track?.artist, payload?.track?.album].filter(Boolean).join(" • ") || "not connected";
      }
    } catch {
      render();
    } finally {
      _fetchNowPending = false;
    }
  }

  window.claudio = window.claudio || {};
  window.claudio.refreshNow = function () {
    return fetchNowSnapshot({ force: true });
  };
  window.claudio.showLogin = function (payload) {
    showLoginModal(payload);
    startLoginPolling();
    fetchTransportStatus();
  };

  async function fetchQueueSnapshot() {
    if (!api || !remoteSession.ready) {
      return;
    }

    try {
      const payload = await api.next();
      remoteSession.queue = Array.isArray(payload?.items) ? payload.items.slice(0, 8) : [];
    } catch {
      remoteSession.queue = [];
    }
  }

  function getDisplayTrack() {
    return isRemoteMode() ? remoteSession.track ?? controller.getCurrentTrack() : controller.getCurrentTrack();
  }

  function normalizeQueueTrack(track) {
    return {
      encryptedId: String(track.encryptedId || track.id || track.originalId || ""),
      originalId: String(track.originalId || track.id || track.encryptedId || ""),
      id: String(track.id || track.originalId || track.encryptedId || ""),
      title: track.title || track.name || "Untitled",
      artist: track.artist || "",
      album: track.album || "",
      duration: track.duration || 0,
      canPlay: track.canPlay !== false,
      blockedReason: track.blockedReason || "",
    };
  }

  function renderDesktopQueue() {
    if (!desktopQueueListEl) return;
    const tracks = remoteSession.desktopQueueTracks || [];
    desktopQueueListEl.innerHTML = "";
    if (!tracks.length) {
      desktopQueueListEl.innerHTML = '<li class="desktop-queue__empty">正在加载喜欢的音乐...</li>';
      return;
    }

    tracks.slice(0, remoteSession.desktopQueueVisible).forEach((track, index) => {
      const item = document.createElement("li");
      item.className = "desktop-queue__item" + (track.canPlay === false ? " is-locked" : "");
      item.innerHTML =
        '<button class="desktop-queue__track" type="button">' +
        '<span class="desktop-queue__index">' +
        String(index + 1).padStart(2, "0") +
        "</span>" +
        '<span class="desktop-queue__copy"><strong>' +
        track.title +
        "</strong><small>" +
        [track.artist, track.album].filter(Boolean).join(" · ") +
        "</small></span>" +
        '<span class="desktop-queue__state">' +
        (track.canPlay === false ? "locked" : "play") +
        "</span></button>";
      const button = item.querySelector("button");
      if (track.canPlay === false) button.disabled = true;
      button.addEventListener("click", async () => {
        if (!api || track.canPlay === false) return;
        button.disabled = true;
        item.classList.add("is-sending");
        try {
          await api.play(track);
          await fetchNowSnapshot({ force: true });
        } catch (_) {
          item.classList.add("is-failed");
        } finally {
          item.classList.remove("is-sending");
          if (track.canPlay !== false) button.disabled = false;
        }
      });
      desktopQueueListEl.appendChild(item);
    });

    if (remoteSession.desktopQueueVisible < tracks.length) {
      const more = document.createElement("li");
      more.className = "desktop-queue__more-row";
      more.innerHTML =
        '<button class="desktop-queue__more" type="button">展开更多 · 还有 ' +
        (tracks.length - remoteSession.desktopQueueVisible) +
        " 首</button>";
      more.querySelector("button").addEventListener("click", () => {
        remoteSession.desktopQueueVisible = Math.min(remoteSession.desktopQueueVisible + 10, tracks.length);
        renderDesktopQueue();
      });
      desktopQueueListEl.appendChild(more);
    }
  }

  async function loadDesktopQueue() {
    if (!api) return;
    remoteSession.desktopQueueVisible = 10;
    renderDesktopQueue();
    try {
      const playlists = await api.playlists();
      const items = Array.isArray(playlists?.items) ? playlists.items : [];
      const liked =
        items.find((item) => /喜欢的音乐|已注笑喜欢/.test(item.title || "")) ||
        items.find((item) => item.selected) ||
        items[0];
      if (!liked?.encryptedId) {
        remoteSession.desktopQueueTracks = [];
        renderDesktopQueue();
        return;
      }
      const tracks = await api.playlistTracks(liked.encryptedId, 50);
      remoteSession.desktopQueueTracks = (tracks.items || []).map(normalizeQueueTrack);
      renderDesktopQueue();
    } catch (_) {
      if (desktopQueueListEl) {
        desktopQueueListEl.innerHTML = '<li class="desktop-queue__empty">喜欢的音乐暂时加载失败</li>';
      }
    }
  }

  function setDesktopQueueOpen(open) {
    if (!desktopQueueEl) return;
    desktopQueueEl.hidden = !open;
    document.body.classList.toggle("is-queue-open", open);
    queueToggleEl?.classList.toggle("is-active", open);
    if (open && !remoteSession.desktopQueueTracks.length) {
      loadDesktopQueue();
    }
  }

  // ─── Live audio visualizer ───
  function renderWaveform(track, progressRatio, isPlaying) {
    drawCanvasWave(track, progressRatio, isPlaying);
    return;

    // NetEase audio URLs are cross-origin and must not be piped through Web Audio.
    // Keep playback on the native <audio> element and use a safe procedural waveform.
    if (ENABLE_LIVE_ANALYSER && isPlaying && audioEl && !audioEl.paused) {
      const analyser = ensureAnalyser();
      if (analyser) {
        connectAudioSource();
        if (_audioCtx && _audioCtx.state === "suspended") {
          _audioCtx.resume().catch(() => {});
        }
        animateVisualizer();
      } else {
        // Fallback: fake energy from waveform data
        animateIdleVisualizer(performance.now() * 3);
      }
    } else {
      // Idle: gentle breathing animation
      animateIdleVisualizer(performance.now());
    }
  }

  function renderTranscript(track, currentTime) {
    const hasTranscript = Array.isArray(track.transcript) && track.transcript.length > 0;
    const renderId = hasTranscript ? track.id : `${track.id || "remote"}::no-lyrics`;

    if (!hasTranscript && isRemoteMode()) {
      if (renderId !== previousTrackId) {
        transcriptEl.innerHTML = "";
        const empty = document.createElement("div");
        empty.className = "transcript-line";
        empty.innerHTML = `<span class="transcript-time">lyrics</span><span class="transcript-copy">${track.id ? "暂无歌词或歌词加载中。" : "正在等待歌曲。"}</span>`;
        transcriptEl.appendChild(empty);
      }
      previousTrackId = renderId;
      activeTranscriptIndex = -1;
      return;
    }
    const nextActiveIndex = getActiveTranscriptIndex(track.transcript, currentTime);

    if (renderId !== previousTrackId) {
      transcriptEl.innerHTML = "";

      track.transcript.forEach((line, index) => {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "transcript-line";
        row.dataset.index = String(index);
        row.dataset.time = String(line.time);
        row.innerHTML = `<span class="transcript-time">${formatTime(line.time)}</span><span class="transcript-copy">${line.text}</span>`;
        row.addEventListener("click", async () => {
          if (isRemoteMode() && api) {
            try {
              await api.seek(line.time);
              await fetchNowSnapshot();
            } catch {}
            return;
          }
          controller.seekTo(line.time);
          render();
        });
        transcriptEl.appendChild(row);
      });
    }

    if (nextActiveIndex !== activeTranscriptIndex || renderId !== previousTrackId) {
      const rows = transcriptEl.querySelectorAll(".transcript-line");
      rows.forEach((row, index) => {
        row.classList.toggle("is-active", index === nextActiveIndex);
      });

      const activeRow = transcriptEl.querySelector(`.transcript-line[data-index="${nextActiveIndex}"]`);
      if (activeRow) {
        window.requestAnimationFrame(() => {
          const containerRect = transcriptEl.getBoundingClientRect();
          const rowRect = activeRow.getBoundingClientRect();
          const desiredTop =
            transcriptEl.scrollTop +
            (rowRect.top - containerRect.top) -
            (transcriptEl.clientHeight - rowRect.height) / 2;
          const maxTop = Math.max(0, transcriptEl.scrollHeight - transcriptEl.clientHeight);
          transcriptEl.scrollTop = clamp(desiredTop, 0, maxTop);
        });
      }
    }

    activeTranscriptIndex = nextActiveIndex;
    previousTrackId = renderId;
  }

  function render() {
    const track = isRemoteMode() ? remoteSession.track ?? controller.getCurrentTrack() : controller.getCurrentTrack();
    const { state } = controller;
    const displayTime =
      isRemoteMode() && !remoteSession.track?.src && Number.isFinite(remoteSession.snapshot?.track?.position)
        ? remoteSession.snapshot.track.position
        : state.currentTime;
    const displayIsPlaying = isRemoteMode() ? remoteSession.snapshot?.track?.status === "playing" : state.isPlaying;
    const displayVolume = getDisplayVolume();
    const displayMuted = getDisplayMuted();
    const progressRatio = track.duration === 0 ? 0 : displayTime / track.duration;

    root.style.setProperty("--accent", track.accent);
    titleEl.textContent = track.title;
    subtitleEl.textContent = track.subtitle || `${track.artist} - ${track.album}`;
    artistBadgeEl.textContent = track.artist;
    albumBadgeEl.textContent = track.album;
    currentTimeEl.textContent = formatTime(displayTime);
    durationEl.textContent = formatTime(track.duration);
    statusEl.textContent = getStatusLabel(displayIsPlaying, track.duration);
    statusDotEl.classList.toggle("is-playing", displayIsPlaying);
    // Make status bar clickable when login is needed
    const needsLogin = remoteSession.available && remoteSession.configured && !remoteSession.loggedIn;
    statusEl.classList.toggle("is-clickable", needsLogin);
    statusEl.style.cursor = needsLogin ? "pointer" : "default";
    statusEl.title = needsLogin ? "Click to log in" : "";
    // Profile Now login/logout buttons
    if (nowLoginEl) nowLoginEl.hidden = !needsLogin;
    if (nowLogoutEl) nowLogoutEl.hidden = !remoteSession.loggedIn;
    playButtonEl.textContent =
      remoteSession.available && remoteSession.configured && !remoteSession.loggedIn
        ? "Login"
        : displayIsPlaying
          ? "Pause"
          : "Play";
      playButtonEl.setAttribute("aria-pressed", String(displayIsPlaying));
      shuffleButtonEl.classList.toggle("is-active", state.isShuffleOn);
      repeatButtonEl.classList.toggle("is-active", state.isRepeatOn);
      favoriteButtonEl?.classList.toggle("is-active", remoteSession.favoriteActive);
      progressFillEl.style.width = `${progressRatio * 100}%`;
    progressThumbEl.style.left = `${progressRatio * 100}%`;
    volumeFillEl.style.width = `${displayVolume * 100}%`;
    volumeThumbEl.style.left = `${displayVolume * 100}%`;
    volumeButtonEl.textContent = getSpeakerGlyph({ volume: displayVolume, muted: displayMuted });
    volumeButtonEl.setAttribute("aria-pressed", String(displayMuted));
    renderTranscript(track, displayTime);
  }

  function replaceTrackList(nextTracks) {
    TRACKS.splice(0, TRACKS.length, ...nextTracks);
    previousTrackId = "";
    activeTranscriptIndex = -1;
    controller.setTrack(0);
  }

  function loadCurrentTrack({ autoplay = false } = {}) {
    if (!audioEl) {
      render();
      return;
    }

    if (isRemoteMode()) {
      render();
      return;
    }

    const track = controller.getCurrentTrack();
    const src = track.src ?? "";

    if (audioEl.getAttribute("src") !== src) {
      audioEl.setAttribute("src", src);
      audioEl.load();
    }

    audioEl.volume = controller.state.volume;
    audioEl.muted = controller.state.muted;
    controller.syncCurrentTime(0);

    if (autoplay) {
      const playPromise = audioEl.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => {
          controller.syncPlaying(false);
          render();
        });
      }
    } else {
      controller.syncPlaying(false);
    }

    render();
  }

  function applyTweak(input) {
    const target = document.documentElement;

    if (input.dataset.tweak === "tone") {
      target.style.setProperty("--hero-hue", input.value);
    }

    if (input.dataset.tweak === "blue") {
      target.style.setProperty("--blue-hue", input.value);
    }

    if (input.dataset.tweak === "blur") {
      target.style.setProperty("--glass-blur", `${input.value}px`);
    }
  }

  function animate(now) {
    const deltaSeconds = (now - lastFrame) / 1000;
    lastFrame = now;
    if (!audioEl && !isRemoteMode()) {
      controller.step(deltaSeconds);
    }

    const playerView = root.closest("[data-view]");
    const isPlayerVisible = !playerView || playerView.classList.contains("is-active");
    if (isPlayerVisible) {
      const track = isRemoteMode() ? remoteSession.track ?? controller.getCurrentTrack() : controller.getCurrentTrack();
      const displayTime =
        isRemoteMode() && !remoteSession.track?.src && Number.isFinite(remoteSession.snapshot?.track?.position)
          ? remoteSession.snapshot.track.position
          : controller.state.currentTime;
      const displayIsPlaying = isRemoteMode()
        ? remoteSession.snapshot?.track?.status === "playing"
        : controller.state.isPlaying;
      const progressRatio = track.duration === 0 ? 0 : displayTime / track.duration;
      renderWaveform(track, progressRatio, displayIsPlaying);
    }

    const domInterval = controller.state.isPlaying || remoteSession.snapshot?.track?.status === "playing" ? 250 : 750;
    if (now - _lastDomRenderAt > domInterval) {
      _lastDomRenderAt = now;
      render();
    }
    requestAnimationFrame(animate);
  }

  root.querySelector("[data-wave-tap]").addEventListener("click", (event) => {
    const track = isRemoteMode() ? remoteSession.track ?? controller.getCurrentTrack() : controller.getCurrentTrack();
    const nextTime = seekFromPointer(event, event.currentTarget, track.duration);
    if (isRemoteMode() && api) {
      api.seek(Number(nextTime.toFixed(2)))
        .then(fetchNowSnapshot)
        .catch(() => {});
      return;
    }
    controller.seekTo(nextTime);
    if (audioEl) {
      audioEl.currentTime = controller.state.currentTime;
    }
    render();
  });

  async function seekProgressFromEvent(event, commit = true) {
    const track = isRemoteMode() ? remoteSession.track ?? controller.getCurrentTrack() : controller.getCurrentTrack();
    const nextTime = seekFromPointer(event, progressRailEl, track.duration);
    if (!Number.isFinite(nextTime)) return;
    progressFillEl.style.width = `${track.duration ? (nextTime / track.duration) * 100 : 0}%`;
    progressThumbEl.style.left = `${track.duration ? (nextTime / track.duration) * 100 : 0}%`;
    currentTimeEl.textContent = formatTime(nextTime);
    if (!commit) return;
    if (isRemoteMode() && api) {
      try {
        await api.seek(Number(nextTime.toFixed(2)));
        await fetchNowSnapshot({ force: true });
      } catch {}
      return;
    }
    controller.seekTo(nextTime);
    if (audioEl) {
      audioEl.currentTime = controller.state.currentTime;
    }
    render();
  }

  progressRailEl.addEventListener("click", (event) => {
    if (_isProgressDragging || _suppressProgressClick) {
      _suppressProgressClick = false;
      return;
    }
    seekProgressFromEvent(event);
  });

  progressRailEl.addEventListener("pointerdown", (event) => {
    _isProgressDragging = true;
    progressRailEl.setPointerCapture?.(event.pointerId);
    seekProgressFromEvent(event, false);
  });

  progressRailEl.addEventListener("pointermove", (event) => {
    if (!_isProgressDragging) return;
    seekProgressFromEvent(event, false);
  });

  progressRailEl.addEventListener("pointerup", (event) => {
    if (!_isProgressDragging) return;
    _isProgressDragging = false;
    _suppressProgressClick = true;
    progressRailEl.releasePointerCapture?.(event.pointerId);
    seekProgressFromEvent(event);
  });

  progressRailEl.addEventListener("pointercancel", (event) => {
    _isProgressDragging = false;
    progressRailEl.releasePointerCapture?.(event.pointerId);
  });

  volumeRailEl.addEventListener("click", (event) => {
    const nextVolume = seekFromPointer(event, volumeRailEl, 1);
    if (isRemoteMode() && api) {
      api.volume(Math.round(nextVolume * 100))
        .then(fetchNowSnapshot)
        .catch(() => {});
      return;
    }
    controller.setVolume(nextVolume);
    if (audioEl) {
      audioEl.volume = controller.state.volume;
      audioEl.muted = controller.state.muted;
    }
    render();
  });

  playButtonEl.addEventListener("click", () => {
    if (remoteSession.available && remoteSession.configured && !remoteSession.loggedIn && api) {
      triggerLogin();
      return;
    }

    // Auto-resolve tracks with no audio source via NetEase search.
    const currentTrack = controller.getCurrentTrack();
    if (!isRemoteMode() && currentTrack && !currentTrack.src && api && api.search) {
      const query = [currentTrack.title, currentTrack.artist].filter(Boolean).join(" ");
      playButtonEl.disabled = true;
      statusEl.textContent = "Searching...";
      render();
      api.search(query, 5)
        .then((resp) => {
          const songs = (resp && resp.songs) ? resp.songs : [];
          if (!songs.length) {
            statusEl.textContent = "No results found";
            render();
            return null;
          }
          const song = songs[0];
          const track = {
            encryptedId: String(song.id),
            originalId: String(song.id),
            title: song.name || song.title,
            artist: song.artist || "",
            album: song.album || "",
          };
          return api.play(track);
        })
        .then((result) => {
          if (!result) {
            return;
          }
          if (result && result.success === false) {
            statusEl.textContent = "Play failed";
          } else {
            fetchNowSnapshot({ force: true });
          }
        })
        .catch(() => {
          statusEl.textContent = "Search failed";
        })
        .finally(() => {
          playButtonEl.disabled = false;
          render();
        });
      return;
    }

    if (isRemoteMode() && api) {
      if (remoteSession.snapshot?.meta?.message === "Queue empty") {
        remoteSession.message = "Queue Empty";
        render();
        return;
      }
      const wasPlaying = remoteSession.snapshot?.track?.status === "playing";
      remoteSession.snapshot = {
        ...remoteSession.snapshot,
        track: {
          ...(remoteSession.snapshot?.track ?? {}),
          status: wasPlaying ? "paused" : "playing",
        },
      };
      if (remoteSession.track) {
        remoteSession.track = {
          ...remoteSession.track,
          status: wasPlaying ? "paused" : "playing",
        };
      }
      controller.syncPlaying(!wasPlaying);
      render();
      // Control audio element locally for instant response
      if (audioEl && remoteSession.track?.src) {
        if (wasPlaying) {
          audioEl.pause();
        } else {
          const playPromise = audioEl.play();
          if (playPromise && typeof playPromise.catch === "function") {
            playPromise.catch(() => {});
          }
        }
      }
      api.toggle().catch((error) => {
        // Revert optimistic update on failure
        controller.syncPlaying(wasPlaying);
        if (remoteSession.snapshot?.track) {
          remoteSession.snapshot.track.status = wasPlaying ? "playing" : "paused";
        }
        if (error?.reason === "queue-empty") {
          remoteSession.message = "Queue Empty";
        }
        // Revert audio state
        if (audioEl && remoteSession.track?.src) {
          if (wasPlaying) {
            audioEl.play().catch(() => {});
          } else {
            audioEl.pause();
          }
        }
        render();
      });
      return;
    }

    if (!audioEl) {
      controller.togglePlay();
      render();
      return;
    }

    if (audioEl.paused) {
      controller.syncPlaying(true);
      const playPromise = audioEl.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => {
          controller.syncPlaying(false);
          render();
        });
      }
    } else {
      audioEl.pause();
      controller.syncPlaying(false);
    }
    render();
  });

  prevButtonEl.addEventListener("click", () => {
    if (isRemoteMode() && api) {
      api.prev()
        .then(fetchNowSnapshot)
        .catch(() => {});
      return;
    }
    const shouldResume = controller.state.isPlaying;
    controller.prevTrack();
    loadCurrentTrack({ autoplay: shouldResume });
  });

  nextButtonEl.addEventListener("click", () => {
    if (isRemoteMode() && api) {
      api.nextTrack()
        .then(fetchNowSnapshot)
        .catch(() => {});
      return;
    }
    const shouldResume = controller.state.isPlaying;
    controller.nextTrack();
    loadCurrentTrack({ autoplay: shouldResume });
  });

  // External track injection — used by brain-driven recommendations.
  // The dispatcher hands us a fully resolved track {title, artist, audioUrl, duration, ...}.
  document.addEventListener("claudio:play-external", (event) => {
    const incoming = event.detail?.track;
    if (!incoming || !incoming.audioUrl) return;

    const synthTrack = {
      id: `ext-${Date.now()}`,
      title: incoming.title || incoming.query || "External track",
      artist: incoming.artist || "",
      album: incoming.album || "",
      duration: Number.isFinite(incoming.duration) && incoming.duration > 0 ? incoming.duration : 0,
      accent: incoming.accent || "#4ade80",
      src: incoming.audioUrl,
      waveform: createWaveform(0.5 + Math.random() * 0.4, 0.3 + Math.random() * 0.4, 68),
      transcript: Array.isArray(incoming.transcript) ? incoming.transcript : [],
    };

    replaceTrackList([synthTrack]);
    loadCurrentTrack({ autoplay: true });
  });

  shuffleButtonEl.addEventListener("click", () => {
    controller.toggleShuffle();
    render();
  });

  repeatButtonEl.addEventListener("click", () => {
    controller.toggleRepeat();
    render();
  });

  queueToggleEl?.addEventListener("click", () => {
    setDesktopQueueOpen(!desktopQueueEl || desktopQueueEl.hidden);
  });

  queueCloseEl?.addEventListener("click", () => {
    setDesktopQueueOpen(false);
  });

  favoriteButtonEl?.addEventListener("click", async () => {
    if (!api) return;
    const track = getDisplayTrack();
    if (!track) return;
    favoriteButtonEl.disabled = true;
    try {
      if (remoteSession.favoriteActive) {
        await api.removeFavorite({ id: track.id || track.originalId || track.encryptedId, title: track.title });
        remoteSession.favoriteActive = false;
      } else {
        await api.addFavorite(track);
        remoteSession.favoriteActive = true;
      }
      favoriteButtonEl.textContent = remoteSession.favoriteActive ? "♥" : "♡";
      render();
    } catch (_) {
      favoriteButtonEl.classList.add("is-error");
      setTimeout(() => favoriteButtonEl.classList.remove("is-error"), 1200);
    } finally {
      favoriteButtonEl.disabled = false;
    }
  });

  volumeButtonEl.addEventListener("click", () => {
    if (isRemoteMode() && api) {
      const nextLevel = getDisplayVolume() > 0 ? 0 : Math.round((controller.state.previousVolume || 0.72) * 100);
      api.volume(nextLevel)
        .then(fetchNowSnapshot)
        .catch(() => {});
      return;
    }
    controller.toggleMute();
    if (audioEl) {
      audioEl.volume = controller.state.volume;
      audioEl.muted = controller.state.muted;
    }
    render();
  });

  tweakInputs.forEach((input) => {
    applyTweak(input);
    input.addEventListener("input", () => {
      applyTweak(input);
    });
  });

  if (audioEl) {
    audioEl.preload = "metadata";
    audioEl.volume = controller.state.volume;
    audioEl.muted = controller.state.muted;
    audioEl.addEventListener("loadedmetadata", () => {
      if (isRemoteMode() && !remoteSession.track?.src) {
        return;
      }
      controller.syncDuration(audioEl.duration);
      render();
    });
    audioEl.addEventListener("timeupdate", () => {
      // In remote mode, only skip time tracking when audio plays on server
      // (no local src). When audio plays locally (netease-api mode), track it.
      if (isRemoteMode() && !remoteSession.track?.src) {
        return;
      }
      controller.syncCurrentTime(audioEl.currentTime);
      render();
    });
    audioEl.addEventListener("play", () => {
      if (isRemoteMode()) {
        return;
      }
      controller.syncPlaying(true);
      render();
    });
    audioEl.addEventListener("pause", () => {
      if (isRemoteMode()) {
        return;
      }
      controller.syncPlaying(false);
      render();
    });
    audioEl.addEventListener("ended", () => {
      // In remote mode with local audio, trigger next track via API.
      // In remote mode without local audio (CLI), skip — server handles it.
      if (isRemoteMode() && remoteSession.track?.src && api) {
        api.nextTrack().then(fetchNowSnapshot).catch(() => {});
        return;
      }
      if (isRemoteMode()) {
        return;
      }
      if (controller.state.isRepeatOn) {
        audioEl.currentTime = 0;
        const playPromise = audioEl.play();
        if (playPromise && typeof playPromise.catch === "function") {
          playPromise.catch(() => {
            controller.syncPlaying(false);
            render();
          });
        }
        return;
      }

      controller.finishTrack();
      render();
    });
    audioEl.addEventListener("error", () => {
      if (audioEl.src && remoteSession.track?.status === "playing") {
        setTimeout(() => {
          if (audioEl && audioEl.src) {
            audioEl.load();
            audioEl.play().catch(() => {
              controller.syncPlaying(false);
              render();
            });
          }
        }, 2000);
      }
    });
    audioEl.addEventListener("stalled", () => {
      if (audioEl && !audioEl.paused && audioEl.src) {
        audioEl.load();
        audioEl.play().catch(() => {});
      }
    });
  }

  if (api?.live) {
    api.live.on((msg) => {
      if (msg?.type === "now") {
        fetchNowSnapshot({ force: true });
      }
      if (msg?.type === "taste") {
        api.taste().then(renderTaste).catch(() => {});
      }
      if (msg?.type === "plan") {
        api.plan().then(renderPlan).catch(() => {});
      }
    });
    api.live.connect();
  }

  buildVizBars();
  fetchNowSnapshot({ force: true });
  fetchTransportStatus();
  startStatusPolling();
  hydrateProfile();
  render();
  requestAnimationFrame(animate);
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", bootstrapPlayer);
}

const exported = {
  TRACKS,
  clamp,
  formatTime,
  getActiveTranscriptIndex,
  getNextTrackIndex,
  getPrevTrackIndex,
  parseTimedLyrics,
  buildTrackFromNeteaseData,
  buildTrackFromCliState,
  buildTrackFromClaudioNow,
  createPlayerController,
  getPlaylistTrackStatus,
  getChatReplyText,
  getChatMetaText,
  shouldShowPlaylistTrack,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = exported;
}

if (typeof window !== "undefined") {
  window.musicPlayerDemo = exported;
}
