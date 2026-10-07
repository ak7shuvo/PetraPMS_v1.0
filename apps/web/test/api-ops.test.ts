import { describe, it, expect, beforeAll } from "vitest";
import { addDays } from "@petra/core";
import { api, freshApp, setupAndLogin } from "./helpers";

let T = "";
let BD = "";

describe("night audit, reports, documents, backups", () => {
  beforeAll(async () => {
    await freshApp();
    ({ token: T, businessDate: BD } = await setupAndLogin());
  });

  it("runs the night audit: posts room charges once, marks no-shows, advances the date, rolls back", async () => {
    const types = (await api("GET", "/room-types", undefined, T)).data;
    const std = types.find((t: any) => t.code === "STD");
    const guest = { firstName: "Audit", lastName: "Guest", idType: "NID", idNumber: "11223344" };
    const a = await api("POST", "/reservations", { guest, arrival: BD, departure: addDays(BD, 3), rooms: [{ roomTypeId: std.id, adults: 2 }] }, T);
    const b = await api("POST", "/reservations", { guest: { ...guest, firstName: "NoShow" }, arrival: BD, departure: addDays(BD, 2), rooms: [{ roomTypeId: std.id, adults: 1 }] }, T);
    const ra = (await api("GET", `/reservations/${a.data.id}`, undefined, T)).data;
    const ci = await api("POST", `/stays/${ra.rooms[0].id}/check-in`, { version: ra.rooms[0].version }, T);
    expect(ci.ok).toBe(true);
    const prev = await api("GET", "/night-audit/preview", undefined, T);
    expect(prev.data.roomCharges).toBe(1);
    expect(prev.data.pendingArrivals).toHaveLength(1);
    const run = await api("POST", "/night-audit/run", { businessDate: BD }, T);
    expect(run.ok).toBe(true);
    expect(run.data.nextBusinessDate).toBe(addDays(BD, 1));
    expect(run.data.roomCharges).toBe(1);
    expect(run.data.noShows).toBe(1);
    const again = await api("POST", "/night-audit/run", { businessDate: BD }, T);
    expect(again.ok).toBe(false);
    const f = (await api("GET", `/folios/${ci.data.folioId}`, undefined, T)).data;
    expect(f.charges.filter((c: any) => c.category === "ROOM")).toHaveLength(1);
    expect(f.charges[0].total).toBe(400000 + 40000 + 66000); // 4000 + SC 10% + VAT 15% on 4400
    const nb = (await api("GET", `/reservations/${b.data.id}`, undefined, T)).data;
    expect(nb.status).toBe("NO_SHOW");
    // rollback restores the date and removes audit postings
    const rb = await api("POST", "/night-audit/rollback", { reason: "Testing rollback" }, T);
    expect(rb.ok).toBe(true);
    expect(rb.data.businessDate).toBe(BD);
    const f2 = (await api("GET", `/folios/${ci.data.folioId}`, undefined, T)).data;
    expect(f2.charges).toHaveLength(0);
    expect((await api("GET", `/reservations/${b.data.id}`, undefined, T)).data.status).toBe("CONFIRMED");
    // run again for real
    expect((await api("POST", "/night-audit/run", { businessDate: BD }, T)).ok).toBe(true);
    BD = addDays(BD, 1);
  });

  it("produces reports as JSON, CSV, XLSX and PDF", async () => {
    const list = await api("GET", "/reports", undefined, T);
    expect(list.data.length).toBeGreaterThan(10);
    const occ = await api("GET", `/reports/occupancy?from=${addDays(BD, -1)}&to=${addDays(BD, 1)}`, undefined, T);
    expect(occ.ok).toBe(true);
    expect(occ.data.rows).toHaveLength(3);
    expect(occ.data.rows[0].sold).toBe(1);
    const csv = await api("GET", `/reports/revenue-category/export?format=csv&from=${addDays(BD, -1)}&to=${BD}`, undefined, T);
    const text = Buffer.from(csv.data).toString("utf8");
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain("ROOM");
    const x = await api("GET", `/reports/manager/export?format=xlsx&to=${addDays(BD, -1)}`, undefined, T);
    expect(x.status, JSON.stringify(x.error)).toBe(200);
    expect(Buffer.from(x.data).subarray(0, 2).toString()).toBe("PK");
    const p = await api("GET", `/reports/manager/export?format=pdf&to=${addDays(BD, -1)}`, undefined, T);
    expect(Buffer.from(p.data).subarray(0, 5).toString()).toBe("%PDF-");
  }, 60_000);

  it("prints invoice (A4 + thermal), registration card, confirmation and receipt", async () => {
    const res = (await api("GET", "/reservations?status=CHECKED_IN", undefined, T)).data.rows[0];
    const detail = (await api("GET", `/reservations/${res.id}`, undefined, T)).data;
    const folioId = detail.folios[0].id;
    const pay = await api("POST", `/folios/${folioId}/payments`, { method: "BKASH", amount: 10000, reference: "TRX99" }, T);
    expect(pay.ok).toBe(true);
    const inv = await api("POST", `/folios/${folioId}/invoices`, { billToName: "অতিথি নাম Guest" }, T);
    expect(inv.ok).toBe(true);
    for (const url of [`/invoices/${inv.data.id}/pdf`, `/invoices/${inv.data.id}/pdf?format=80mm`, `/folios/${folioId}/proforma/pdf`, `/stays/${detail.rooms[0].id}/registration-card/pdf`, `/reservations/${res.id}/confirmation/pdf`, `/payments/${pay.data.id}/receipt/pdf?lang=bn`]) {
      const r = await api("GET", url, undefined, T);
      expect(r.status, url).toBe(200);
      expect(Buffer.from(r.data).subarray(0, 5).toString(), url).toBe("%PDF-");
    }
  }, 60_000);

  it("creates, inspects and restores an encrypted backup", async () => {
    const s = await api("PUT", "/settings/backup", { enabled: true, time: "03:00", folder: "", retentionDays: 30, encrypt: true, lastRunDate: "" }, T);
    expect(s.ok, JSON.stringify(s.error)).toBe(true);
    const b = await api("POST", "/backups", {}, T);
    expect(b.ok, JSON.stringify(b.error)).toBe(true);
    expect(b.data.encrypted).toBe(true);
    // change data after the backup
    const g = await api("POST", "/guests", { firstName: "After", lastName: "Backup" }, T);
    expect(g.ok).toBe(true);
    const insp = await api("POST", "/backups/inspect", { id: b.data.id }, T);
    expect(insp.data.ok).toBe(true);
    const r = await api("POST", "/backups/restore", { id: b.data.id, confirm: "RESTORE" }, T);
    expect(r.ok, JSON.stringify(r.error)).toBe(true);
    const guests = (await api("GET", "/guests?q=After", undefined, T)).data;
    expect(guests.total).toBe(0);
    const list = (await api("GET", "/backups", undefined, T)).data;
    expect(list.rows.some((x: any) => x.kind === "PRE_RESTORE")).toBe(true);
    // wrong recovery key is rejected
    const bad = await api("POST", "/backups/inspect", { id: b.data.id, recoveryKey: "AAAAAAAA-AAAAAAAA-AAAAAAAA-AAAAAAAA-AAAAAAAAAAA" }, T);
    expect(bad.ok).toBe(false);
  }, 60_000);

  it("dashboard aggregates", async () => {
    const d = await api("GET", "/dashboard", undefined, T);
    expect(d.ok).toBe(true);
    expect(d.data.businessDate).toBe(BD);
    expect(d.data.backup.state).toBe("OK");
    expect(d.data.forecast).toHaveLength(14);
  });
});
