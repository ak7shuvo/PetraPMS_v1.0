// Reservations: create (single, multi-room, group, waitlist), modify stays (dates/room/type/occupancy — used by
// the tape chart drag & drop), room assignment, cancellation with penalty, no-show.
// Every inventory-affecting path runs inside lockedTx(db, …, "inventory") so the availability check and the
// write are atomic. Rows carry a `version` for optimistic locking across terminals.
import { z } from "zod";
import { arrivalMoment, cancellationPenalty, nightsBetween, noShowPenalty, toNightlyRates, type CancellationPolicyDef } from "@petra/core";
import type { Db, Tx } from "../db";
import { audit, nextNumber, parseJson, type AuditActor } from "../common";
import { ApiError, badRequest, notFound, versionConflict } from "../errors";
import { lockedTx } from "../lock";
import { publish } from "../events";
import { approveWith, type SessionUser } from "../auth";
import { assertAvailable, pickFreeRoom } from "./inventory";
import { quoteStay } from "./pricing";
import { assertNotBlacklisted, createGuest } from "./guests";
import { addPayment, postCharge, reservationFolio } from "./folio";
import { guestSchema, SOURCES, zDate } from "@/shared/schemas";

export const approvalSchema = z.object({ username: z.string().max(60), secret: z.string().max(200) }).nullable().optional();

export const stayInputSchema = z.object({
  roomTypeId: z.string().min(1),
  roomId: z.string().nullable().optional(),
  adults: z.number().int().min(1).max(12).default(2),
  children: z.number().int().min(0).max(12).default(0),
  extraBeds: z.number().int().min(0).max(4).default(0),
  ratePlanId: z.string().nullable().optional(),
  overrideRate: z.number().int().min(0).max(100_000_000_00).nullable().optional(),
  discountBp: z.number().int().min(0).max(10000).default(0),
  guestId: z.string().nullable().optional(),
  arrival: zDate.optional(),
  departure: zDate.optional(),
});
export type StayInput = z.infer<typeof stayInputSchema>;

export const reservationInputSchema = z
  .object({
    guestId: z.string().nullable().optional(),
    guest: guestSchema.nullable().optional(),
    companyId: z.string().nullable().optional(),
    status: z.enum(["CONFIRMED", "TENTATIVE", "WAITLIST"]).default("CONFIRMED"),
    source: z.enum(SOURCES).default("PHONE"),
    sourceRef: z.string().trim().max(60).default(""),
    agentName: z.string().trim().max(80).default(""),
    arrival: zDate,
    departure: zDate,
    rooms: z.array(stayInputSchema).min(1).max(60),
    isGroup: z.boolean().default(false),
    groupName: z.string().trim().max(120).default(""),
    eta: z.string().trim().max(10).default(""),
    specialRequests: z.string().trim().max(2000).default(""),
    notes: z.string().trim().max(2000).default(""),
    depositRequired: z.number().int().min(0).max(100_000_000_00).default(0),
    paymentTerms: z.enum(["GUEST", "COMPANY"]).default("GUEST"),
    autoAssign: z.boolean().default(false),
    deposit: z.object({ method: z.string().min(1), amount: z.number().int().min(1), reference: z.string().max(80).default("") }).nullable().optional(),
    approval: approvalSchema,
  })
  .refine((v) => v.departure > v.arrival, { message: "Departure must be after arrival", path: ["departure"] })
  .refine((v) => v.guestId || v.guest, { message: "Select or enter a guest", path: ["guestId"] });
export type ReservationInput = z.infer<typeof reservationInputSchema>;

export interface Who {
  me: SessionUser | null;
  actor: AuditActor;
  businessDate: string;
  isDemo?: boolean;
  importBatchId?: string;
  /** API-key callers (POS / import) skip interactive permission checks */
  system?: boolean;
}

/** Discount / rate override authority. Returns the approver id (if any). */
async function checkPricingAuthority(db: Db, stays: StayInput[], who: Who, approval: z.infer<typeof approvalSchema>) {
  if (who.system || !who.me) return null;
  let approver: string | null = null;
  const maxDiscount = Math.max(0, ...stays.map((s) => s.discountBp));
  if (maxDiscount > 0) {
    if (!who.me.permissions.includes("rates.discount") && !who.me.permissions.includes("rates.discount_approve")) approver = await approveWith(db, approval, "rates.discount_approve", who.me);
    else if (maxDiscount > who.me.discountLimitBp) approver = await approveWith(db, approval, "rates.discount_approve", who.me);
  }
  if (stays.some((s) => s.overrideRate !== null && s.overrideRate !== undefined)) approver = await approveWith(db, approval, "rates.override", who.me);
  return approver === who.me.id ? null : approver;
}

async function priceStayFor(tx: Tx, s: StayInput, arrival: string, departure: string) {
  const q = await quoteStay(tx, { roomTypeId: s.roomTypeId, ratePlanId: s.ratePlanId, arrival, departure, adults: s.adults, children: s.children, extraBeds: s.extraBeds, discountBp: s.discountBp, overrideRate: s.overrideRate });
  const hard = q.errors.filter((e) => !(s.overrideRate != null && (e.code === "MIN_STAY" || e.code === "MAX_STAY")));
  if (hard.length) throw new ApiError(400, "RATE_RULE", hard[0].message, { errors: hard });
  return q;
}

async function policySnapshot(tx: Tx, ratePlanId: string | null | undefined) {
  if (!ratePlanId) return "{}";
  const p = await tx.ratePlan.findUnique({ where: { id: ratePlanId }, include: { cancellationPolicy: true } });
  const c = p?.cancellationPolicy;
  return c ? JSON.stringify({ code: c.code, name: c.name, freeUntilHours: c.freeUntilHours, penaltyType: c.penaltyType, penaltyValue: c.penaltyValue, noShowType: c.noShowType }) : "{}";
}

export async function createReservation(db: Db, input: ReservationInput, who: Who) {
  const approver = await checkPricingAuthority(db, input.rooms, who, input.approval);
  const result = await lockedTx(db, (tx) => createReservationTx(tx, input, who, approver));
  publish("reservations", "created", result.id, who.actor.userId ?? undefined);
  return result;
}

/** Same as createReservation, inside the caller's (already locked) transaction. Used by imports. */
export async function createReservationTx(tx: Tx, input: ReservationInput, who: Who, approver: string | null = null) {
  {
    let guestId = input.guestId ?? null;
    if (!guestId && input.guest) guestId = (await createGuest(tx, input.guest, who.actor, who.businessDate, { isDemo: who.isDemo, importBatchId: who.importBatchId })).id;
    await assertNotBlacklisted(tx, guestId!);
    const waitlist = input.status === "WAITLIST";
    const stays = input.rooms.map((s) => ({ ...s, arrival: s.arrival ?? input.arrival, departure: s.departure ?? input.departure }));
    for (const s of stays) if (s.departure <= s.arrival) throw badRequest("Each room's departure must be after its arrival");
    if (!waitlist) {
      // auto-assign rooms when requested (walk-ins, groups)
      if (input.autoAssign) {
        const picked: string[] = stays.filter((s) => s.roomId).map((s) => s.roomId!);
        for (const s of stays) {
          if (s.roomId) continue;
          const r = await pickFreeRoom(tx, s.roomTypeId, s.arrival, s.departure, picked, [], true);
          if (r) {
            s.roomId = r.id;
            picked.push(r.id);
          }
        }
      }
      await assertAvailable(tx, stays.map((s) => ({ roomTypeId: s.roomTypeId, arrival: s.arrival, departure: s.departure, roomId: s.roomId })));
    }
    const confirmationNo = await nextNumber(tx, "reservation", who.businessDate);
    const res = await tx.reservation.create({
      data: {
        confirmationNo,
        status: input.status,
        source: input.source,
        sourceRef: input.sourceRef,
        agentName: input.agentName,
        guestId: guestId!,
        companyId: input.companyId || null,
        isGroup: input.isGroup || stays.length > 1 ? input.isGroup : false,
        groupName: input.groupName,
        arrivalDate: stays.reduce((m, s) => (s.arrival < m ? s.arrival : m), stays[0].arrival),
        departureDate: stays.reduce((m, s) => (s.departure > m ? s.departure : m), stays[0].departure),
        adults: stays.reduce((a, s) => a + s.adults, 0),
        children: stays.reduce((a, s) => a + s.children, 0),
        ratePlanId: stays[0].ratePlanId || null,
        eta: input.eta,
        specialRequests: input.specialRequests,
        notes: input.notes,
        depositRequired: input.depositRequired,
        paymentTerms: input.paymentTerms,
        cancellationPolicy: await policySnapshot(tx, stays[0].ratePlanId),
        createdById: who.actor.userId ?? null,
        isDemo: who.isDemo ?? false,
        importBatchId: who.importBatchId,
      },
    });
    let total = 0;
    for (const s of stays) {
      const q = await priceStayFor(tx, s, s.arrival, s.departure);
      total += q.total;
      await tx.reservationRoom.create({
        data: {
          reservationId: res.id,
          roomTypeId: s.roomTypeId,
          roomId: s.roomId || null,
          guestId: s.guestId || null,
          arrivalDate: s.arrival,
          departureDate: s.departure,
          adults: s.adults,
          children: s.children,
          extraBeds: s.extraBeds,
          ratePlanId: s.ratePlanId || null,
          nightlyRates: JSON.stringify(toNightlyRates(q)),
          rateOverride: s.overrideRate != null,
          discountBp: s.discountBp,
          status: waitlist ? "WAITLIST" : "RESERVED",
          isDemo: who.isDemo ?? false,
          importBatchId: who.importBatchId,
        },
      });
    }
    if (input.deposit) {
      const f = await reservationFolio(tx, res.id, who.actor, who.businessDate);
      await addPayment(tx, { folioId: f.id, type: "DEPOSIT", method: input.deposit.method, amount: input.deposit.amount, reference: input.deposit.reference, businessDate: who.businessDate, isDemo: who.isDemo }, who.actor);
    }
    if (!who.importBatchId) await audit(tx, who.actor, "reservation.created", "Reservation", res.id, { after: { confirmationNo, arrival: res.arrivalDate, departure: res.departureDate, rooms: stays.length, total, approvedBy: approver }, reason: approver ? "manager approval" : undefined });
    return { id: res.id, confirmationNo, total };
  }
}

/** Recomputes header dates/counts/status from the stays. */
export async function syncReservationHeader(tx: Tx, reservationId: string) {
  const res = await tx.reservation.findUnique({ where: { id: reservationId }, include: { rooms: true } });
  if (!res) return;
  const live = res.rooms.filter((r) => !["CANCELLED", "NO_SHOW"].includes(r.status));
  const basis = live.length ? live : res.rooms;
  const statuses = new Set(basis.map((r) => r.status));
  let status = res.status;
  if (!live.length) status = res.rooms.every((r) => r.status === "NO_SHOW") ? "NO_SHOW" : "CANCELLED";
  else if (statuses.has("CHECKED_IN")) status = "CHECKED_IN";
  else if ([...statuses].every((s) => s === "CHECKED_OUT")) status = "CHECKED_OUT";
  else if ([...statuses].every((s) => s === "WAITLIST")) status = "WAITLIST";
  else if (res.status === "WAITLIST" || res.status === "CHECKED_IN" || res.status === "CHECKED_OUT") status = "CONFIRMED";
  await tx.reservation.update({
    where: { id: reservationId },
    data: {
      status,
      arrivalDate: basis.reduce((m, s) => (s.arrivalDate < m ? s.arrivalDate : m), basis[0].arrivalDate),
      departureDate: basis.reduce((m, s) => (s.departureDate > m ? s.departureDate : m), basis[0].departureDate),
      adults: live.reduce((a, s) => a + s.adults, 0),
      children: live.reduce((a, s) => a + s.children, 0),
      version: { increment: 1 },
    },
  });
}

export const reservationPatchSchema = z.object({
  version: z.number().int(),
  companyId: z.string().nullable().optional(),
  source: z.enum(SOURCES).optional(),
  sourceRef: z.string().trim().max(60).optional(),
  agentName: z.string().trim().max(80).optional(),
  groupName: z.string().trim().max(120).optional(),
  eta: z.string().trim().max(10).optional(),
  specialRequests: z.string().trim().max(2000).optional(),
  notes: z.string().trim().max(2000).optional(),
  depositRequired: z.number().int().min(0).optional(),
  paymentTerms: z.enum(["GUEST", "COMPANY"]).optional(),
  status: z.enum(["CONFIRMED", "TENTATIVE"]).optional(),
  guestId: z.string().optional(),
});

export async function updateReservation(db: Db, id: string, patch: z.infer<typeof reservationPatchSchema>, who: Who) {
  const out = await lockedTx(db, async (tx) => {
    const before = await tx.reservation.findUnique({ where: { id } });
    if (!before) throw notFound("Reservation");
    if (before.version !== patch.version) throw versionConflict("Reservation", before);
    if (["CANCELLED", "NO_SHOW", "CHECKED_OUT"].includes(before.status) && (patch.status || patch.guestId)) throw new ApiError(409, "RES_CLOSED", `Reservation is ${before.status.toLowerCase().replace("_", " ")}`);
    if (patch.status && !["CONFIRMED", "TENTATIVE"].includes(before.status)) throw new ApiError(409, "BAD_STATUS", "Only tentative/confirmed reservations can change status this way");
    if (patch.guestId) await assertNotBlacklisted(tx, patch.guestId);
    const { version: _v, ...data } = patch;
    const after = await tx.reservation.update({ where: { id }, data: { ...data, companyId: patch.companyId === undefined ? undefined : patch.companyId || null, version: { increment: 1 }, updatedById: who.actor.userId ?? null } });
    await audit(tx, who.actor, "reservation.updated", "Reservation", id, { before, after: data });
    return after;
  });
  publish("reservations", "updated", id, who.actor.userId ?? undefined);
  return out;
}

export const stayPatchSchema = z.object({
  version: z.number().int(),
  arrival: zDate.optional(),
  departure: zDate.optional(),
  roomTypeId: z.string().optional(),
  roomId: z.string().nullable().optional(),
  adults: z.number().int().min(1).max(12).optional(),
  children: z.number().int().min(0).max(12).optional(),
  extraBeds: z.number().int().min(0).max(4).optional(),
  ratePlanId: z.string().nullable().optional(),
  overrideRate: z.number().int().min(0).nullable().optional(),
  discountBp: z.number().int().min(0).max(10000).optional(),
  guestId: z.string().nullable().optional(),
  /** keep the booked nightly rates for nights that already existed (default true) */
  keepRates: z.boolean().default(true),
  approval: approvalSchema,
});
export type StayPatch = z.infer<typeof stayPatchSchema>;

/**
 * Changes a stay. Handles tape-chart moves (dates and/or room), extensions, shortening, type changes, occupancy.
 * Checked-in stays cannot change arrival; their room changes go through moveRoom (front desk).
 */
export async function updateStay(db: Db, stayId: string, p: StayPatch, who: Who) {
  const current = await db.reservationRoom.findUnique({ where: { id: stayId } });
  if (!current) throw notFound("Stay");
  const merged: StayInput = {
    roomTypeId: p.roomTypeId ?? current.roomTypeId,
    roomId: p.roomId === undefined ? current.roomId : p.roomId,
    adults: p.adults ?? current.adults,
    children: p.children ?? current.children,
    extraBeds: p.extraBeds ?? current.extraBeds,
    ratePlanId: p.ratePlanId === undefined ? current.ratePlanId : p.ratePlanId,
    overrideRate: p.overrideRate,
    discountBp: p.discountBp ?? current.discountBp,
    guestId: p.guestId === undefined ? current.guestId : p.guestId,
  };
  const pricingChanged = p.discountBp !== undefined && p.discountBp > current.discountBp;
  const approver = await checkPricingAuthority(db, pricingChanged || p.overrideRate != null ? [merged] : [], who, p.approval);
  const out = await lockedTx(db, async (tx) => {
    const s = await tx.reservationRoom.findUnique({ where: { id: stayId } });
    if (!s) throw notFound("Stay");
    if (s.version !== p.version) throw versionConflict("Stay", s);
    if (!["RESERVED", "CHECKED_IN", "WAITLIST"].includes(s.status)) throw new ApiError(409, "STAY_CLOSED", `This stay is ${s.status.toLowerCase().replace("_", " ")} and cannot be changed`);
    const arrival = p.arrival ?? s.arrivalDate;
    const departure = p.departure ?? s.departureDate;
    if (departure <= arrival) throw badRequest("Departure must be after arrival");
    if (s.status === "CHECKED_IN") {
      if (arrival !== s.arrivalDate) throw new ApiError(409, "IN_HOUSE", "The guest is in house; arrival date cannot change");
      if (merged.roomId !== s.roomId) throw new ApiError(409, "USE_ROOM_MOVE", "Use Room Move for in-house guests");
      if (departure <= who.businessDate) throw new ApiError(400, "DEPARTURE_PAST", "Departure must be after the current business date; use check-out instead");
    } else if (s.status === "RESERVED" && arrival < who.businessDate && arrival !== s.arrivalDate) {
      throw new ApiError(400, "ARRIVAL_PAST", `Arrival cannot be before the business date ${who.businessDate}`);
    }
    if (s.status !== "WAITLIST") {
      await assertAvailable(tx, [{ roomTypeId: merged.roomTypeId, arrival: s.status === "CHECKED_IN" ? who.businessDate : arrival, departure, roomId: merged.roomId, excludeStayId: s.id }]);
    }
    // a room of another type implies an upgrade/downgrade: keep the booked room type unless explicitly changed
    if (merged.roomId && p.roomTypeId === undefined) {
      const room = await tx.room.findUnique({ where: { id: merged.roomId }, select: { roomTypeId: true } });
      if (room && room.roomTypeId !== s.roomTypeId && !p.keepRates) merged.roomTypeId = room.roomTypeId;
    }
    let nightly = parseJson<{ date: string; amount: number }[]>(s.nightlyRates, []);
    const reprice = p.roomTypeId !== undefined || p.adults !== undefined || p.children !== undefined || p.extraBeds !== undefined || p.ratePlanId !== undefined || p.overrideRate != null || p.discountBp !== undefined || !p.keepRates;
    const q = await priceStayFor(tx, merged, arrival, departure);
    if (reprice) nightly = toNightlyRates(q);
    else {
      // keep booked prices for nights that still exist, price only new nights
      const known = new Map(nightly.map((n) => [n.date, n.amount]));
      nightly = q.nights.map((n) => ({ date: n.date, amount: known.get(n.date) ?? n.amount }));
    }
    const after = await tx.reservationRoom.update({
      where: { id: s.id },
      data: {
        arrivalDate: arrival,
        departureDate: departure,
        roomTypeId: merged.roomTypeId,
        roomId: merged.roomId || null,
        adults: merged.adults,
        children: merged.children,
        extraBeds: merged.extraBeds,
        ratePlanId: merged.ratePlanId || null,
        discountBp: merged.discountBp,
        guestId: merged.guestId || null,
        rateOverride: p.overrideRate != null ? true : s.rateOverride,
        nightlyRates: JSON.stringify(nightly),
        version: { increment: 1 },
      },
    });
    await syncReservationHeader(tx, s.reservationId);
    await audit(tx, who.actor, "stay.updated", "ReservationRoom", s.id, {
      before: { arrival: s.arrivalDate, departure: s.departureDate, roomId: s.roomId, roomTypeId: s.roomTypeId, adults: s.adults, total: parseJson<{ amount: number }[]>(s.nightlyRates, []).reduce((a, n) => a + n.amount, 0) },
      after: { arrival, departure, roomId: after.roomId, roomTypeId: after.roomTypeId, adults: after.adults, total: nightly.reduce((a, n) => a + n.amount, 0), approvedBy: approver },
    });
    return after;
  });
  publish("reservations", "stayUpdated", out.reservationId, who.actor.userId ?? undefined);
  return out;
}

/** Adds a room to an existing reservation (group pickup / multi-room). */
export async function addStay(db: Db, reservationId: string, s: StayInput & { arrival: string; departure: string }, who: Who, approval?: z.infer<typeof approvalSchema>) {
  await checkPricingAuthority(db, [s], who, approval);
  const out = await lockedTx(db, async (tx) => {
    const res = await tx.reservation.findUnique({ where: { id: reservationId } });
    if (!res) throw notFound("Reservation");
    if (["CANCELLED", "NO_SHOW", "CHECKED_OUT"].includes(res.status)) throw new ApiError(409, "RES_CLOSED", "Reservation is closed");
    const waitlist = res.status === "WAITLIST";
    if (!waitlist) await assertAvailable(tx, [{ roomTypeId: s.roomTypeId, arrival: s.arrival, departure: s.departure, roomId: s.roomId }]);
    const q = await priceStayFor(tx, s, s.arrival, s.departure);
    const stay = await tx.reservationRoom.create({
      data: { reservationId, roomTypeId: s.roomTypeId, roomId: s.roomId || null, guestId: s.guestId || null, arrivalDate: s.arrival, departureDate: s.departure, adults: s.adults, children: s.children, extraBeds: s.extraBeds, ratePlanId: s.ratePlanId || null, nightlyRates: JSON.stringify(toNightlyRates(q)), rateOverride: s.overrideRate != null, discountBp: s.discountBp, status: waitlist ? "WAITLIST" : "RESERVED" },
    });
    await syncReservationHeader(tx, reservationId);
    await audit(tx, who.actor, "stay.added", "ReservationRoom", stay.id, { after: { reservation: res.confirmationNo, arrival: s.arrival, departure: s.departure, total: q.total } });
    return stay;
  });
  publish("reservations", "stayAdded", reservationId, who.actor.userId ?? undefined);
  return out;
}

/** Promotes a waitlisted reservation to confirmed when inventory allows. */
export async function confirmWaitlist(db: Db, reservationId: string, who: Who) {
  await lockedTx(db, async (tx) => {
    const res = await tx.reservation.findUnique({ where: { id: reservationId }, include: { rooms: true } });
    if (!res) throw notFound("Reservation");
    const wl = res.rooms.filter((r) => r.status === "WAITLIST");
    if (!wl.length) throw new ApiError(409, "NOT_WAITLISTED", "Nothing on the waitlist for this reservation");
    await assertAvailable(tx, wl.map((r) => ({ roomTypeId: r.roomTypeId, arrival: r.arrivalDate, departure: r.departureDate, roomId: r.roomId })));
    await tx.reservationRoom.updateMany({ where: { id: { in: wl.map((r) => r.id) } }, data: { status: "RESERVED", version: { increment: 1 } } });
    await tx.reservation.update({ where: { id: reservationId }, data: { status: "CONFIRMED" } });
    await syncReservationHeader(tx, reservationId);
    await audit(tx, who.actor, "reservation.waitlistConfirmed", "Reservation", reservationId);
  });
  publish("reservations", "updated", reservationId, who.actor.userId ?? undefined);
}

function policyOf(res: { cancellationPolicy: string }): CancellationPolicyDef | null {
  const p = parseJson<Partial<CancellationPolicyDef>>(res.cancellationPolicy, {});
  return p.penaltyType ? (p as CancellationPolicyDef) : null;
}

export async function cancellationPreview(db: Db | Tx, reservationId: string, stayIds?: string[]) {
  const res = await db.reservation.findUnique({ where: { id: reservationId }, include: { rooms: true } });
  if (!res) throw notFound("Reservation");
  const hotel = await db.hotel.findUnique({ where: { id: "hotel" } });
  const rooms = res.rooms.filter((r) => (stayIds ? stayIds.includes(r.id) : true) && ["RESERVED", "WAITLIST"].includes(r.status));
  const policy = policyOf(res);
  let penalty = 0;
  let hoursBefore = 0;
  for (const r of rooms) {
    if (r.status === "WAITLIST") continue;
    const p = cancellationPenalty(policy, arrivalMoment(r.arrivalDate, hotel?.checkInTime ?? "14:00"), Date.now(), parseJson<{ amount: number }[]>(r.nightlyRates, []).map((n) => n.amount));
    penalty += p.penalty;
    hoursBefore = p.hoursBefore;
  }
  return { penalty, hoursBefore, policy, stays: rooms.map((r) => r.id) };
}

export const cancelSchema = z.object({
  version: z.number().int(),
  reason: z.string().trim().min(2, "Enter a reason").max(500),
  stayIds: z.array(z.string()).optional(),
  waivePenalty: z.boolean().default(false),
  approval: approvalSchema,
});

export async function cancelReservation(db: Db, reservationId: string, b: z.infer<typeof cancelSchema>, who: Who) {
  if (b.waivePenalty && who.me) await approveWith(db, b.approval, "reservations.waive_penalty", who.me);
  const out = await lockedTx(db, async (tx) => {
    const res = await tx.reservation.findUnique({ where: { id: reservationId }, include: { rooms: true } });
    if (!res) throw notFound("Reservation");
    if (res.version !== b.version) throw versionConflict("Reservation", res);
    const preview = await cancellationPreview(tx, reservationId, b.stayIds);
    if (!preview.stays.length) throw new ApiError(409, "NOTHING_TO_CANCEL", "No reserved rooms to cancel (checked-in guests must check out)");
    await tx.reservationRoom.updateMany({ where: { id: { in: preview.stays } }, data: { status: "CANCELLED", roomId: null, version: { increment: 1 } } });
    const fee = b.waivePenalty ? 0 : preview.penalty;
    if (fee > 0) {
      const f = await reservationFolio(tx, reservationId, who.actor, who.businessDate);
      await postCharge(tx, { folioId: f.id, chargeCode: "CXL", amount: fee, description: `Cancellation fee ${res.confirmationNo}`, businessDate: who.businessDate, source: "SYSTEM", sourceRef: res.id, route: false }, who.actor);
    }
    await tx.reservation.update({ where: { id: reservationId }, data: { cancelReason: b.reason, cancelledAt: new Date(), cancellationFee: { increment: fee } } });
    await syncReservationHeader(tx, reservationId);
    await audit(tx, who.actor, "reservation.cancelled", "Reservation", reservationId, { before: { status: res.status }, after: { stays: preview.stays.length, fee, waived: b.waivePenalty && preview.penalty > 0 }, reason: b.reason });
    return { fee, stays: preview.stays.length };
  });
  publish("reservations", "cancelled", reservationId, who.actor.userId ?? undefined);
  return out;
}

/** Marks reserved stays arriving before `asOf` (or the given reservation) as no-show and posts the penalty. */
export async function markNoShow(tx: Tx, reservationId: string, who: Who, postPenalty = true) {
  const res = await tx.reservation.findUnique({ where: { id: reservationId }, include: { rooms: true } });
  if (!res) throw notFound("Reservation");
  const stays = res.rooms.filter((r) => r.status === "RESERVED");
  if (!stays.length) throw new ApiError(409, "NOTHING_TO_MARK", "No reserved rooms on this reservation");
  let fee = 0;
  if (postPenalty) for (const s of stays) fee += noShowPenalty(policyOf(res), parseJson<{ amount: number }[]>(s.nightlyRates, []).map((n) => n.amount));
  await tx.reservationRoom.updateMany({ where: { id: { in: stays.map((s) => s.id) } }, data: { status: "NO_SHOW", roomId: null, version: { increment: 1 } } });
  if (fee > 0) {
    const f = await reservationFolio(tx, reservationId, who.actor, who.businessDate);
    await postCharge(tx, { folioId: f.id, chargeCode: "CXL", amount: fee, description: `No-show ${res.confirmationNo}`, businessDate: who.businessDate, source: "NIGHT_AUDIT", sourceRef: `noshow:${res.id}`, route: false }, who.actor);
  }
  await tx.reservation.update({ where: { id: reservationId }, data: { noShowAt: new Date(), cancellationFee: { increment: fee } } });
  await syncReservationHeader(tx, reservationId);
  await audit(tx, who.actor, "reservation.noShow", "Reservation", reservationId, { after: { stays: stays.length, fee } });
  return { fee };
}

/** Reinstates a cancelled / no-show reservation if rooms are still available. */
export async function reinstateReservation(db: Db, reservationId: string, who: Who) {
  await lockedTx(db, async (tx) => {
    const res = await tx.reservation.findUnique({ where: { id: reservationId }, include: { rooms: true } });
    if (!res) throw notFound("Reservation");
    const dead = res.rooms.filter((r) => ["CANCELLED", "NO_SHOW"].includes(r.status));
    if (!dead.length) throw new ApiError(409, "NOT_CANCELLED", "Reservation is not cancelled");
    if (dead.some((r) => r.departureDate <= who.businessDate)) throw new ApiError(409, "IN_PAST", "The stay dates have passed; create a new reservation");
    const arrivalFix = (a: string) => (a < who.businessDate ? who.businessDate : a);
    await assertAvailable(tx, dead.map((r) => ({ roomTypeId: r.roomTypeId, arrival: arrivalFix(r.arrivalDate), departure: r.departureDate })));
    for (const r of dead) await tx.reservationRoom.update({ where: { id: r.id }, data: { status: "RESERVED", arrivalDate: arrivalFix(r.arrivalDate), version: { increment: 1 } } });
    await tx.reservation.update({ where: { id: reservationId }, data: { status: "CONFIRMED", cancelledAt: null, noShowAt: null } });
    await syncReservationHeader(tx, reservationId);
    await audit(tx, who.actor, "reservation.reinstated", "Reservation", reservationId, { reason: "reinstated" });
  });
  publish("reservations", "updated", reservationId, who.actor.userId ?? undefined);
}

export async function reservationDetail(db: Db | Tx, id: string) {
  const r = await db.reservation.findUnique({
    where: { id },
    include: {
      guest: true,
      company: { select: { id: true, code: true, name: true } },
      rooms: { include: { room: { select: { id: true, number: true, hkStatus: true } }, roomType: { select: { id: true, code: true, name: true } }, guest: { select: { id: true, fullName: true } } }, orderBy: { createdAt: "asc" } },
      folios: { select: { id: true, number: true, name: true, status: true, type: true, reservationRoomId: true, parentFolioId: true } },
    },
  });
  if (!r) throw notFound("Reservation");
  const { folioBalance } = await import("@petra/core");
  const folioRows = await db.folio.findMany({ where: { reservationId: id }, include: { charges: true, payments: true } });
  const balances = new Map(folioRows.map((f) => [f.id, folioBalance(f.charges, f.payments)]));
  const deposits = folioRows.flatMap((f) => f.payments).filter((p) => p.type === "DEPOSIT" && !p.voidedAt).reduce((a, p) => a + p.amount, 0);
  return {
    ...r,
    cancellationPolicy: parseJson(r.cancellationPolicy, {}),
    rooms: r.rooms.map((s) => {
      const nightly = parseJson<{ date: string; amount: number }[]>(s.nightlyRates, []);
      return { ...s, nightlyRates: nightly, total: nightly.reduce((a, n) => a + n.amount, 0), nights: nightsBetween(s.arrivalDate, s.departureDate) };
    }),
    folios: r.folios.map((f) => ({ ...f, balance: balances.get(f.id)?.balance ?? 0, charges: balances.get(f.id)?.charges ?? 0 })),
    deposits,
    roomTotal: r.rooms.filter((s) => !["CANCELLED", "NO_SHOW"].includes(s.status)).reduce((a, s) => a + parseJson<{ amount: number }[]>(s.nightlyRates, []).reduce((b, n) => b + n.amount, 0), 0),
  };
}
