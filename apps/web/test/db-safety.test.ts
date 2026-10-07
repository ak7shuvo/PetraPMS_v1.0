import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkSqliteIntegrity, DatabaseDamagedError } from "@/server/db";
import { freshApp } from "./helpers";
import { env } from "@/server/env";

describe.skipIf(!!process.env.PETRA_TEST_PG)("SQLite integrity check at start-up", () => {
  it("passes on a healthy database and on a missing file", async () => {
    await freshApp();
    expect(() => checkSqliteIntegrity(env().dbFile)).not.toThrow();
    expect(() => checkSqliteIntegrity(path.join(os.tmpdir(), "nope-" + Date.now() + ".db"))).not.toThrow();
  });
  it("refuses a corrupted file with a clear error", async () => {
    await freshApp();
    const { closeDb } = await import("@/server/db");
    await closeDb();
    const f = env().dbFile;
    const buf = fs.readFileSync(f);
    // damage the middle of the file (keeps the header so it still looks like SQLite)
    for (let i = 4096; i < Math.min(buf.length, 4096 * 6); i++) buf[i] = (buf[i] + 97) & 255;
    fs.writeFileSync(f, buf);
    expect(() => checkSqliteIntegrity(f)).toThrow(DatabaseDamagedError);
  });
});
