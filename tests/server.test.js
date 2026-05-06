const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getConfig,
} = require("../server/config.js");
const { createHubState } = require("../server/state/hub.js");
const { createDefaultStore } = require("../server/state/store.js");
const { createClaudioRouter } = require("../server/routes/claudio.js");
const { matchIntent } = require("../server/services/chat-router.js");
const {
  classifyPlaybackFailure,
  isMatchingPlaybackTrack,
} = require("../server/services/playback.js");
const {
  buildNeteaseApiSpawnArgs,
  buildRouteErrorResponse,
  sendJson,
} = require("../server/server.js");
const {
  buildPersonalizationSnapshot,
  inferScene,
} = require("../server/services/personalization.js");
const {
  normalizeSongItem: normalizeNeteaseApiSongItem,
  normalizeQrCheckPayload,
  normalizeQrPayload,
  pickDefaultPlaylist: pickNeteaseApiDefaultPlaylist,
} = require("../server/providers/music/ncma.js");

test("getConfig exposes only the NetEase API music provider configuration", () => {
  const config = getConfig();

  assert.equal(config.musicProvider, "netease-api");
  assert.equal(config.neteaseApi.baseUrl, "http://localhost:4000");
  assert.equal(config.neteaseApi.defaultSongQuery, "Bread If");
  assert.equal(config.neteaseApi.proxy, process.env.NETEASE_API_PROXY ?? "");
  assert.deepEqual(Object.keys(config).sort(), [
    "brain",
    "musicProvider",
    "neteaseApi",
    "port",
    "scheduler",
    "tts",
    "upnp",
    "weather",
  ]);
});

test("buildNeteaseApiSpawnArgs disables the upstream version check", () => {
  const args = buildNeteaseApiSpawnArgs();

  assert.equal(args[0], "-e");
  assert.match(args[1], /await require\('NeteaseCloudMusicApi\/server'\)\.serveNcmApi\(\{ checkVersion: false \}\)/);
  assert.doesNotMatch(args[1], /NeteaseCloudMusicApi\/app\.js/);
});

test("buildRouteErrorResponse maps backend dependency failures to HTTP 503", () => {
  const result = buildRouteErrorResponse(new Error("fetch failed"));

  assert.equal(result.statusCode, 503);
  assert.equal(result.payload.error, "Claudio hub request failed");
  assert.equal(result.payload.reason, "backend-unavailable");
  assert.equal(result.payload.detail, "fetch failed");
});

test("sendJson allows local Electron fetches from alternate origins", () => {
  let headers = null;
  let body = "";
  const response = {
    writeHead(statusCode, nextHeaders) {
      assert.equal(statusCode, 200);
      headers = nextHeaders;
    },
    end(nextBody) {
      body = nextBody;
    },
  };

  sendJson(response, 200, { ok: true });

  assert.equal(headers["Access-Control-Allow-Origin"], "*");
  assert.match(headers["Access-Control-Allow-Methods"], /GET/);
  assert.equal(body, "{\"ok\":true}");
});

test("createHubState stores and stamps Claudio snapshot updates", () => {
  const hub = createHubState();
  const before = hub.get().lastUpdatedAt;

  const next = hub.replace({
    now: {
      track: {
        id: "song-1",
        title: "Blinding Lights",
        transcript: [],
      },
      transport: {
        canPlay: true,
        canPause: true,
        canSeek: true,
        volume: 60,
      },
      meta: {
        ready: true,
        message: "",
      },
    },
  });

  assert.equal(next.now.track.id, "song-1");
  assert.ok(next.lastUpdatedAt >= before);
});

test("createClaudioRouter serves Claudio now snapshot", async () => {
  const hub = createHubState();
  hub.setNow({
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
    transport: {
      canPlay: true,
      canPause: true,
      canSeek: true,
      volume: 60,
    },
    meta: {
      ready: true,
      message: "",
    },
  });

  const router = createClaudioRouter({
    hub,
    stream: {
      addClient() {
        return () => {};
      },
      broadcast() {},
    },
    music: {
      async getNow() {
        return hub.get().now;
      },
      async getNext() {
        return [];
      },
      async toggle() {
        return {};
      },
      async prev() {
        return {};
      },
      async next() {
        return {};
      },
      async seek() {
        return {};
      },
      async volume() {
        return {};
      },
      async login() {
        return {};
      },
      async status() {
        return {};
      },
    },
  });

  let handled = false;
  await router.handle(
    new URL("http://localhost/api/now"),
    { method: "GET", on() {} },
    {
      raw: {
        write() {},
      },
      json(status, body) {
        handled = true;
        assert.equal(status, 200);
        assert.equal(body.track.title, "Blinding Lights");
        assert.equal(body.meta.ready, true);
      },
      sse() {},
    }
  );

  assert.equal(handled, true);
});

test("matchIntent detects local music commands", () => {
  assert.equal(matchIntent("你好").type, "hello");
  assert.equal(matchIntent("现在播放什么").type, "now");
  assert.equal(matchIntent("下一首").type, "next");
  assert.equal(matchIntent("版权为什么 locked").type, "copyright");
  assert.equal(matchIntent("recommend something").type, "recommend");
  assert.equal(matchIntent("why did playback fail").type, "diagnostics");
});

test("createClaudioRouter routes chat through local intent and store", async () => {
  const messages = [];
  const router = createClaudioRouter({
    hub: createHubState(),
    stream: {
      addClient() {
        return () => {};
      },
      broadcast() {},
    },
    store: {
      appendMessage(role, text, meta) {
        messages.push({ role, text, meta });
      },
    },
    music: {
      async getNow() {
        return {
          track: {
            title: "孤独症DEMO",
            artist: "功夫胖",
            status: "playing",
          },
        };
      },
      async getPlaylists() {
        return [];
      },
      async status() {
        return { state: { status: "stopped" } };
      },
    },
  });

  let responseBody = null;
  await router.handle(
    new URL("http://localhost/api/chat"),
    {
      method: "POST",
      on(event, callback) {
        if (event === "data") callback(Buffer.from(JSON.stringify({ message: "现在播放什么" })));
        if (event === "end") callback();
      },
    },
    {
      json(status, body) {
        assert.equal(status, 200);
        responseBody = body;
      },
    }
  );

  assert.match(responseBody.reply, /孤独症DEMO/);
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, "user");
  assert.equal(messages[1].role, "assistant");
});

test("handleChat executes safe brain actions against music facade", async () => {
  const actions = [];
  const { handleChat } = require("../server/services/chat-router.js");
  const reply = await handleChat({
    message: "build a darker radio mood",
    store: { appendMessage() {} },
    brain: {
      async ask() {
        return { reply: "Switching mood.", actions: ["next"] };
      },
    },
    music: {
      async next() {
        actions.push("next");
        return { success: true };
      },
    },
  });

  assert.deepEqual(actions, ["next"]);
  assert.deepEqual(reply.actions, ["next"]);
});

test("createClaudioRouter refreshes now after chat executes transport actions", async () => {
  let refreshes = 0;
  const router = createClaudioRouter({
    hub: createHubState(),
    stream: {
      addClient() {
        return () => {};
      },
      broadcast() {},
    },
    store: { appendMessage() {} },
    brain: {
      async ask() {
        return { reply: "Next up.", actions: ["next"] };
      },
    },
    music: {
      async next() {
        return { success: true };
      },
      async getNow() {
        return {
          track: {
            id: "song-after-chat",
            title: "After Chat",
            status: "playing",
          },
          transport: {},
          meta: { ready: true },
        };
      },
    },
    onAfterNowUpdate() {
      refreshes += 1;
    },
  });

  let responseBody = null;
  await router.handle(
    new URL("http://localhost/api/chat"),
    {
      method: "POST",
      on(event, callback) {
        if (event === "data") callback(Buffer.from(JSON.stringify({ message: "build a darker radio mood" })));
        if (event === "end") callback();
      },
    },
    {
      json(status, body) {
        assert.equal(status, 200);
        responseBody = body;
      },
    }
  );

  assert.deepEqual(responseBody.executedActions, ["next"]);
  assert.equal(refreshes, 1);
});

test("createClaudioRouter serves local memory summary", async () => {
  const router = createClaudioRouter({
    hub: createHubState(),
    stream: {
      addClient() {
        return () => {};
      },
      broadcast() {},
    },
    store: {
      get() {
        return {
          messages: [{ role: "user", text: "hi" }],
          plays: [{ title: "Song A", artist: "Artist A" }],
          blockedSongs: [{ title: "Song B", reason: "no-license" }],
        };
      },
    },
    music: {},
  });

  let responseBody = null;
  await router.handle(
    new URL("http://localhost/api/memory"),
    { method: "GET", on() {} },
    {
      json(status, body) {
        assert.equal(status, 200);
        responseBody = body;
      },
    }
  );

  assert.equal(responseBody.messages.length, 1);
  assert.equal(responseBody.plays.length, 1);
  assert.equal(responseBody.blockedSongs.length, 1);
});

test("createClaudioRouter serves personalization snapshot", async () => {
  const hub = createHubState();
  hub.setNow({
    track: {
      title: "Song A",
      artist: "Artist A",
      album: "Album A",
      status: "playing",
    },
    transport: {},
    meta: { ready: true },
  });

  const router = createClaudioRouter({
    hub,
    stream: {
      addClient() {
        return () => {};
      },
      broadcast() {},
    },
    store: {
      get() {
        return {
          messages: [{ role: "user", text: "coding focus please" }],
          plays: [{ title: "Song A", artist: "Artist A", album: "Album A" }],
          blockedSongs: [{ title: "Song B", reason: "no-license" }],
        };
      },
    },
    music: {
      async getPlaylists() {
        return [{ title: "Night Drive", trackCount: 12, selected: true }];
      },
      async getNext() {
        return [{ title: "Song C", artist: "Artist C", canPlay: true }];
      },
      async getNow() {
        return hub.get().now;
      },
    },
  });

  let responseBody = null;
  await router.handle(
    new URL("http://localhost/api/personalization"),
    { method: "GET", on() {} },
    {
      json(status, body) {
        assert.equal(status, 200);
        responseBody = body;
      },
    }
  );

  assert.equal(responseBody.profile.topArtists[0].name, "Artist A");
  assert.equal(responseBody.scene.activity, "coding");
  assert.equal(responseBody.recommendation.title, "Song C");
});

test("createClaudioRouter reports brain configuration without exposing secrets", async () => {
  const router = createClaudioRouter({
    hub: createHubState(),
    stream: {
      addClient() {
        return () => {};
      },
      broadcast() {},
    },
    store: { get() { return {}; } },
    music: {},
    brain: {
      status() {
        return {
          configured: true,
          baseUrl: "https://v2.aicodee.com",
          model: "MiniMax-M2.5-highspeed",
          apiKey: "secret",
        };
      },
    },
  });

  let responseBody = null;
  await router.handle(
    new URL("http://localhost/api/brain/status"),
    { method: "GET", on() {} },
    {
      json(status, body) {
        assert.equal(status, 200);
        responseBody = body;
      },
    }
  );

  assert.equal(responseBody.configured, true);
  assert.equal(responseBody.model, "MiniMax-M2.5-highspeed");
  assert.equal(responseBody.apiKey, undefined);
});

test("createDefaultStore returns bounded state containers", () => {
  const store = createDefaultStore();
  assert.deepEqual(Object.keys(store), ["version", "messages", "plays", "blockedSongs", "updatedAt"]);
  assert.deepEqual(store.messages, []);
});

test("NeteaseCloudMusicApi normalizers map songs and liked playlist", () => {
  const song = normalizeNeteaseApiSongItem({
    id: 186016,
    name: "晴天",
    ar: [{ name: "周杰伦" }],
    al: { name: "叶惠美", picUrl: "cover.jpg" },
    dt: 269000,
  });

  assert.equal(song.originalId, "186016");
  assert.equal(song.title, "晴天");
  assert.equal(song.artist, "周杰伦");
  assert.equal(song.duration, 269);

  const playlist = pickNeteaseApiDefaultPlaylist([
    { title: "普通歌单", encryptedId: "1", specialType: 0 },
    { title: "账户已注笑喜欢的音乐", encryptedId: "2", specialType: 5 },
  ]);
  assert.equal(playlist.encryptedId, "2");
});

test("NeteaseCloudMusicApi normalizes QR login responses", () => {
  const qr = normalizeQrPayload(
    { data: { unikey: "abc" } },
    { data: { qrimg: "data:image/png;base64,xxx", qrurl: "https://example.test/qr" } }
  );
  assert.equal(qr.success, true);
  assert.equal(qr.key, "abc");
  assert.equal(qr.qrImg, "data:image/png;base64,xxx");

  const checked = normalizeQrCheckPayload({
    code: 803,
    cookie: "MUSIC_U=token;",
    message: "授权登录成功",
  });
  assert.equal(checked.success, true);
  assert.equal(checked.cookie, "MUSIC_U=token;");
});

test("NeteaseCloudMusicApi login refreshes QR when saved cookie is invalid", async () => {
  const { createNeteaseApiProvider } = require("../server/providers/music/ncma.js");
  const originalFetch = global.fetch;
  const requests = [];
  const store = {
    cookie: "MUSIC_U=expired;",
    getCookie() {
      return this.cookie;
    },
    clearCookie() {
      this.cookie = "";
    },
    saveCookie(cookie) {
      this.cookie = cookie;
    },
  };

  global.fetch = async (url) => {
    const parsed = new URL(String(url));
    requests.push(parsed.pathname);
    if (parsed.pathname === "/login/status") {
      return Response.json({ data: { profile: null } });
    }
    if (parsed.pathname === "/user/account") {
      return Response.json({});
    }
    if (parsed.pathname === "/login/qr/key") {
      return Response.json({ data: { unikey: "fresh-key" } });
    }
    if (parsed.pathname === "/login/qr/create") {
      return Response.json({
        data: {
          qrimg: "data:image/png;base64,fresh",
          qrurl: "https://example.test/fresh-qr",
        },
      });
    }
    return Response.json({});
  };

  try {
    const provider = createNeteaseApiProvider({ baseUrl: "http://localhost:4000", timeoutMs: 1000 }, store);
    const result = await provider.login();

    assert.equal(result.success, true);
    assert.equal(result.key, "fresh-key");
    assert.equal(result.qrImg, "data:image/png;base64,fresh");
    assert.equal(store.cookie, "");
    assert.deepEqual(requests, ["/login/status", "/user/account", "/login/qr/key", "/login/qr/create"]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("classifyPlaybackFailure maps NetEase playback failures into user-facing reasons", () => {
  assert.equal(classifyPlaybackFailure({ subCode: 10003 }), "no-license");
  assert.equal(classifyPlaybackFailure({ subCode: 10004 }), "paid-or-vip");
  assert.equal(classifyPlaybackFailure({ message: "mpv not found" }), "player-backend");
  assert.equal(classifyPlaybackFailure({ message: "queue empty" }), "queue-empty");
  assert.equal(classifyPlaybackFailure({ message: "something odd" }), "playback-failed");
});

test("isMatchingPlaybackTrack confirms current state belongs to the requested track", () => {
  const item = {
    encryptedId: "ENC-1",
    originalId: "ORI-1",
    title: "Song A",
    artist: "Artist A",
  };

  assert.equal(isMatchingPlaybackTrack({ track: { id: "ENC-1" } }, item), true);
  assert.equal(isMatchingPlaybackTrack({ track: { originalId: "ORI-1" } }, item), true);
  assert.equal(isMatchingPlaybackTrack({ track: { title: "Song A", artist: "Artist A" } }, item), true);
  assert.equal(isMatchingPlaybackTrack({ track: { title: "Song B", artist: "Artist A" } }, item), false);
});

test("inferScene reads time and recent chat mood", () => {
  const scene = inferScene({
    now: new Date("2026-05-03T22:30:00+08:00"),
    messages: [{ role: "user", text: "今天很累，想放松一下" }],
  });

  assert.equal(scene.timeBlock, "night");
  assert.equal(scene.mood, "tired");
  assert.match(scene.summary, /night|tired/);
});

test("buildPersonalizationSnapshot distills plays playlists and scene into radio context", () => {
  const snapshot = buildPersonalizationSnapshot({
    storeState: {
      messages: [{ role: "user", text: "写代码的时候来点轻一点的" }],
      plays: [
        { title: "Song A", artist: "Artist A", album: "Album A" },
        { title: "Song B", artist: "Artist A", album: "Album B" },
      ],
      blockedSongs: [{ title: "Song C", artist: "Artist C", reason: "no-license" }],
    },
    playlists: [{ title: "夜晚开车", trackCount: 30, selected: true }],
    queue: [{ title: "Song D", artist: "Artist D", canPlay: true }],
    now: { track: { title: "Song A", artist: "Artist A", status: "playing" } },
    date: new Date("2026-05-03T10:00:00+08:00"),
  });

  assert.deepEqual(snapshot.profile.topArtists[0], { name: "Artist A", count: 2 });
  assert.equal(snapshot.scene.activity, "coding");
  assert.equal(snapshot.recommendation.title, "Song D");
  assert.equal(snapshot.plan.items.length, 3);
});
