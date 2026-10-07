// Night audit, dashboard, realtime events (SSE), backups, notifications, demo data.
import { storageHealth } from "../fsSafe";
import { log } from "../log";
import { z } from "zod";
import { auditOverdue, calendarToday, clockNow, addDays } from "@petra/core";
import { route } from "../api";
import { audit, parseJson } from "../common";
import { bus, type PetraEvent } from "../events";
import { ApiError, notFound } from "../errors";
import { auditPreview, rollbackNightAudit, runNightAudit } from "../services/nightAudit";
import { dayStats, forecast } from "../services/stats";
import { assertRegularFile } from "../fsSafe";
import { backupHealth, createBackup, fetchRemote, inspectBackup, listRemote, recoveryKey, restoreBackup, testRemote } from "../services/backup";
import { getSection } from "../settings";
import { processQueue, queueNotification, TEMPLATES } from "../services/notifications";
import { clearDemoData, hasDemoData, loadDemoData } from "../services/demo";
import { env } from "../env";
import fs from "node:fs";

// ── night audit ──────────────────────────────────────────────────────────────
route("GET", "/night-audit/preview", { perm: "nightaudit.run", allowReadOnly: true }, async (ctx) => auditPreview(ctx.db, ctx.businessDate));

route("POST", "/night-audit/run", { perm: "nightaudit.run" }, async (ctx) => {
  const b = await ctx.body(z.object({ businessDate: z.string() }));
  if (b.businessDate !== ctx.businessDate) throw new ApiError(409, "DATE_CHANGED", `The business date is now ${ctx.businessDate}. Refresh the wizard.`);
  return runNightAudit(ctx.db, ctx.businessDate, ctx.actor);
});

route("POST", "/night-audit/rollback", { perm: "nightaudit.rollback" }, async (ctx) => {
  const b = await ctx.body(z.object({ reason: z.string().trim().min(5, "Explain why").max(500) }));
  return rollbackNightAudit(ctx.db, ctx.actor, b.reason);
});

route("GET", "/night-audit/history", { perm: ["nightaudit.run", "reports.view"], allowReadOnly: true }, async (ctx) => {
  const rows = await ctx.db.nightAudit.findMany({ orderBy: { businessDate: "desc" }, take: 60 });
  return rows.map((r) => ({ ...r, steps: parseJson(r.steps, []), summary: parseJson<Record<string, unknown>>(r.summary, {}) }));
});

// ── dashboard ────────────────────────────────────────────────────────────────
route("GET", "/dashboard", { perm: "dashboard.view", allowReadOnly: true }, async (ctx) => {
  const bd = ctx.businessDate;
  const hotel = await ctx.db.hotel.findUnique({ where: { id: "hotel" } });
  const tz = hotel?.timezone || "Asia/Dhaka";
  const [today, yesterday, fc, rooms, arrivalsPending, departuresPending, inHouse, openTickets, overdueTickets, dirty, vip, notes, health, lic, demo, auditS] = await Promise.all([
    dayStats(ctx.db, bd, { forecast: true }),
    dayStats(ctx.db, addDays(bd, -1)),
    forecast(ctx.db, bd, 14),
    ctx.db.room.findMany({ where: { active: true }, select: { hkStatus: true } }),
    ctx.db.reservationRoom.count({ where: { arrivalDate: bd, status: "RESERVED" } }),
    ctx.db.reservationRoom.count({ where: { departureDate: { lte: bd }, status: "CHECKED_IN" } }),
    ctx.db.reservationRoom.count({ where: { status: "CHECKED_IN" } }),
    ctx.db.maintenanceTicket.count({ where: { status: { in: ["OPEN", "IN_PROGRESS", "ON_HOLD"] } } }),
    ctx.db.maintenanceTicket.count({ where: { status: { in: ["OPEN", "IN_PROGRESS", "ON_HOLD"] }, slaDueAt: { lt: new Date() } } }),
    ctx.db.room.count({ where: { active: true, hkStatus: "DIRTY" } }),
    ctx.db.reservationRoom.findMany({ where: { OR: [{ arrivalDate: bd, status: "RESERVED" }, { status: "CHECKED_IN" }], reservation: { guest: { vip: { gt: 0 } } } }, take: 10, include: { reservation: { select: { confirmationNo: true, guest: { select: { fullName: true, vip: true } } } }, room: { select: { number: true } } } }),
    ctx.db.shiftNote.findMany({ where: { businessDate: { gte: addDays(bd, -1) } }, orderBy: { createdAt: "desc" }, take: 5 }),
    backupHealth(ctx.db),
    ctx.license(),
    hasDemoData(ctx.db),
    getSection(ctx.db, "audit"),
  ]);
  const showMoney = ctx.can("dashboard.financials");
  const strip = <T extends Record<string, unknown>>(s: T) => (showMoney ? s : { ...s, roomRevenue: null, otherRevenue: null, totalRevenue: null, adr: null, revpar: null, payments: {}, byCategory: {}, serviceCharge: null, vat: null });
  return {
    businessDate: bd,
    calendarDate: calendarToday(tz),
    auditOverdue: auditOverdue(bd, calendarToday(tz), clockNow(tz), auditS.autoTime),
    today: strip(today as unknown as Record<string, unknown>),
    yesterday: strip(yesterday as unknown as Record<string, unknown>),
    forecast: showMoney ? fc : fc.map((f) => ({ ...f, revenue: null })),
    roomStatus: rooms.reduce<Record<string, number>>((a, r) => ((a[r.hkStatus] = (a[r.hkStatus] ?? 0) + 1), a), {}),
    pending: { arrivals: arrivalsPending, departures: departuresPending, inHouse, dirty, openTickets, overdueTickets },
    vip: vip.map((v) => ({ id: v.id, name: v.reservation.guest.fullName, vip: v.reservation.guest.vip, room: v.room?.number ?? null, status: v.status, conf: v.reservation.confirmationNo })),
    notes,
    backup: health,
    storage: storageHealth(),
    license: { mode: lic.state.mode, readOnly: lic.state.readOnly, daysLeft: lic.state.readOnly ? 0 : lic.state.daysLeft, warnings: lic.state.warnings },
    demoData: demo,
  };
});

// ── realtime: Server-Sent Events ─────────────────────────────────────────────
// EventSource cannot send headers, so the window token travels in the query string (short-lived, per window).
route("GET", "/events", { auth: "public", beforeSetup: true, allowReadOnly: true }, async (ctx) => {
  const { authenticate } = await import("../auth");
  const a = await authenticate(ctx.db, ctx.query.get("token"));
  if (!a) throw new ApiError(401, "UNAUTHENTICATED", "Please sign in");
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (data: string, event?: string) => {
        try {
          controller.enqueue(encoder.encode(`${event ? `event: ${event}\n` : ""}data: ${data}\n\n`));
        } catch {
          cleanup();
        }
      };
      send(JSON.stringify({ topic: "system", action: "hello", at: new Date().toISOString() }));
      const onEvent = (e: PetraEvent) => send(JSON.stringify(e));
      bus.on("event", onEvent);
      const ping = setInterval(() => send(String(Date.now()), "ping"), 25_000);
      cleanup = () => {
        clearInterval(ping);
        bus.off("event", onEvent);
      };
      ctx.req.signal?.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {
          /* closed */
        }
      });
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store, no-transform", connection: "keep-alive", "x-accel-buffering": "no" } });
});

// ── backups ──────────────────────────────────────────────────────────────────
route("GET", "/backups", { perm: "data.backup", allowReadOnly: true }, async (ctx) => {
  const rows = await ctx.db.backupRecord.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
  return { rows: rows.map((r) => ({ ...r, exists: r.status === "OK" && fs.existsSync(r.path) })), health: await backupHealth(ctx.db) };
});

route("POST", "/backups", { perm: "data.backup", allowReadOnly: true }, async (ctx) => createBackup(ctx.db, "MANUAL", ctx.actor));

// Update step "backup": the desktop UI calls this before it lets the installer run. A verified, checksummed backup of the
// current data is written first (kind PRE_UPDATE); if it fails the update is NOT started (the caller shows the error).
route("POST", "/system/update/prepare", { perm: "data.backup", allowReadOnly: true }, async (ctx) => {
  log("info", "update", `pre-update backup requested by ${ctx.actor.username ?? "?"}`);
  const rec = await createBackup(ctx.db, "PRE_UPDATE", ctx.actor);
  log("info", "update", `pre-update backup ${rec.fileName} verified`);
  return { backupId: rec.id, fileName: rec.fileName, sizeBytes: rec.sizeBytes, schemaVersion: rec.schemaVersion, appVersion: rec.appVersion };
});

route("GET", "/backups/:id/download", { perm: "data.backup", allowReadOnly: true }, async (ctx) => {
  const r = await ctx.db.backupRecord.findUnique({ where: { id: ctx.params.id } });
  if (!r || !fs.existsSync(r.path)) throw notFound("Backup file");
  await audit(ctx.db, ctx.actor, "backup.downloaded", "BackupRecord", r.id);
  return new Response(new Uint8Array(fs.readFileSync(r.path)), { headers: { "content-type": "application/octet-stream", "content-disposition": `attachment; filename="${r.fileName}"` } });
});

route("GET", "/backups/recovery-key", { perm: "data.restore" }, async (ctx) => {
  const k = recoveryKey();
  await audit(ctx.db, ctx.actor, "backup.recoveryKeyViewed", "System", "");
  return { key: k };
});

const restoreBody = z.object({ id: z.string().optional(), remoteName: z.string().max(120).optional(), fileBase64: z.string().max(700_000_000).optional(), recoveryKey: z.string().max(200).optional(), confirm: z.literal("RESTORE").optional() });

async function backupBytes(ctx: Parameters<Parameters<typeof route>[3]>[0], b: z.infer<typeof restoreBody>) {
  if (b.id) {
    const r = await ctx.db.backupRecord.findUnique({ where: { id: b.id } });
    if (!r || !fs.existsSync(r.path)) throw notFound("Backup file");
    assertRegularFile(r.path);
    return fs.readFileSync(r.path);
  }
  if (b.remoteName) return fetchRemote(ctx.db, b.remoteName);
  if (b.fileBase64) return Buffer.from(b.fileBase64, "base64");
  throw new ApiError(400, "VALIDATION", "Choose a backup");
}

route("POST", "/backups/remote/test", { perm: "data.backup", allowReadOnly: true }, async (ctx) => testRemote(ctx.db));
route("GET", "/backups/remote", { perm: "data.backup", allowReadOnly: true }, async (ctx) => listRemote(ctx.db));

route("POST", "/backups/inspect", { perm: "data.restore", allowReadOnly: true }, async (ctx) => {
  const b = await ctx.body(restoreBody);
  const r = inspectBackup(await backupBytes(ctx, b), b.recoveryKey);
  return r;
});

route("POST", "/backups/restore", { perm: "data.restore", allowReadOnly: true }, async (ctx) => {
  const b = await ctx.body(restoreBody);
  if (b.confirm !== "RESTORE") throw new ApiError(400, "CONFIRM", 'Type RESTORE to confirm');
  return restoreBackup(await backupBytes(ctx, b), ctx.actor, b.recoveryKey);
});

// ── notifications ────────────────────────────────────────────────────────────
route("GET", "/notifications", { perm: "settings.manage", allowReadOnly: true }, async (ctx) => ctx.db.notification.findMany({ orderBy: { createdAt: "desc" }, take: 200 }));
route("GET", "/notifications/templates", { perm: "settings.view", allowReadOnly: true }, async () => TEMPLATES);
route("POST", "/notifications/test", { perm: "settings.manage" }, async (ctx) => {
  const b = await ctx.body(z.object({ channel: z.enum(["SMS", "EMAIL", "WHATSAPP"]), to: z.string().trim().min(3).max(120) }));
  const hotel = await ctx.db.hotel.findUnique({ where: { id: "hotel" } });
  const n = await queueNotification(ctx.db, { channel: b.channel, to: b.to, templateCode: "TEST", locale: "en", vars: { hotel: hotel?.name ?? "PetraPMS" } });
  const r = await processQueue(ctx.db, 5);
  const after = n ? await ctx.db.notification.findUnique({ where: { id: n.id } }) : null;
  return { sent: r.sent, status: after?.status, error: after?.lastError };
});
route("POST", "/notifications/:id/retry", { perm: "settings.manage" }, async (ctx) => {
  await ctx.db.notification.update({ where: { id: ctx.params.id }, data: { status: "QUEUED", sendAfter: new Date(), attempts: 0 } });
  return { ok: true };
});

// ── demo data ────────────────────────────────────────────────────────────────
route("POST", "/demo/load", { perm: "data.demo" }, async (ctx) => {
  await loadDemoData(ctx.db, ctx.actor);
  return { ok: true };
});
route("POST", "/demo/clear", { perm: "data.demo" }, async (ctx) => {
  const b = await ctx.body(z.object({ confirm: z.literal("CLEAR") }));
  void b;
  return clearDemoData(ctx.db, ctx.actor);
});

route("GET", "/system/data-dir", { perm: "settings.manage", allowReadOnly: true }, async () => ({ dataDir: env().dataDir, backupsDir: env().backupsDir, logsDir: env().logsDir, provider: env().provider }));
