import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { redact, errText, log, categoryOf, LOG_CATEGORIES } from "@/server/log";
import { env } from "@/server/env";
import { api, freshApp, setupAndLogin } from "./helpers";

describe("log redaction", () => {
  it("never keeps secrets", () => {
    const cases = [
      'login {"username":"a","password":"Sup3rSecret!"}',
      "password=hunter2 pin: 7392",
      "Authorization: Bearer abcdef0123456789abcdef.token-part",
      "key ppk_abcDEF123456789",
      ["-----BEGIN", "PRIVATE KEY-----"].join(" ") + "\nMIIEvQIBADANBgkq\n" + ["-----END", "PRIVATE KEY-----"].join(" "),
      "PETRA1.eyJhIjoxfQ.c2lnbmF0dXJl",
      "secretAccessKey=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      "hash $argon2id$v=19$m=65536,t=3,p=4$abc$def",
      "session " + "a".repeat(64),
      "recoveryKey: ABCD-EFGH-1234",
    ];
    const out = cases.map(redact).join("\n");
    for (const bad of ["Sup3rSecret", "hunter2", "7392", "abcdef0123456789abcdef", "ppk_abcDEF", "MIIEvQ", "eyJhIjoxfQ", "wJalrXUtnFEMI", "argon2id", "a".repeat(64), "ABCD-EFGH-1234"]) expect(out, bad).not.toContain(bad);
  });
  it("masks guest contact data", () => {
    const r = redact("guest rahim.uddin@example.com phone 01711223344 and +8801812345678");
    expect(r).not.toContain("rahim.uddin");
    expect(r).not.toContain("01711223344");
    expect(r).not.toContain("1812345678");
    expect(r).toContain("@example.com");
  });
  it("keeps ordinary text readable", () => {
    expect(redact("applied migrations: 0003_x, 0004_y (backup petrapms-pre-update-2026.petrabak)")).toContain("0003_x");
  });
  it("reduces Prisma errors to one line (no query payload)", () => {
    const e = new Error("\nInvalid `prisma.guest.create()` invocation:\n\n{ data: { fullName: 'Rahim Uddin', phone: '01711223344', idNumber: '99887766' } }\n\nUnique constraint failed on the fields: (`phone`)");
    e.name = "PrismaClientKnownRequestError";
    const t = errText(e);
    expect(t).not.toContain("Rahim");
    expect(t).not.toContain("99887766");
    expect(t).toContain("query details omitted");
  });
});

describe("log categories and files", () => {
  beforeAll(async () => {
    await freshApp("petra-log-");
  });
  it("maps areas to the eight categories", () => {
    expect(LOG_CATEGORIES).toEqual(["application", "error", "security", "license", "backup", "update", "database", "server"]);
    expect([categoryOf("auth"), categoryOf("license"), categoryOf("backup"), categoryOf("db"), categoryOf("api"), categoryOf("updater"), categoryOf("scheduler")]).toEqual(["security", "license", "backup", "database", "server", "update", "application"]);
  });
  it("writes each line to its category, errors also to error.log, secrets redacted", () => {
    log("info", "scheduler", "tick ok");
    log("error", "backup", "backup failed password=abc123");
    log("warn", "auth", "login failed");
    const d = env().logsDir;
    const rd = (n: string) => fs.readFileSync(path.join(d, n), "utf8");
    expect(rd("application.log")).toContain("tick ok");
    expect(rd("backup.log")).toContain("backup failed");
    expect(rd("error.log")).toContain("backup failed");
    expect(rd("security.log")).toContain("login failed");
    expect(rd("error.log")).not.toContain("tick ok");
    expect(rd("error.log")).not.toContain("abc123");
  });
  it("rotates at 2 MB and keeps 5 files", () => {
    const d = env().logsDir;
    const f = path.join(d, "update.log");
    fs.writeFileSync(f, "x".repeat(2 * 1024 * 1024 + 10));
    log("info", "update", "after rotation");
    expect(fs.existsSync(f + ".1")).toBe(true);
    expect(fs.readFileSync(f, "utf8")).toContain("after rotation");
    expect(fs.statSync(f).size).toBeLessThan(1000);
  });
});

describe("failed logins are logged without leaking secrets, and the user gets Bangla messages", () => {
  let T = "";
  beforeAll(async () => {
    await freshApp("petra-log2-");
    ({ token: T } = await setupAndLogin());
  });
  it("logs security events and returns bn text", async () => {
    const bad = await api("POST", "/auth/login", { username: "admin", password: "WrongPassword9" });
    expect(bad.status).toBe(401);
    expect((bad.error!.details as { bn: string }).bn).toMatch(/ভুল/);
    await api("POST", "/auth/login", { username: "typed-my-password-Secret123", password: "x" });
    const sec = fs.readFileSync(path.join(env().logsDir, "security.log"), "utf8");
    expect(sec).toContain("login failed");
    expect(sec).not.toContain("WrongPassword9");
    expect(sec).not.toContain("Secret123");
  });
  it("support bundle is available to admins and contains no secrets", async () => {
    const r = await api("GET", "/system/diagnostics", undefined, T);
    expect(r.status).toBe(200);
    const text = Buffer.from(r.data as ArrayBuffer).toString("utf8");
    expect(text).toContain("PetraPMS support bundle");
    expect(text).toContain("security.log");
    expect(text).not.toMatch(/WrongPassword9|Admin1234|-----BEGIN/);
    expect((await api("GET", "/system/diagnostics")).status).toBe(401);
  });
  it("an unexpected error gives a reference and a Bangla message, never a stack trace", async () => {
    const { getDb } = await import("@/server/db");
    const db = await getDb();
    const orig = db.hotel.findUnique;
    (db.hotel as unknown as { findUnique: unknown }).findUnique = () => {
      throw new Error("kaboom internal detail with password=secret99");
    };
    try {
      const r = await api("GET", "/reports", undefined, T);
      const r2 = await api("GET", "/dashboard", undefined, T);
      const bad = [r, r2].find((x) => x.status === 500);
      expect(bad, JSON.stringify([r.status, r2.status])).toBeTruthy();
      if (bad) {
        expect(bad.error!.code).toBe("INTERNAL");
        expect(JSON.stringify(bad.error)).not.toMatch(/kaboom|secret99|\bat \w/);
        expect((bad.error!.details as { bn: string }).bn).toMatch(/রেফারেন্স/);
      }
    } finally {
      (db.hotel as unknown as { findUnique: unknown }).findUnique = orig;
    }
    const errLog = fs.existsSync(path.join(env().logsDir, "error.log")) ? fs.readFileSync(path.join(env().logsDir, "error.log"), "utf8") : "";
    expect(errLog).not.toContain("secret99");
  });
});

describe("database outages map to a friendly 503", () => {
  it("recognises pg / Prisma connection failures", async () => {
    const { mapSystemError } = await import("@/server/errors");
    for (const e of [new Error("Connection terminated unexpectedly"), Object.assign(new Error("x"), { code: "P1001" }), Object.assign(new Error("terminating connection due to administrator command"), { code: "57P01" }), new Error("Can't reach database server at `db:5432`")]) {
      const m = mapSystemError(e);
      expect(m?.status).toBe(503);
      expect(m?.code).toBe("DB_UNREACHABLE");
      expect((m?.details as { bn: string }).bn.length).toBeGreaterThan(10);
    }
    expect(mapSystemError(new Error("some bug"))).toBeNull();
  });
});
