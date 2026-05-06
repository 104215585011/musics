const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");
const { spawn } = require("node:child_process");

const { getConfig } = require("./config.js");
const { createHubState } = require("./state/hub.js");
const { createHubStore } = require("./state/hub-store.js");
const { createPersistentStore } = require("./state/store.js");
const { createStreamService } = require("./services/stream.js");
const { createWebSocketServer } = require("./services/websocket.js");
const { processChatMessage, matchIntent } = require("./services/chat-router.js");
const { startScheduler } = require("./services/scheduler.js");
const { createUPnPService } = require("./services/upnp.js");
const { createClaudioRouter } = require("./routes/claudio.js");
const { askAicodeeBrain } = require("./providers/brain/aicodee.js");
const { createNeteaseApiProvider } = require("./providers/music/ncma.js");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    ...CORS_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function sendFile(response, filePath) {
  if (!fs.existsSync(filePath)) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  response.writeHead(200, {
    ...CORS_HEADERS,
    "Content-Type": MIME_TYPES[ext] ?? "application/octet-stream",
  });
  fs.createReadStream(filePath).pipe(response);
}

function getStaticFilePath(urlPath) {
  const safePath = urlPath === "/" ? "/index.html" : urlPath;
  const resolvedPath = path.normalize(path.join(process.cwd(), safePath));
  if (!resolvedPath.startsWith(process.cwd())) {
    return null;
  }
  return resolvedPath;
}

function createResponseHelpers(response) {
  return {
    raw: response,
    json(status, body) {
      sendJson(response, status, body);
    },
    sse() {
      response.writeHead(200, {
        ...CORS_HEADERS,
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
      });
      response.write("\n");
    },
  };
}

function wrapUPnP(provider, upnp) {
  if (!upnp) return provider;
  const _play = provider.play?.bind(provider);
  if (!_play) return provider;

  provider.play = async function (item) {
    if (upnp.isConnected()) {
      const result = await _play(item);
      const audioUrl = result?.url || result?.audioUrl || item?.audioUrl || item?.url;
      if (audioUrl) {
        const ok = await upnp.play(audioUrl, {
          title: item?.title || result?.title || "",
          artist: item?.artist || result?.artist || "",
        });
        return { success: ok, via: "upnp", ...result };
      }
      return { success: false, message: "No audio URL to send to UPnP" };
    }
    return _play(item);
  };

  return provider;
}

function createMusicFacade(config, store, upnp) {
  const provider = createNeteaseApiProvider(config.neteaseApi, store);
  return wrapUPnP(provider, upnp);
}

function createBrainFacade(config) {
  let toolRegistry = null;
  let _tools = null;

  function initToolRegistry(music, store) {
    const personalization = require("./services/personalization.js");
    const weatherService = require("./services/weather.js");
    const tools = require("./services/tools.js");
    _tools = tools.createToolRegistry({ music, store, weatherService, personalization, config });
    return _tools;
  }

  return {
    status() {
      return {
        configured: Boolean(config.brain.apiKey && config.brain.baseUrl && config.brain.model),
        baseUrl: config.brain.baseUrl,
        model: config.brain.model,
      };
    },
    get tools() {
      return _tools;
    },
    setMusicStore(music, store) {
      if (music && store) {
        initToolRegistry(music, store);
      }
    },
    executeTool: null, // set dynamically in createServer
    async ask(message, options) {
      // options may contain { context, tools, executeTool } from chat-router,
      // or be the old-style music facade (ignored in tool mode).
      if (options && typeof options === "object" && (options.context || options.tools)) {
        return askAicodeeBrain(config.brain, {
          message,
          context: options.context ?? null,
          tools: options.tools ?? null,
          executeTool: options.executeTool ?? null,
        });
      }
      return askAicodeeBrain(config.brain, { message, context: null, tools: null, executeTool: null });
    },
  };
}

function buildRouteErrorResponse(error) {
  const message = String(error?.message || error || "Request failed");
  const backendUnavailable =
    /fetch failed|ECONNREFUSED|ECONNRESET|ETIMEDOUT|unavailable/i.test(message);

  return {
    statusCode: backendUnavailable ? 503 : 500,
    payload: {
      error: "Claudio hub request failed",
      detail: message,
      reason: backendUnavailable ? "backend-unavailable" : "unknown",
    },
  };
}

function createServer(config) {
  const hub = createHubState();
  const hubStore = createHubStore();

  // Restore hub state from disk
  const storedHub = hubStore.load();
  hub.replace(storedHub);

  // Auto-persist hub on mutation
  const _hubSetNow = hub.setNow.bind(hub);
  const _hubSetNext = hub.setNext.bind(hub);
  const _hubSetTaste = hub.setTaste.bind(hub);
  const _hubSetPlan = hub.setPlan.bind(hub);
  const _hubReplace = hub.replace.bind(hub);
  hub.setNow = (now) => { const r = _hubSetNow(now); hubStore.save(hub.get()); return r; };
  hub.setNext = (next) => { const r = _hubSetNext(next); hubStore.save(hub.get()); return r; };
  hub.setTaste = (taste) => { const r = _hubSetTaste(taste); hubStore.save(hub.get()); return r; };
  hub.setPlan = (plan) => { const r = _hubSetPlan(plan); hubStore.save(hub.get()); return r; };
  hub.replace = (next) => { const r = _hubReplace(next); hubStore.save(hub.get()); return r; };

  const store = createPersistentStore();
  const stream = createStreamService();
  const upnp = config?.upnp?.enabled ? createUPnPService() : null;
  const music = createMusicFacade(config, store, upnp);
  const brain = createBrainFacade(config);
  brain.setMusicStore(music, store);
  const { executeToolCall } = require("./services/tools.js");
  brain.executeTool = async (toolName, args, ctx) => {
    return executeToolCall(brain.tools || {}, toolName, args, ctx);
  };
  const claudioRouter = createClaudioRouter({
    hub,
    stream,
    music,
    brain,
    store,
    config,
    upnp,
    onAfterNowUpdate(snapshot) {
      stream.broadcast({
        type: "now",
        track: snapshot.now?.track ?? null,
      });
    },
  });

  const httpServer = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url, `http://${request.headers.host}`);
    const routeResponse = createResponseHelpers(response);

    if (request.method === "OPTIONS") {
      response.writeHead(204, CORS_HEADERS);
      response.end();
      return;
    }

    if (requestUrl.pathname === "/api/health") {
      sendJson(response, 200, { status: "ok" });
      return;
    }

    try {
      if (await claudioRouter.handle(requestUrl, request, routeResponse)) {
        return;
      }
    } catch (error) {
      const errorResponse = buildRouteErrorResponse(error);
      sendJson(response, errorResponse.statusCode, errorResponse.payload);
      return;
    }

    const filePath = getStaticFilePath(requestUrl.pathname);
    if (!filePath) {
      sendJson(response, 400, { error: "Invalid path" });
      return;
    }

    sendFile(response, filePath);
  });

  // WebSocket streaming chat
  const wss = createWebSocketServer(httpServer, { path: "/chat-ws" });

  async function streamChatResponse(socketId, message) {
    // Send typing indicator
    wss.send(socketId, JSON.stringify({ type: "chat-typing", status: "thinking" }));

    // Process the message using the same pipeline as POST /api/chat
    const result = await processChatMessage({
      message,
      music,
      brain,
      store,
      weatherConfig: config?.weather ?? {},
    });

    // Update hub state + broadcast SSE after transport actions (mirrors POST /api/chat)
    if (Array.isArray(result?.executedActions) && result.executedActions.length) {
      const now = await music.getNow().catch(() => null);
      if (now) {
        hub.setNow(now);
        stream.broadcast({ type: "now", track: now?.track ?? null });
      }
    }

    const replyText = result?.reply || "抱歉，我现在无法回复。";
    const chars = [...replyText];

    // Stream characters with small delays for natural feel
    for (let i = 0; i < chars.length; i++) {
      const delay = 15 + Math.random() * 25; // 15-40ms per char
      await new Promise(r => setTimeout(r, delay));
      wss.send(socketId, JSON.stringify({
        type: "chat-chunk",
        chunk: chars[i],
        index: i,
        total: chars.length,
      }));
    }

    // Send completion
    wss.send(socketId, JSON.stringify({
      type: "chat-done",
      fullReply: replyText,
      actions: result?.actions || [],
      recommendation: result?.recommendation || result?._recommendation || null,
      executedActions: result?.executedActions || [],
    }));
  }

  wss.onMessage(async (socketId, rawMessage) => {
    let parsed;
    try { parsed = JSON.parse(rawMessage); } catch { return; }

    if (parsed.type === "chat") {
      const message = String(parsed.message || "").trim();
      if (!message) return;
      streamChatResponse(socketId, message).catch(e => {
        console.log(`[ws] stream error: ${e.message}`);
        try {
          wss.send(socketId, JSON.stringify({
            type: "chat-done",
            fullReply: "抱歉，处理消息时出错了：" + e.message,
            actions: [],
            recommendation: null,
            executedActions: [],
          }));
        } catch (_) {}
      });
    }
  });

  // Spawn NetEase Cloud Music API as a child process
  let neteaseProcess = null;
  const neteaseApiPort = config?.neteaseApi?.baseUrl
    ? new URL(config.neteaseApi.baseUrl).port
    : 4000;

  try {
    const neteaseEntry = require.resolve("NeteaseCloudMusicApi/app.js");
    const nodeCommand = process.env.npm_node_execpath || (process.platform === "win32" ? "node.exe" : "node");
    neteaseProcess = spawn(nodeCommand, [neteaseEntry], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(neteaseApiPort),
      },
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    neteaseProcess.stdout?.on("data", (d) => {
      process.stdout.write(`[netease-api] ${d}`);
    });
    neteaseProcess.stderr?.on("data", (d) => {
      process.stderr.write(`[netease-api:err] ${d}`);
    });
    neteaseProcess.on("exit", (code) => {
      console.log(`[netease-api] exited with code ${code}`);
    });
    console.log(`[server] NetEase API spawned on port ${neteaseApiPort}, pid=${neteaseProcess.pid}`);
  } catch (e) {
    console.log(`[server] Failed to spawn NetEase API: ${e.message}`);
  }

  // Start scheduler
  const scheduler = startScheduler({
    hub, store, music, brain, stream,
    weatherConfig: config?.weather ?? {},
    schedulerConfig: config?.scheduler ?? {},
  });

  // Graceful shutdown: flush persistent state
  function shutdown() {
    console.log("[server] Shutting down, flushing state...");
    try { scheduler.stop(); } catch (e) {}
    try { hubStore.flushSync(hub.get()); } catch (e) { console.log("[server] hub flush error:", e.message); }
    try { store.flushSync(); } catch (e) { console.log("[server] store flush error:", e.message); }
    if (neteaseProcess && neteaseProcess.exitCode == null) {
      try {
        if (process.platform === "win32") {
          spawn("taskkill", ["/PID", String(neteaseProcess.pid), "/T", "/F"]);
        } else {
          neteaseProcess.kill("SIGTERM");
        }
      } catch (e) {}
    }
    process.exit(0);
  }
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  return httpServer;
}

if (require.main === module) {
  const config = getConfig();
  const server = createServer(config);

  server.listen(config.port, () => {
    console.log(`Claudio hub listening on http://localhost:${config.port}`);
  });
}

module.exports = {
  buildRouteErrorResponse,
  createMusicFacade,
  createResponseHelpers,
  createServer,
  getStaticFilePath,
  sendFile,
  sendJson,
};
