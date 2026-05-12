const test = require("node:test");
const assert = require("node:assert/strict");

const {
  clamp,
  formatTime,
  getActiveTranscriptIndex,
  getNextTrackIndex,
  parseTimedLyrics,
  buildTrackFromNeteaseData,
  buildTrackFromPlaybackState,
  buildTrackFromClaudioNow,
  normalizeDesktopLayout,
  readDesktopLayout,
  writeDesktopLayout,
  createPlayerController,
  getPlaylistTrackStatus,
  getChatReplyText,
  getChatMetaText,
  shouldShowPlaylistTrack,
} = require("../script.js");

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

test("normalizeDesktopLayout clamps adjustable module sizes", () => {
  assert.deepEqual(
    normalizeDesktopLayout({ waveHeight: 40 }),
    { waveHeight: 72 }
  );
  assert.deepEqual(
    normalizeDesktopLayout({ waveHeight: 180 }),
    { waveHeight: 150 }
  );
  assert.deepEqual(
    normalizeDesktopLayout({ waveHeight: 118.6 }),
    { waveHeight: 119 }
  );
});

test("desktop layout persistence falls back when storage is empty or invalid", () => {
  const values = new Map();
  const storage = {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };

  assert.deepEqual(readDesktopLayout(storage), { waveHeight: 104 });
  values.set("claudioDesktopLayout", "{bad json");
  assert.deepEqual(readDesktopLayout(storage), { waveHeight: 104 });

  writeDesktopLayout(storage, { waveHeight: 130 });
  assert.deepEqual(readDesktopLayout(storage), { waveHeight: 130 });
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
  const controller = createPlayerController(
    [
      { duration: 120, transcript: [], waveform: [0.2] },
      { duration: 200, transcript: [], waveform: [0.4] },
      { duration: 180, transcript: [], waveform: [0.3] },
    ],
    { random: () => 0.99 }
  );

  controller.toggleShuffle();
  controller.nextTrack();

  assert.equal(controller.state.trackIndex, 2);
  assert.equal(controller.state.currentTime, 0);
});

test("controller moves to the previous track and wraps around", () => {
  const controller = createPlayerController([
    { duration: 120, transcript: [], waveform: [0.2] },
    { duration: 200, transcript: [], waveform: [0.4] },
    { duration: 180, transcript: [], waveform: [0.3] },
  ]);

  controller.prevTrack();
  assert.equal(controller.state.trackIndex, 2);

  controller.prevTrack();
  assert.equal(controller.state.trackIndex, 1);
});

test("controller handles repeat-at-end and normal end states", () => {
  const controller = createPlayerController([
    { duration: 120, transcript: [], waveform: [0.2] },
  ]);

  controller.togglePlay();
  controller.seekTo(120);
  controller.finishTrack();
  assert.equal(controller.state.isPlaying, false);
  assert.equal(controller.state.currentTime, 120);

  controller.toggleRepeat();
  controller.togglePlay();
  controller.finishTrack();
  assert.equal(controller.state.isPlaying, true);
  assert.equal(controller.state.currentTime, 0);
});

test("controller updates volume and restores it after mute", () => {
  const controller = createPlayerController([
    { duration: 120, transcript: [], waveform: [0.2] },
  ]);

  controller.setVolume(0.35);
  assert.equal(controller.state.volume, 0.35);
  assert.equal(controller.state.muted, false);

  controller.toggleMute();
  assert.equal(controller.state.muted, true);
  assert.equal(controller.state.volume, 0);

  controller.toggleMute();
  assert.equal(controller.state.muted, false);
  assert.equal(controller.state.volume, 0.35);
});

test("controller exposes the current track audio source and resets time on track change", () => {
  const controller = createPlayerController([
    { duration: 120, src: "assets/audio/one.mp3", transcript: [], waveform: [0.2] },
    { duration: 200, src: "assets/audio/two.mp3", transcript: [], waveform: [0.4] },
  ]);

  assert.equal(controller.getCurrentTrack().src, "assets/audio/one.mp3");
  controller.seekTo(45);
  controller.setTrack(1);

  assert.equal(controller.getCurrentTrack().src, "assets/audio/two.mp3");
  assert.equal(controller.state.currentTime, 0);
});

test("controller can sync real audio metadata and playback time", () => {
  const controller = createPlayerController([
    { duration: 120, src: "assets/audio/one.mp3", transcript: [], waveform: [0.2] },
  ]);

  controller.syncDuration(183.4);
  controller.syncCurrentTime(61.8);
  assert.equal(controller.getCurrentTrack().duration, 183.4);
  assert.equal(controller.state.currentTime, 61.8);

  controller.syncCurrentTime(999);
  assert.equal(controller.state.currentTime, 183.4);
});

test("parseTimedLyrics converts lrc text into timestamped transcript lines", () => {
  const transcript = parseTimedLyrics("[00:02.00]hello\n[01:10.50]world");

  assert.deepEqual(transcript, [
    { time: 2, text: "hello" },
    { time: 70.5, text: "world" },
  ]);
});

test("buildTrackFromNeteaseData maps detail and lyric payloads into player track shape", () => {
  const track = buildTrackFromNeteaseData({
    searchItem: {
      id: "123",
      name: "Song A",
      artists: [{ name: "Artist A" }],
      album: { name: "Album A" },
      coverImgUrl: "https://image",
    },
    detailItem: {
      songId: "123",
      name: "Song A",
      duration: 125000,
      url: "https://audio.example/song-a.mp3",
      album: { name: "Album A" },
      artists: [{ name: "Artist A" }],
      coverImgUrl: "https://image",
      playFlag: true,
      visible: true,
      vipPlayFlag: false,
    },
    lyricText: "[00:01.00]line one\n[00:04.20]line two",
  });

  assert.equal(track.id, "123");
  assert.equal(track.title, "Song A");
  assert.equal(track.artist, "Artist A");
  assert.equal(track.album, "Album A");
  assert.equal(track.duration, 125);
  assert.equal(track.src, "https://audio.example/song-a.mp3");
  assert.equal(track.canPlay, true);
  assert.deepEqual(track.transcript, [
    { time: 1, text: "line one" },
    { time: 4.2, text: "line two" },
  ]);
});

test("buildTrackFromPlaybackState creates a display track for remote playback", () => {
  const track = buildTrackFromPlaybackState(
    {
      title: "Nuit Blanche",
      artist: "Example Artist",
      album: "After Midnight",
      duration: 188,
    },
    {
      accent: "#7dd3fc",
      waveform: [0.1, 0.6],
    }
  );

  assert.equal(track.title, "Nuit Blanche");
  assert.equal(track.artist, "Example Artist");
  assert.equal(track.album, "After Midnight");
  assert.equal(track.duration, 188);
  assert.deepEqual(track.waveform, [0.1, 0.6]);
  assert.deepEqual(track.transcript, []);
});

test("buildTrackFromClaudioNow maps Claudio hub snapshot into a display track", () => {
  const track = buildTrackFromClaudioNow(
    {
      track: {
        id: "song-1",
        title: "Blinding Lights",
        artist: "The Weeknd",
        album: "After Hours",
        duration: 200,
        position: 18,
        transcript: [{ time: 4, text: "hello" }],
      },
      transport: {
        volume: 60,
      },
      meta: {
        ready: true,
        message: "",
      },
    },
    {
      accent: "#7dd3fc",
      waveform: [0.2, 0.7],
    }
  );

  assert.equal(track.id, "song-1");
  assert.equal(track.title, "Blinding Lights");
  assert.equal(track.artist, "The Weeknd");
  assert.equal(track.album, "After Hours");
  assert.equal(track.duration, 200);
  assert.equal(track.currentTime, 18);
  assert.equal(track.subtitle, "The Weeknd • After Hours");
  assert.deepEqual(track.transcript, [{ time: 4, text: "hello" }]);
  assert.deepEqual(track.waveform, [0.2, 0.7]);
});

test("getPlaylistTrackStatus separates tryable locked failed and sending states", () => {
  assert.equal(getPlaylistTrackStatus({ canPlay: true }), "try");
  assert.equal(getPlaylistTrackStatus({ canPlay: false }), "locked");
  assert.equal(getPlaylistTrackStatus({ blockedReason: "previous failure" }), "failed");
  assert.equal(getPlaylistTrackStatus({ playState: "sending" }), "sending");
  assert.equal(getPlaylistTrackStatus({ playState: "sent" }), "sent");
});

test("shouldShowPlaylistTrack supports hiding locked and failed songs", () => {
  assert.equal(shouldShowPlaylistTrack({ canPlay: true }, { hideLocked: true, hideFailed: true }), true);
  assert.equal(shouldShowPlaylistTrack({ canPlay: false }, { hideLocked: true }), false);
  assert.equal(shouldShowPlaylistTrack({ blockedReason: "previous failure" }, { hideFailed: true }), false);
  assert.equal(shouldShowPlaylistTrack({ canPlay: false }, { hideLocked: false }), true);
});

test("getChatReplyText accepts server reply field and legacy aliases", () => {
  assert.equal(getChatReplyText({ reply: "server reply" }), "server reply");
  assert.equal(getChatReplyText({ say: "legacy say" }), "legacy say");
  assert.equal(getChatReplyText({ text: "legacy text" }), "legacy text");
  assert.equal(getChatReplyText({ message: "legacy message" }), "legacy message");
  assert.equal(getChatReplyText({}), "(no response)");
});

test("getChatMetaText renders model reasons and executed actions", () => {
  assert.equal(getChatMetaText({ reason: "matched mood", executedActions: ["next"] }), "matched mood · ran next");
  assert.equal(getChatMetaText({ actions: ["diagnostics"] }), "diagnostics");
  assert.equal(getChatMetaText({}), "");
});
