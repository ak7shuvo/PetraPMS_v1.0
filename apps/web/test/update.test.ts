import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { api, freshApp, setupAndLogin } from "./helpers";

const desktop = path.resolve(__dirname, "../../desktop");
const read = (f: string) => fs.readFileSync(path.join(desktop, f), "utf8");

describe("update flow (server side)", () => {
  let token = "";
  beforeAll(async () => {
    await freshApp("petra-upd-");
    token = (await setupAndLogin()).token;
  });

  it("requires authentication", async () => {
    const r = await api("POST", "/system/update/prepare", {});
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
  });

  it("takes a verified PRE_UPDATE backup before an update", async () => {
    const r = await api<{ backupId: string; fileName: string; sizeBytes: number }>("POST", "/system/update/prepare", {}, token);
    expect(r.ok).toBe(true);
    expect(r.data.fileName).toMatch(/pre-update/);
    expect(r.data.sizeBytes).toBeGreaterThan(1000);
    const list = await api<{ rows: { kind: string; status: string; exists: boolean }[] }>("GET", "/backups", undefined, token);
    expect(list.data.rows.some((b) => b.kind === "PRE_UPDATE" && b.status === "OK" && b.exists)).toBe(true);
  });

  it("refuses a user without backup permission", async () => {
    const roles = await api<{ roles: { id: string; code: string }[] }>("GET", "/roles", undefined, token);
    const hk = roles.data.roles.find((r) => r.code === "HOUSEKEEPER")!;
    const u = await api<{ temporaryPassword: string }>("POST", "/users", { username: "hk1", fullName: "House Keeper", roleId: hk.id }, token);
    expect(u.ok).toBe(true);
    const l = await api<{ token: string }>("POST", "/auth/login", { username: "hk1", password: u.data.temporaryPassword, windowId: "w2", terminalId: "t1" });
    expect(l.ok).toBe(true);
    const r = await api("POST", "/system/update/prepare", {}, l.data.token);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(403);
  });
});

describe("desktop updater safety (static)", () => {
  const main = read("src/main.cjs");
  it("never installs silently on quit and never downgrades", () => {
    expect(main).toMatch(/autoInstallOnAppQuit = false/);
    expect(main).toMatch(/allowDowngrade = false/);
    expect(main).toMatch(/allowPrerelease = false/);
  });
  it("installs only a downloaded update and only through the trusted IPC channel", () => {
    expect(main).toMatch(/handle\("petra:installUpdate"/);
    expect(main).toMatch(/state !== "downloaded"/);
  });
  it("explains recovery when the first start after an update fails", () => {
    expect(main).toMatch(/right after an update/);
  });
  it("accepts only an https update feed (or a local http test feed)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "petra-cfg-"));
    process.env.PETRA_DATA_DIR = dir;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const config = require(path.join(desktop, "src/config.cjs"));
    const load = (u: string) => {
      fs.writeFileSync(config.file(), JSON.stringify({ updateUrl: u }));
      return config.load().updateUrl;
    };
    expect(load("https://downloads.acme-hotels.net/petrapms")).toBe("https://downloads.acme-hotels.net/petrapms");
    expect(load("http://127.0.0.1:8080/feed")).toBe("http://127.0.0.1:8080/feed");
    expect(load("http://evil.acme-hotels.net/feed")).toBe("");
    expect(load("file:///c:/x")).toBe("");
    expect(load("ftp://x/y")).toBe("");
  });
});
