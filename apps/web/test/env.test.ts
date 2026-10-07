import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { env, resetEnvCache, ConfigError } from "@/server/env";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
  resetEnvCache();
});
function fresh(over: Record<string, string | undefined>) {
  process.env.PETRA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "petra-env-"));
  for (const [k, v] of Object.entries(over)) (v === undefined ? delete process.env[k] : (process.env[k] = v));
  resetEnvCache();
  return env();
}

describe("environment validation", () => {
  it("reports the real package version when the shell passes none (never a stale literal)", () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf8")) as { version: string };
    expect(fresh({ PETRA_APP_VERSION: undefined }).appVersion).toBe(pkg.version);
    expect(fresh({ PETRA_APP_VERSION: "7.8.9" }).appVersion).toBe("7.8.9");
  });
  it("defaults to standalone SQLite", () => {
    const e = fresh({ DATABASE_PROVIDER: undefined, PETRA_MODE: undefined, PORT: undefined });
    expect([e.provider, e.mode, e.port]).toEqual(["sqlite", "standalone", 3000]);
  });
  it("rejects bad values with a clear message", () => {
    expect(() => fresh({ PORT: "99999" })).toThrow(ConfigError);
    expect(() => fresh({ PORT: "80", PETRA_MODE: "lan" })).toThrow(/PETRA_MODE/);
    expect(() => fresh({ PETRA_MODE: undefined, DATABASE_PROVIDER: "mysql" })).toThrow(/DATABASE_PROVIDER/);
    expect(() => fresh({ DATABASE_PROVIDER: "postgres", DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
  });
  it("reads the database URL from a secret file", () => {
    const f = path.join(os.tmpdir(), `dburl-${Date.now()}`);
    fs.writeFileSync(f, "postgresql://u:p@db:5432/x\n");
    const e = fresh({ DATABASE_PROVIDER: "postgres", DATABASE_URL: undefined, DATABASE_URL_FILE: f });
    expect(e.databaseUrl).toBe("postgresql://u:p@db:5432/x");
  });
  it("ignores the licence-key override in production", async () => {
    const { LICENSE_PUBLIC_KEY } = await import("@/server/license-public-key");
    (process.env as Record<string, string>).NODE_ENV = "production";
    const e = fresh({ PETRA_LICENSE_PUBKEY: "-----BEGIN PUBLIC KEY-----\\nEVIL\\n-----END PUBLIC KEY-----" });
    expect(e.licensePublicKey).toBe(LICENSE_PUBLIC_KEY.replace(/\\n/g, "\n"));
  });
});
