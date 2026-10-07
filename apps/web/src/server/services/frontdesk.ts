// Front desk operations: check-in (with ID capture), walk-in, check-out with settlement, room move, early
// check-in / late check-out charges.
import { z } from "zod";
import { folioBalance, nightsBetween } from "@petra/core";
import type { Db, Tx } from "../db";
import { audit, parseJson } from "../common";
import { ApiError, notFound, versionConflict } from "../errors";
import { lockedTx } from "../lock";
import { publish } from "../events";
import { getSection } from "../settings";
import { approveWith, type SessionUser } from "../auth";
import { assertAvailable, pickFreeRoom } from "./inventory";
import { addPayment, postCharge, primaryFolioForStay, transferToCityLedger } from "./folio";
import { assertNotBlacklisted, refreshGuestStats } from "./guests";
import { syncReservationHeader, approvalSchema } from "./reservations";
import { createHkTask } from "./housekeeping";
import { queueEventNotification } from "./notifications";
import { zDate } from "@/shared/schemas";


interface Who {
  me: SessionUser | null;
  actor: { userId?: string | null; username?: string; ip?: string; terminalId?: string; businessDate?: string };
  businessDate: string;
  isDemo?: boolean;
}

export const checkInSchema = z.object({
  version: z.number().int(),
  roomId: z.string().nullable().optional(),
  allowDirty: z.boolean().default(false),
  earlyCheckInCharge: z.number().int().min(0).default(0),
  deposit: z.object({ method: z.string().min(1), amount: z.number().int().min(1), reference: z.string().max(80).default("") }).nullable().optional(),
  approval: approvalSchema,
});

/** What's missing before a stay can be checked in (shown as a checklist in the UI). */
export async function checkInReadiness(db: Db | Tx, stayId: string, businessDate: string) {
  const s = await db.reservationRoom.findUnique({ where: { id: stayId }, include: { reservation: { include: { guest: true } }, guest: true, room: true } });
  if (!s) throw notFound("Stay");
  const fd = await getSection(db, "frontdesk");
  const g = s.guest ?? s.reservation.guest;
  const foreign = g.nationality && g.nationality !== "BD";
  const issues: { code: string; message: string; blocking: boolean }[] = [];
  if (s.status !== "RESERVED") issues.push({ code: "STATUS", message: `Stay is ${s.status.toLowerCase().replace("_", " ")}`, blocking: true });
  if (s.arrivalDate > businessDate) issues.push({ code: "FUTURE", message: `Arrival is ${s.arrivalDate}; change the arrival date to check in early`, blocking: true });
  if (s.departureDate <= businessDate) issues.push({ code: "PAST", message: "Departure date has passed", blocking: true });
  if (g.blacklisted) issues.push({ code: "BLACKLISTED", message: `Guest is blacklisted: ${g.blacklistReason}`, blocking: true });
  if (fd.requireIdForCheckIn) {
    if (foreign && !g.passportNumber) issues.push({ code: "PASSPORT", message: "Passport number is required for foreign guests", blocking: true });
    if (!foreign && !(g.idType && g.idNumber)) issues.push({ code: "ID", message: "Guest ID (NID / passport / driving licence) is required", blocking: true });
  }
  if (foreign && !g.visaNumber) issues.push({ code: "VISA", message: "Visa details are missing (needed for the police report)", blocking: false });
  if (!s.roomId) issues.push({ code: "ROOM", message: "No room assigned", blocking: !fd.autoAssignRoom });
  else if (s.room && !["CLEAN", "INSPECTED"].includes(s.room.hkStatus)) issues.push({ code: "DIRTY", message: `Room ${s.room.number} is ${s.room.hkStatus.toLowerCase().replace("_", " ")}`, blocking: false });
  if (fd.requireDepositAtCheckIn && s.reservation.depositRequired > 0) {
    const folios = await db.folio.findMany({ where: { reservationId: s.reservationId }, include: { payments: true } });
    const paid = folios.flatMap((f) => f.payments).filter((p) => !p.voidedAt && p.type !== "REFUND").reduce((a, p) => a + p.amount, 0);
    if (paid < s.reservation.depositRequired) issues.push({ code: "DEPOSIT", message: `Deposit of ${(s.reservation.depositRequired / 100).toFixed(2)} required (received ${(paid / 100).toFixed(2)})`, blocking: false });
  }
  return { ready: !issues.some((i) => i.blocking), issues, foreign: !!foreign };
}

export async function checkIn(db: Db, stayId: string, b: z.infer<typeof checkInSchema>, who: Who) {
  const out = await lockedTx(db, async (tx) => {
    const s = await tx.reservationRoom.findUnique({ where: { id: stayId }, include: { reservation: true } });
    if (!s) throw notFound("Stay");
    if (s.version !== b.version) throw versionConflict("Stay", s);
    let roomId = b.roomId ?? s.roomId;
    if (roomId !== s.roomId || !roomId) {
      if (!roomId) {
        const r = await pickFreeRoom(tx, s.roomTypeId, s.arrivalDate < who.businessDate ? who.businessDate : s.arrivalDate, s.departureDate, [], [s.id], true);
        if (!r) throw new ApiError(409, "NO_ROOM", "No free room of this type; assign a room manually");
        roomId = r.id;
      }
      await assertAvailable(tx, [{ roomTypeId: s.roomTypeId, roomId, arrival: who.businessDate > s.arrivalDate ? who.businessDate : s.arrivalDate, departure: s.departureDate, excludeStayId: s.id }]);
      await tx.reservationRoom.update({ where: { id: s.id }, data: { roomId } });
    }
    const ready = await checkInReadiness(tx, stayId, who.businessDate);
    const blocking = ready.issues.filter((i) => i.blocking && i.code !== "ROOM");
    if (blocking.length) throw new ApiError(409, "CHECKIN_BLOCKED", blocking.map((i) => i.message).join("; "), { issues: ready.issues });
    await assertNotBlacklisted(tx, s.guestId ?? s.reservation.guestId);
    const room = await tx.room.findUniqueOrThrow({ where: { id: roomId! } });
    if (!["CLEAN", "INSPECTED"].includes(room.hkStatus) && !b.allowDirty) throw new ApiError(409, "ROOM_NOT_READY", `Room ${room.number} is not clean (${room.hkStatus.toLowerCase()}). Confirm to check in anyway.`, { roomId: room.id, hkStatus: room.hkStatus });
    // in-house occupant check (physical room)
    const occupant = await tx.reservationRoom.findFirst({ where: { roomId: room.id, status: "CHECKED_IN", id: { not: s.id } } });
    if (occupant) throw new ApiError(409, "ROOM_OCCUPIED", `Room ${room.number} is still occupied; check out the previous guest first`);
    const arrival = s.arrivalDate < who.businessDate ? who.businessDate : s.arrivalDate;
    let nightly = parseJson<{ date: string; amount: number }[]>(s.nightlyRates, []);
    if (arrival !== s.arrivalDate) nightly = nightly.filter((n) => n.date >= arrival);
    const after = await tx.reservationRoom.update({ where: { id: s.id }, data: { status: "CHECKED_IN", checkedInAt: new Date(), arrivalDate: arrival, nightlyRates: JSON.stringify(nightly), earlyCheckIn: b.earlyCheckInCharge > 0, version: { increment: 1 } } });
    const folio = await primaryFolioForStay(tx, s.id, who.actor, who.businessDate);
    // deposits taken on the reservation folio before check-in stay where they are (same reservation); move them
    // to this stay's folio if the reservation folio belongs to no stay
    await tx.folio.updateMany({ where: { reservationId: s.reservationId, reservationRoomId: null }, data: { reservationRoomId: s.id } });
    if (b.earlyCheckInCharge > 0) await postCharge(tx, { folioId: folio.id, chargeCode: "ECI", amount: b.earlyCheckInCharge, businessDate: who.businessDate, reservationRoomId: s.id, roomNumber: room.number, source: "SYSTEM", description: "Early check-in" }, who.actor);
    if (b.deposit) await addPayment(tx, { folioId: folio.id, type: "DEPOSIT", method: b.deposit.method, amount: b.deposit.amount, reference: b.deposit.reference, businessDate: who.businessDate }, who.actor);
    await syncReservationHeader(tx, s.reservationId);
    await audit(tx, who.actor, "frontdesk.checkIn", "ReservationRoom", s.id, { after: { room: room.number, reservation: s.reservation.confirmationNo, folio: folio.number } });
    await queueEventNotification(tx, "CHECKED_IN", s.reservationId);
    return { stay: after, folioId: folio.id, roomNumber: room.number };
  });
  publish("reservations", "checkedIn", out.stay.reservationId, who.actor.userId ?? undefined);
  publish("rooms", "occupied", out.stay.roomId ?? undefined, who.actor.userId ?? undefined);
  return out;
}

export const checkOutSchema = z.object({
  version: z.number().int(),
  /** settle the remaining balance with this payment */
  payment: z.object({ method: z.string().min(1), amount: z.number().int().min(1), reference: z.string().max(80).default("") }).nullable().optional(),
  /** move the remaining balance to the company's city ledger */
  cityLedgerCompanyId: z.string().nullable().optional(),
  lateCheckOutCharge: z.number().int().min(0).default(0),
  /** allow early departure: shorten the stay to today */
  early: z.boolean().default(false),
  approval: approvalSchema,
});

export async function checkOut(db: Db, stayId: string, b: z.infer<typeof checkOutSchema>, who: Who) {
  const fd = await getSection(db, "frontdesk");
  const out = await lockedTx(db, async (tx) => {
    const s = await tx.reservationRoom.findUnique({ where: { id: stayId }, include: { reservation: true, room: true } });
    if (!s) throw notFound("Stay");
    if (s.version !== b.version) throw versionConflict("Stay", s);
    if (s.status !== "CHECKED_IN") throw new ApiError(409, "NOT_IN_HOUSE", "Guest is not checked in");
    if (s.departureDate > who.businessDate) {
      if (!b.early) throw new ApiError(409, "EARLY_DEPARTURE", `Scheduled departure is ${s.departureDate}. Confirm early departure to check out today.`, { departureDate: s.departureDate });
    }
    const folio = await primaryFolioForStay(tx, s.id, who.actor, who.businessDate);
    if (b.lateCheckOutCharge > 0) await postCharge(tx, { folioId: folio.id, chargeCode: "LCO", amount: b.lateCheckOutCharge, businessDate: who.businessDate, reservationRoomId: s.id, roomNumber: s.room?.number ?? "", source: "SYSTEM", description: "Late check-out" }, who.actor);
    if (b.payment) await addPayment(tx, { folioId: folio.id, type: "PAYMENT", method: b.payment.method, amount: b.payment.amount, reference: b.payment.reference, businessDate: who.businessDate }, who.actor);
    const folios = await tx.folio.findMany({ where: { reservationRoomId: s.id, cityLedger: false, status: { not: "CLOSED" } }, include: { charges: true, payments: true } });
    let open = folios.map((f) => ({ f, bal: folioBalance(f.charges, f.payments).balance }));
    if (b.cityLedgerCompanyId) {
      if (who.me && !who.me.permissions.includes("frontdesk.checkout_balance")) await approveWith(db, b.approval, "frontdesk.checkout_balance", who.me);
      for (const o of open.filter((x) => x.bal > 0)) await transferToCityLedger(tx, o.f.id, b.cityLedgerCompanyId, who.actor, who.businessDate);
      open = open.filter((x) => x.bal <= 0);
    }
    const due = open.filter((x) => x.bal > 0);
    if (due.length && !fd.allowCheckoutWithBalance) {
      const total = due.reduce((a, x) => a + x.bal, 0);
      throw new ApiError(409, "BALANCE_DUE", `Balance due ${(total / 100).toFixed(2)} on folio ${due.map((x) => x.f.number).join(", ")}. Take payment or transfer to city ledger.`, { balance: total, folios: due.map((x) => ({ id: x.f.id, number: x.f.number, balance: x.bal })) });
    }
    const credit = open.filter((x) => x.bal < 0);
    if (credit.length) {
      const total = credit.reduce((a, x) => a - x.bal, 0);
      throw new ApiError(409, "REFUND_DUE", `The guest has a credit of ${(total / 100).toFixed(2)}. Refund it before check-out.`, { credit: total, folios: credit.map((x) => ({ id: x.f.id, number: x.f.number, balance: x.bal })) });
    }
    for (const o of open) if (o.bal === 0) await tx.folio.update({ where: { id: o.f.id }, data: { status: "SETTLED", closedAt: new Date(), version: { increment: 1 } } });
    const departure = s.departureDate > who.businessDate ? who.businessDate : s.departureDate;
    let nightly = parseJson<{ date: string; amount: number }[]>(s.nightlyRates, []);
    nightly = nightly.filter((n) => n.date < departure);
    // same-day check-in/out keeps one night's price on record for reporting
    const after = await tx.reservationRoom.update({ where: { id: s.id }, data: { status: "CHECKED_OUT", checkedOutAt: new Date(), departureDate: departure > s.arrivalDate ? departure : s.departureDate, nightlyRates: JSON.stringify(nightly), lateCheckOut: b.lateCheckOutCharge > 0 ? "Y" : "", version: { increment: 1 } } });
    if (s.roomId) {
      await tx.room.update({ where: { id: s.roomId }, data: { hkStatus: "DIRTY", version: { increment: 1 } } });
      await createHkTask(tx, { roomId: s.roomId, type: "CHECKOUT_CLEAN", priority: 1, businessDate: who.businessDate, notes: `Departure ${s.reservation.confirmationNo}` }, who.actor);
    }
    await syncReservationHeader(tx, s.reservationId);
    await refreshGuestStats(tx, s.guestId ?? s.reservation.guestId);
    await audit(tx, who.actor, "frontdesk.checkOut", "ReservationRoom", s.id, { after: { room: s.room?.number, early: s.departureDate > who.businessDate, nights: nightsBetween(after.arrivalDate, after.departureDate) } });
    await queueEventNotification(tx, "CHECKED_OUT", s.reservationId);
    return { stay: after, folioId: folio.id };
  });
  publish("reservations", "checkedOut", out.stay.reservationId, who.actor.userId ?? undefined);
  publish("rooms", "vacated", out.stay.roomId ?? undefined, who.actor.userId ?? undefined);
  publish("housekeeping", "task", undefined, who.actor.userId ?? undefined);
  return out;
}

export const moveSchema = z.object({ version: z.number().int(), toRoomId: z.string().min(1), reason: z.string().trim().min(2).max(300), reprice: z.boolean().default(false) });

/** Moves an in-house guest (or assigned reservation) to another room for the rest of the stay. */
export async function moveRoom(db: Db, stayId: string, b: z.infer<typeof moveSchema>, who: Who) {
  const out = await lockedTx(db, async (tx) => {
    const s = await tx.reservationRoom.findUnique({ where: { id: stayId }, include: { room: true } });
    if (!s) throw notFound("Stay");
    if (s.version !== b.version) throw versionConflict("Stay", s);
    if (s.status !== "CHECKED_IN") throw new ApiError(409, "NOT_IN_HOUSE", "Room moves are for in-house guests. Edit the reservation to change an assigned room.");
    if (s.roomId === b.toRoomId) throw new ApiError(400, "SAME_ROOM", "Choose a different room");
    const to = await tx.room.findUnique({ where: { id: b.toRoomId } });
    if (!to) throw notFound("Room");
    await assertAvailable(tx, [{ roomTypeId: to.roomTypeId, roomId: to.id, arrival: who.businessDate, departure: s.departureDate, excludeStayId: s.id }]);
    const occupant = await tx.reservationRoom.findFirst({ where: { roomId: to.id, status: "CHECKED_IN" } });
    if (occupant) throw new ApiError(409, "ROOM_OCCUPIED", `Room ${to.number} is occupied`);
    let nightly = parseJson<{ date: string; amount: number }[]>(s.nightlyRates, []);
    if (b.reprice) {
      const { quoteStay } = await import("./pricing");
      const q = await quoteStay(tx, { roomTypeId: to.roomTypeId, ratePlanId: s.ratePlanId, arrival: who.businessDate, departure: s.departureDate, adults: s.adults, children: s.children, extraBeds: s.extraBeds, discountBp: s.discountBp });
      const fresh = new Map(q.nights.map((n) => [n.date, n.amount]));
      nightly = nightly.map((n) => (fresh.has(n.date) ? { date: n.date, amount: fresh.get(n.date)! } : n));
    }
    const after = await tx.reservationRoom.update({ where: { id: s.id }, data: { roomId: to.id, roomTypeId: b.reprice ? to.roomTypeId : s.roomTypeId, nightlyRates: JSON.stringify(nightly), version: { increment: 1 } } });
    await tx.roomMove.create({ data: { reservationRoomId: s.id, fromRoomId: s.roomId, toRoomId: to.id, businessDate: who.businessDate, reason: b.reason, movedById: who.actor.userId ?? null } });
    if (s.roomId) {
      await tx.room.update({ where: { id: s.roomId }, data: { hkStatus: "DIRTY", version: { increment: 1 } } });
      await createHkTask(tx, { roomId: s.roomId, type: "CHECKOUT_CLEAN", priority: 1, businessDate: who.businessDate, notes: `Room move to ${to.number}` }, who.actor);
    }
    await audit(tx, who.actor, "frontdesk.roomMove", "ReservationRoom", s.id, { before: { room: s.room?.number }, after: { room: to.number, repriced: b.reprice }, reason: b.reason });
    return after;
  });
  publish("rooms", "moved", undefined, who.actor.userId ?? undefined);
  publish("reservations", "stayUpdated", out.reservationId, who.actor.userId ?? undefined);
  return out;
}

export const extendSchema = z.object({ version: z.number().int(), departure: zDate });
