// Backups and restore.
//   SQLite:   consistent online snapshot with VACUUM INTO (separate read connection, WAL allows it), gzip.
//   Postgres: portable JSON dump of every table (no pg_dump needed on the customer's machine), gzip.
// Optional AES-256-GCM encryption with a random key kept in <data>/backup.key (shown once as a recovery key;
// backups copied to USB or a network share stay unreadable without it). Each file starts with a small header
// so restore can verify format, schema version and integrity (SHA-256) before touching the live database.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { latestSchemaVersion, openSqlite, sqliteSchemaVersion } from "@petra/db";
import type { Db } from "../db";
import { closeDb, getDb } from "../db";
import { validateUserFolder } from "../fsSafe";
import { env } from "../env";
import { ApiError, mapSystemError } from "../errors";
import { buildProvider } from "./backupStorage";
import { getSection, patchSection } from "../settings";
import { errText, log } from "../log";
import { audit, type AuditActor } from "../common";

const MAGIC = "PETRABK1";

export interface BackupHeader {
  magic: string;
  provider: "sqlite" | "postgres";
  schemaVersion: string;
  appVersion: string;
  createdAt: string;
  encrypted: boolean;
  sha256: string; // of the plain (decompressed, decrypted) payload
  hotel: string;
}

function keyFile() {
  return path.join(env().dataDir, "backup.key");
}

/** Returns the encryption key, creating one when missing. */
export function backupKey(create = true): Buffer | null {
  const f = keyFile();
  if (fs.existsSync(f)) return Buffer.from(fs.readFileSync(f, "utf8").trim(), "base64url");
  if (!create) return null;
  const k = randomBytes(32);
  fs.writeFileSync(f, k.toString("base64url"), { mode: 0o600 });
  return k;
}

export function recoveryKey(): string | null {
  const k = backupKey(false);
  return k ? k.toString("base64url").replace(/(.{8})(?!$)/g, "$1-") : null;
}

function parseRecoveryKey(s: string): Buffer {
  const k = Buffer.from(s.replace(/[^A-Za-z0-9_-]/g, ""), "base64url");
  if (k.length !== 32) throw new ApiError(400, "BAD_KEY", "The recovery key is not valid");
  return k;
}

function stamp() {
  return new Date().toISOString().replace(/\D/g, "").slice(0, 14);
}

export function backupDir(folder?: string) {
  const d = folder && folder.trim() ? validateUserFolder(folder, "Backup folder") : env().backupsDir;
  fs.mkdirSync(d, { recursive: true });
  return d;
}

async function sqlitePayload(): Promise<Buffer> {
  const tmp = path.join(env().dataDir, `.snapshot-${stamp()}-${randomBytes(3).toString("hex")}.db`);
  const conn = openSqlite(env().dbFile, { readOnly: false });
  try {
    conn.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  } finally {
    conn.close();
  }
  try {
    return fs.readFileSync(tmp);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

async function postgresPayload(): Promise<Buffer> {
  const { Client } = await import("pg");
  const c = new Client({ connectionString: env().databaseUrl });
  await c.connect();
  try {
    await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const tables = (await c.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`)).rows.map((r) => r.table_name as string);
    const out: Record<string, unknown[]> = {};
    for (const t of tables) out[t] = (await c.query(`SELECT * FROM "${t}"`)).rows;
    await c.query("COMMIT");
    return Buffer.from(JSON.stringify({ format: "petra-pg-json-1", tables: out }));
  } finally {
    await c.end();
  }
}

function encrypt(plain: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]);
}

function decrypt(data: Buffer, key: Buffer): Buffer {
  const iv = data.subarray(0, 12);
  const tag = data.subarray(12, 28);
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  try {
    return Buffer.concat([d.update(data.subarray(28)), d.final()]);
  } catch {
    throw new ApiError(400, "BAD_KEY", "Cannot decrypt the backup: wrong recovery key or damaged file");
  }
}

export async function createBackup(db: Db, kind: "AUTO" | "MANUAL" | "PRE_RESTORE" | "PRE_UPDATE" | "PRE_IMPORT" | "PRE_AUDIT", actor?: AuditActor) {
  const e = env();
  const s = await getSection(db, "backup");
  const fileName = `petrapms-${kind.toLowerCase().replace("_", "-")}-${stamp()}.petrabak`;
  let file = path.join(s.folder || env().backupsDir, fileName);
  const hotel = (await db.hotel.findUnique({ where: { id: "hotel" }, select: { name: true } }))?.name ?? "";
  try {
    file = path.join(backupDir(s.folder), fileName); // inside the try: an unplugged drive must be recorded as a failed backup
    const plain = e.provider === "sqlite" ? await sqlitePayload() : await postgresPayload();
    const header: BackupHeader = { magic: MAGIC, provider: e.provider, schemaVersion: latestSchemaVersion(e.provider), appVersion: e.appVersion, createdAt: new Date().toISOString(), encrypted: s.encrypt, sha256: createHash("sha256").update(plain).digest("hex"), hotel };
    let body = zlib.gzipSync(plain, { level: 6 });
    if (s.encrypt) body = encrypt(body, backupKey(true)!);
    const h = Buffer.from(JSON.stringify(header));
    const len = Buffer.alloc(4);
    len.writeUInt32BE(h.length);
    fs.writeFileSync(file + ".part", Buffer.concat([Buffer.from(MAGIC), len, h, body]));
    fs.renameSync(file + ".part", file);
    verifyBackupFile(file, header.sha256, s.encrypt);
    const size = fs.statSync(file).size;
    const rec = await db.backupRecord.create({ data: { fileName, path: file, sizeBytes: size, kind, encrypted: s.encrypt, sha256: header.sha256, schemaVersion: header.schemaVersion, appVersion: e.appVersion, createdById: actor?.userId ?? null } });
    if (actor) await audit(db, actor, "backup.created", "BackupRecord", rec.id, { after: { fileName, kind, size } });
    await pruneBackups(db);
    await replicate(db, file, fileName, s);
    return rec;
  } catch (err) {
    for (const f of [file + ".part", file]) {
      try {
        fs.rmSync(f, { force: true }); // a file that failed verification must not look like a good backup
      } catch {
        /* the folder itself is unavailable */
      }
    }
    const msg = (err as Error).message;
    log("error", "backup", `backup failed: ${errText(err)}`);
    await db.backupRecord.create({ data: { fileName, path: file, kind, status: "FAILED", error: msg.slice(0, 500), appVersion: e.appVersion } }).catch(() => undefined);
    const m = mapSystemError(err);
    throw new ApiError(m?.status ?? 500, m?.code ?? "BACKUP_FAILED", m?.message ?? `Backup failed: ${msg}`, m?.details);
  }
}

/** Re-reads the file just written and checks container, decryption and checksum, so a half-written backup is never trusted. */
export function verifyBackupFile(file: string, sha256: string, encrypted: boolean) {
  const buf = fs.readFileSync(file);
  const { header } = readBackup(buf);
  if (header.sha256 !== sha256 || header.encrypted !== encrypted) throw new ApiError(500, "BACKUP_VERIFY", "Backup verification failed after writing");
}

/** Second copy (folder/NAS or cloud). A failure here is reported and retried by the scheduler but never fails the local backup. */
async function replicate(db: Db, file: string, fileName: string, s: Awaited<ReturnType<typeof getSection<"backup">>>) {
  let provider;
  try {
    provider = buildProvider(s);
    if (!provider) return;
    await provider.put(fileName, fs.readFileSync(file));
    // retention on the remote copy mirrors the local rule
    const cutoff = Date.now() - Math.max(1, s.retentionDays) * 3 * 86400_000;
    for (const o of await provider.list()) {
      const t = o.name.match(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\.petrabak$/);
      if (t && Date.UTC(+t[1], +t[2] - 1, +t[3], +t[4], +t[5], +t[6]) < cutoff) await provider.remove(o.name);
    }
    await patchSection(db, "backup", { lastRemote: { at: new Date().toISOString(), ok: true, error: "", fileName } });
  } catch (err) {
    const msg = ((err as Error).message || "error").slice(0, 300);
    log("error", "backup", `remote backup copy failed: ${msg}`);
    await patchSection(db, "backup", { lastRemote: { at: new Date().toISOString(), ok: false, error: msg, fileName } }).catch(() => undefined);
  }
}

export async function testRemote(db: Db) {
  const p = buildProvider(await getSection(db, "backup"));
  if (!p) throw new ApiError(400, "REMOTE_CONFIG", "No second backup location is configured");
  await p.test();
  return { ok: true, provider: p.id };
}
export async function listRemote(db: Db) {
  const p = buildProvider(await getSection(db, "backup"));
  return p ? p.list() : [];
}
export async function fetchRemote(db: Db, name: string) {
  const p = buildProvider(await getSection(db, "backup"));
  if (!p) throw new ApiError(400, "REMOTE_CONFIG", "No second backup location is configured");
  return p.get(name);
}

/** Deletes automatic backups older than the retention period (manual and pre-* backups are kept 3× longer). */
export async function pruneBackups(db: Db) {
  const s = await getSection(db, "backup");
  const days = Math.max(1, s.retentionDays);
  const rows = await db.backupRecord.findMany({ where: { status: "OK" } });
  const now = Date.now();
  for (const r of rows) {
    const keep = (r.kind === "AUTO" ? days : days * 3) * 86400_000;
    if (now - r.createdAt.getTime() > keep) {
      fs.rmSync(r.path, { force: true });
      await db.backupRecord.delete({ where: { id: r.id } });
    }
  }
}

export function readBackup(buf: Buffer, recovery?: string): { header: BackupHeader; payload: Buffer } {
  if (buf.subarray(0, 8).toString() !== MAGIC) throw new ApiError(400, "NOT_A_BACKUP", "This file is not a PetraPMS backup");
  const len = buf.readUInt32BE(8);
  const header = JSON.parse(buf.subarray(12, 12 + len).toString()) as BackupHeader;
  let body = buf.subarray(12 + len);
  if (header.encrypted) {
    const key = recovery ? parseRecoveryKey(recovery) : backupKey(false);
    if (!key) throw new ApiError(400, "KEY_REQUIRED", "This backup is encrypted. Enter the recovery key.");
    body = decrypt(body, key);
  }
  const payload = zlib.gunzipSync(body);
  if (createHash("sha256").update(payload).digest("hex") !== header.sha256) throw new ApiError(400, "CORRUPT", "The backup file is damaged (checksum mismatch)");
  return { header, payload };
}

/** Validates a backup without restoring (shown to the admin before confirming). */
export function inspectBackup(buf: Buffer, recovery?: string) {
  const { header, payload } = readBackup(buf, recovery);
  const e = env();
  const problems: string[] = [];
  if (header.provider !== e.provider) problems.push(`Backup is from a ${header.provider} database; this installation uses ${e.provider}`);
  if (header.schemaVersion > latestSchemaVersion(e.provider)) problems.push(`Backup was made by a newer PetraPMS version (${header.appVersion}). Update PetraPMS first.`);
  if (header.provider === "sqlite") {
    const tmp = path.join(env().dataDir, `.inspect-${randomBytes(4).toString("hex")}.db`);
    fs.writeFileSync(tmp, payload);
    try {
      const v = sqliteSchemaVersion(tmp);
      const c = openSqlite(tmp, { readOnly: true });
      const ok = (c.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check;
      c.close();
      if (ok !== "ok") problems.push(`Database integrity check failed: ${ok}`);
      if (!v) problems.push("Backup has no schema version");
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }
  return { header, problems, ok: problems.length === 0 };
}

/**
 * Restores a backup. A PRE_RESTORE backup of the current data is always taken first. For SQLite the database
 * file is swapped while the client is closed, then migrations bring an older backup up to date.
 */
export async function restoreBackup(buf: Buffer, actor: AuditActor, recovery?: string) {
  const insp = inspectBackup(buf, recovery);
  if (!insp.ok) throw new ApiError(409, "BACKUP_INCOMPATIBLE", insp.problems.join("; "));
  const { payload, header } = readBackup(buf, recovery);
  const db = await getDb();
  const pre = await createBackup(db, "PRE_RESTORE", actor);
  const e = env();
  if (header.provider === "sqlite") {
    await closeDb();
    const target = e.dbFile;
    const tmp = target + ".restore";
    fs.writeFileSync(tmp, payload);
    for (const ext of ["-wal", "-shm"]) fs.rmSync(target + ext, { force: true });
    fs.renameSync(tmp, target);
  } else {
    await restorePostgres(payload);
    await closeDb();
  }
  const fresh = await getDb(); // re-opens and applies pending migrations for older backups
  // the restored database does not know about the safety backup taken just before; record it again
  const { id: _id, ...preRow } = pre;
  await fresh.backupRecord.create({ data: preRow }).catch(() => undefined);
  await audit(fresh, actor, "backup.restored", "System", "", { after: { from: header.createdAt, appVersion: header.appVersion, preRestoreBackup: pre.fileName } });
  return { restoredFrom: header.createdAt, preRestoreBackup: pre.fileName };
}

async function restorePostgres(payload: Buffer) {
  const dump = JSON.parse(payload.toString()) as { format: string; tables: Record<string, Record<string, unknown>[]> };
  if (dump.format !== "petra-pg-json-1") throw new ApiError(400, "NOT_A_BACKUP", "Unknown backup format");
  const { Client } = await import("pg");
  const c = new Client({ connectionString: env().databaseUrl });
  await c.connect();
  try {
    await c.query("BEGIN");
    const names = Object.keys(dump.tables).filter((t) => t !== "_petra_migrations");
    // dependency order from foreign keys: parents first
    const fks = (await c.query(`SELECT tc.table_name AS child, ccu.table_name AS parent FROM information_schema.table_constraints tc JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public'`)).rows as { child: string; parent: string }[];
    const order: string[] = [];
    const visit = (t: string, seen = new Set<string>()) => {
      if (order.includes(t) || seen.has(t)) return;
      seen.add(t);
      for (const f of fks.filter((x) => x.child === t && x.parent !== t)) visit(f.parent, seen);
      order.push(t);
    };
    names.forEach((t) => visit(t));
    await c.query(`TRUNCATE ${order.map((t) => `"${t}"`).join(", ")} CASCADE`);
    for (const t of order) {
      const rows = dump.tables[t] ?? [];
      for (const row of rows) {
        const cols = Object.keys(row);
        await c.query(`INSERT INTO "${t}" (${cols.map((x) => `"${x}"`).join(",")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(",")})`, cols.map((k) => row[k]));
      }
    }
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    await c.end();
  }
}

/** Backup health for the dashboard: last successful backup and whether it is overdue. */
export async function backupHealth(db: Db) {
  const s = await getSection(db, "backup");
  const last = await db.backupRecord.findFirst({ where: { status: "OK" }, orderBy: { createdAt: "desc" } });
  const lastFailed = await db.backupRecord.findFirst({ where: { status: "FAILED" }, orderBy: { createdAt: "desc" } });
  const ageHours = last ? (Date.now() - last.createdAt.getTime()) / 3600_000 : null;
  const localState = !s.enabled ? "DISABLED" : !last ? "NEVER" : ageHours! > 36 ? "OVERDUE" : lastFailed && lastFailed.createdAt > last.createdAt ? "FAILED" : "OK";
  const remoteBad = s.remote.provider !== "none" && !!s.lastRemote.at && !s.lastRemote.ok;
  const state = localState === "OK" && remoteBad ? "REMOTE_FAILED" : localState;
  return { state, last: last ? { at: last.createdAt, fileName: last.fileName, size: last.sizeBytes, encrypted: last.encrypted } : null, lastError: remoteBad && localState === "OK" ? s.lastRemote.error : lastFailed && (!last || lastFailed.createdAt > last.createdAt) ? lastFailed.error : null, folder: (() => {
      try {
        return backupDir(s.folder);
      } catch {
        return s.folder; // unplugged drive / bad path: the dashboard must still load and show the failure
      }
    })(), encrypt: s.encrypt };
}

/**
 * Daily automatic backup (called by the scheduler once a minute). Runs once per calendar day after the configured time.
 * If it fails (disk full, drive unplugged) it is retried every 30 minutes — at most 6 times a day — and the dashboard
 * shows the failure until a backup succeeds.
 */
export async function maybeAutoBackup(db: Db, today: string, nowHHMM: string) {
  const s = await getSection(db, "backup");
  if (!s.enabled || s.lastRunDate === today || nowHHMM < s.time) return null;
  if (s.lastFailAt && Date.now() - new Date(s.lastFailAt).getTime() < 30 * 60_000) return null;
  try {
    const rec = await createBackup(db, "AUTO");
    await patchSection(db, "backup", { lastRunDate: today, lastFailAt: "" });
    return rec;
  } catch (e) {
    const failsToday = await db.backupRecord.count({ where: { status: "FAILED", kind: "AUTO", createdAt: { gte: new Date(today + "T00:00:00.000Z") } } });
    await patchSection(db, "backup", { lastFailAt: new Date().toISOString(), ...(failsToday >= 6 ? { lastRunDate: today } : {}) });
    throw e;
  }
}
