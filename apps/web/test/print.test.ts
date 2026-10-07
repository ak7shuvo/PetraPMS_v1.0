import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { addDays } from "@petra/core";
import { api, freshApp, setupAndLogin, setupBody } from "./helpers";

// Set PETRA_PRINT_OUT=<dir> to keep the generated PDFs (for visual inspection / real printer tests).
const OUT = process.env.PETRA_PRINT_OUT;
const bytes = (r: { data: unknown }) => Buffer.from(r.data as ArrayBuffer);
const pages = (b: Buffer) => (b.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
const save = (name: string, b: Buffer) => OUT && (fs.mkdirSync(OUT, { recursive: true }), fs.writeFileSync(path.join(OUT, name), b));

let T = "";
let BD = "";
let folioId = "";
let invoiceId = "";
let stayId = "";
let reservationId = "";
let paymentId = "";

describe("printing: every document renders, in English and Bangla, on A4 and 80 mm", () => {
  beforeAll(async () => {
    await freshApp("petra-print-");
    ({ token: T, businessDate: BD } = await setupAndLogin({
      hotel: { name: "হোটেল সী পার্ল ইন্টারন্যাশনাল অ্যান্ড রিসোর্ট Hotel Sea Pearl International", address: "প্লট ১২, রোড ৫, গুলশান-২, ঢাকা ১২১২, বাংলাদেশ — near Gulshan Circle 2", city: "Dhaka", phone: "+8801711000000", email: "fo@test.bd", bin: "000123456789", checkInTime: "14:00", checkOutTime: "12:00" },
    }));
    const types = (await api("GET", "/room-types", undefined, T)).data as { id: string; code: string }[];
    const std = types.find((t) => t.code === "STD")!;
    const r = await api("POST", "/reservations", { guest: { firstName: "মোহাম্মদ আবদুল্লাহ আল মামুন", lastName: "চৌধুরী", phone: "+8801812345678", idType: "NID", idNumber: "9988776655", address: "বাড়ি ৪৫, সড়ক ১০, ধানমন্ডি, ঢাকা" }, arrival: BD, departure: addDays(BD, 1), rooms: [{ roomTypeId: std.id, adults: 2 }], deposit: { method: "BKASH", amount: 100000, reference: "TRX1" } }, T);
    expect(r.ok).toBe(true);
    reservationId = r.data.id;
    const res = (await api("GET", `/reservations/${reservationId}`, undefined, T)).data;
    stayId = res.rooms[0].id;
    const ci = await api("POST", `/stays/${stayId}/check-in`, { version: res.rooms[0].version }, T);
    folioId = ci.data.folioId;
    for (const d of ["Restaurant — Dinner buffet for two with extra service items and a very long description line that must wrap", "Laundry — গেস্টের কাপড় ধোলাই ও ইস্ত্রি সার্ভিস (এক্সপ্রেস)", "Minibar"]) {
      const c = await api("POST", `/folios/${folioId}/charges`, { chargeCode: "REST", amount: 100000, description: d }, T);
      expect(c.ok, JSON.stringify(c.error)).toBe(true);
    }
    const f = (await api("GET", `/folios/${folioId}`, undefined, T)).data;
    const pay = await api("POST", `/folios/${folioId}/payments`, { method: "CASH", amount: f.balance.balance }, T);
    expect(pay.ok).toBe(true);
    paymentId = pay.data.id;
    const inv = await api("POST", `/folios/${folioId}/invoices`, {}, T);
    expect(inv.ok, JSON.stringify(inv.error)).toBe(true);
    invoiceId = inv.data.id;
  });

  for (const lang of ["en", "bn"]) {
    it(`A4 documents (${lang})`, async () => {
      const docs: [string, string][] = [
        ["invoice", `/invoices/${invoiceId}/pdf?lang=${lang}`],
        ["proforma", `/folios/${folioId}/proforma/pdf?lang=${lang}`],
        ["regcard", `/stays/${stayId}/registration-card/pdf?lang=${lang}`],
        ["confirmation", `/reservations/${reservationId}/confirmation/pdf?lang=${lang}`],
        ["test-a4", `/print/test?format=A4&lang=${lang}&printer=EPSON%20L3150`],
      ];
      for (const [name, url] of docs) {
        const r = await api("GET", url, undefined, T);
        expect(r.status, `${name}: ${JSON.stringify(r.error)}`).toBe(200);
        const b = bytes(r);
        expect(b.subarray(0, 5).toString()).toBe("%PDF-");
        expect(b.length).toBeGreaterThan(1500);
        save(`${name}-${lang}.pdf`, b);
      }
    });

    it(`80 mm thermal documents are always ONE page, however long the text (${lang})`, async () => {
      const docs: [string, string][] = [
        ["thermal-invoice", `/invoices/${invoiceId}/pdf?format=80mm&lang=${lang}`],
        ["thermal-proforma", `/folios/${folioId}/proforma/pdf?format=80mm&lang=${lang}`],
        ["thermal-receipt", `/payments/${paymentId}/receipt/pdf?lang=${lang}`],
        ["thermal-test", `/print/test?format=80mm&lang=${lang}`],
      ];
      for (const [name, url] of docs) {
        const r = await api("GET", url, undefined, T);
        expect(r.status, `${name}: ${JSON.stringify(r.error)}`).toBe(200);
        const b = bytes(r);
        expect(b.subarray(0, 5).toString()).toBe("%PDF-");
        expect(pages(b), `${name} has ${pages(b)} pages`).toBe(1);
        save(`${name}-${lang}.pdf`, b);
      }
    });
  }

  it("reports export to PDF", async () => {
    const list = (await api("GET", "/reports", undefined, T)).data as { id: string }[];
    let n = 0;
    for (const rep of list.slice(0, 6)) {
      const r = await api("GET", `/reports/${rep.id}/export?format=pdf&from=${BD}&to=${BD}`, undefined, T);
      expect(r.status, rep.id).toBe(200);
      expect(bytes(r).subarray(0, 5).toString()).toBe("%PDF-");
      n++;
    }
    expect(n).toBeGreaterThan(0);
  });

  it("refuses to print documents the user may not see", async () => {
    expect((await api("GET", `/invoices/${invoiceId}/pdf`)).status).toBe(401);
  });
});
