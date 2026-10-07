import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPair, signLicense, type LicensePayload } from "@petra/core/license";
import { addDays } from "@petra/core";
import { api, freshApp, setupAndLogin } from "./helpers";
import { resetEnvCache } from "@/server/env";
import { invalidateLicenseCache } from "@/server/api";
import { processQueue, render } from "@/server/services/notifications";
import { getDb } from "@/server/db";

let T = "";
let BD = "";
const kp = generateKeyPair();

describe("POS integration API", () => {
  let key = "";
  let room = "";
  beforeAll(async () => {
    await freshApp();
    ({ token: T, businessDate: BD } = await setupAndLogin());
    const k = await api("POST", "/pos/keys", { name: "PetraPOS restaurant" }, T);
    key = k.data.key;
    const types = (await api("GET", "/room-types", undefined, T)).data;
    const r = await api("POST", "/reservations", { guest: { firstName: "Pos", lastName: "Guest", idType: "NID", idNumber: "5555" }, arrival: BD, departure: addDaysLocal(BD, 2), rooms: [{ roomTypeId: types[0].id, adults: 1 }] }, T);
    const d = (await api("GET", `/reservations/${r.data.id}`, undefined, T)).data;
    const ci = await api("POST", `/stays/${d.rooms[0].id}/check-in`, { version: d.rooms[0].version }, T);
    room = ci.data.roomNumber;
  });

  it("rejects missing or bad keys", async () => {
    expect((await api("GET", "/pos/v1/ping")).status).toBe(401);
    expect((await api("GET", "/pos/v1/ping", undefined, undefined, { "x-api-key": "ppk_wrong_key_xxxxxxxx" })).status).toBe(401);
    const ok = await api("GET", "/pos/v1/ping", undefined, undefined, { "x-api-key": key });
    expect(ok.data.hotel).toBe("Hotel Test Dhaka");
  });

  it("posts a check idempotently, verifies name, voids", async () => {
    const H = { "x-api-key": key };
    const rooms = await api("GET", "/pos/v1/rooms", undefined, undefined, H);
    expect(rooms.data.map((r: any) => r.roomNumber)).toContain(room);
    const bad = await api("POST", "/pos/v1/charges", { roomNumber: room, guestName: "Someone", checkNumber: "R-1", amount: 100000 }, undefined, H);
    expect(bad.error?.code).toBe("NAME_MISMATCH");
    const c1 = await api("POST", "/pos/v1/charges", { roomNumber: room, guestName: "guest", checkNumber: "R-1", amount: 100000, items: [{ name: "Kacchi biryani", quantity: 2, amount: 50000 }] }, undefined, H);
    expect(c1.ok, JSON.stringify(c1.error)).toBe(true);
    expect(c1.data.total).toBe(126500);
    const c2 = await api("POST", "/pos/v1/charges", { roomNumber: room, checkNumber: "R-1", amount: 100000 }, undefined, H);
    expect(c2.data.duplicate).toBe(true);
    expect(c2.data.chargeId).toBe(c1.data.chargeId);
    const inc = await api("POST", "/pos/v1/charges", { roomNumber: room, checkNumber: "R-2", amount: 126500, taxInclusive: true }, undefined, H);
    expect(inc.data.total).toBe(126500);
    expect(inc.data.net).toBe(100000);
    const nf = await api("POST", "/pos/v1/charges", { roomNumber: "999", checkNumber: "R-3", amount: 1000 }, undefined, H);
    expect(nf.error?.code).toBe("ROOM_NOT_IN_HOUSE");
    const v = await api("POST", "/pos/v1/charges/void", { checkNumber: "R-2", reason: "Wrong room" }, undefined, H);
    expect(v.ok).toBe(true);
    const log = await api("GET", "/pos/log", undefined, T);
    expect(log.data).toHaveLength(2);
    const spec = await api("GET", "/pos/v1/openapi.json");
    expect(spec.data.openapi).toBe("3.1.0");
  });

  it("revoked keys stop working", async () => {
    const keys = (await api("GET", "/pos/keys", undefined, T)).data;
    await api("DELETE", `/pos/keys/${keys[0].id}`, undefined, T);
    expect((await api("GET", "/pos/v1/ping", undefined, undefined, { "x-api-key": key })).status).toBe(401);
  });
});

function addDaysLocal(d: string, n: number) {
  const t = new Date(d + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

describe("licensing", () => {
  beforeAll(async () => {
    process.env.PETRA_LICENSE_PUBKEY = kp.publicKeyPem;
    await freshApp();
    resetEnvCache();
    ({ token: T, businessDate: BD } = await setupAndLogin());
  });
  afterAll(() => {
    delete process.env.PETRA_LICENSE_PUBKEY;
    resetEnvCache();
  });
  const base = (over: Partial<LicensePayload> = {}): LicensePayload => ({ v: 1, id: "LIC-T-1", customer: "Test Ltd", hotel: "Hotel Test", edition: "STANDARD", maxRooms: 20, maxTerminals: 2, modules: ["core", "housekeeping", "reports", "import", "maintenance", "cityledger", "multiwindow"], issuedAt: "2026-01-01", expiresAt: null, supportUntil: null, fingerprint: null, ...over });

  it("starts in trial and activates a valid key", async () => {
    const s = await api("GET", "/license", undefined, T);
    expect(s.data.state.mode).toBe("TRIAL");
    const forged = signLicense(base(), generateKeyPair().privateKeyPem);
    expect((await api("POST", "/license/activate", { key: forged }, T)).error?.code).toBe("LICENSE_INVALID");
    const wrongMachine = signLicense(base({ fingerprint: "AAAAA-BBBBB-CCCCC-DDDDD" }), kp.privateKeyPem);
    expect((await api("POST", "/license/activate", { key: wrongMachine }, T)).error?.code).toBe("LICENSE_FINGERPRINT");
    const tooSmall = signLicense(base({ maxRooms: 4 }), kp.privateKeyPem);
    expect((await api("POST", "/license/activate", { key: tooSmall }, T)).error?.code).toBe("LICENSE_ROOMS");
    const good = await api("POST", "/license/activate", { key: signLicense(base(), kp.privateKeyPem) }, T);
    expect(good.ok, JSON.stringify(good.error)).toBe(true);
    invalidateLicenseCache();
    const s2 = await api("GET", "/license", undefined, T);
    expect(s2.data.state.mode).toBe("ACTIVE");
    expect(s2.data.edition).toBe("STANDARD");
    // POS module not in STANDARD
    const k = await api("POST", "/pos/keys", { name: "x" }, T);
    expect(k.error?.code).toBe("MODULE_NOT_LICENSED");
  });

  it("goes read-only when expired but keeps data viewable", async () => {
    const r = await api("POST", "/license/activate", { key: signLicense(base({ expiresAt: addDays(BD, 1) }), kp.privateKeyPem) }, T);
    expect(r.ok).toBe(true);
    const db = await getDb();
    // simulate expiry: store an already-expired key directly (activation refuses expired keys)
    await db.license.update({ where: { id: "license" }, data: { key: signLicense(base({ expiresAt: "2026-01-02" }), kp.privateKeyPem) } });
    invalidateLicenseCache();
    const s = await api("GET", "/license", undefined, T);
    expect(s.data.state.readOnly).toBe(true);
    const write = await api("POST", "/guests", { firstName: "X" }, T);
    expect(write.status).toBe(423);
    const read = await api("GET", "/reservations", undefined, T);
    expect(read.ok).toBe(true);
    const exp = await api("GET", "/data/export/guests", undefined, T);
    expect(exp.status).toBe(200);
    // login still works in read-only mode
    expect((await api("POST", "/auth/login", { username: "admin", password: "Admin1234" })).ok).toBe(true);
  });

  it("enforces the licensed terminal limit", async () => {
    const db = await getDb();
    await db.license.update({ where: { id: "license" }, data: { key: signLicense(base({ maxTerminals: 2 }), kp.privateKeyPem) } });
    await db.userWindowSession.deleteMany({});
    invalidateLicenseCache();
    const login = (t: string) => api("POST", "/auth/login", { username: "admin", password: "Admin1234", terminalId: t, windowId: t });
    expect((await login("T-A")).ok).toBe(true);
    const b = await login("T-B");
    const c = await login("T-C");
    expect(b.ok).toBe(true);
    expect(c.error?.code).toBe("TERMINAL_LIMIT");
    // another window on an already-counted terminal is fine (multi-monitor)
    expect((await api("POST", "/auth/login", { username: "admin", password: "Admin1234", terminalId: "T-A", windowId: "T-A-2" })).ok).toBe(true);
  });
});

describe("notifications", () => {
  it("renders templates and delivers through the generic HTTP gateway with retries", async () => {
    expect(render("Hi {{name}}", { name: "রহিম" })).toBe("Hi রহিম");
    expect(render('{"m":"{{message}}"}', { message: 'say "hi"' }, true)).toBe('{"m":"say \\"hi\\""}');
    await freshApp();
    const { token } = await setupAndLogin();
    await api("PUT", "/settings/notifications", { smsEnabled: true, sms: { url: "https://sms.example.com/send", method: "POST", bodyTemplate: '{"to":"{{to}}","text":"{{message}}"}', headers: '{"Content-Type":"application/json"}', senderId: "HOTEL" } }, token);
    const db = await getDb();
    await db.notification.create({ data: { channel: "SMS", to: "+8801711000000", body: "hello", templateCode: "TEST" } });
    const calls: { url: string; body: string }[] = [];
    let fail = true;
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: String(init.body) });
      return new Response("", { status: fail ? 500 : 200 });
    }) as unknown as typeof fetch;
    const r1 = await processQueue(db, 10, fake);
    expect(r1.sent).toBe(0);
    let n = await db.notification.findFirst();
    expect(n!.status).toBe("QUEUED");
    expect(n!.attempts).toBe(1);
    fail = false;
    await db.notification.update({ where: { id: n!.id }, data: { sendAfter: new Date(0) } });
    const r2 = await processQueue(db, 10, fake);
    expect(r2.sent).toBe(1);
    expect(JSON.parse(calls[1].body)).toEqual({ to: "+8801711000000", text: "hello" });
    n = await db.notification.findFirst();
    expect(n!.status).toBe("SENT");
  });
});
