import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { addDays } from "@petra/core";
import { api, freshApp, setupAndLogin } from "./helpers";
import { ENTITIES, templateCsv, autoMap, entityById } from "@/features/data-import/registry";
import { sanitizeText } from "@/server/services/import";

let T = "";
let BD = "";
const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64");

async function parse(entityId: string, fileName: string, content: string | Buffer) {
  const r = await api("POST", "/data/import/parse", { entityId, fileName, fileBase64: b64(content) }, T);
  expect(r.ok, JSON.stringify(r.error)).toBe(true);
  return r.data;
}
async function run(entityId: string, p: any, opts: Record<string, unknown> = {}) {
  const r = await api("POST", "/data/import/run", { entityId, mapping: p.mapping, rows: p.rows, fileName: "test.csv", ...opts }, T);
  expect(r.ok, JSON.stringify(r.error)).toBe(true);
  return r.data;
}

describe("Data Import Center", () => {
  beforeAll(async () => {
    await freshApp();
    ({ token: T, businessDate: BD } = await setupAndLogin());
  });

  it("templates in public/templates match the registry", () => {
    const dir = path.resolve(__dirname, "../public/templates");
    fs.mkdirSync(dir, { recursive: true });
    for (const e of ENTITIES) {
      const file = path.join(dir, `petrapms-${e.id}-template.csv`);
      if (process.env.UPDATE_TEMPLATES || !fs.existsSync(file)) fs.writeFileSync(file, templateCsv(e));
      expect(fs.readFileSync(file, "utf8"), e.id).toBe(templateCsv(e));
    }
  });

  it("neutralises formula injection", () => {
    expect(sanitizeText("=HYPERLINK(\"x\")").value).toBe('HYPERLINK("x")');
    expect(sanitizeText("+cmd").changed).toBe(true);
    expect(sanitizeText("-500").changed).toBe(false);
    expect(sanitizeText("'=SUM(A1)").value).toBe("SUM(A1)");
  });

  it("auto-maps Bangla and alias headers", () => {
    const m = autoMap(entityById("guests")!, ["Name", "মোবাইল", "NID", "ইমেইল"]);
    expect(m).toMatchObject({ firstName: "Name", phone: "মোবাইল", idNumber: "NID", email: "ইমেইল" });
  });

  it("dry run previews without saving; all-or-nothing rolls back; skip-invalid imports the rest", async () => {
    const csv = "﻿code,name,baseRate,bedType,maxOccupancy\nSUP,Superior,\"5,500.00\",QUEEN,3\nFAM,Family,৮৫০০,KING,5\nBAD,Broken,abc,KING,2\n";
    const p = await parse("roomTypes", "types.csv", csv);
    expect(p.headers).toEqual(["code", "name", "baseRate", "bedType", "maxOccupancy"]);
    const dry = await run("roomTypes", p, { dryRun: true });
    expect(dry.created).toBe(2);
    expect(dry.errors).toHaveLength(1);
    expect(dry.errors[0]).toMatchObject({ row: 3, field: "baseRate" });
    expect((await api("GET", "/room-types", undefined, T)).data.map((t: any) => t.code)).not.toContain("SUP");
    const aon = await run("roomTypes", p, { dryRun: false, mode: "ALL_OR_NOTHING" });
    expect(aon.created).toBe(0);
    expect((await api("GET", "/room-types", undefined, T)).data.map((t: any) => t.code)).not.toContain("SUP");
    const skip = await run("roomTypes", p, { dryRun: false, mode: "SKIP_INVALID" });
    expect(skip.created).toBe(2);
    expect(skip.skipped).toBe(1);
    const fam = (await api("GET", "/room-types", undefined, T)).data.find((t: any) => t.code === "FAM");
    expect(fam.baseRate).toBe(850000);
    // upsert updates existing, create refuses duplicates
    const p2 = await parse("roomTypes", "types2.csv", "code,name,baseRate\nFAM,Family Room,9000\n");
    const create = await run("roomTypes", p2, { dryRun: false, strategy: "CREATE", mode: "SKIP_INVALID" });
    expect(create.errors[0].message).toMatch(/already exists/);
    const up = await run("roomTypes", p2, { dryRun: false, strategy: "UPSERT" });
    expect(up.updated).toBe(1);
    expect((await api("GET", "/room-types", undefined, T)).data.find((t: any) => t.code === "FAM").name).toBe("Family Room");
    // undo the upsert restores the old values
    const undo = await api("POST", `/data/import/batches/${up.batchId}/undo`, {}, T);
    expect(undo.ok, JSON.stringify(undo.error)).toBe(true);
    expect((await api("GET", "/room-types", undefined, T)).data.find((t: any) => t.code === "FAM").name).toBe("Family");
  });

  it("imports rooms referencing types, and refuses unknown types", async () => {
    const p = await parse("rooms", "rooms.csv", "Room No,Floor,Type\n301,3,FAM\n302,3,FAM\n303,3,NOPE\n");
    expect(p.mapping).toMatchObject({ number: "Room No", floor: "Floor", roomTypeCode: "Type" });
    const r = await run("rooms", p, { dryRun: false, mode: "SKIP_INVALID" });
    expect(r.created).toBe(2);
    expect(r.errors[0].message).toMatch(/Room type "NOPE" not found/);
  });

  it("imports guests from xlsx and round-trips an export", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Guests");
    ws.addRow(["Guest list from old PMS"]);
    ws.addRow(["firstName", "lastName", "phone", "nationality", "dateOfBirth", "notes"]);
    ws.addRow(["রহিম", "উদ্দিন", "01711-223344", "BD", new Date("1985-04-12"), "=cmd|' /C calc'!A0"]);
    ws.addRow(["John", "Miller", "+44 7700 900123", "GB", "12/05/1979", ""]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const p = await parse("guests", "guests.xlsx", buf);
    expect(p.rows).toHaveLength(2);
    const r = await run("guests", p, { dryRun: false });
    expect(r.created).toBe(2);
    expect(r.warnings.some((w: any) => w.field === "notes")).toBe(true);
    const g = (await api("GET", "/guests?q=রহিম", undefined, T)).data.rows[0];
    expect(g.phone).toBe("+8801711223344");
    expect(g.dateOfBirth).toBe("1985-04-12");
    expect(g.notes.startsWith("=")).toBe(false);
    const exp = await api("GET", "/data/export/guests?format=csv", undefined, T);
    const csv = Buffer.from(exp.data).toString("utf8");
    const p2 = await parse("guests", "export.csv", csv);
    const again = await run("guests", p2, { dryRun: true, strategy: "UPSERT" });
    expect(again.errors).toHaveLength(0);
    expect(again.updated).toBe(2);
  });

  it("imports future reservations with availability checks and undo", async () => {
    const t = addDays(BD, 5);
    const lines = ["externalRef,guestName,phone,arrival,departure,roomTypeCode,adults,deposit,depositMethod"];
    for (let i = 0; i < 6; i++) lines.push(`OLD-${i},Guest ${i},0171100000${i},${t},${addDays(t, 2)},DLX,2,${i === 0 ? "1000" : "0"},CASH`);
    const p = await parse("reservations", "res.csv", lines.join("\n"));
    const r = await run("reservations", p, { dryRun: false, mode: "SKIP_INVALID" });
    expect(r.created).toBe(4); // 4 DLX rooms
    expect(r.errors).toHaveLength(2);
    expect(r.errors[0].message).toMatch(/No Deluxe available/);
    const list = (await api("GET", `/reservations?from=${t}&to=${t}`, undefined, T)).data;
    expect(list.total).toBe(4);
    const undo = await api("POST", `/data/import/batches/${r.batchId}/undo`, {}, T);
    expect(undo.ok, JSON.stringify(undo.error)).toBe(true);
    expect((await api("GET", `/reservations?from=${t}&to=${t}`, undefined, T)).data.total).toBe(0);
  });

  it("creates users with temporary passwords and opening balances", async () => {
    const p = await parse("users", "users.csv", "username,fullName,roleCode\nrahima.fd,Rahima Akter,RECEPTIONIST\n");
    const r = await run("users", p, { dryRun: false });
    expect(r.output[0].temporaryPassword).toMatch(/.{10}/);
    const login = await api("POST", "/auth/login", { username: "rahima.fd", password: r.output[0].temporaryPassword }, undefined);
    expect(login.ok).toBe(true);
    expect(login.data.user.mustChangePassword).toBe(true);
    const c = await parse("companies", "c.csv", "code,name,creditLimit\nGTL,Grameen Textiles,300000\n");
    await run("companies", c, { dryRun: false });
    const ob = await parse("openingBalances", "ob.csv", `companyCode,reference,amount,invoiceDate\nGTL,OLD-INV-1,45600.50,${addDays(BD, -40)}\n`);
    const r2 = await run("openingBalances", ob, { dryRun: false });
    expect(r2.created).toBe(1);
    const ledger = (await api("GET", "/ledger", undefined, T)).data;
    expect(ledger.items[0].balance).toBe(4560050);
  });

  it("exports and re-imports configuration", async () => {
    const r = await api("GET", "/data/config/export", undefined, T);
    const cfg = JSON.parse(Buffer.from(r.data).toString("utf8"));
    expect(cfg.format).toBe("petrapms-config-1");
    expect(JSON.stringify(cfg)).not.toMatch(/passwordHash/);
    cfg.taxRules.find((x: any) => x.code === "VAT").rateBp = 1000;
    const imp = await api("POST", "/data/config/import", { config: cfg, parts: ["taxRules", "roles"] }, T);
    expect(imp.ok, JSON.stringify(imp.error)).toBe(true);
    const rules = (await api("GET", "/tax-rules", undefined, T)).data;
    expect(rules.find((x: any) => x.code === "VAT").rateBp).toBe(1000);
    const sb = await api("GET", "/data/support-bundle", undefined, T);
    const bundle = Buffer.from(sb.data).toString("utf8");
    expect(bundle).toContain("schemaVersion");
    expect(bundle).not.toMatch(/passwordHash|tokenHash/);
  });
});
