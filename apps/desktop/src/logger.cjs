"use strict";
// Desktop-shell logging: <data>/logs/desktop.log (+ error.log for errors, update.log for the updater), rotated at 2 MB × 5.
// The captured stdout/stderr of the server child process goes to server-stdio.log through a rotating stream.
const fs = require("node:fs");
const path = require("node:path");
const config = require("./config.cjs");

const MAX = 2 * 1024 * 1024;
const KEEP = 5;

const redact = (s) =>
  String(s)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted]")
    .replace(/\b(password|passwd|pin|token|secret|apiKey|api_key|authorization|key)(["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&}]+)/gi, "$1$2[redacted]")
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, "[private-key]");

function rotate(file) {
  try {
    if (!fs.existsSync(file) || fs.statSync(file).size <= MAX) return;
    for (let i = KEEP - 1; i >= 1; i--) if (fs.existsSync(`${file}.${i}`)) fs.renameSync(`${file}.${i}`, `${file}.${i + 1}`);
    fs.renameSync(file, `${file}.1`);
    fs.rmSync(`${file}.${KEEP + 1}`, { force: true });
  } catch {
    /* never let logging break the app */
  }
}

function dir() {
  const d = path.join(config.dataDir(), "logs");
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function write(name, line) {
  try {
    const f = path.join(dir(), name);
    rotate(f);
    fs.appendFileSync(f, line);
  } catch {
    /* ignore */
  }
}

/** log("error", "update", "message") → desktop.log (+ update.log for area "update", + error.log for errors) */
function log(level, area, message) {
  const line = `${new Date().toISOString()} ${String(level).toUpperCase()} [${area}] ${redact(message)}\n`;
  write("desktop.log", line);
  if (area === "update") write("update.log", line);
  if (level === "error") write("error.log", line);
}

/** A writable stream-like object that rotates; used for the server child's stdout/stderr. */
function rotatingStream(name) {
  return {
    write(chunk) {
      write(name, redact(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk)));
      return true;
    },
  };
}

module.exports = { log, rotatingStream, redact, dir };
