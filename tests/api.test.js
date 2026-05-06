const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadApi(overrides = {}) {
  const apiSource = fs.readFileSync(path.join(__dirname, "..", "api.js"), "utf8");
  const stored = new Map(Object.entries(overrides.storage || {}));
  const calls = [];
  const context = {
    console,
    EventSource: function EventSource() {
      this.addEventListener = function () {};
      this.close = function () {};
    },
    WebSocket: function WebSocket() {},
    localStorage: {
      getItem(key) {
        return stored.has(key) ? stored.get(key) : null;
      },
      setItem(key, value) {
        stored.set(key, String(value));
      },
      removeItem(key) {
        stored.delete(key);
      },
    },
    fetch(url) {
      calls.push(String(url));
      return Promise.resolve({
        ok: true,
        headers: { get: () => "application/json" },
        json: () => Promise.resolve({ ok: true }),
      });
    },
    window: {
      claudio: {},
      location: { host: "localhost:3000" },
      electronAPI: overrides.electron ? { isElectron: true } : null,
    },
  };
  context.window.localStorage = context.localStorage;
  context.window.fetch = context.fetch;
  vm.createContext(context);
  vm.runInContext(apiSource, context);
  return { api: context.window.claudio.api, calls, stored };
}

test("Electron API client always targets the local desktop hub", async () => {
  const { api, calls, stored } = loadApi({
    electron: true,
    storage: { "claudio.apiBase": "http://localhost:9999" },
  });

  assert.equal(api.getBase(), "http://localhost:3000");
  api.setBase("http://localhost:9999");
  assert.equal(stored.has("claudio.apiBase"), false);

  await api.ping();
  assert.equal(calls[0], "http://localhost:3000/api/health");
});
