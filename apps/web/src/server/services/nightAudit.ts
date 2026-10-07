// Night audit: closes the business date.
//   1. pre-checks (pending arrivals, overdue departures, unsettled same-day folios) — shown in the wizard
//   2. automatic pre-audit backup
//   3. in ONE locked transaction: no-shows (+ penalty), room & tax posting for every in-house stay (idempotent:
//      a charge with sourceRef room:<stay>:<date> is never posted twice), daily housekeeping tasks, due
//      preventive maintenance, day statistics, close the date and open the next one
//   4. rollback (Super Admin) reverses an audit while nothing has been posted on the new date yet.
import { planNightAudit, type AuditStay } from "@petra/core";
import type { Db, Tx } from "../db";
import { audit, parseJson, type AuditActor } from "../common";
import { ApiError } from "../errors";
import { lockedTx } from "../lock";
import { getSection } from "../settings";
import { publish } from "../events";
import { markNoShow } from "./reservations";
import { postCharge, primaryFolioForStay } from "./folio";
import { generateDailyTasks } from "./housekeeping";
import { dayStats } from "./stats";
import { createBackup } from "./backup";

async function loadAuditStays(db: Db | Tx, date: string): Promise<AuditStay[]> {
  const rows = await db.reservationRoom.findMany({
    where: { OR: [{ status: "CHECKED_IN" }, { status: "RESERVED", arrivalDate: { lte: date } }] },
    include: { reservation: { select: { id: true, confirmationNo: true, guest: { select: { fullName: true } } } }, room: { select: { number: true } }, guest: { select: { fullName: true } } },
  });
  return rows.map((r) => ({ id: r.id, reservationId: r.reservationId, confirmationNo: r.reservation.confirmationNo, guestName: r.guest?.fullName ?? r.reservation.guest.fullName, roomNumber: r.room?.number ?? null, arrivalDate: r.arrivalDate, departureDate: r.departureDate, status: r.status, nightlyRates: parseJson(r.nightlyRates, []) }));
}

async function postedNights(db: Db | Tx, date: string) {
  const rows = await db.folioCharge.findMany({ where: { businessDate: date, source: "NIGHT_AUDIT", voidedAt: null, sourceRef: { startsWith: "room:" } }, select: { sourceRef: true } });
  return new Set(rows.map((r) => {
    const [, stay, d] = r.sourceRef.split(":");
    return `${stay}|${d}`;
  }));
}

/** Wizard step 1: what the audit will do and what blocks it. */
export async function auditPreview(db: Db, businessDate: string) {
  const s = await getSection(db, "audit");
  const plan = planNightAudit(businessDate, await loadAuditStays(db, businessDate), await postedNights(db, businessDate), { requireDeparturesResolved: s.requireDeparturesResolved });
  const unsettledWalkIns = await db.folio.count({ where: { type: "WALK_IN", status: "OPEN", openedAt: { lt: new Date() } } });
  const running = await db.nightAudit.findUnique({ where: { businessDate } });
  return {
    businessDate,
    nextBusinessDate: plan.nextBusinessDate,
    pendingArrivals: plan.pendingArrivals,
    noShows: plan.noShows,
    overdueDepartures: plan.overdueDepartures,
    roomCharges: plan.roomCharges.length,
    roomRevenue: plan.roomCharges.reduce((a, c) => a + c.amount, 0),
    warnings: [...(plan.pendingArrivals.length ? [`${plan.pendingArrivals.length} arrival(s) for today not checked in: they will be marked no-show`] : []), ...(unsettledWalkIns ? [`${unsettledWalkIns} open walk-in / house folio(s)`] : [])],
    blocking: plan.blocking,
    alreadyRun: running?.status === "COMPLETED",
    postNoShowPenalty: s.postNoShowPenalty,
  };
}

export async function runNightAudit(db: Db, businessDate: string, actor: AuditActor, opts: { skipBackup?: boolean } = {}) {
  const s = await getSection(db, "audit");
  const existing = await db.nightAudit.findUnique({ where: { businessDate } });
  if (existing?.status === "COMPLETED") throw new ApiError(409, "ALREADY_RUN", `Night audit for ${businessDate} has already been completed`);
  const steps: { step: string; at: string; detail?: string }[] = [];
  const step = (n: string, d?: string) => steps.push({ step: n, at: new Date().toISOString(), detail: d });
  await db.nightAudit.upsert({ where: { businessDate }, create: { businessDate, startedById: actor.userId ?? null, status: "RUNNING" }, update: { status: "RUNNING", error: "", startedAt: new Date(), startedById: actor.userId ?? null } });
  let backupName = "";
  if (!opts.skipBackup) {
    try {
      backupName = (await createBackup(db, "PRE_AUDIT", actor)).fileName;
      step("backup", backupName);
    } catch (e) {
      step("backup", `failed: ${(e as Error).message}`); // audit continues; dashboard shows backup health
    }
  }
  try {
    const A: AuditActor = { ...actor, businessDate };
    const result = await lockedTx(db, async (tx) => {
      const current = await tx.businessDate.findFirst({ where: { status: "OPEN" }, orderBy: { date: "desc" } });
      if (current?.date !== businessDate) throw new ApiError(409, "DATE_CHANGED", `The business date is ${current?.date}; refresh and try again`);
      const plan = planNightAudit(businessDate, await loadAuditStays(tx, businessDate), await postedNights(tx, businessDate), { requireDeparturesResolved: s.requireDeparturesResolved });
      if (plan.blocking.length) throw new ApiError(409, "AUDIT_BLOCKED", plan.blocking.join("; "), { overdueDepartures: plan.overdueDepartures });
      // no-shows: reservations whose arrival was today (or earlier) and never checked in
      const noShowRes = [...new Set([...plan.noShows, ...plan.pendingArrivals].map((x) => x.reservationId))];
      const noShowIds: string[] = [];
      let noShowFees = 0;
      for (const rid of noShowRes) {
        const reserved = await tx.reservationRoom.count({ where: { reservationId: rid, status: "RESERVED", arrivalDate: { lte: businessDate } } });
        if (!reserved) continue;
        const { fee } = await markNoShow(tx, rid, { me: null, actor: A, businessDate }, s.postNoShowPenalty);
        noShowIds.push(rid);
        noShowFees += fee;
      }
      step("noShows", `${noShowIds.length} reservation(s), fees ${noShowFees}`);
      // room charges
      const chargeIds: string[] = [];
      for (const c of plan.roomCharges) {
        const folio = await primaryFolioForStay(tx, c.stayId, A, businessDate);
        const ch = await postCharge(tx, { folioId: folio.id, chargeCode: "ROOM", amount: c.amount, description: `Room ${c.roomNumber} – ${businessDate}`, businessDate, source: "NIGHT_AUDIT", sourceRef: `room:${c.stayId}:${businessDate}`, reservationRoomId: c.stayId, roomNumber: c.roomNumber }, A);
        chargeIds.push(ch.id);
      }
      step("roomCharges", `${chargeIds.length} posted`);
      const next = plan.nextBusinessDate;
      const hk = await generateDailyTasks(tx, next, A);
      step("housekeeping", `${hk} task(s) for ${next}`);
      const { raiseDuePreventive } = await import("../routes/maintenance");
      const pm = await raiseDuePreventive(tx, next, A);
      step("preventive", `${pm} ticket(s)`);
      const stats = await dayStats(tx, businessDate);
      await tx.businessDate.update({ where: { date: businessDate }, data: { status: "CLOSED", closedAt: new Date(), closedById: actor.userId ?? null } });
      await tx.businessDate.upsert({ where: { date: next }, create: { date: next }, update: { status: "OPEN", closedAt: null } });
      step("businessDate", `${businessDate} → ${next}`);
      const summary = { stats, noShowReservations: noShowIds, noShowFees, roomChargeIds: chargeIds, backup: backupName };
      await tx.nightAudit.update({ where: { businessDate }, data: { status: "COMPLETED", completedAt: new Date(), steps: JSON.stringify(steps), summary: JSON.stringify(summary) } });
      await audit(tx, A, "nightAudit.completed", "NightAudit", businessDate, { after: { next, roomCharges: chargeIds.length, noShows: noShowIds.length, occupancyBp: stats.occupancyBp, roomRevenue: stats.roomRevenue } });
      return { businessDate, nextBusinessDate: next, stats, roomCharges: chargeIds.length, noShows: noShowIds.length };
    });
    publish("businessDate", "advanced", result.nextBusinessDate, actor.userId ?? undefined);
    publish("folios", "audit");
    publish("reservations", "audit");
    publish("housekeeping", "tasks");
    return result;
  } catch (e) {
    await db.nightAudit.update({ where: { businessDate }, data: { status: "FAILED", error: (e as Error).message.slice(0, 1000), steps: JSON.stringify(steps) } }).catch(() => undefined);
    throw e;
  }
}

/** Reverses the last audit while the new business date has no activity. Super Admin only. */
export async function rollbackNightAudit(db: Db, actor: AuditActor, reason: string) {
  const out = await lockedTx(db, async (tx) => {
    const cur = await tx.businessDate.findFirst({ where: { status: "OPEN" }, orderBy: { date: "desc" } });
    if (!cur) throw new ApiError(409, "NO_DATE", "No open business date");
    const last = await tx.nightAudit.findFirst({ where: { status: "COMPLETED" }, orderBy: { businessDate: "desc" } });
    if (!last) throw new ApiError(409, "NOTHING_TO_ROLLBACK", "No completed night audit to roll back");
    const activity = (await tx.folioCharge.count({ where: { businessDate: cur.date } })) + (await tx.payment.count({ where: { businessDate: cur.date } })) + (await tx.reservationRoom.count({ where: { checkedInAt: { gte: cur.openedAt } } }));
    if (activity) throw new ApiError(409, "DATE_IN_USE", `Transactions were already posted on ${cur.date}; roll back is no longer possible. Post corrections instead.`);
    const summary = parseJson<{ roomChargeIds?: string[]; noShowReservations?: string[] }>(last.summary, {});
    if (summary.roomChargeIds?.length) await tx.folioCharge.deleteMany({ where: { id: { in: summary.roomChargeIds } } });
    for (const rid of summary.noShowReservations ?? []) {
      await tx.folioCharge.deleteMany({ where: { sourceRef: `noshow:${rid}` } });
      await tx.reservationRoom.updateMany({ where: { reservationId: rid, status: "NO_SHOW" }, data: { status: "RESERVED", version: { increment: 1 } } });
      await tx.reservation.update({ where: { id: rid }, data: { status: "CONFIRMED", noShowAt: null, cancellationFee: 0, version: { increment: 1 } } });
    }
    await tx.housekeepingTask.deleteMany({ where: { businessDate: cur.date, status: "PENDING", type: "STAYOVER" } });
    await tx.businessDate.delete({ where: { date: cur.date } });
    await tx.businessDate.update({ where: { date: last.businessDate }, data: { status: "OPEN", closedAt: null, closedById: null } });
    await tx.nightAudit.update({ where: { id: last.id }, data: { status: "ROLLED_BACK", error: `Rolled back: ${reason}` } });
    await audit(tx, actor, "nightAudit.rolledBack", "NightAudit", last.businessDate, { before: { businessDate: cur.date }, after: { businessDate: last.businessDate }, reason });
    return { businessDate: last.businessDate };
  });
  publish("businessDate", "rolledBack", out.businessDate, actor.userId ?? undefined);
  return out;
}
