const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseCliJsonOutput,
  parseCliConfigOutput,
  createCliActionArgs,
} = require("../server/ncm-cli.js");
const {
  extractEncryptedId,
  getCurrentQueueItem,
  mergeQueueItems,
  normalizeCliNow,
  pickDefaultPlaylist,
  normalizeQueueItems,
  normalizeCliTranscript,
} = require("../server/providers/music/cli.js");
const { buildTrackFromCliState } = require("../script.js");

test("parseCliJsonOutput parses pure json output", () => {
  const payload = parseCliJsonOutput('{"success":true,"state":{"status":"stopped"}}');

  assert.deepEqual(payload, {
    success: true,
    state: { status: "stopped" },
  });
});

test("parseCliJsonOutput can extract a json object from noisy output", () => {
  const payload = parseCliJsonOutput('\u001b[32mready\u001b[0m\n{"success":false,"message":"oops"}\n');

  assert.deepEqual(payload, {
    success: false,
    message: "oops",
  });
});

test("parseCliConfigOutput understands the human-readable config list", () => {
  const parsed = parseCliConfigOutput([
    "appId: demo-app (凭证文件)",
    "privateKey: MIIEvQIB*** (凭证文件)",
    "player: mpv",
  ].join("\n"));

  assert.deepEqual(parsed, {
    appId: "demo-app",
    hasAppId: true,
    hasPrivateKey: true,
    player: "mpv",
    playerConfigured: true,
  });
});

test("createCliActionArgs prepends output json for stable parsing", () => {
  assert.deepEqual(createCliActionArgs(["state"]), ["state", "--output", "json"]);
  assert.deepEqual(createCliActionArgs(["seek", "90"]), ["seek", "90", "--output", "json"]);
});

test("buildTrackFromCliState maps cli playback state into a display track", () => {
  const track = buildTrackFromCliState(
    {
      title: "夜曲",
      artist: "周杰伦",
      album: "十一月的萧邦",
      duration: 246,
    },
    {
      accent: "#8b7cff",
      waveform: [0.2, 0.4],
    }
  );

  assert.equal(track.title, "夜曲");
  assert.equal(track.artist, "周杰伦");
  assert.equal(track.album, "十一月的萧邦");
  assert.equal(track.duration, 246);
  assert.equal(track.accent, "#8b7cff");
  assert.deepEqual(track.waveform, [0.2, 0.4]);
  assert.deepEqual(track.transcript, []);
});

test("normalizeCliTranscript keeps valid timed lines only", () => {
  const transcript = normalizeCliTranscript([
    { time: 13.1, text: " hello " },
    { startTime: 18.2, text: "world" },
    { time: "bad", text: "skip" },
  ]);

  assert.deepEqual(transcript, [
    { time: 13.1, text: "hello" },
    { time: 18.2, text: "world" },
  ]);
});

test("normalizeCliNow returns Claudio-shaped now snapshot", () => {
  const snapshot = normalizeCliNow({
    state: {
      status: "playing",
      position: 42,
      duration: 188,
      volume: 55,
      queueLength: 3,
      track: {
        id: "song-1",
        title: "Blinding Lights",
        artist: "The Weeknd",
        album: "After Hours",
      },
    },
  });

  assert.equal(snapshot.track.title, "Blinding Lights");
  assert.equal(snapshot.track.artist, "The Weeknd");
  assert.equal(snapshot.track.status, "playing");
  assert.equal(snapshot.transport.volume, 55);
  assert.equal(snapshot.meta.ready, true);
  assert.equal(snapshot.meta.message, "");
});

test("normalizeQueueItems maps recommendation or queue records into playback seed items", () => {
  const items = normalizeQueueItems({
    data: [
      {
        originalId: 28306668,
        id: "DD60B0451A3086DBB6F523263EFEAD62",
        name: "Chandelier",
        duration: 216293,
        artists: [{ name: "Sia" }],
        album: { name: "Chandelier" },
        coverImgUrl: "http://image",
      },
    ],
  });

  assert.deepEqual(items, [
    {
      encryptedId: "DD60B0451A3086DBB6F523263EFEAD62",
      originalId: "28306668",
      title: "Chandelier",
      artist: "Sia",
      album: "Chandelier",
      duration: 216.293,
      coverImgUrl: "http://image",
    },
  ]);
});

test("normalizeQueueItems parses encrypted ids from queue labels", () => {
  const items = normalizeQueueItems({
    queue: [
      {
        index: 3,
        current: true,
        label: "DD60B0451A3086DBB6F523263EFEAD62 | 歌曲 ID: DD60B0451A3086DBB6F523263EFEAD62",
        prefix: "▶",
      },
    ],
  });

  assert.deepEqual(items, [
    {
      encryptedId: "DD60B0451A3086DBB6F523263EFEAD62",
      originalId: "",
      title: "DD60B0451A3086DBB6F523263EFEAD62",
      artist: "",
      album: "",
      duration: 0,
      coverImgUrl: "",
      current: true,
      index: 3,
    },
  ]);
});

test("mergeQueueItems enriches queue labels with metadata", () => {
  const merged = mergeQueueItems(
    [
      {
        encryptedId: "DD60B0451A3086DBB6F523263EFEAD62",
        originalId: "",
        title: "DD60B0451A3086DBB6F523263EFEAD62",
        artist: "",
        album: "",
        duration: 0,
        coverImgUrl: "",
        current: true,
        index: 3,
      },
    ],
    [
      {
        encryptedId: "DD60B0451A3086DBB6F523263EFEAD62",
        originalId: "28306668",
        title: "Chandelier",
        artist: "Sia",
        album: "Chandelier",
        duration: 216.293,
        coverImgUrl: "http://image",
      },
    ]
  );

  assert.equal(merged[0].title, "Chandelier");
  assert.equal(merged[0].artist, "Sia");
  assert.equal(merged[0].originalId, "28306668");
});

test("getCurrentQueueItem prefers the flagged current item", () => {
  const item = getCurrentQueueItem([
    { encryptedId: "one", current: false, index: 1 },
    { encryptedId: "two", current: true, index: 2 },
  ]);

  assert.deepEqual(item, { encryptedId: "two", current: true, index: 2 });
});

test("extractEncryptedId reads a 32-char id from a queue label", () => {
  assert.equal(
    extractEncryptedId("DD60B0451A3086DBB6F523263EFEAD62 | 歌曲 ID: DD60B0451A3086DBB6F523263EFEAD62"),
    "DD60B0451A3086DBB6F523263EFEAD62"
  );
});

test("pickDefaultPlaylist prefers liked music special playlist or matching configured name", () => {
  const playlist = pickDefaultPlaylist(
    [
      { encryptedId: "one", originalId: "1", title: "普通歌单", trackCount: 10, specialType: 0 },
      { encryptedId: "two", originalId: "2", title: "账户已注笑喜欢的音乐", trackCount: 300, specialType: 5 },
    ],
    "账户已注笑喜欢的音乐"
  );

  assert.deepEqual(playlist, {
    encryptedId: "two",
    originalId: "2",
    title: "账户已注笑喜欢的音乐",
    trackCount: 300,
    specialType: 5,
  });
});
