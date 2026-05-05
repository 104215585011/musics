const fs = require("node:fs");
const path = require("node:path");
const { createDefaultSnapshot } = require("./hub.js");

function createHubStore(filePath) {
  const resolvedPath = filePath || path.join(process.cwd(), "server", "state", "hub.json");

  function atomicWrite(data) {
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmpPath = resolvedPath + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2) + "\n", "utf8");
    try {
      fs.renameSync(tmpPath, resolvedPath);
    } catch (_e) {
      // Cross-device fallback
      fs.copyFileSync(tmpPath, resolvedPath);
      try { fs.unlinkSync(tmpPath); } catch (_) {}
    }
  }

  function load() {
    const defaults = createDefaultSnapshot();
    try {
      if (!fs.existsSync(resolvedPath)) return defaults;
      const raw = fs.readFileSync(resolvedPath, "utf8");
      const parsed = JSON.parse(raw);
      // Deep merge: use defaults for missing keys
      return {
        ...defaults,
        ...parsed,
        now: { ...defaults.now, ...(parsed.now || {}) },
        taste: { ...defaults.taste, ...(parsed.taste || {}) },
        plan: { ...defaults.plan, ...(parsed.plan || {}) },
        status: { ...defaults.status, ...(parsed.status || {}) },
      };
    } catch (e) {
      console.log(`[hub-store] Failed to load ${resolvedPath}: ${e.message}, using defaults`);
      return defaults;
    }
  }

  let _timer = null;

  function save(snapshot) {
    if (_timer) clearTimeout(_timer);
    _timer = setTimeout(() => {
      _timer = null;
      try {
        atomicWrite(snapshot);
      } catch (e) {
        console.log(`[hub-store] Failed to save: ${e.message}`);
      }
    }, 500);
  }

  function flushSync() {
    if (_timer) {
      clearTimeout(_timer);
      _timer = null;
    }
    try {
      atomicWrite(load()); // Load current from file, then write... actually we need current state
    } catch (e) {
      console.log(`[hub-store] flushSync error: ${e.message}`);
    }
  }

  // flushSync needs the current in-memory snapshot to write.
  // We expose a variant that takes the snapshot directly.
  function flushSyncWith(snapshot) {
    if (_timer) {
      clearTimeout(_timer);
      _timer = null;
    }
    try {
      atomicWrite(snapshot);
    } catch (e) {
      console.log(`[hub-store] flushSync error: ${e.message}`);
    }
  }

  return { load, save, flushSync: flushSyncWith };
}

module.exports = { createHubStore };
