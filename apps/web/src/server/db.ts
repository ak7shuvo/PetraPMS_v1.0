// Database singleton. On first use: run pending migrations (with an automatic pre-migration backup for SQLite),
// open the Prisma client, then seed the permission catalogue and default roles. Survives Next.js hot reload.
import { createDb, migrate, type Db, type Tx, type MigrateResult } from "@petra/db";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { env } from "./env";
import { errText, log } from "./log";

interface DbState {
  db: Promise<Db>;
  migration: MigrateResult | null;
}
const g = globalThis as unknown as { __petraDb?: DbState };

export class DatabaseDamagedError extends Error {
  constructor(public detail: string) {
    super("The hotel database file is damaged. Do not keep working: restore the latest backup (Data center → Backup) or contact support.");
    this.name = "DatabaseDamagedError";
  }
}

/** Fast structural check of an existing SQLite file before anything writes to it (after a crash or power loss). */
export function checkSqliteIntegrity(file: string): void {
  if (!fs.existsSync(file) || fs.statSync(file).size === 0) return;
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(file);
    db.exec("PRAGMA busy_timeout=10000");
    const rows = db.prepare("PRAGMA quick_check").all() as { quick_check: string }[];
    const bad = rows.map((r) => r.quick_check).filter((v) => v !== "ok");
    if (bad.length) throw new DatabaseDamagedError(bad.slice(0, 5).join("; "));
  } catch (err) {
    if (err instanceof DatabaseDamagedError) throw err;
    throw new DatabaseDamagedError(String((err as Error).message));
  } finally {
    try {
      db?.close();
    } catch {
      /* ignore */
    }
  }
}

async function init(state: DbState): Promise<Db> {
  const e = env();
  if (e.provider === "sqlite") checkSqliteIntegrity(e.dbFile);
  const res = await migrate({ provider: e.provider, sqliteFile: e.dbFile, databaseUrl: e.databaseUrl, backupDir: e.backupsDir });
  state.migration = res;
  if (res.applied.length) log("info", "database", `applied migrations: ${res.applied.join(", ")}${res.preMigrationBackup ? ` (backup ${res.preMigrationBackup})` : ""}`);
  const db = await createDb({ provider: e.provider, sqliteFile: e.dbFile, databaseUrl: e.databaseUrl });
  const { ensureSystemData } = await import("./bootstrap");
  await ensureSystemData(db);
  return db;
}

export function getDb(): Promise<Db> {
  if (!g.__petraDb) {
    const state: DbState = { db: null as unknown as Promise<Db>, migration: null };
    state.db = init(state).catch((err) => {
      g.__petraDb = undefined; // allow retry after fixing the cause
      log("error", "database", `database init failed: ${errText(err, 10)}`);
      throw err;
    });
    g.__petraDb = state;
  }
  return g.__petraDb.db;
}

export function lastMigration(): MigrateResult | null {
  return g.__petraDb?.migration ?? null;
}

/** Closes the client (used before restoring a backup and in tests). */
export async function closeDb(): Promise<void> {
  const s = g.__petraDb;
  g.__petraDb = undefined;
  if (s) {
    try {
      const db = await s.db;
      await db.$disconnect();
    } catch {
      /* ignore */
    }
  }
}

export type { Db, Tx };
