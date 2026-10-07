// Reservation API: search, detail, create (single/group/waitlist), modify, stays, cancel, no-show, reinstate,
// confirmation document data.
import { z } from "zod";
import { route, pageArgs } from "../api";
import { parseJson } from "../common";
import {
  addStay,
  cancelReservation,
  cancellationPreview,
  cancelSchema,
  confirmWaitlist,
  createReservation,
  markNoShow,
  reinstateReservation,
  reservationDetail,
  reservationInputSchema,
  reservationPatchSchema,
  stayInputSchema,
  stayPatchSchema,
  updateReservation,
  updateStay,
} from "../services/reservations";
import { queueEventNotification } from "../services/notifications";
import { lockedTx } from "../lock";
import { publish } from "../events";
import { ApiError, notFound } from "../errors";
import { zDate } from "@/shared/schemas";
import type { Ctx } from "../api";

const who = (ctx: Ctx) => ({ me: ctx.user, actor: ctx.actor, businessDate: ctx.businessDate });

route("GET", "/reservations", { perm: "reservations.view", allowReadOnly: true }, async (ctx) => {
  const q = ctx.query;
  const { take, skip } = pageArgs(q);
  const text = (q.get("q") ?? "").trim();
  const status = q.get("status");
  const from = q.get("from");
  const to = q.get("to");
  const dateField = q.get("dateField") === "departure" ? "departureDate" : q.get("dateField") === "created" ? "createdAt" : "arrivalDate";
  const where: Record<string, unknown> = {};
  if (status) where.status = { in: status.split(",") };
  if (from || to) {
    if (dateField === "createdAt") where.createdAt = { ...(from ? { gte: new Date(from + "T00:00:00Z") } : {}), ...(to ? { lt: new Date(to + "T23:59:59Z") } : {}) };
    else where[dateField] = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
  }
  if (q.get("source")) where.source = q.get("source");
  if (q.get("companyId")) where.companyId = q.get("companyId");
  if (q.get("guestId")) where.guestId = q.get("guestId");
  if (text) {
    where.OR = [
      { confirmationNo: { contains: text.toUpperCase() } },
      { sourceRef: { contains: text } },
      { groupName: { contains: text } },
      { guest: { fullName: { contains: text } } },
      { guest: { phone: { contains: text.replace(/\D/g, "").slice(-10) || text } } },
      { rooms: { some: { room: { number: text } } } },
    ];
  }
  const [rows, total] = await Promise.all([
    ctx.db.reservation.findMany({
      where,
      take,
      skip,
      orderBy: [{ arrivalDate: q.get("order") === "desc" ? "desc" : "asc" }, { createdAt: "desc" }],
      include: { guest: { select: { id: true, fullName: true, phone: true, vip: true } }, company: { select: { name: true } }, rooms: { select: { id: true, status: true, nightlyRates: true, room: { select: { number: true } }, roomType: { select: { code: true } } } } },
    }),
    ctx.db.reservation.count({ where }),
  ]);
  return {
    total,
    rows: rows.map((r) => ({
      id: r.id,
      confirmationNo: r.confirmationNo,
      status: r.status,
      source: r.source,
      guest: r.guest,
      company: r.company?.name ?? "",
      arrivalDate: r.arrivalDate,
      departureDate: r.departureDate,
      adults: r.adults,
      children: r.children,
      isGroup: r.isGroup,
      groupName: r.groupName,
      version: r.version,
      createdAt: r.createdAt,
      rooms: r.rooms.map((s) => ({ id: s.id, status: s.status, room: s.room?.number ?? null, type: s.roomType.code })),
      total: r.rooms.filter((s) => !["CANCELLED", "NO_SHOW"].includes(s.status)).reduce((a, s) => a + parseJson<{ amount: number }[]>(s.nightlyRates, []).reduce((b, n) => b + n.amount, 0), 0),
    })),
  };
});

route("GET", "/reservations/:id", { perm: "reservations.view", allowReadOnly: true }, async (ctx) => reservationDetail(ctx.db, ctx.params.id));

route("POST", "/reservations", { perm: "reservations.create" }, async (ctx) => {
  const b = await ctx.body(reservationInputSchema);
  if (b.deposit) ctx.need("folio.payment");
  const r = await createReservation(ctx.db, b, who(ctx));
  if (b.status === "CONFIRMED") await queueEventNotification(ctx.db, "RESERVATION_CONFIRMED", r.id);
  return r;
});

route("PATCH", "/reservations/:id", { perm: "reservations.edit" }, async (ctx) => {
  const b = await ctx.body(reservationPatchSchema);
  return updateReservation(ctx.db, ctx.params.id, b, who(ctx));
});

route("POST", "/reservations/:id/stays", { perm: "reservations.edit" }, async (ctx) => {
  const b = await ctx.body(stayInputSchema.extend({ arrival: zDate, departure: zDate, approval: z.object({ username: z.string(), secret: z.string() }).nullable().optional() }));
  return addStay(ctx.db, ctx.params.id, b, who(ctx), b.approval);
});

route("PATCH", "/stays/:id", { perm: "reservations.edit" }, async (ctx) => {
  const b = await ctx.body(stayPatchSchema);
  if (b.roomId !== undefined) ctx.need("reservations.edit", "rooms.move");
  return updateStay(ctx.db, ctx.params.id, b, who(ctx));
});

route("GET", "/reservations/:id/cancel-preview", { perm: "reservations.cancel" }, async (ctx) => cancellationPreview(ctx.db, ctx.params.id, ctx.query.get("stays")?.split(",").filter(Boolean)));

route("POST", "/reservations/:id/cancel", { perm: "reservations.cancel" }, async (ctx) => {
  const b = await ctx.body(cancelSchema);
  return cancelReservation(ctx.db, ctx.params.id, b, who(ctx));
});

route("POST", "/reservations/:id/no-show", { perm: "reservations.cancel" }, async (ctx) => {
  const b = await ctx.body(z.object({ postPenalty: z.boolean().default(true) }));
  const res = await ctx.db.reservation.findUnique({ where: { id: ctx.params.id }, select: { arrivalDate: true } });
  if (!res) throw notFound("Reservation");
  if (res.arrivalDate > ctx.businessDate) throw new ApiError(409, "NOT_YET", "Arrival is in the future; cancel instead");
  const out = await lockedTx(ctx.db, (tx) => markNoShow(tx, ctx.params.id, who(ctx), b.postPenalty));
  publish("reservations", "noShow", ctx.params.id, ctx.user?.id);
  return out;
});

route("POST", "/reservations/:id/reinstate", { perm: "reservations.cancel" }, async (ctx) => {
  await reinstateReservation(ctx.db, ctx.params.id, who(ctx));
  return { ok: true };
});

route("POST", "/reservations/:id/confirm-waitlist", { perm: "reservations.edit" }, async (ctx) => {
  await confirmWaitlist(ctx.db, ctx.params.id, who(ctx));
  await queueEventNotification(ctx.db, "RESERVATION_CONFIRMED", ctx.params.id);
  return { ok: true };
});

route("POST", "/reservations/:id/resend-confirmation", { perm: "reservations.view" }, async (ctx) => {
  await queueEventNotification(ctx.db, "RESERVATION_CONFIRMED", ctx.params.id);
  return { ok: true };
});

/** Today's movement lists for the front desk. */
route("GET", "/frontdesk/lists", { perm: ["frontdesk.checkin", "frontdesk.checkout", "reservations.view"], allowReadOnly: true }, async (ctx) => {
  const d = ctx.query.get("date") ?? ctx.businessDate;
  const inc = { reservation: { select: { id: true, confirmationNo: true, eta: true, specialRequests: true, version: true, source: true, groupName: true, guest: { select: { id: true, fullName: true, phone: true, vip: true, nationality: true } }, company: { select: { name: true } } } }, room: { select: { id: true, number: true, hkStatus: true } }, roomType: { select: { code: true, name: true } }, guest: { select: { id: true, fullName: true } } } as const;
  const [arrivals, departures, inHouse] = await Promise.all([
    ctx.db.reservationRoom.findMany({ where: { arrivalDate: d, status: { in: ["RESERVED", "CHECKED_IN"] } }, include: inc, orderBy: { createdAt: "asc" } }),
    ctx.db.reservationRoom.findMany({ where: { departureDate: { lte: d }, status: "CHECKED_IN" }, include: inc, orderBy: { departureDate: "asc" } }),
    ctx.db.reservationRoom.findMany({ where: { status: "CHECKED_IN" }, include: inc, orderBy: { room: { number: "asc" } } }),
  ]);
  const map = (s: (typeof arrivals)[number]) => ({ id: s.id, version: s.version, status: s.status, arrivalDate: s.arrivalDate, departureDate: s.departureDate, adults: s.adults, children: s.children, room: s.room, roomType: s.roomType, guest: s.guest ?? s.reservation.guest, reservation: s.reservation });
  return { date: d, arrivals: arrivals.map(map), departures: departures.map(map), inHouse: inHouse.map(map) };
});

