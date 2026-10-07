// Background jobs (one per server process; in cloud mode with several instances set PETRA_SCHEDULER=off on all
// but one). Every minute: deliver queued notifications, daily backup, scheduled report export, license expiry
// warnings, preventive maintenance, housekeeping of expired sessions and import undo data.
import fs from "node:fs";
import path from "node:path";
import { calendarToday, clockNow } from "@petra/core";
import { expiryThreshold } from "@petra/core/license";
import { getDb, type Db } from "./db";
import { errText, log } from "./log";
import { getSection, patchSection } from "./settings";
import { processQueue, queueNotification } from "./services/notifications";
import { maybeAutoBackup } from "./services/backup";
import { getBusinessDate } from "./common";
import { lockedTx } from "./lock";

const g = globalThis as unknown as { __petraScheduler?: NodeJS.Timeout; __petraTickRunning?: boolean };

async function scheduledExports(db: Db) {
  const r = await getSection(db, "reports");
  if (!r.scheduledExportEnabled) return;
  const closed = await db.nightAudit.findMany({ where: { status: "COMPLETED", businessDate: { gt: r.lastExportDate || "0000" } }, orderBy: { businessDate: "asc" }, take: 3 });
  if (!closed.length) return;
  const { reportById } = await import("./services/reports");
  const { toXlsx } = await import("./services/export");
  const { renderReportPdf } = await import("./pdf/documents");
  const hotel = await db.hotel.findUnique({ where: { id: "hotel" } });
  const loc = await getSection(db, "locale");
  const dir = r.scheduledExportFolder ? (await import("./fsSafe")).validateUserFolder(r.scheduledExportFolder, "Export folder") : path.join((await import("./env")).env().exportsDir, "daily");
  fs.mkdirSync(dir, { recursive: true });
  for (const a of closed) {
    for (const id of ["manager", "revenue-category", "payments", "tax"]) {
      const def = reportById(id)!;
      const res = await def.run(db, { from: a.businessDate, to: a.businessDate, businessDate: a.businessDate });
      fs.writeFileSync(path.join(dir, `${a.businessDate}_${id}.xlsx`), await toXlsx(res, { hotel: hotel?.name ?? "" }));
      if (id === "manager") fs.writeFileSync(path.join(dir, `${a.businessDate}_${id}.pdf`), await renderReportPdf(res, { name: hotel?.name ?? "", address: hotel?.address, city: hotel?.city, phone: hotel?.phone, bin: hotel?.bin, logo: hotel?.logo }, "Scheduled export", { bn: false, grouping: loc.grouping }));
    }
    await patchSection(db, "reports", { lastExportDate: a.businessDate });
    log("info", "scheduler", `exported reports for ${a.businessDate} to ${dir}`);
  }
}

async function licenseWarnings(db: Db) {
  const { getLicenseInfo } = await import("./services/license");
  const lic = await getLicenseInfo(db);
  if (lic.state.mode !== "ACTIVE") return;
  const th = expiryThreshold(lic.state.daysLeft);
  const s = await getSection(db, "license");
  if (!th || s.warnedThreshold === th) return;
  const hotel = await db.hotel.findUnique({ where: { id: "hotel" } });
  const ev = (await getSection(db, "notifications")).events.LICENSE_EXPIRY;
  if (hotel?.email && ev?.email) await queueNotification(db, { channel: "EMAIL", to: hotel.email, templateCode: "LICENSE_EXPIRY", locale: "en", vars: { hotel: hotel.name, days: String(lic.state.daysLeft), date: lic.expiresAt ?? "" } });
  await patchSection(db, "license", { warnedThreshold: th });
}

async function preventive(db: Db) {
  const bd = await getBusinessDate(db);
  const { raiseDuePreventive } = await import("./routes/maintenance");
  const n = await lockedTx(db, (tx) => raiseDuePreventive(tx, bd, { username: "system", businessDate: bd }));
  if (n) {
    const { publish } = await import("./events");
    publish("maintenance", "preventive");
  }
}

async function cleanup(db: Db) {
  const cutoff = new Date(Date.now() - 7 * 86400_000);
  await db.userWindowSession.deleteMany({ where: { OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }] } });
  await db.importBatch.updateMany({ where: { status: "COMPLETED", expiresAt: { lt: new Date() }, undoData: { not: "[]" } }, data: { undoData: "[]" } });
}

let lastDaily = "";

export async function tick(now = new Date()) {
  if (g.__petraTickRunning) return;
  g.__petraTickRunning = true;
  try {
    const db = await getDb();
    const hotel = await db.hotel.findUnique({ where: { id: "hotel" }, select: { setupComplete: true, timezone: true } });
    if (!hotel?.setupComplete) return;
    const tz = hotel.timezone || "Asia/Dhaka";
    const today = calendarToday(tz, now);
    const hhmm = clockNow(tz, now);
    const jobs: [string, () => Promise<unknown>][] = [
      ["notifications", () => processQueue(db)],
      ["backup", () => maybeAutoBackup(db, today, hhmm)],
      ["exports", () => scheduledExports(db)],
    ];
    if (lastDaily !== today && process.env.PETRA_LICENSE_STATUS_URL) jobs.push(["licenseStatus", async () => (await import("./services/license")).refreshStatusFromUrl(db, process.env.PETRA_LICENSE_STATUS_URL!)]);
    if (lastDaily !== today) jobs.push(["license", () => licenseWarnings(db)], ["preventive", () => preventive(db)], ["cleanup", () => cleanup(db)]);
    for (const [name, job] of jobs) {
      try {
        await job();
      } catch (e) {
        log("error", "scheduler", `${name}: ${errText(e)}`);
      }
    }
    lastDaily = today;
  } catch (e) {
    log("error", "scheduler", `tick failed: ${errText(e)}`);
  } finally {
    g.__petraTickRunning = false;
  }
}

export function startScheduler() {
  if (g.__petraScheduler || process.env.PETRA_SCHEDULER === "off") return;
  g.__petraScheduler = setInterval(() => void tick(), 60_000);
  g.__petraScheduler.unref?.();
  setTimeout(() => void tick(), 5_000).unref?.();
  log("info", "scheduler", "background jobs started");
}
