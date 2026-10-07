"use strict";
// PetraPMS desktop shell. Responsibilities: start/attach to the local server, secure windows, multi-monitor
// workspaces, silent printing, tray, kiosk mode, auto-update. Business logic lives in the web app, not here.
/* global setInterval, setImmediate */
const { app, BrowserWindow, Menu, Tray, ipcMain, dialog, shell, screen, session, nativeImage } = require("electron");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const config = require("./config.cjs");
const service = require("./service.cjs");
const v = require("./ipc-validate.cjs");
const logger = require("./logger.cjs");

const argv = process.argv.slice(1);

/* ---- elevated helper invocations: PetraPMS.exe --service install|uninstall ------------------------------------- */
const svcArg = argv.indexOf("--service");
if (svcArg >= 0) {
  const action = argv[svcArg + 1];
  try {
    const ops = { install: service.install, uninstall: service.uninstall, stop: service.stop, refresh: service.refresh };
    if (!ops[action]) throw new Error("unknown service action");
    const out = ops[action]();
    fs.appendFileSync(path.join(config.dataDir(), "logs", "service-setup.log"), `[${new Date().toISOString()}] ${action}\n${out}\n`);
    process.exit(0);
  } catch (e) {
    try {
      fs.mkdirSync(path.join(config.dataDir(), "logs"), { recursive: true });
      fs.appendFileSync(path.join(config.dataDir(), "logs", "service-setup.log"), `[${new Date().toISOString()}] ${action} FAILED: ${e && e.stack}\n`);
    } catch {}
    process.exit(1);
  }
}

let cfg = config.load();
let serverProc = null;
let baseUrl = "";
let tray = null;
let quitting = false;
const windows = new Set();

const isDev = !app.isPackaged;
const log = (m, level = "info", area = "desktop") => logger.log(level, area, m);
const logErr = (m, area = "desktop") => logger.log("error", area, m);

/* ---- crash logging ---------------------------------------------------------------------------------------------- */
let crashDialogShown = false;
process.on("uncaughtException", (e) => {
  logErr(`uncaught exception: ${(e && e.stack) || e}`);
  if (!crashDialogShown && app.isReady()) {
    crashDialogShown = true;
    dialog.showErrorBox("PetraPMS", `PetraPMS hit an unexpected problem. Your data is safe. Details were saved in:\n${logger.dir()}`);
  }
});
process.on("unhandledRejection", (e) => logErr(`unhandled rejection: ${(e && e.stack) || e}`));
app.on("render-process-gone", (_e, wc, d) => {
  logErr(`window process gone: ${d.reason} (exit ${d.exitCode})`);
  if (d.reason !== "clean-exit" && d.reason !== "killed" && wc && !wc.isDestroyed()) setTimeout(() => !wc.isDestroyed() && wc.reload(), 1000);
});
app.on("child-process-gone", (_e, d) => logErr(`${d.type} process gone: ${d.reason} (exit ${d.exitCode})`));

/* ---- single instance (a second launch opens another window of the first) --------------------------------------- */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => createWindow("/"));
}

/* ---- server ---------------------------------------------------------------------------------------------------- */
function probe(url, timeout = 1500) {
  return new Promise((resolve) => {
    const req = http.get(url + "/api/status", { timeout }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => (req.destroy(), resolve(false)));
  });
}

async function startServer() {
  const local = `http://127.0.0.1:${cfg.port}`;
  if (await probe(local)) return local; // Windows Service (or another instance) already serves it
  const launcher = path.join(__dirname, "server-launcher.cjs");
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: "1", PETRA_APP_VERSION: app.getVersion() };
  if (isDev) env.PETRA_WEB_DIR = path.join(__dirname, "..", "..", "web", ".next", "standalone");
  fs.mkdirSync(path.join(config.dataDir(), "logs"), { recursive: true });
  const out = logger.rotatingStream("server-stdio.log");
  serverProc = spawn(process.execPath, [launcher], { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  serverProc.stdout.on("data", (c) => out.write(c));
  serverProc.stderr.on("data", (c) => out.write(c));
  serverProc.on("exit", (code) => {
    logErr(`server exited ${code}`, "server");
    serverProc = null;
    if (!quitting) void recoverServer(code);
  });
  for (let i = 0; i < 120; i++) {
    if (await probe(local, 1000)) return local;
    if (!serverProc) throw new Error("Server failed to start");
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Server did not become ready in 60 seconds");
}

/**
 * The server child crashed. Restart it automatically (up to 3 times in 2 minutes) and reload the windows, so a one-off crash
 * is invisible to the receptionist. Only when it keeps crashing is the person told, with the log folder one click away.
 */
const crashes = [];
async function recoverServer(code) {
  const now = Date.now();
  while (crashes.length && now - crashes[0] > 120_000) crashes.shift();
  crashes.push(now);
  if (crashes.length > 3) {
    const r = dialog.showMessageBoxSync({ type: "error", title: "PetraPMS", message: "The PetraPMS server keeps stopping.", detail: `Exit code ${code}. Your data is safe. Click “Open log folder” and send the support file to PETRA.`, buttons: ["Open log folder", "Close"], defaultId: 0 });
    if (r === 0) shell.openPath(logger.dir());
    return;
  }
  log(`restarting server (attempt ${crashes.length})`, "warn", "server");
  await new Promise((r) => setTimeout(r, 1500 * crashes.length));
  try {
    baseUrl = await startServer();
    for (const w of windows) if (!w.isDestroyed()) w.loadURL(baseUrl + "/");
    log("server restarted", "info", "server");
  } catch (e) {
    logErr(`server restart failed: ${(e && e.message) || e}`, "server");
  }
}

function stopServer() {
  if (serverProc) {
    try {
      serverProc.kill();
    } catch {}
    serverProc = null;
  }
}

/* ---- windows --------------------------------------------------------------------------------------------------- */
const safeRoute = v.safeRoute;
const num = (v, d) => (Number.isFinite(v) ? Math.round(v) : d);

function createWindow(route = "/", opts = {}) {
  const b = opts.bounds;
  const bounds = b ? { x: num(b.x, undefined), y: num(b.y, undefined), width: Math.max(480, num(b.width, 1280)), height: Math.max(360, num(b.height, 800)) } : { width: 1366, height: 820 };
  const win = new BrowserWindow({
    ...bounds,
    minWidth: 480,
    minHeight: 360,
    title: opts.title || "PetraPMS",
    backgroundColor: "#F6F1E7",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.once("ready-to-show", () => win.show());
  if (cfg.kiosk) win.setKiosk(true);
  const origin = new URL(baseUrl).origin;
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const u = new URL(url);
      if (u.origin === origin) {
        createWindow(u.pathname + u.search);
      } else if (v.externalUrl(url)) {
        shell.openExternal(v.externalUrl(url));
      }
    } catch {}
    return { action: "deny" };
  });
  const guard = (e, url) => {
    if (!v.sameOrigin(url, baseUrl)) {
      e.preventDefault();
      const ext = v.externalUrl(url);
      if (ext) shell.openExternal(ext);
    }
  };
  win.webContents.on("will-navigate", guard);
  win.webContents.on("will-redirect", guard);
  win.webContents.on("did-fail-load", (_e, code, desc, _url, isMain) => {
    if (!isMain || code === -3) return;
    log(`load failed (${code} ${desc}) for ${origin}`, "warn");
    // Friendly offline page that keeps retrying every 5 s, so a terminal recovers by itself when the server comes back.
    const html = `<body style="font-family:sans-serif;padding:40px;background:#F6F1E7;color:#2a2118"><h2>সার্ভারের সাথে সংযোগ হচ্ছে না / Cannot reach the PetraPMS server</h2><p>সার্ভার কম্পিউটার চালু ও নেটওয়ার্কে যুক্ত আছে কিনা দেখুন। সংযোগ ফিরলে নিজে থেকেই খুলবে।<br>Check that the server computer is on and connected. This page retries automatically.</p><p id=s style="color:#8a7a62"></p><script>let n=0;setInterval(()=>{n++;document.getElementById('s').textContent='Retrying… ('+n+')';location.href=${JSON.stringify(origin + safeRoute(route))}},5000)</script></body>`;
    win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
  });
  win.on("close", (e) => {
    if (!quitting && cfg.mode === "server" && cfg.trayOnClose && windows.size === 1 && tray) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on("closed", () => windows.delete(win));
  windows.add(win);
  win.loadURL(origin + safeRoute(route));
  return win;
}

function ownerWindow(event) {
  return BrowserWindow.fromWebContents(event.sender);
}

/** IPC is only honoured from our own pages. */
function trusted(event) {
  try {
    return new URL(event.senderFrame.url).origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
}
function handle(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!trusted(event)) throw new Error("Untrusted sender");
    return fn(event, ...args);
  });
}

ipcMain.on("petra:boot", (e) => {
  if (!trusted(e)) {
    e.returnValue = { terminalId: "", mode: "" };
    return;
  }
  e.returnValue = { terminalId: cfg.terminalId, mode: cfg.mode };
});

handle("petra:printers", async (e) => (await e.sender.getPrintersAsync()).map((p) => ({ name: p.name, isDefault: !!p.isDefault })));

/** Writes a validated PDF to <data>/temp and runs fn(file); the temp file is removed afterwards. */
function tempPdf(data) {
  const tmp = path.join(config.dataDir(), "temp");
  fs.mkdirSync(tmp, { recursive: true });
  const file = path.join(tmp, `print-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pdf`);
  fs.writeFileSync(file, data, { flag: "wx" });
  return file;
}
const later = (file, ms = 60_000) => setTimeout(() => fs.rm(file, { force: true }, () => {}), ms);
const pdfWindowPrefs = { plugins: true, sandbox: true, contextIsolation: true, nodeIntegration: false };

/** Loads the PDF in a hidden window and waits until the viewer has really finished (no fixed sleeps). */
async function loadPdf(w, file) {
  await Promise.race([
    new Promise((resolve, reject) => {
      w.webContents.once("did-finish-load", resolve);
      w.webContents.once("did-fail-load", (_e, code, desc) => reject(new Error(`PDF could not be loaded (${desc})`)));
      w.loadFile(file).catch(reject);
    }),
    new Promise((_r, reject) => setTimeout(() => reject(new Error("PDF load timed out")), 20_000)),
  ]);
  await new Promise((r) => setTimeout(r, 400)); // the built-in PDF viewer paints just after load
}

handle("petra:print", async (e, rawBuf, rawOpts) => {
  let a;
  try {
    a = v.printArgs(rawBuf, rawOpts);
  } catch (err) {
    return { ok: false, error: String(err.message) };
  }
  // A named printer that no longer exists (unplugged USB thermal printer, renamed queue) must produce a clear error, not a silent no-op.
  if (a.printer) {
    try {
      const list = await e.sender.getPrintersAsync();
      if (!list.some((p) => p.name === a.printer)) return { ok: false, error: `Printer "${a.printer}" was not found. Check that it is switched on and connected, or choose another printer in Settings.` };
    } catch {}
  }
  const file = tempPdf(a.data);
  const w = new BrowserWindow({ show: false, webPreferences: pdfWindowPrefs });
  w.webContents.on("will-navigate", (ev) => ev.preventDefault());
  w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  try {
    await loadPdf(w, file);
    return await Promise.race([
      new Promise((resolve) => {
        w.webContents.print({ silent: a.silent, deviceName: a.printer || undefined, printBackground: true, margins: { marginType: a.thermal ? "none" : "default" } }, (ok, reason) => resolve(ok ? { ok: true } : { ok: false, error: reason || "Print cancelled" }));
      }),
      new Promise((resolve) => setTimeout(() => resolve({ ok: false, error: "The printer did not respond in time." }), 90_000)),
    ]);
  } catch (err) {
    logErr("print failed: " + (err && err.message));
    return { ok: false, error: String((err && err.message) || err) };
  } finally {
    w.destroy();
    later(file);
  }
});

/** On-screen preview in a normal window with the built-in PDF viewer (zoom, print button). */
handle("petra:previewPdf", (_e, rawBuf, title) => {
  const data = v.pdfBytes(rawBuf);
  const file = tempPdf(data);
  const w = new BrowserWindow({ width: 900, height: 1000, title: typeof title === "string" ? title.slice(0, 80) : "PetraPMS", autoHideMenuBar: true, webPreferences: pdfWindowPrefs });
  w.webContents.on("will-navigate", (ev) => ev.preventDefault());
  w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  w.on("closed", () => later(file, 1000));
  w.loadFile(file).catch((err) => logErr("preview failed: " + err.message));
  return { ok: true };
});

/** Fallback when the app cannot print: open the PDF in the computer's own PDF reader (Edge, Adobe, …). */
handle("petra:openPdfExternal", async (_e, rawBuf) => {
  const file = tempPdf(v.pdfBytes(rawBuf));
  const err = await shell.openPath(file);
  later(file, 10 * 60_000);
  return err ? { ok: false, error: err } : { ok: true };
});

handle("petra:saveFile", async (e, name, data) => {
  const a = v.saveArgs(name, data);
  const r = await dialog.showSaveDialog(ownerWindow(e), { defaultPath: path.join(app.getPath("downloads"), a.name) });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, a.data);
  return r.filePath;
});

handle("petra:openDataFolder", async () => {
  await shell.openPath(config.dataDir());
});
handle("petra:setKiosk", (e, on) => {
  cfg = { ...cfg, kiosk: !!on };
  config.save(cfg);
  for (const w of windows) w.setKiosk(!!on);
});
handle("petra:displays", () => {
  const primary = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d, i) => ({ id: d.id, label: d.label || `Display ${i + 1}`, bounds: d.bounds, primary: d.id === primary }));
});
handle("petra:windowState", (e) => {
  const w = ownerWindow(e);
  const bounds = w.getBounds();
  return { displayId: screen.getDisplayMatching(bounds).id, bounds };
});
handle("petra:openWindow", (_e, route, rawOpts) => {
  const opts = v.windowOpts(rawOpts);
  let bounds = opts.bounds;
  if (opts.displayId && !bounds) {
    const d = screen.getAllDisplays().find((x) => x.id === opts.displayId);
    if (d) bounds = { x: d.bounds.x + 40, y: d.bounds.y + 40, width: d.bounds.width - 80, height: d.bounds.height - 80 };
  }
  createWindow(route, { bounds, title: opts.title });
});
handle("petra:openWorkspace", (_e, rawList) => {
  const list = v.workspace(rawList);
  for (const w of list) {
    const d = screen.getAllDisplays().find((x) => x.id === w.displayId) || screen.getPrimaryDisplay();
    const b = w.bounds;
    const width = Math.min(Math.max(480, num(b.width, d.bounds.width)), d.bounds.width);
    const height = Math.min(Math.max(360, num(b.height, d.bounds.height)), d.bounds.height);
    // Clamp into the display so a saved layout from a larger monitor still opens on screen.
    const x = Math.min(Math.max(num(b.x, d.bounds.x), d.bounds.x), d.bounds.x + d.bounds.width - width);
    const y = Math.min(Math.max(num(b.y, d.bounds.y), d.bounds.y), d.bounds.y + d.bounds.height - height);
    createWindow(w.route, { bounds: { x, y, width, height } });
  }
});
handle("petra:appInfo", () => ({ version: app.getVersion(), mode: cfg.mode, dataDir: config.dataDir(), lanUrls: cfg.mode === "server" ? config.lanUrls(cfg.port) : [] }));

/* ---- updates (no telemetry: only contacts the feed URL you configured) ------------------------------------------ */
// Flow: check → download (sha512 verified by electron-updater against the signed feed) → "ready" → an administrator
// confirms in the UI → the UI takes a verified PRE_UPDATE backup through the server → only then installUpdate runs the
// installer (service stop → files → service refresh → migrations, see build/installer.nsh). Nothing is ever installed
// silently on quit, so an update can never be applied without a fresh backup.
let updater = null;
const updateState = { state: "idle", version: null, progress: 0, error: null, checkedAt: null, current: app.getVersion() };
const setUpdate = (patch) => Object.assign(updateState, patch);
function setupUpdater() {
  if (isDev || !cfg.updateUrl) return;
  try {
    ({ autoUpdater: updater } = require("electron-updater"));
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = false;
    updater.allowDowngrade = false;
    updater.allowPrerelease = false;
    updater.setFeedURL({ provider: "generic", url: cfg.updateUrl });
    updater.on("error", (e) => {
      logErr("updater: " + ((e && e.message) || e), "update");
      setUpdate({ state: "error", error: String((e && e.message) || e).slice(0, 300) });
    });
    updater.on("checking-for-update", () => {
      log("checking for update", "info", "update");
      setUpdate({ state: "checking", error: null });
    });
    updater.on("update-available", (i) => {
      log(`update available: ${i && i.version}`, "info", "update");
      setUpdate({ state: "downloading", version: i && i.version, progress: 0, checkedAt: new Date().toISOString() });
    });
    updater.on("update-not-available", () => {
      log("no update available", "info", "update");
      setUpdate({ state: "idle", version: null, checkedAt: new Date().toISOString() });
    });
    updater.on("download-progress", (p) => setUpdate({ state: "downloading", progress: Math.round((p && p.percent) || 0) }));
    updater.on("update-downloaded", (i) => {
      log(`update downloaded and checksum-verified: ${i && i.version}`, "info", "update");
      setUpdate({ state: "downloaded", version: i && i.version, progress: 100 });
    });
    const check = () => updater.checkForUpdates().catch(() => {});
    check();
    setInterval(check, 6 * 60 * 60 * 1000).unref();
  } catch (e) {
    log("updater unavailable: " + e.message, "warn", "update");
  }
}
handle("petra:checkForUpdates", async () => {
  if (!updater) return { available: false, error: cfg.updateUrl ? "Updater unavailable" : "No update feed configured" };
  if (updateState.state === "downloaded") return { available: true, version: updateState.version, downloaded: true };
  try {
    const r = await updater.checkForUpdates();
    const v = r && r.updateInfo && r.updateInfo.version;
    return { available: !!v && v !== app.getVersion(), version: v };
  } catch (e) {
    return { available: false, error: String(e.message || e) };
  }
});
handle("petra:updateStatus", () => ({ ...updateState, enabled: !!updater }));
handle("petra:installUpdate", () => {
  if (!updater || updateState.state !== "downloaded") return { ok: false, error: "No downloaded update is ready" };
  log(`installing update ${updateState.version} (backup confirmed by administrator flow)`, "info", "update");
  setImmediate(() => {
    quitting = true;
    updater.quitAndInstall(false, true);
  });
  return { ok: true };
});

/* ---- first-run mode chooser -------------------------------------------------------------------------------------- */
function runElevated(args) {
  // UAC prompt via PowerShell; resolves when the elevated helper exits.
  const ps = `Start-Process -FilePath '${process.execPath.replace(/'/g, "''")}' -ArgumentList '--service','${args}' -Verb RunAs -Wait`;
  const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { windowsHide: true });
  return r.status === 0;
}

function chooseMode() {
  return new Promise((resolve) => {
    const w = new BrowserWindow({ width: 560, height: 560, resizable: false, title: "PetraPMS", autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, "welcome-preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false } });
    w.loadFile(path.join(__dirname, "welcome.html"));
    const fromWelcome = (e) => e.sender === w.webContents && e.senderFrame.url.startsWith("file:");
    ipcMain.removeHandler("welcome:lan");
    ipcMain.removeHandler("welcome:choose");
    ipcMain.handle("welcome:lan", (e) => (fromWelcome(e) ? config.lanUrls(cfg.port) : []));
    ipcMain.handle("welcome:choose", async (e, arg) => {
      if (!fromWelcome(e) || !arg || typeof arg !== "object") return { error: "Untrusted sender" };
      const { mode } = arg;
      let serverUrl = arg.serverUrl;
      if (!["standalone", "server", "terminal"].includes(mode)) return { error: "Invalid mode" };
      if (mode === "terminal") {
        try {
          serverUrl = v.serverUrl(serverUrl);
        } catch {
          return { error: "Enter the server address, e.g. http://192.168.1.10:38080" };
        }
      }
      cfg = { ...cfg, mode, serverUrl: mode === "terminal" ? serverUrl : "", configured: true };
      config.save(cfg);
      if (mode === "server" && process.platform === "win32" && !runElevated("install")) {
        cfg = { ...cfg, mode: "standalone" };
        config.save(cfg);
        return { error: "Administrator permission is needed to install the service. Choose again or pick Single computer." };
      }
      w.destroy();
      resolve();
    });
    w.webContents.on("will-navigate", (e) => e.preventDefault());
    w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    w.on("closed", () => resolve());
  });
}

/* ---- tray -------------------------------------------------------------------------------------------------------- */
function createTray() {
  const iconPath = path.join(__dirname, "..", "build", "icon.png");
  const img = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 }) : nativeImage.createEmpty();
  tray = new Tray(img);
  tray.setToolTip("PetraPMS");
  const show = () => {
    const w = [...windows][0];
    if (w) (w.show(), w.focus());
    else createWindow("/");
  };
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open PetraPMS", click: show },
      { label: "New window", click: () => createWindow("/") },
      { label: "Open data folder", click: () => shell.openPath(config.dataDir()) },
      { type: "separator" },
      { label: "Quit", click: () => ((quitting = true), app.quit()) },
    ]),
  );
  tray.on("double-click", show);
}

/* ---- boot -------------------------------------------------------------------------------------------------------- */
app.on("web-contents-created", (_e, contents) => {
  contents.on("will-attach-webview", (e) => e.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: "deny" })); // windows that set their own handler (createWindow) override this
});

app.whenReady().then(async () => {
  try {
    if (!cfg.configured) await chooseMode();
    cfg = config.load();
    if (!cfg.configured) return app.quit();

    // Only camera (ID/photo capture) and clipboard are allowed, and only for our own origin.
    const allowed = (wc, permission) => ["media", "clipboard-sanitized-write"].includes(permission) && v.sameOrigin(wc.getURL(), baseUrl);
    session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(allowed(wc, permission)));
    session.defaultSession.setPermissionCheckHandler((wc, permission) => !!wc && allowed(wc, permission));

    baseUrl = cfg.mode === "terminal" ? cfg.serverUrl : await startServer();
    if (cfg.lastVersion && cfg.lastVersion !== app.getVersion()) log(`PetraPMS updated from ${cfg.lastVersion} to ${app.getVersion()}`, "info", "update");
    if (cfg.lastVersion !== app.getVersion()) {
      cfg = { ...cfg, lastVersion: app.getVersion() };
      config.save(cfg);
    }
    if (cfg.mode === "server") createTray();
    Menu.setApplicationMenu(null);
    createWindow("/");
    setupUpdater();
  } catch (e) {
    logErr("boot failed: " + (e && e.stack));
    const updated = cfg.lastVersion && cfg.lastVersion !== app.getVersion();
    const hint = updated
      ? `\n\nThis happened right after an update (${cfg.lastVersion} → ${app.getVersion()}). Your data was backed up before the update (Data & Backups → "Before update"). Re-install the previous version or restore that backup. Details: ${logger.dir()}`
      : `\n\nDetails: ${logger.dir()}`;
    dialog.showErrorBox("PetraPMS could not start", String((e && e.message) || e) + hint);
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (cfg.mode === "server" && tray && !quitting) return;
  app.quit();
});
app.on("before-quit", () => {
  quitting = true;
  stopServer();
});
