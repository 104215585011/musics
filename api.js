(function () {
  var STORAGE_KEY = "claudio.apiBase";
  var ELECTRON_BASE = "http://localhost:3000";

  function isElectron() {
    return Boolean(window.electronAPI && window.electronAPI.isElectron);
  }

  function readBase() {
    try {
      if (isElectron()) return ELECTRON_BASE;
      return localStorage.getItem(STORAGE_KEY) || "";
    } catch (_) {
      return isElectron() ? ELECTRON_BASE : "";
    }
  }

  function writeBase(value) {
    try {
      if (isElectron()) {
        localStorage.removeItem(STORAGE_KEY);
        return;
      }
      if (value) localStorage.setItem(STORAGE_KEY, value);
      else localStorage.removeItem(STORAGE_KEY);
    } catch (_) {}
  }

  function joinUrl(path) {
    var base = readBase();
    if (!base) return path;
    if (base.endsWith("/")) base = base.slice(0, -1);
    if (!path.startsWith("/")) path = "/" + path;
    return base + path;
  }

  function withRequestUrl(error, url) {
    if (error && typeof error === "object" && !error.url) error.url = url;
    return error;
  }

  function jsonOrThrow(response) {
    if (!response.ok) {
      return response
        .json()
        .catch(function () {
          throw new Error("HTTP " + response.status);
        })
        .then(function (payload) {
          var err = new Error(payload.detail || payload.error || "HTTP " + response.status);
          err.status = response.status;
          err.reason = payload.reason || "";
          throw err;
        });
    }

    var ct = response.headers.get("content-type") || "";
    if (ct.indexOf("application/json") === -1) {
      return response.text();
    }
    return response.json();
  }

  function request(path, init) {
    var base = readBase();
    var primaryUrl = joinUrl(path);
    var options = init || {};
    return fetch(primaryUrl, options)
      .then(jsonOrThrow)
      .catch(function (error) {
        if (!base || isElectron()) throw withRequestUrl(error, primaryUrl);
        return fetch(path, options)
          .then(jsonOrThrow)
          .catch(function (fallbackError) {
            throw withRequestUrl(fallbackError, path);
          });
      });
  }

  function get(path, init) {
    return request(path, Object.assign({ method: "GET" }, init || {}));
  }

  function post(path, body, init) {
    return request(
      path,
      Object.assign(
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: body == null ? undefined : JSON.stringify(body),
        },
        init || {}
      )
    );
  }

  var api = {
    getBase: readBase,
    setBase: writeBase,
    url: joinUrl,
    chat: function (message, context) {
      return post("/api/chat", { message: message, context: context || {} });
    },
    now: function () {
      return get("/api/now");
    },
    next: function () {
      return get("/api/next");
    },
    playlists: function () {
      return get("/api/playlists?limit=8");
    },
    playlistTracks: function (id, limit) {
      return get("/api/playlist/tracks?id=" + encodeURIComponent(id || "") + "&limit=" + encodeURIComponent(limit || 8));
    },
    taste: function () {
      return get("/api/taste");
    },
    plan: function () {
      return get("/api/plan/today");
    },
    stats: function () {
      return get("/api/stats");
    },

    // NetEase song search
    search: function (query, limit) {
      return get("/api/search?q=" + encodeURIComponent(query || "") + "&limit=" + encodeURIComponent(limit || 5));
    },
    memory: function () {
      return get("/api/memory");
    },
    favorites: function () {
      return get("/api/favorites");
    },
    addFavorite: function (track) {
      return post("/api/favorites", track || {});
    },
    removeFavorite: function (query) {
      return request("/api/favorites", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query }),
      });
    },
    history: function () {
      return get("/api/history");
    },
    personalization: function () {
      return get("/api/personalization");
    },
    recommend: function (context) {
      return post("/api/recommend", context || {});
    },
    weather: function () {
      return get("/api/weather");
    },
    tts: function (text) {
      var url = joinUrl("/api/tts");
      return fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text }),
      })
        .then(function (res) {
          if (!res.ok) return null;
          return res.blob();
        })
        .then(function (blob) {
          if (!blob || blob.size === 0) return null;
          return URL.createObjectURL(blob);
        })
        .catch(function () { return null; });
    },
    brainStatus: function () {
      return get("/api/brain/status");
    },
    upnpDevices: function () {
      return get("/api/upnp/devices");
    },
    upnpConnect: function (device) {
      return post("/api/upnp/connect", device);
    },
    upnpDisconnect: function () {
      return post("/api/upnp/disconnect");
    },
    upnpStatus: function () {
      return get("/api/upnp/status");
    },
    userFiles: function () {
      return get("/api/user/files");
    },
    readUserFile: function (name) {
      return get("/api/user/files/" + encodeURIComponent(name));
    },
    saveUserFile: function (name, content) {
      return request("/api/user/files/" + encodeURIComponent(name), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: content }),
      });
    },
    transportStatus: function () {
      return get("/api/transport/status");
    },
    login: function () {
      return post("/api/transport/login");
    },
    logout: function () {
      return post("/api/transport/logout");
    },
    toggle: function () {
      return post("/api/transport/toggle");
    },
    play: function (item) {
      return post("/api/transport/play", item || {});
    },
    prev: function () {
      return post("/api/transport/prev");
    },
    nextTrack: function () {
      return post("/api/transport/next");
    },
    seek: function (seconds) {
      return post("/api/transport/seek", { seconds: seconds });
    },
    volume: function (level) {
      return post("/api/transport/volume", { level: level });
    },
    ping: function () {
      return get("/api/health")
        .then(function () {
          return true;
        })
        .catch(function (err) {
          if (err && err.status === 404) return false;
          throw err;
        });
    },
    connectStream: function (onMessage, onError) {
      var source;
      try {
        source = new EventSource(joinUrl("/stream"));
      } catch (error) {
        if (onError) onError(error);
        return null;
      }

      source.addEventListener("message", function (event) {
        var data = event.data;
        try {
          data = JSON.parse(event.data);
        } catch (_) {}
        if (onMessage) onMessage(data, event);
      });

      if (onError) {
        source.addEventListener("error", onError);
      }

      return source;
    },

    // WebSocket streaming chat client
    _chatSocket: null,
    _chatReconnectTimer: null,
    _chatBackoff: 1000,
    _chatHandlers: null,
    _chatManualClose: false,

    connectChatStream: function (onChunk, onDone, onError, onState) {
      var self = this;
      if (self._chatSocket) {
        self._chatManualClose = true;
        try { self._chatSocket.close(); } catch (_) {}
        self._chatSocket = null;
      }
      if (self._chatReconnectTimer) {
        clearTimeout(self._chatReconnectTimer);
        self._chatReconnectTimer = null;
      }

      self._chatHandlers = { onChunk: onChunk, onDone: onDone, onError: onError, onState: onState };
      self._chatManualClose = false;

      var base = readBase();
      var wsUrl = "ws://" + (window.location.host || "localhost:3000") + "/chat-ws";

      try {
        self._chatSocket = new WebSocket(wsUrl);
      } catch (e) {
        if (onError) onError(e);
        return;
      }

      self._chatSocket.onopen = function () {
        self._chatBackoff = 1000;
        if (onState) onState("open");
      };

      self._chatSocket.onmessage = function (event) {
        var data;
        try { data = JSON.parse(event.data); } catch (_) { data = {}; }

        if (data.type === "chat-chunk" && onChunk) {
          onChunk(data.chunk, data.index, data.total);
        } else if (data.type === "chat-done" && onDone) {
          onDone(data);
        } else if (data.type === "chat-typing" && onState) {
          onState("typing", data.status);
        }
      };

      self._chatSocket.onerror = function () {
        if (onError) onError(new Error("WebSocket connection error"));
      };

      self._chatSocket.onclose = function () {
        if (onState) onState("closed");
        if (self._chatManualClose) {
          self._chatManualClose = false;
          return;
        }
        // Auto-reconnect
        if (self._chatReconnectTimer) clearTimeout(self._chatReconnectTimer);
        self._chatReconnectTimer = setTimeout(function () {
          self._chatBackoff = Math.min(self._chatBackoff * 2, 30000);
          self.connectChatStream(onChunk, onDone, onError, onState);
        }, self._chatBackoff);
      };
    },

    sendChatStream: function (message) {
      var socket = this._chatSocket;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        return false;
      }
      socket.send(JSON.stringify({ type: "chat", message: message }));
      return true;
    },

    disconnectChatStream: function () {
      if (this._chatReconnectTimer) {
        clearTimeout(this._chatReconnectTimer);
        this._chatReconnectTimer = null;
      }
      if (this._chatSocket) {
        this._chatManualClose = true;
        try { this._chatSocket.close(); } catch (_) {}
        this._chatSocket = null;
      }
    },
  };

  var liveListeners = [];
  var liveStateListeners = [];
  var liveSocket = null;
  var liveReconnectTimer = null;
  var liveBackoffMs = 1000;
  var liveLastState = "idle";

  function setLiveState(next) {
    if (liveLastState === next) return;
    liveLastState = next;
    liveStateListeners.forEach(function (fn) {
      try {
        fn(next);
      } catch (_) {}
    });
  }

  function scheduleReconnect() {
    if (liveReconnectTimer) return;
    var delay = liveBackoffMs;
    liveBackoffMs = Math.min(liveBackoffMs * 2, 30000);
    liveReconnectTimer = setTimeout(function () {
      liveReconnectTimer = null;
      liveConnect();
    }, delay);
  }

  function liveConnect() {
    if (liveSocket) return;
    setLiveState("connecting");
    liveSocket = api.connectStream(
      function (data) {
        liveBackoffMs = 1000;
        setLiveState("open");
        liveListeners.forEach(function (fn) {
          try {
            fn(data);
          } catch (_) {}
        });
      },
      function () {
        if (liveSocket) {
          try {
            liveSocket.close();
          } catch (_) {}
        }
        liveSocket = null;
        setLiveState("closed");
        scheduleReconnect();
      }
    );

    if (!liveSocket) {
      setLiveState("closed");
      scheduleReconnect();
    }
  }

  function liveDisconnect() {
    if (liveReconnectTimer) {
      clearTimeout(liveReconnectTimer);
      liveReconnectTimer = null;
    }
    if (liveSocket) {
      try {
        liveSocket.close();
      } catch (_) {}
      liveSocket = null;
    }
    setLiveState("idle");
  }

  api.live = {
    connect: liveConnect,
    disconnect: liveDisconnect,
    on: function (fn) {
      liveListeners.push(fn);
      return function () {
        liveListeners = liveListeners.filter(function (x) {
          return x !== fn;
        });
      };
    },
    onState: function (fn) {
      liveStateListeners.push(fn);
      try {
        fn(liveLastState);
      } catch (_) {}
      return function () {
        liveStateListeners = liveStateListeners.filter(function (x) {
          return x !== fn;
        });
      };
    },
    state: function () {
      return liveLastState;
    },
    isOpen: function () {
      return liveLastState === "open";
    },
  };

  var origSetBase = api.setBase;
  api.setBase = function (value) {
    origSetBase(value);
    liveDisconnect();
    liveConnect();
  };

  window.claudio = window.claudio || {};
  window.claudio.api = api;
})();
