// Data Import Center, templates, round-trip exports, configuration export/import, support bundle.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { z } from "zod";
import { toDecimalString } from "@petra/core";
import { latestSchemaVersion } from "@petra/db";
import { route, type Ctx } from "../api";
import { audit, parseJson } from "../common";
import { ApiError, notFound } from "../errors";
import { env } from "../env";
import { lastMigration } from "../db";
import { lockedTx } from "../lock";
import { getSettings, setSection, DEFAULT_SETTINGS, type Settings, type SettingsSection } from "../settings";
import { ENTITIES, entityById, autoMap, templateCsv, type EntityDef } from "@/features/data-import/registry";
import { importProgress, parseFile, runImport, undoImport, MAX_FILE_BYTES } from "../services/import";
import { toCsv, toXlsx } from "../services/export";
import { publish } from "../events";

const PERM = { perm: "data.import", module: "import" } as const;

route("GET", "/data/entities", { perm: ["data.import", "data.export"], allowReadOnly: true }, async (ctx) => {
  const counts: Record<string, number> = {
    roomTypes: await ctx.db.roomType.count(),
    rooms: await ctx.db.room.count(),
    ratePlans: await ctx.db.ratePlan.count(),
    rateSeasons: await ctx.db.rateSeason.count(),
    companies: await ctx.db.company.count({ where: { deletedAt: null } }),
    guests: await ctx.db.guest.count({ where: { deletedAt: null } }),
    chargeCodes: await ctx.db.chargeCode.count(),
    users: await ctx.db.user.count({ where: { deletedAt: null } }),
    reservations: await ctx.db.reservation.count({ where: { status: { in: ["CONFIRMED", "TENTATIVE"] } } }),
    openingBalances: await ctx.db.folio.count({ where: { cityLedger: true, status: { not: "CLOSED" } } }),
  };
  return ENTITIES.map((e) => ({ ...e, count: counts[e.id] ?? 0 }));
});

route("POST", "/data/import/parse", PERM, async (ctx) => {
  const b = await ctx.body(z.object({ entityId: z.string(), fileName: z.string().max(200), fileBase64: z.string().max(Math.ceil((MAX_FILE_BYTES * 4) / 3) + 16) }));
  const entity = entityById(b.entityId);
  if (!entity) throw notFound("Import type");
  const parsed = await parseFile(b.fileName, Buffer.from(b.fileBase64, "base64"));
  const presets = parseJson<Record<string, { name: string; mapping: Record<string, string> }[]>>((await ctx.db.setting.findUnique({ where: { key: "importPresets" } }))?.value, {});
  return { ...parsed, mapping: autoMap(entity, parsed.headers), presets: presets[entity.id] ?? [] };
});

const runSchema = z.object({
  entityId: z.string(),
  mapping: z.record(z.string(), z.string()),
  rows: z.array(z.record(z.string(), z.string())).max(20_000),
  mode: z.enum(["ALL_OR_NOTHING", "SKIP_INVALID"]).default("ALL_OR_NOTHING"),
  strategy: z.enum(["CREATE", "UPDATE", "UPSERT"]).default("CREATE"),
  dryRun: z.boolean().default(true),
  fileName: z.string().max(200).default("pasted rows"),
  jobId: z.string().max(64).optional(),
});

route("POST", "/data/import/run", PERM, async (ctx) => {
  const b = await ctx.body(runSchema);
  const r = await runImport(ctx.db, { ...b, actor: ctx.actor, businessDate: ctx.businessDate });
  if (!b.dryRun && (r.created || r.updated)) publish("system", "import", b.entityId, ctx.user?.id);
  return r;
});

route("GET", "/data/import/progress/:jobId", PERM, async (ctx) => importProgress(ctx.params.jobId) ?? { processed: 0, total: 0 });

route("GET", "/data/import/batches", { perm: "data.import", allowReadOnly: true }, async (ctx) => {
  const rows = await ctx.db.importBatch.findMany({ orderBy: { createdAt: "desc" }, take: 100, select: { id: true, entity: true, fileName: true, mode: true, strategy: true, status: true, total: true, created: true, updated: true, skipped: true, createdAt: true, expiresAt: true, undoneAt: true, createdById: true } });
  return rows.map((r) => ({ ...r, undoable: r.status === "COMPLETED" && r.expiresAt > new Date() }));
});

route("POST", "/data/import/batches/:id/undo", PERM, async (ctx) => {
  const r = await undoImport(ctx.db, ctx.params.id, ctx.actor);
  publish("system", "importUndone", ctx.params.id, ctx.user?.id);
  return r;
});

route("PUT", "/data/import/presets/:entity", PERM, async (ctx) => {
  const b = await ctx.body(z.object({ name: z.string().trim().min(1).max(60), mapping: z.record(z.string(), z.string()) }));
  const cur = parseJson<Record<string, { name: string; mapping: Record<string, string> }[]>>((await ctx.db.setting.findUnique({ where: { key: "importPresets" } }))?.value, {});
  const list = (cur[ctx.params.entity] ?? []).filter((p) => p.name !== b.name);
  list.push(b);
  cur[ctx.params.entity] = list.slice(-20);
  await ctx.db.setting.upsert({ where: { key: "importPresets" }, create: { key: "importPresets", value: JSON.stringify(cur) }, update: { value: JSON.stringify(cur) } });
  return cur[ctx.params.entity];
});

// ── templates and round-trip exports ─────────────────────────────────────────
function asTable(e: EntityDef, rows: Record<string, unknown>[]) {
  return { title: e.label, subtitle: "", columns: e.fields.map((f) => ({ key: f.key, label: f.key, type: "text" as const })), rows };
}

route("GET", "/data/templates/:entity", { perm: ["data.import", "data.export"], allowReadOnly: true }, async (ctx) => {
  const e = entityById(ctx.params.entity);
  if (!e) throw notFound("Import type");
  if (ctx.query.get("format") === "xlsx") {
    const buf = await toXlsx(asTable(e, [Object.fromEntries(e.fields.map((f) => [f.key, f.example]))]), { hotel: "PetraPMS import template" });
    return new Response(new Uint8Array(buf), { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="petrapms-${e.id}-template.xlsx"` } });
  }
  return new Response(templateCsv(e), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="petrapms-${e.id}-template.csv"` } });
});

const yes = (b: boolean) => (b ? "yes" : "no");
const money = (p: number | null | undefined) => (p == null ? "" : toDecimalString(p));
const pct = (bp: number) => String(bp / 100);

async function exportRows(ctx: Ctx, id: string): Promise<Record<string, unknown>[]> {
  const db = ctx.db;
  const types = new Map((await db.roomType.findMany()).map((t) => [t.id, t.code]));
  const plans = new Map((await db.ratePlan.findMany()).map((p) => [p.id, p.code]));
  const companies = new Map((await db.company.findMany()).map((c) => [c.id, c.code]));
  switch (id) {
    case "roomTypes":
      return (await db.roomType.findMany({ orderBy: { sortOrder: "asc" } })).map((t) => ({ ...t, baseRate: money(t.baseRate), extraAdultRate: money(t.extraAdultRate), extraChildRate: money(t.extraChildRate), extraBedRate: money(t.extraBedRate), amenities: parseJson<string[]>(t.amenities, []).join(";"), active: yes(t.active) }));
    case "rooms":
      return (await db.room.findMany({ orderBy: { number: "asc" } })).map((r) => ({ ...r, roomTypeCode: types.get(r.roomTypeId), active: yes(r.active) }));
    case "ratePlans": {
      const pols = new Map((await db.cancellationPolicy.findMany()).map((p) => [p.id, p.code]));
      return (await db.ratePlan.findMany({ orderBy: { code: "asc" } })).map((p) => ({ ...p, mealPricePerAdult: money(p.mealPricePerAdult), mealPricePerChild: money(p.mealPricePerChild), adjustmentValue: p.adjustmentType === "AMOUNT" ? money(p.adjustmentValue) : pct(p.adjustmentValue), weekendAdjustment: pct(p.weekendAdjustmentBp), cancellationPolicyCode: p.cancellationPolicyId ? pols.get(p.cancellationPolicyId) : "", active: yes(p.active) }));
    }
    case "rateSeasons":
      return (await db.rateSeason.findMany({ orderBy: { startDate: "asc" } })).map((s) => ({ ...s, value: s.adjustmentType === "PERCENT" ? pct(s.value) : money(s.value), ratePlanCode: s.ratePlanId ? plans.get(s.ratePlanId) : "", roomTypeCode: s.roomTypeId ? types.get(s.roomTypeId) : "", daysOfWeek: parseJson<number[]>(s.daysOfWeek, []).join(";") }));
    case "companies":
      return (await db.company.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" } })).map((c) => ({ ...c, creditLimit: money(c.creditLimit), discount: pct(c.discountBp), ratePlanCode: c.ratePlanId ? plans.get(c.ratePlanId) : "", active: yes(c.active) }));
    case "guests":
      return (await db.guest.findMany({ where: { deletedAt: null }, orderBy: { fullName: "asc" } })).map((g) => ({ ...g, companyCode: g.companyId ? companies.get(g.companyId) : "", marketingOptIn: yes(g.marketingOptIn) }));
    case "chargeCodes":
      return (await db.chargeCode.findMany({ orderBy: { sortOrder: "asc" } })).map((c) => ({ ...c, defaultAmount: money(c.defaultAmount), taxable: yes(c.taxable), active: yes(c.active) }));
    case "users": {
      const roles = new Map((await db.role.findMany()).map((r) => [r.id, r.code]));
      return (await db.user.findMany({ where: { deletedAt: null }, orderBy: { username: "asc" } })).map((u) => ({ username: u.username, fullName: u.fullName, roleCode: roles.get(u.roleId), phone: u.phone, email: u.email, locale: u.locale, active: yes(u.active) }));
    }
    case "reservations": {
      const rows = await db.reservationRoom.findMany({ where: { status: "RESERVED" }, include: { reservation: { include: { guest: true } }, room: true }, orderBy: { arrivalDate: "asc" } });
      return rows.map((s) => ({ externalRef: s.reservation.confirmationNo, guestName: s.reservation.guest.fullName, phone: s.reservation.guest.phone, email: s.reservation.guest.email, arrival: s.arrivalDate, departure: s.departureDate, roomTypeCode: types.get(s.roomTypeId), roomNumber: s.room?.number ?? "", adults: s.adults, children: s.children, ratePlanCode: s.ratePlanId ? plans.get(s.ratePlanId) : "", nightlyRate: s.rateOverride ? money(parseJson<{ amount: number }[]>(s.nightlyRates, [])[0]?.amount) : "", source: s.reservation.source, companyCode: s.reservation.companyId ? companies.get(s.reservation.companyId) : "", notes: s.reservation.specialRequests }));
    }
    case "openingBalances": {
      const { folioBalance } = await import("@petra/core");
      const rows = await db.folio.findMany({ where: { cityLedger: true, status: { not: "CLOSED" } }, include: { charges: true, payments: true } });
      return rows.map((f) => ({ companyCode: f.companyId ? companies.get(f.companyId) : "", reference: f.number, amount: money(folioBalance(f.charges, f.payments).balance), invoiceDate: f.openedAt.toISOString().slice(0, 10), dueDate: f.dueDate }));
    }
  }
  throw notFound("Export type");
}

route("GET", "/data/export/:entity", { perm: "data.export", allowReadOnly: true }, async (ctx) => {
  const e = entityById(ctx.params.entity);
  if (!e) throw notFound("Export type");
  const rows = await exportRows(ctx, e.id);
  const table = asTable(e, rows);
  await audit(ctx.db, ctx.actor, "data.export", e.id, "", { after: { rows: rows.length, format: ctx.query.get("format") ?? "csv" } });
  const stamp = ctx.businessDate;
  if (ctx.query.get("format") === "xlsx") return new Response(new Uint8Array(await toXlsx(table, { hotel: (await ctx.db.hotel.findUnique({ where: { id: "hotel" } }))?.name ?? "" })), { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="petrapms-${e.id}-${stamp}.xlsx"` } });
  return new Response(new Uint8Array(toCsv(table)), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="petrapms-${e.id}-${stamp}.csv"` } });
});

// ── configuration export / import (move setup between installations) ───────
const CONFIG_SECTIONS: SettingsSection[] = ["billing", "frontdesk", "audit", "housekeeping", "maintenance", "reports", "branding", "locale", "security", "notifications"];
const SECRET_KEYS = /(token|secret|password|apikey|api_key|authorization)/i;

function stripSecrets<T>(v: T): T {
  return JSON.parse(JSON.stringify(v, (k, val) => (SECRET_KEYS.test(k) ? undefined : typeof val === "string" && /authorization|bearer|api[-_]?key/i.test(val) ? "" : val)));
}

route("GET", "/data/config/export", { perm: "data.export", allowReadOnly: true }, async (ctx) => {
  const s = await getSettings(ctx.db);
  const [hotel, taxRules, paymentMethods, chargeCodes, policies, discountRules, amenities, roles] = await Promise.all([
    ctx.db.hotel.findUnique({ where: { id: "hotel" } }),
    ctx.db.taxRule.findMany(),
    ctx.db.paymentMethod.findMany(),
    ctx.db.chargeCode.findMany(),
    ctx.db.cancellationPolicy.findMany(),
    ctx.db.discountRule.findMany(),
    ctx.db.amenity.findMany(),
    ctx.db.role.findMany({ include: { permissions: true } }),
  ]);
  const strip = <T extends Record<string, unknown>>(r: T) => Object.fromEntries(Object.entries(r).filter(([k]) => !["id", "createdAt", "updatedAt", "createdById", "updatedById", "importBatchId", "isDemo"].includes(k)));
  const out = {
    format: "petrapms-config-1",
    exportedAt: new Date().toISOString(),
    appVersion: env().appVersion,
    schemaVersion: latestSchemaVersion(env().provider),
    hotel: hotel ? strip({ ...hotel, setupComplete: undefined }) : null,
    settings: stripSecrets(Object.fromEntries(CONFIG_SECTIONS.map((k) => [k, s[k]]))),
    taxRules: taxRules.map(strip),
    paymentMethods: paymentMethods.map(strip),
    chargeCodes: chargeCodes.map(strip),
    cancellationPolicies: policies.map(strip),
    discountRules: discountRules.map(strip),
    amenities: amenities.map(strip),
    roles: roles.map((r) => ({ code: r.code, name: r.name, nameBn: r.nameBn, builtin: r.builtin, permissions: r.permissions.map((p) => p.permissionCode) })),
  };
  await audit(ctx.db, ctx.actor, "data.configExport", "System", "");
  return new Response(JSON.stringify(out, null, 2), { headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="petrapms-config-${ctx.businessDate}.json"` } });
});

route("POST", "/data/config/import", { perm: "settings.manage" }, async (ctx) => {
  ctx.need("data.import");
  const b = await ctx.body(z.object({ config: z.record(z.string(), z.unknown()), parts: z.array(z.enum(["hotel", "settings", "taxRules", "paymentMethods", "chargeCodes", "cancellationPolicies", "discountRules", "amenities", "roles"])).min(1) }));
  const c = b.config as Record<string, unknown>;
  if (c.format !== "petrapms-config-1") throw new ApiError(400, "BAD_FILE", "This is not a PetraPMS configuration file");
  const summary: Record<string, number> = {};
  await lockedTx(ctx.db, async (tx) => {
    const t = tx as unknown as Record<string, { upsert: Function }>;
    const upsertAll = async (model: string, key: string, list: unknown) => {
      if (!Array.isArray(list)) return;
      for (const raw of list as Record<string, unknown>[]) {
        const row = Object.fromEntries(Object.entries(raw).filter(([k]) => !["id", "createdAt", "updatedAt"].includes(k)));
        await t[model].upsert({ where: { [key]: row[key] }, create: row, update: row });
      }
      summary[model] = (list as unknown[]).length;
    };
    for (const part of b.parts) {
      if (part === "hotel" && c.hotel) {
        const h = c.hotel as Record<string, unknown>;
        const allowed = ["name", "legalName", "address", "city", "country", "phone", "email", "website", "bin", "tradeLicense", "logo", "checkInTime", "checkOutTime", "timezone", "usdRate", "showUsd"];
        await tx.hotel.update({ where: { id: "hotel" }, data: Object.fromEntries(Object.entries(h).filter(([k]) => allowed.includes(k))) });
        summary.hotel = 1;
      }
      if (part === "settings" && c.settings) {
        for (const [k, v] of Object.entries(c.settings as Record<string, unknown>)) {
          if (!CONFIG_SECTIONS.includes(k as SettingsSection)) continue;
          const merged = { ...(DEFAULT_SETTINGS[k as SettingsSection] as object), ...(v as object) } as Settings[SettingsSection];
          await setSection(tx, k as SettingsSection, merged, ctx.user?.id);
        }
        summary.settings = Object.keys(c.settings as object).length;
      }
      if (part === "taxRules") await upsertAll("taxRule", "code", c.taxRules);
      if (part === "paymentMethods") await upsertAll("paymentMethod", "code", c.paymentMethods);
      if (part === "chargeCodes") await upsertAll("chargeCode", "code", c.chargeCodes);
      if (part === "cancellationPolicies") await upsertAll("cancellationPolicy", "code", c.cancellationPolicies);
      if (part === "discountRules") await upsertAll("discountRule", "code", c.discountRules);
      if (part === "amenities") await upsertAll("amenity", "code", c.amenities);
      if (part === "roles" && Array.isArray(c.roles)) {
        const known = new Set((await tx.permission.findMany({ select: { code: true } })).map((p) => p.code));
        for (const r of c.roles as { code: string; name: string; nameBn?: string; permissions: string[] }[]) {
          if (r.code === "SUPER_ADMIN") continue; // never altered by file
          const role = await tx.role.upsert({ where: { code: r.code }, create: { code: r.code, name: r.name, nameBn: r.nameBn ?? "" }, update: { name: r.name, nameBn: r.nameBn ?? "" } });
          await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
          const perms = r.permissions.filter((p) => known.has(p));
          if (perms.length) await tx.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, permissionCode: p })) });
        }
        summary.roles = (c.roles as unknown[]).length;
      }
    }
    await audit(tx, ctx.actor, "data.configImport", "System", "", { after: summary });
  });
  publish("settings", "configImport", undefined, ctx.user?.id);
  return summary;
});

// ── support bundle (no secrets, no guest data) ───────────────────────────────
route("GET", "/data/support-bundle", { perm: "settings.manage", allowReadOnly: true }, async (ctx) => {
  const e = env();
  const s = await getSettings(ctx.db);
  const lic = await ctx.license();
  const logFiles = fs.existsSync(e.logsDir) ? fs.readdirSync(e.logsDir).filter((f) => f.endsWith(".log")).sort().slice(-3) : [];
  const logs: Record<string, string> = {};
  for (const f of logFiles) logs[f] = fs.readFileSync(path.join(e.logsDir, f), "utf8").split("\n").slice(-800).join("\n");
  const counts = { rooms: await ctx.db.room.count(), reservations: await ctx.db.reservation.count(), folios: await ctx.db.folio.count(), users: await ctx.db.user.count(), auditLog: await ctx.db.auditLog.count(), notificationsFailed: await ctx.db.notification.count({ where: { status: "FAILED" } }) };
  const bundle = {
    generatedAt: new Date().toISOString(),
    app: { version: e.appVersion, mode: e.mode, provider: e.provider, schemaVersion: latestSchemaVersion(e.provider), lastMigration: lastMigration() },
    system: { platform: process.platform, release: os.release(), arch: process.arch, node: process.version, cpus: os.cpus().length, memoryMB: Math.round(os.totalmem() / 1048576), freeMemoryMB: Math.round(os.freemem() / 1048576), uptimeHours: Math.round(os.uptime() / 3600), dataDir: e.dataDir },
    license: { mode: lic.state.mode, edition: lic.edition, maxRooms: lic.maxRooms, maxTerminals: lic.maxTerminals, expiresAt: lic.expiresAt, warnings: lic.state.warnings },
    businessDate: ctx.businessDate,
    settings: stripSecrets({ ...s, notifications: { ...s.notifications, sms: { ...s.notifications.sms, headers: "[removed]", url: s.notifications.sms.url ? "[set]" : "" }, email: { ...s.notifications.email, headers: "[removed]", url: s.notifications.email.url ? "[set]" : "" }, whatsapp: { ...s.notifications.whatsapp, headers: "[removed]", url: s.notifications.whatsapp.url ? "[set]" : "" } } }),
    counts,
    backups: (await ctx.db.backupRecord.findMany({ orderBy: { createdAt: "desc" }, take: 10, select: { fileName: true, kind: true, status: true, error: true, createdAt: true, sizeBytes: true } })),
    nightAudits: await ctx.db.nightAudit.findMany({ orderBy: { businessDate: "desc" }, take: 7, select: { businessDate: true, status: true, error: true } }),
    logs,
  };
  await audit(ctx.db, ctx.actor, "data.supportBundle", "System", "");
  return new Response(JSON.stringify(bundle, null, 2), { headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="petrapms-support-${ctx.businessDate}.json"` } });
});
