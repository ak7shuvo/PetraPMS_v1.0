import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDb, migrate, sqliteSchemaVersion, latestSchemaVersion, type Db } from "../src";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "petra-db-"));
const file = path.join(dir, "t.db");
let db: Db;

beforeAll(async () => {
  const r = await migrate({ provider: "sqlite", sqliteFile: file, backupDir: path.join(dir, "backups") });
  expect(r.fresh).toBe(true);
  expect(r.applied.length).toBeGreaterThan(0);
  db = await createDb({ provider: "sqlite", sqliteFile: file });
});
afterAll(async () => db?.$disconnect());

describe("prisma over node:sqlite", () => {
  it("creates and reads related records", async () => {
    const t = await db.roomType.create({ data: { code: "DLX", name: "Deluxe", baseRate: 550000 } });
    await db.room.create({ data: { number: "101", roomTypeId: t.id } });
    const rooms = await db.room.findMany({ include: { roomType: true } });
    expect(rooms[0].roomType.baseRate).toBe(550000);
    expect(rooms[0].createdAt).toBeInstanceOf(Date);
  });
  it("maps unique violations to P2002", async () => {
    await expect(db.roomType.create({ data: { code: "DLX", name: "dup", baseRate: 1 } })).rejects.toMatchObject({ code: "P2002" });
  });
  it("rolls back interactive transactions", async () => {
    await expect(
      db.$transaction(async (tx) => {
        await tx.roomType.create({ data: { code: "STD", name: "Standard", baseRate: 300000 } });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await db.roomType.count({ where: { code: "STD" } })).toBe(0);
  });
  it("does not let outside statements join an open transaction", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const tx = db
      .$transaction(async (t) => {
        await t.roomType.create({ data: { code: "TX1", name: "in tx", baseRate: 1 } });
        await gate;
        throw new Error("rollback");
      })
      .catch(() => "rolled back");
    const outside = db.roomType.create({ data: { code: "OUT", name: "outside", baseRate: 1 } });
    setTimeout(release, 50);
    expect(await tx).toBe("rolled back");
    await outside;
    expect(await db.roomType.count({ where: { code: "TX1" } })).toBe(0);
    expect(await db.roomType.count({ where: { code: "OUT" } })).toBe(1);
  });
  it("handles booleans, nulls, dates and aggregates", async () => {
    const r = await db.role.create({ data: { code: "r", name: "R" } });
    const user = await db.user.create({ data: { username: "a", fullName: "A", roleId: r.id, passwordHash: "x", lockedUntil: null } });
    expect(user.active).toBe(true);
    const agg = await db.roomType.aggregate({ _sum: { baseRate: true } });
    expect(agg._sum.baseRate).toBeGreaterThan(0);
  });
  it("re-running migrations is a no-op and the schema version is recorded", async () => {
    const again = await migrate({ provider: "sqlite", sqliteFile: file, backupDir: path.join(dir, "backups") });
    expect(again.applied).toEqual([]);
    expect(sqliteSchemaVersion(file)).toBe(latestSchemaVersion("sqlite"));
  });
});

const pgUrl = process.env.PG_TEST_URL;
describe.skipIf(!pgUrl)("prisma over postgres", () => {
  it("migrates and queries", async () => {
    const { Client } = await import("pg");
    const c = new Client({ connectionString: pgUrl });
    await c.connect();
    await c.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await c.end();
    const r = await migrate({ provider: "postgres", databaseUrl: pgUrl });
    expect(r.applied.length).toBeGreaterThan(0);
    const pg = await createDb({ provider: "postgres", databaseUrl: pgUrl });
    const t = await pg.roomType.create({ data: { code: "DLX", name: "Deluxe", baseRate: 550000 } });
    await expect(pg.roomType.create({ data: { code: "DLX", name: "dup", baseRate: 1 } })).rejects.toMatchObject({ code: "P2002" });
    await expect(
      pg.$transaction(async (tx) => {
        await tx.room.create({ data: { number: "1", roomTypeId: t.id } });
        throw new Error("x");
      }),
    ).rejects.toThrow();
    expect(await pg.room.count()).toBe(0);
    await pg.$disconnect();
  });
});
