import { describe, it, expect, beforeAll } from "vitest";
import { addDays } from "@petra/core";
import { api, freshApp, setupAndLogin } from "./helpers";

let T = "";
let BD = "";
let types: { id: string; code: string }[] = [];
let rooms: { id: string; number: string; roomTypeId: string }[] = [];

describe("API: setup → booking → stay → billing", () => {
  beforeAll(async () => {
    await freshApp();
    const st = await api("GET", "/status");
    expect(st.ok).toBe(true);
    expect(st.data.setupComplete).toBe(false);
    // protected routes are gated before setup
    const pre = await api("GET", "/rooms");
    expect(pre.status).toBe(401);
    ({ token: T, businessDate: BD } = await setupAndLogin());
    types = (await api("GET", "/room-types", undefined, T)).data;
    rooms = (await api("GET", "/rooms", undefined, T)).data;
  });

  it("generated the hotel from the quick setup", async () => {
    expect(types.map((t) => t.code).sort()).toEqual(["DLX", "STD"]);
    expect(rooms).toHaveLength(8);
    const dlx = types.find((t) => t.code === "DLX")!;
    expect(rooms.filter((r) => r.roomTypeId === dlx.id).map((r) => r.number)).toEqual(["201", "202", "203", "204"]);
    const again = await api("POST", "/setup", {});
    expect(again.ok).toBe(false);
  });

  it("rejects bad credentials and requires a token", async () => {
    expect((await api("POST", "/auth/login", { username: "admin", password: "nope" })).status).toBe(401);
    expect((await api("GET", "/reservations")).status).toBe(401);
    const me = await api("GET", "/auth/me", undefined, T);
    expect(me.data.user.username).toBe("admin");
  });

  it("quotes with taxes excluded and refuses overbooking", async () => {
    const std = types.find((t) => t.code === "STD")!;
    const q = await api("POST", "/rates/quote", { roomTypeId: std.id, arrival: BD, departure: addDays(BD, 2), adults: 2 }, T);
    expect(q.ok).toBe(true);
    expect(q.data.nightCount).toBe(2);
    const guest = { firstName: "Rahim", lastName: "Uddin", phone: "01711223344", idType: "NID", idNumber: "1234567890" };
    // 4 STD rooms: book 4 then the 5th must fail
    const mk = (n: number) => api("POST", "/reservations", { guest, arrival: addDays(BD, 10), departure: addDays(BD, 12), rooms: Array.from({ length: n }, () => ({ roomTypeId: std.id, adults: 2 })) }, T);
    const four = await mk(4);
    expect(four.ok).toBe(true);
    const fifth = await mk(1);
    expect(fifth.status).toBe(409);
    expect(fifth.error!.code).toBe("NO_AVAILABILITY");
    // concurrent attempts: only the available count succeeds
    const dlx = types.find((t) => t.code === "DLX")!;
    const tries = await Promise.all(Array.from({ length: 7 }, () => api("POST", "/reservations", { guest, arrival: addDays(BD, 20), departure: addDays(BD, 21), rooms: [{ roomTypeId: dlx.id, adults: 2 }] }, T)));
    expect(tries.filter((t) => t.ok)).toHaveLength(4);
    expect(tries.filter((t) => t.status === "409" as unknown as number || t.status === 409)).toHaveLength(3);
  });

  it("checks in, bills, settles and checks out a guest", async () => {
    const std = types.find((t) => t.code === "STD")!;
    const r = await api("POST", "/reservations", { guest: { firstName: "Karim", lastName: "Hossain", phone: "+8801812345678", idType: "NID", idNumber: "9988776655" }, arrival: BD, departure: addDays(BD, 1), rooms: [{ roomTypeId: std.id, adults: 2 }], deposit: { method: "BKASH", amount: 100000, reference: "TRX1" } }, T);
    expect(r.ok).toBe(true);
    const res = (await api("GET", `/reservations/${r.data.id}`, undefined, T)).data;
    expect(res.deposits).toBe(100000);
    const stay = res.rooms[0];
    const ready = await api("GET", `/stays/${stay.id}/checkin-readiness`, undefined, T);
    expect(ready.data.ready).toBe(true);
    const ci = await api("POST", `/stays/${stay.id}/check-in`, { version: stay.version }, T);
    expect(ci.ok).toBe(true);
    const folioId = ci.data.folioId;
    // the room is now occupied on the rack
    const rack = await api("GET", "/rack", undefined, T);
    expect(rack.data.rooms.find((x: any) => x.number === ci.data.roomNumber).status).toBe("OCCUPIED");
    // post a restaurant charge: 1000 tk + SC 10% + VAT 15% on (net+SC) = 1265
    const ch = await api("POST", `/folios/${folioId}/charges`, { chargeCode: "REST", amount: 100000 }, T);
    expect(ch.ok).toBe(true);
    expect(ch.data.total).toBe(126500);
    // a negative adjustment needs a reason
    const adj = await api("POST", `/folios/${folioId}/charges`, { chargeCode: "ADJ", amount: -5000 }, T);
    expect(adj.status).toBe(400);
    let f = (await api("GET", `/folios/${folioId}`, undefined, T)).data;
    expect(f.balance.balance).toBe(126500 - 100000);
    // card payment needs a reference
    expect((await api("POST", `/folios/${folioId}/payments`, { method: "CARD", amount: 26500 }, T)).status).toBe(400);
    // early departure must be confirmed
    const early = await api("POST", `/stays/${stay.id}/check-out`, { version: ci.data.stay.version }, T);
    expect(early.error?.code).toBe("EARLY_DEPARTURE");
    const owe = await api("POST", `/stays/${stay.id}/check-out`, { version: ci.data.stay.version, early: true }, T);
    expect(owe.error?.code).toBe("BALANCE_DUE");
    const co = await api("POST", `/stays/${stay.id}/check-out`, { version: ci.data.stay.version, early: true, payment: { method: "CASH", amount: 26500 } }, T);
    expect(co.ok).toBe(true);
    f = (await api("GET", `/folios/${folioId}`, undefined, T)).data;
    expect(f.balance.balance).toBe(0);
    expect(f.status).toBe("SETTLED");
    const inv = await api("POST", `/folios/${folioId}/invoices`, {}, T);
    expect(inv.ok).toBe(true);
    expect(inv.data.number).toMatch(/^INV-\d{4}-00001$/);
    const doc = (await api("GET", `/invoices/${inv.data.id}`, undefined, T)).data;
    expect(doc.totals.total).toBe(126500);
    expect(doc.qrText).toContain("BIN:000123456789");
    // housekeeping task created and room dirty
    const room = (await api("GET", "/rooms", undefined, T)).data.find((x: any) => x.number === ci.data.roomNumber);
    expect(room.hkStatus).toBe("DIRTY");
  });

  it("detects concurrent edits with optimistic locking", async () => {
    const std = types.find((t) => t.code === "STD")!;
    const r = await api("POST", "/reservations", { guest: { firstName: "Lock", lastName: "Test" }, arrival: addDays(BD, 30), departure: addDays(BD, 32), rooms: [{ roomTypeId: std.id, adults: 1 }] }, T);
    const res = (await api("GET", `/reservations/${r.data.id}`, undefined, T)).data;
    const s = res.rooms[0];
    const a = await api("PATCH", `/stays/${s.id}`, { version: s.version, departure: addDays(BD, 33) }, T);
    expect(a.ok).toBe(true);
    const b = await api("PATCH", `/stays/${s.id}`, { version: s.version, departure: addDays(BD, 34) }, T);
    expect(b.status).toBe(409);
    expect(b.error!.code).toBe("VERSION_CONFLICT");
    // cancellation with flexible policy (no rate plan → free)
    const fresh = (await api("GET", `/reservations/${r.data.id}`, undefined, T)).data;
    const c = await api("POST", `/reservations/${r.data.id}/cancel`, { version: fresh.version, reason: "Guest request" }, T);
    expect(c.ok).toBe(true);
    expect(c.data.fee).toBe(0);
    const after = (await api("GET", `/reservations/${r.data.id}`, undefined, T)).data;
    expect(after.status).toBe("CANCELLED");
  });

  it("blocks a blacklisted guest", async () => {
    const g = await api("POST", "/guests", { firstName: "Bad", lastName: "Actor", phone: "01911000000" }, T);
    expect(g.ok).toBe(true);
    await api("POST", `/guests/${g.data.id}/blacklist`, { blacklisted: true, reason: "Unpaid bill" }, T);
    const std = types.find((t) => t.code === "STD")!;
    const r = await api("POST", "/reservations", { guestId: g.data.id, arrival: addDays(BD, 40), departure: addDays(BD, 41), rooms: [{ roomTypeId: std.id, adults: 1 }] }, T);
    expect(r.error?.code).toBe("GUEST_BLACKLISTED");
    const dup = await api("GET", "/guests/duplicates?phone=01911000000", undefined, T);
    expect(dup.data).toHaveLength(1);
  });
});

describe("demo data", () => {
  it("loads and clears demo data without touching real records", async () => {
    await freshApp();
    const { token } = await setupAndLogin({ loadDemo: true });
    const res = await api("GET", "/reservations?take=200", undefined, token);
    expect(res.data.total).toBeGreaterThan(5);
    const lists = await api("GET", "/frontdesk/lists", undefined, token);
    expect(lists.data.inHouse.length).toBeGreaterThan(0);
    const real = await api("POST", "/guests", { firstName: "Real", lastName: "Guest" }, token);
    expect(real.ok).toBe(true);
    const { clearDemoData } = await import("@/server/services/demo");
    const { getDb } = await import("@/server/db");
    await clearDemoData(await getDb(), { username: "admin" });
    const after = await api("GET", "/reservations?take=200", undefined, token);
    expect(after.data.total).toBe(0);
    const guests = await api("GET", "/guests", undefined, token);
    expect(guests.data.rows.map((g: any) => g.fullName)).toEqual(["Real Guest"]);
    const rooms = await api("GET", "/rooms", undefined, token);
    expect(rooms.data).toHaveLength(8);
  });
});
