import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { addDays, calendarToday } from "@petra/core";
import { generateKeyPair, makeActivationRequest, parseActivationRequest, signLicense, signStatusList, REF_PATTERN, type LicensePayload } from "@petra/core/license";
// @ts-expect-error plain ESM vendor tool
import { createManager } from "../../../tools/license-keygen/keygen.mjs";
import { api, freshApp, setupAndLogin } from "./helpers";
import { invalidateLicenseCache } from "@/server/api";
import { resetEnvCache, env } from "@/server/env";
import { getDb } from "@/server/db";

const fp = (n: string) => `${n}-AAAAA-BBBBB-CCCCC`.slice(0, 23);
const req = (f: string, hotel = "Hotel Test") => makeActivationRequest({ fingerprint: f, hotel, appVersion: "1.0.0", rooms: 8, licenseId: null, at: "2026-10-04" });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "petra-lm-"));

describe("License Manager (vendor side)", () => {
  it("pools AVAILABLE references, issues, activates, enforces installation limit, transfers", () => {
    const m = createManager(tmp());
    m.init();
    const refs = m.pool(5);
    expect(refs).toHaveLength(5);
    expect(refs.every((r: string) => REF_PATTERN.test(r))).toBe(true);
    expect(new Set(refs).size).toBe(5);
    expect(m.list("AVAILABLE")).toHaveLength(5);

    const r = m.issue({ ref: refs[0], customer: "Sea Pearl Ltd", hotel: "Hotel Sea Pearl", rooms: 60, terminals: 6, request: req(fp("PC1")), expires: "2030-01-01", grace: 14 });
    expect(r.payload.v).toBe(2);
    expect(r.payload.ref).toBe(refs[0]);
    expect(r.payload.product).toBe("PetraPMS");
    expect(r.payload.hotelId).toMatch(/^HTL-/);
    expect(r.state).toBe("ACTIVATED");
    expect(JSON.stringify(r.payload)).not.toMatch(/PRIVATE|secret/i);
    expect(m.verify(r.key).fingerprint).toBe(fp("PC1"));
    expect(() => m.issue({ ref: refs[0], customer: "x", hotel: "y", rooms: 1 })).toThrow(/already issued/);

    // second computer: refused (installation limit 1), then transfer
    expect(() => m.activate(req(fp("PC2")), refs[0])).toThrow(/bound to another computer|limit/);
    const code = Buffer.from(JSON.stringify({ licenseId: r.payload.id, oldFp: fp("PC1"), newFp: fp("PC2"), at: "2026-10-04" })).toString("base64url");
    const t = m.transfer(code, r.key);
    expect(t.payload.fingerprint).toBe(fp("PC2"));
    const l = m.lookup(refs[0]);
    expect(l.installations.map((i: { state: string }) => i.state)).toEqual(["TRANSFERRED", "ACTIVE"]);
    expect(l.history.map((h: { action: string }) => h.action)).toContain("transferred");
  });

  it("derives EXPIRED, supports suspend / reinstate / revoke and publishes a signed status list", () => {
    const m = createManager(tmp());
    m.init();
    const a = m.issue({ customer: "A", hotel: "A", rooms: 10, expires: "2020-01-01" });
    expect(m.list("EXPIRED")).toHaveLength(1);
    const b = m.issue({ customer: "B", hotel: "B", rooms: 10 });
    m.setState(b.payload.id, "SUSPENDED", "unpaid invoice");
    let s = m.publishStatus();
    expect(s.entries).toBe(1);
    m.setState(b.payload.id, "REINSTATE", "paid");
    const s2 = m.publishStatus();
    expect(s2.seq).toBeGreaterThan(s.seq);
    expect(s2.entries).toBe(0);
    m.setState(a.payload.id, "REVOKED", "fraud");
    expect(() => m.setState(a.payload.id, "REINSTATE", "")).toThrow(/permanent/);
    expect(() => m.renew(a.payload.id, { expires: "2031-01-01" })).toThrow(/revoked/);
    expect(m.list("REVOKED")).toHaveLength(1);
    s = m.publishStatus();
    expect(s.entries).toBe(1);
  });

  it("can protect the private key with a passphrase", () => {
    process.env.PETRA_KEY_PASSPHRASE = "correct horse battery staple";
    const d = tmp();
    const m = createManager(d);
    m.init({ encrypt: true });
    expect(fs.readFileSync(path.join(d, "private.pem"), "utf8")).toContain("ENCRYPTED");
    expect(m.issue({ customer: "A", hotel: "A", rooms: 5 }).key).toMatch(/^PETRA1\./);
    delete process.env.PETRA_KEY_PASSPHRASE;
    expect(() => createManager(d).issue({ customer: "A", hotel: "A", rooms: 5 })).toThrow(/PASSPHRASE/);
  });

  it("renews with the same id and computer", () => {
    const m = createManager(tmp());
    m.init();
    const r = m.issue({ customer: "A", hotel: "A", rooms: 10, expires: "2027-01-01", request: req(fp("X")) });
    const n = m.renew(r.payload.id, { expires: "2028-01-01", rooms: 20 });
    expect(n.payload.expiresAt).toBe("2028-01-01");
    expect(n.payload.id).toBe(r.payload.id);
    expect(n.payload.fingerprint).toBe(fp("X"));
  });
});

describe("App side of the lifecycle", () => {
  const kp = generateKeyPair();
  const other = generateKeyPair();
  let T = "";
  let BD = "";
  const machine = "test-machine";
  const base = (over: Partial<LicensePayload> = {}): LicensePayload => ({ v: 2, product: "PetraPMS", id: "LIC-L-1", ref: "PETRA-ABCD-EFGH-JKLM-NPQR", hotelId: "HTL-AAAA11", customer: "T", hotel: "Hotel Test", edition: "PREMIUM", plan: "ANNUAL", maxRooms: 50, maxTerminals: 5, maxInstallations: 1, modules: ["core", "housekeeping", "reports", "import", "maintenance", "cityledger", "multiwindow", "pos", "notifications"], issuedAt: "2026-01-01", expiresAt: null, supportUntil: null, fingerprint: null, graceDays: 0, statusMaxAgeDays: null, ...over });
  const activate = (p: Partial<LicensePayload>) => api("POST", "/license/activate", { key: signLicense(base(p), kp.privateKeyPem) }, T);
  const lic = async () => {
    invalidateLicenseCache();
    return (await api("GET", "/license", undefined, T)).data;
  };
  const list = (seq: number, entries: { id: string; status: "SUSPENDED" | "REVOKED" }[], key = kp.privateKeyPem, issuedAt = calendarToday()) =>
    signStatusList({ v: 1, seq, issuedAt, entries: entries.map((e) => ({ ...e, reason: "test", at: issuedAt })) }, key);

  beforeAll(async () => {
    process.env.PETRA_LICENSE_PUBKEY = kp.publicKeyPem;
    await freshApp("petra-lic2-");
    resetEnvCache();
    ({ token: T, businessDate: BD } = await setupAndLogin());
  });
  afterAll(() => {
    delete process.env.PETRA_LICENSE_PUBKEY;
    resetEnvCache();
  });

  it("gives an activation request containing the installation identity and no secrets", async () => {
    const r = await api("GET", "/license/request-code", undefined, T);
    const parsed = parseActivationRequest(r.data.code);
    expect(parsed.fingerprint).toBe(machine);
    expect(parsed.rooms).toBe(8);
    expect(JSON.stringify(parsed)).not.toMatch(/password|secret|key/i);
  });

  it("rejects wrong product and activates a v2 license; hotel identity cannot be swapped", async () => {
    const wrong = await api("POST", "/license/activate", { key: signLicense({ ...base(), product: "OtherPOS" as never }, kp.privateKeyPem) }, T);
    expect(wrong.error?.code).toBe("LICENSE_INVALID");
    const ok = await activate({});
    expect(ok.ok, JSON.stringify(ok.error)).toBe(true);
    const s = await lic();
    expect(s.state.mode).toBe("ACTIVE");
    expect(s.hotelId).toBe("HTL-AAAA11");
    expect(s.ref).toBe("PETRA-ABCD-EFGH-JKLM-NPQR");
    const other = await activate({ hotelId: "HTL-ZZZZ99", id: "LIC-L-2" });
    expect(other.error?.code).toBe("LICENSE_HOTEL_MISMATCH");
  });

  it("suspend → read-only; reinstate → active; revoke → read-only; stale/forged/older lists are refused", async () => {
    expect((await api("POST", "/license/status", { doc: list(1, [{ id: "LIC-L-1", status: "SUSPENDED" }]) }, T)).ok).toBe(true);
    let s = await lic();
    expect(s.state.readOnly).toBe(true);
    expect(s.state.reason).toBe("SUSPENDED");
    expect((await api("POST", "/guests", { firstName: "X" }, T)).status).toBe(423);
    expect((await api("GET", "/reservations", undefined, T)).ok).toBe(true); // data stays viewable

    expect((await api("POST", "/license/status", { doc: list(0, []) }, T)).error?.code).toBe("STATUS_OLDER"); // replay of an older all-clear
    expect((await api("POST", "/license/status", { doc: list(5, [], other.privateKeyPem) }, T)).error?.code).toBe("STATUS_INVALID"); // signed by another key
    const tampered = list(6, []).replace(/\.[^.]+$/, ".AAAA");
    expect((await api("POST", "/license/status", { doc: tampered }, T)).error?.code).toBe("STATUS_INVALID");
    s = await lic();
    expect(s.state.reason).toBe("SUSPENDED");

    expect((await api("POST", "/license/status", { doc: list(2, []) }, T)).ok).toBe(true);
    s = await lic();
    expect(s.state.mode).toBe("ACTIVE");

    expect((await api("POST", "/license/status", { doc: list(3, [{ id: "LIC-L-1", status: "REVOKED" }]) }, T)).ok).toBe(true);
    s = await lic();
    expect(s.state.reason).toBe("REVOKED");
    expect((await activate({})).error?.code).toBe("LICENSE_REVOKED");
    // clear for the next tests
    await api("POST", "/license/status", { doc: list(4, []) }, T);
  });

  it("offline grace after expiry, then read-only", async () => {
    const db = await getDb();
    const set = async (p: Partial<LicensePayload>) => {
      await db.license.update({ where: { id: "license" }, data: { key: signLicense(base(p), kp.privateKeyPem) } });
      return lic();
    };
    let s = await set({ expiresAt: addDays(BD, -3), graceDays: 7 });
    expect(s.state.mode).toBe("ACTIVE");
    expect(s.state.inGrace).toBe(true);
    expect(s.state.warnings[0]).toMatch(/Grace period/);
    s = await set({ expiresAt: addDays(BD, -8), graceDays: 7 });
    expect(s.state.reason).toBe("EXPIRED");
    s = await set({ expiresAt: addDays(BD, -1), graceDays: 0 });
    expect(s.state.reason).toBe("EXPIRED");
    await set({});
  });

  it("requires a fresh signed status list when the license says so", async () => {
    const db = await getDb();
    await db.license.update({ where: { id: "license" }, data: { key: signLicense(base({ statusMaxAgeDays: 30, graceDays: 10 }), kp.privateKeyPem), activatedAt: new Date(Date.now() - 35 * 86400_000) } });
    const { patchSection } = await import("@/server/settings");
    await patchSection(db, "license", { statusAt: "" });
    let s = await lic();
    expect(s.state.mode).toBe("ACTIVE");
    expect(s.state.warnings.join(" ")).toMatch(/refresh/);
    await db.license.update({ where: { id: "license" }, data: { activatedAt: new Date(Date.now() - 80 * 86400_000) } });
    s = await lic();
    expect(s.state.reason).toBe("STATUS_STALE");
    // importing a fresh list fixes it
    const seq = (await getDb().then((d) => import("@/server/settings").then((m) => m.getSection(d, "license")))).statusSeq + 1;
    expect((await api("POST", "/license/status", { doc: list(seq, []) }, T)).ok).toBe(true);
    s = await lic();
    expect(s.state.mode).toBe("ACTIVE");
    await db.license.update({ where: { id: "license" }, data: { key: signLicense(base(), kp.privateKeyPem) } });
  });

  it("clock rollback cannot be undone by restoring an old database", async () => {
    const db = await getDb();
    const future = addDays(calendarToday(), 10);
    fs.writeFileSync(path.join(env().dataDir, ".license-hwm"), future);
    const { patchSection } = await import("@/server/settings");
    await patchSection(db, "license", { lastSeenDate: "2026-01-01" }); // what an old backup would contain
    const s = await lic();
    expect(s.state.reason).toBe("CLOCK");
    fs.writeFileSync(path.join(env().dataDir, ".license-hwm"), calendarToday());
    await patchSection(db, "license", { lastSeenDate: calendarToday() });
  });
});
