// ASCII Animals Screensaver: a tray app that shows the animals full-screen when you're idle.
const { app, BrowserWindow, Tray, Menu, ipcMain, powerMonitor, screen, nativeImage } = require("electron");
const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");

const PAGE = path.join(__dirname, "app", "index.html");
const ICON = path.join(__dirname, "app", "icons", "icon32.png");
const IDLE_CHOICES = [1, 2, 3, 5, 10, 15, 20, 30];

/* ---------- config (idle delay etc.) ---------- */

const configPath = () => path.join(app.getPath("userData"), "config.json");
const DEFAULT_CONFIG = { idleMinutes: 2, enabled: true };
let config = { ...DEFAULT_CONFIG };

function loadConfig() {
  try {
    config = { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(configPath(), "utf8")) };
  } catch {
    config = { ...DEFAULT_CONFIG };
  }
}
function saveConfig() {
  try {
    fs.writeFileSync(configPath(), JSON.stringify(config, null, 2));
  } catch {
    /* best effort */
  }
}

/* ---------- command line: classic Windows screensaver arguments ---------- */
// If the exe is renamed to .scr, Windows launches it with /s (run), /c (configure) or /p <hwnd> (preview box).
const arg = (process.argv.slice(app.isPackaged ? 1 : 2).find((a) => /^[/-][scp]/i.test(a)) || "").toLowerCase();
const scrMode = arg.startsWith("/s") || arg.startsWith("-s") ? "run" : arg.startsWith("/c") || arg.startsWith("-c") ? "config" : arg.startsWith("/p") || arg.startsWith("-p") ? "preview" : null;

/* ---------- windows ---------- */

let tray = null;
let settingsWin = null;
let saverWins = [];
let saverStartedAt = 0;

function showSaver() {
  if (saverWins.length) return;
  saverStartedAt = Date.now();
  saverWins = screen.getAllDisplays().map((d) => {
    const w = new BrowserWindow({
      x: d.bounds.x,
      y: d.bounds.y,
      width: d.bounds.width,
      height: d.bounds.height,
      // transparent overlay: the animals walk over whatever was on screen
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      hasShadow: false,
      resizable: false,
      movable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      webPreferences: { preload: path.join(__dirname, "preload.js"), backgroundThrottling: false },
    });
    w.setAlwaysOnTop(true, "screen-saver");
    w.setMenu(null);
    w.loadFile(PAGE, { query: { mode: "saver" } });
    w.once("ready-to-show", () => {
      w.show();
      w.focus();
    });
    w.on("closed", () => {
      saverWins = saverWins.filter((x) => x !== w);
    });
    return w;
  });
}

function hideSaver() {
  // ignore the jitter right after the windows appear
  if (Date.now() - saverStartedAt < 800) return;
  for (const w of saverWins) if (!w.isDestroyed()) w.close();
  saverWins = [];
  if (scrMode === "run") app.quit();
}

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 1200,
    height: 760,
    minWidth: 720,
    minHeight: 520,
    title: "ASCII Animals",
    icon: ICON,
    backgroundColor: "#0d1016",
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  });
  settingsWin.setMenu(null);
  settingsWin.loadFile(PAGE, { query: { mode: "settings" } });
  settingsWin.on("closed", () => {
    settingsWin = null;
    if (scrMode === "config") app.quit();
  });
}

ipcMain.on("saver:dismiss", hideSaver);
ipcMain.on("saver:preview", () => {
  saverStartedAt = 0;
  showSaver();
});

/* ---------- idle watcher ---------- */

// Watching a movie or playing a game full-screen doesn't count as input, so ask Windows
// whether a full-screen app or presentation is in front before covering the screen.
// SHQueryUserNotificationState: 2 = busy (full-screen app), 3 = full-screen Direct3D, 4 = presentation mode.
const BUSY_CHECK =
  "Add-Type -Namespace W -Name N -MemberDefinition '[DllImport(\"shell32.dll\")] public static extern int SHQueryUserNotificationState(out int s);';" +
  "$s = 0; [void][W.N]::SHQueryUserNotificationState([ref]$s); $s";

function fullscreenAppInFront() {
  return new Promise((resolve) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", BUSY_CHECK], { windowsHide: true, timeout: 15000 }, (err, stdout) => {
      if (err) return resolve(false); // if we can't tell, behave like a normal screensaver
      resolve([2, 3, 4].includes(parseInt(String(stdout).trim(), 10)));
    });
  });
}

function startIdleWatch() {
  let checking = false;
  let skipUntil = 0;
  setInterval(async () => {
    if (!config.enabled || saverWins.length || checking || Date.now() < skipUntil) return;
    const threshold = config.idleMinutes * 60;
    if (powerMonitor.getSystemIdleTime() < threshold) return; // seconds since last keyboard/mouse input
    checking = true;
    const busy = await fullscreenAppInFront();
    checking = false;
    if (busy) {
      skipUntil = Date.now() + 30000; // look again in a bit
      return;
    }
    if (!saverWins.length && powerMonitor.getSystemIdleTime() >= threshold) showSaver();
  }, 2000);
  // the lock screen covers us anyway; free the GPU
  powerMonitor.on("lock-screen", () => {
    saverStartedAt = 0;
    hideSaver();
  });
}

/* ---------- tray ---------- */

function buildTray() {
  tray = new Tray(nativeImage.createFromPath(ICON));
  tray.setToolTip("ASCII Animals");
  tray.on("click", openSettings);
  refreshTrayMenu();
}

function refreshTrayMenu() {
  const login = app.getLoginItemSettings().openAtLogin;
  const menu = Menu.buildFromTemplate([
    { label: "Preview now", click: () => ((saverStartedAt = 0), showSaver()) },
    { label: "Choose animals & tweaks…", click: openSettings },
    { type: "separator" },
    {
      label: "Start after",
      submenu: IDLE_CHOICES.map((m) => ({
        label: `${m} minute${m === 1 ? "" : "s"} idle`,
        type: "radio",
        checked: config.idleMinutes === m,
        click: () => {
          config.idleMinutes = m;
          saveConfig();
        },
      })),
    },
    {
      label: "Enabled",
      type: "checkbox",
      checked: config.enabled,
      click: (item) => {
        config.enabled = item.checked;
        saveConfig();
      },
    },
    {
      label: "Start with Windows",
      type: "checkbox",
      checked: login,
      click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked });
        refreshTrayMenu();
      },
    },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}

/* ---------- boot ---------- */

if (scrMode === "preview") {
  // the tiny preview box in Windows' screensaver dialog: nothing to draw there
  app.quit();
} else if (!scrMode && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", openSettings);
  app.whenReady().then(() => {
    app.setAppUserModelId("com.asciianimals.screensaver");
    loadConfig();
    if (scrMode === "run") {
      saverStartedAt = 0;
      showSaver();
      return;
    }
    if (scrMode === "config") {
      openSettings();
      return;
    }
    buildTray();
    startIdleWatch();
    // first run: show the settings so people know it's there
    if (!fs.existsSync(configPath())) {
      saveConfig();
      if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: true });
      refreshTrayMenu();
      openSettings();
    }
  });
  // a tray app keeps running with no windows open
  app.on("window-all-closed", () => {
    if (scrMode) app.quit();
  });
}
