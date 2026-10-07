// Local rotating log files in <data>/logs. One file per category, plus error.log (every error) and petrapms.log (everything):
//   application · error · security · license · backup · update · database · server
// Rotation: 2 MB × 5 per file. Nothing secret is ever written: values are redacted on the way in (passwords, PINs, tokens,
// API keys, private keys, license keys, recovery keys, e-mail addresses, phone numbers), and database errors are reduced to
// their first line because Prisma otherwise echoes the whole query payload (guest names, phones, ID numbers).
import fs from "node:fs";
import path from "node:path";
import { env } from "./env";

export const LOG_CATEGORIES = ["application", "error", "security", "license", "backup", "update", "database", "server"] as const;
export type LogCategory = (typeof LOG_CATEGORIES)[number];

const MAX = 2 * 1024 * 1024;
const KEEP = 5;

const AREA_TO_CATEGORY: Record<string, LogCategory> = {
  auth: "security",
  security: "security",
  license: "license",
  backup: "backup",
  restore: "backup",
  update: "update",
  updater: "update",
  db: "database",
  database: "database",
  migrate: "database",
  server: "server",
  api: "server",
  startup: "server",
  crash: "server",
};
export const categoryOf = (area: string): LogCategory => AREA_TO_CATEGORY[area] ?? "application";

const SECRET_KEY = "password|passwd|pin|token|secret|authorization|apiKey|api_key|accessKeyId|secretAccessKey|privateKey|passphrase|recoveryKey|recovery|key";
const SECRET_RE = new RegExp(`("?(?:${SECRET_KEY})"?\\s*[:=]\\s*)("[^"]*"|'[^']*'|[^\\s,;}]+)`, "gi");

export function redact(s: string): string {
  return s
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, "[private-key]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted]")
    .replace(SECRET_RE, "$1[redacted]")
    .replace(/\bppk_[A-Za-z0-9_-]{6,}/g, "ppk_[redacted]")
    .replace(/\bPETRA1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[license-key]")
    .replace(/\bPETRAREQ1\.[A-Za-z0-9_-]+/g, "[activation-request]")
    .replace(/\$argon2[^\s"']+|\bscrypt\$[^\s"']+/g, "[hash]")
    .replace(/\b[a-f0-9]{48,}\b/gi, "[token]")
    .replace(/\b([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g, "$1***@$2")
    .replace(/(?<![\d.])(\+?88)?(01[3-9])\d{6}(\d{2})(?![\d.])/g, "$1$2******$3");
}

/** Safe text for an error: no query payloads, bounded stack. Use this instead of interpolating an Error into a log line. */
export function errText(e: unknown, frames = 6): string {
  const err = e as { name?: string; code?: string; message?: string; stack?: string } | null;
  if (!err || typeof err !== "object") return String(e).slice(0, 300);
  let msg = String(err.message ?? err);
  if (/Invalid `prisma\.|PrismaClient/.test(msg) || err.name?.startsWith("PrismaClient")) {
    // Prisma echoes the whole query payload (guest names, phones, ID numbers) before the real reason, which is the last line.
    const last = msg.split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? "database error";
    msg = `${last.replace(/(['"])(?:(?!\1).)*\1/g, "$1?$1").slice(0, 200)} [query details omitted]`;
  }
  const stack = (err.stack ?? "").split("\n").filter((l) => /^\s+at /.test(l)).slice(0, frames).join("\n");
  return `${err.name ?? "Error"}${err.code ? ` ${err.code}` : ""}: ${msg.split("\n")[0].slice(0, 400)}${stack ? "\n" + stack : ""}`;
}

function rotate(file: string) {
  if (!fs.existsSync(file) || fs.statSync(file).size <= MAX) return;
  for (let i = KEEP - 1; i >= 1; i--) {
    const a = `${file}.${i}`;
    if (fs.existsSync(a)) fs.renameSync(a, `${file}.${i + 1}`);
  }
  fs.renameSync(file, `${file}.1`);
  fs.rmSync(`${file}.${KEEP + 1}`, { force: true });
}

function append(dir: string, name: string, line: string) {
  const file = path.join(dir, name);
  rotate(file);
  fs.appendFileSync(file, line);
}

export function log(level: "info" | "warn" | "error", area: string, message: string) {
  const cat = categoryOf(area);
  const line = `${new Date().toISOString()} ${level.toUpperCase()} [${area}] ${redact(message)}\n`;
  if (process.env.NODE_ENV !== "test" && level !== "info") process.stderr.write(line);
  try {
    const dir = env().logsDir;
    append(dir, `${cat}.log`, line);
    if (level === "error") append(dir, "error.log", line);
    append(dir, "petrapms.log", line);
  } catch {
    /* logging must never break a request */
  }
}

/** Last lines of every log (already redacted at write time; redacted again defensively) for the support bundle. */
export function tailLogs(lines = 200): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const dir = env().logsDir;
    for (const c of LOG_CATEGORIES) {
      const f = path.join(dir, `${c}.log`);
      if (!fs.existsSync(f)) continue;
      const buf = fs.readFileSync(f, "utf8").split("\n");
      out[c] = redact(buf.slice(-lines).join("\n"));
    }
  } catch {
    /* ignore */
  }
  return out;
}
