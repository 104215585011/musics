const { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, Tray } = require("electron");
const fs = require("fs");
const path = require("path");
const { fork } = require("child_process");

const ELECTRON_USER_DATA_DIR = path.join(__dirname, ".electron-user-data");
const ELECTRON_CACHE_DIR = path.join(__dirname, ".electron-cache");

try {
  fs.mkdirSync(ELECTRON_USER_DATA_DIR, { recursive: true });
  fs.mkdirSync(ELECTRON_CACHE_DIR, { recursive: true });
  app.setPath("userData", ELECTRON_USER_DATA_DIR);
  app.commandLine.appendSwitch("disk-cache-dir", ELECTRON_CACHE_DIR);
  app.commandLine.appendSwitch("disable-gpu-shader-disk-cache");
} catch (error) {
  console.warn("[claudio] Could not prepare Electron cache paths:", error.message);
}

let mainWindow = null;
let serverProcess = null;
let tray = null;

const WINDOW_STATE_FILE = path.join(app.getPath("userData"), "window-state.json");
const DEFAULT_BOUNDS = { width: 760, height: 980 };

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

function readWindowState() {
  try {
    const state = JSON.parse(fs.readFileSync(WINDOW_STATE_FILE, "utf8"));
    return {
      width: Number(state.width) || DEFAULT_BOUNDS.width,
      height: Number(state.height) || DEFAULT_BOUNDS.height,
      x: Number.isFinite(state.x) ? state.x : undefined,
      y: Number.isFinite(state.y) ? state.y : undefined,
    };
  } catch {
    return DEFAULT_BOUNDS;
  }
}

function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized() || mainWindow.isMaximized()) return;
  try {
    fs.mkdirSync(path.dirname(WINDOW_STATE_FILE), { recursive: true });
    fs.writeFileSync(WINDOW_STATE_FILE, JSON.stringify(mainWindow.getBounds(), null, 2));
  } catch (error) {
    console.warn("[claudio] Could not save window state:", error.message);
  }
}

function getIconPath() {
  const pngPath = path.join(__dirname, "assets", "icons", "icon.png");
  if (fs.existsSync(pngPath)) return pngPath;
  return path.join(__dirname, "assets", "icons", "icon.svg");
}

function startServer() {
  if (serverProcess) return;
  serverProcess = fork(path.join(__dirname, "server", "server.js"), [], {
    stdio: "pipe",
    env: { ...process.env },
  });
  serverProcess.stdout?.on("data", (data) => process.stdout.write(data));
  serverProcess.stderr?.on("data", (data) => process.stderr.write(data));
  serverProcess.on("error", (error) => {
    console.error("[claudio] Server process error:", error.message);
  });
  serverProcess.on("exit", () => {
    serverProcess = null;
  });
}

function waitAndLoad(window, retries = 0) {
  if (!window || window.isDestroyed()) return;
  window.loadURL("http://localhost:3000/#player").catch(() => {
    if (retries < 30) {
      setTimeout(() => waitAndLoad(window, retries + 1), 500);
    }
  });
}

function createTray() {
  if (tray) return;
  const image = nativeImage.createFromPath(getIconPath());
  const trayImage = image.isEmpty() ? nativeImage.createEmpty() : image.resize({ width: 16, height: 16 });
  tray = new Tray(trayImage);
  tray.setToolTip("Claudio FM");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Show Claudio", click: () => showMainWindow() },
    {
      label: "Quit",
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]));
  tray.on("click", () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      showMainWindow();
    }
  });
}

function showMainWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function registerWindowIpc() {
  ipcMain.removeAllListeners("window-minimize");
  ipcMain.removeAllListeners("window-maximize");
  ipcMain.removeAllListeners("window-close");
  ipcMain.on("window-minimize", () => mainWindow?.minimize());
  ipcMain.on("window-maximize", () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on("window-close", () => mainWindow?.close());
}

function registerMediaKeys() {
  try {
    globalShortcut.unregisterAll();
    globalShortcut.register("MediaPlayPause", () => {
      mainWindow?.webContents.executeJavaScript('document.querySelector("[data-play]")?.click()');
    });
    globalShortcut.register("MediaNextTrack", () => {
      mainWindow?.webContents.executeJavaScript('document.querySelector("[data-next]")?.click()');
    });
    globalShortcut.register("MediaPreviousTrack", () => {
      mainWindow?.webContents.executeJavaScript('document.querySelector("[data-prev]")?.click()');
    });
  } catch (error) {
    console.warn("[claudio] Media key registration failed:", error.message);
  }
}

function createWindow() {
  const bounds = readWindowState();
  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 620,
    minHeight: 760,
    frame: false,
    show: false,
    title: "Claudio FM",
    backgroundColor: "#05060a",
    icon: getIconPath(),
    hasShadow: true,
    roundedCorners: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });
  mainWindow.on("resize", saveWindowState);
  mainWindow.on("move", saveWindowState);
  mainWindow.on("close", (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  waitAndLoad(mainWindow);
  registerMediaKeys();
}

app.on("second-instance", () => {
  showMainWindow();
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  startServer();
  registerWindowIpc();
  createTray();
  createWindow();
});

app.on("activate", () => {
  showMainWindow();
});

app.on("before-quit", () => {
  app.isQuitting = true;
});

app.on("window-all-closed", (event) => {
  event.preventDefault();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});
