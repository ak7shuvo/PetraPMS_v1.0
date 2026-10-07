"use strict";
// Runs the bundled Next.js standalone server. Used both by the desktop app (child process) and by the Windows
// Service (WinSW runs PetraPMS.exe with ELECTRON_RUN_AS_NODE=1 and this script).
const path = require("node:path");
const fs = require("node:fs");
const cfg = require("./config.cjs").load();

const resources = process.resourcesPath || path.join(path.dirname(process.execPath), "resources");
const root = process.env.PETRA_WEB_DIR || path.join(resources, "web");
const candidates = [path.join(root, "apps", "web", "server.js"), path.join(root, "server.js"), path.join(__dirname, "..", "..", "web", ".next", "standalone", "apps", "web", "server.js")];
const entry = candidates.find((p) => fs.existsSync(p));
if (!entry) {
  console.error("PetraPMS web server not found. Looked in:\n" + candidates.join("\n"));
  process.exit(2);
}
process.env.PETRA_DATA_DIR = process.env.PETRA_DATA_DIR || require("./config.cjs").dataDir();
process.env.PORT = String(process.env.PORT || cfg.port);
process.env.HOSTNAME = process.env.HOSTNAME || (cfg.mode === "server" ? cfg.bindHost : "127.0.0.1");
process.env.PETRA_MODE = cfg.mode === "server" ? "server" : "standalone";
process.env.PETRA_ASSETS_DIR = process.env.PETRA_ASSETS_DIR || path.join(path.dirname(entry), "assets");
if (cfg.updateUrl && !process.env.PETRA_LICENSE_STATUS_URL) process.env.PETRA_LICENSE_STATUS_URL = cfg.updateUrl.replace(/\/+$/, "") + "/license-status.txt";
// The server learns its version from the desktop package (the single source of truth for the installer version).
// The Windows Service starts this script without the Electron app, so it must be set here, never left to a default.
if (!process.env.PETRA_APP_VERSION) process.env.PETRA_APP_VERSION = require("../package.json").version;
process.env.NODE_ENV = "production";
process.chdir(path.dirname(entry));
require(entry);
