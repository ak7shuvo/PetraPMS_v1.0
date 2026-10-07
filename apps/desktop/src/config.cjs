"use strict";
// Machine-wide configuration (%ProgramData%\PetraPMS\config.json) shared by the desktop app and the Windows Service.
// Contains no secrets: mode, port, optional server URL for terminals, kiosk flag, update feed URL.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

function dataDir() {
  if (process.env.PETRA_DATA_DIR) return path.resolve(process.env.PETRA_DATA_DIR);
  if (process.platform === "win32") return path.join(process.env.ProgramData || "C:\\ProgramData", "PetraPMS");
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "PetraPMS");
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "PetraPMS");
}

const { urlProblem } = require("./release-config.cjs");

/** Update feed chosen at release time. Absent in development builds (then updates stay off unless config.json sets one). */
function bundledUpdateUrl(dir = __dirname) {
  try {
    const u = JSON.parse(fs.readFileSync(path.join(dir, "release.json"), "utf8")).updateUrl;
    return u && !urlProblem(u, { release: true }) ? String(u) : "";
  } catch {
    return "";
  }
}

const DEFAULTS = {
  /** standalone = this computer runs everything; server = also serves the LAN; terminal = connects to a server */
  mode: "standalone",
  port: 38080,
  /** Address the server listens on in Server mode. "0.0.0.0" = whole LAN; set a single LAN IP to limit it. */
  bindHost: "0.0.0.0",
  serverUrl: "",
  kiosk: false,
  trayOnClose: true,
  updateUrl: "",
  terminalId: "",
  configured: false,
  /** Windows Service account in Server mode: "LocalService" (default, least privilege) or "LocalSystem" */
  serviceAccount: "LocalService",
};

function file() {
  return path.join(dataDir(), "config.json");
}

function load() {
  let cfg = {};
  try {
    cfg = JSON.parse(fs.readFileSync(file(), "utf8"));
  } catch {
    /* first run */
  }
  const out = { ...DEFAULTS, ...cfg };
  if (!out.terminalId) out.terminalId = `${os.hostname().toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 16)}-${crypto.randomBytes(4).toString("hex")}`;
  if (!["standalone", "server", "terminal"].includes(out.mode)) out.mode = "standalone";
  out.port = Number.isInteger(out.port) && out.port > 1023 && out.port < 65536 ? out.port : DEFAULTS.port;
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(String(out.bindHost))) out.bindHost = DEFAULTS.bindHost;
  // Update feed: HTTPS only (plain http only for a local test feed); placeholders such as *.invalid are refused.
  // Anything unacceptable is ignored and never contacted. When config.json has none, the feed baked in at release time
  // (release.json, written by scripts/dist-win.mjs from release/release.config.json) is used.
  if (out.updateUrl && urlProblem(out.updateUrl, { release: false })) out.updateUrl = "";
  if (!out.updateUrl) out.updateUrl = bundledUpdateUrl();
  return out;
}

function save(cfg) {
  fs.mkdirSync(dataDir(), { recursive: true });
  const tmp = file() + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2));
  fs.renameSync(tmp, file());
}

function lanUrls(port) {
  const urls = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === "IPv4" && !i.internal) urls.push(`http://${i.address}:${port}`);
  }
  return urls;
}

module.exports = { bundledUpdateUrl, dataDir, load, save, lanUrls, file, DEFAULTS };
