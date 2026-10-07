// Front desk: readiness checklist, check-in, walk-in, check-out, room move, extend, shift notes, police report.
import { z } from "zod";
import { route, type Ctx } from "../api";
import { audit, parseJson } from "../common";
import { checkIn, checkInReadiness, checkInSchema, checkOut, checkOutSchema, moveRoom, moveSchema, extendSchema } from "../services/frontdesk";
import { createReservation, reservationInputSchema, updateStay } from "../services/reservations";
import { publish } from "../events";
import { ApiError, notFound } from "../errors";
import { saveDataUrl } from "../services/files";
import { zDate } from "@/shared/schemas";

const who = (ctx: Ctx) => ({ me: ctx.user, actor: ctx.actor, businessDate: ctx.businessDate });

route("GET", "/stays/:id/checkin-readiness", { perm: "frontdesk.checkin", allowReadOnly: true }, async (ctx) => checkInReadiness(ctx.db, ctx.params.id, ctx.businessDate));

route("POST", "/stays/:id/check-in", { perm: "frontdesk.checkin" }, async (ctx) => {
  const b = await ctx.body(checkInSchema);
  if (b.deposit) ctx.need("folio.payment");
  return checkIn(ctx.db, ctx.params.id, b, who(ctx));
});

/** Walk-in: creates the reservation for today, auto-assigns (or uses) a room and checks in, in one step. */
route("POST", "/frontdesk/walk-in", { perm: "frontdesk.checkin" }, async (ctx) => {
  const raw = (await ctx.rawBody()) as Record<string, unknown>;
  const input = reservationInputSchema.parse({ ...raw, arrival: ctx.businessDate, source: "WALK_IN", status: "CONFIRMED", autoAssign: true });
  const extra = z.object({ allowDirty: z.boolean().default(false), deposit: checkInSchema.shape.deposit }).parse(raw);
  if (input.deposit || extra.deposit) ctx.need("folio.payment");
  const res = await createReservation(ctx.db, { ...input, deposit: null }, who(ctx));
  const stays = await ctx.db.reservationRoom.findMany({ where: { reservationId: res.id }, orderBy: { createdAt: "asc" } });
  const results = [];
  for (const [i, s] of stays.entries()) {
    try {
      results.push(await checkIn(ctx.db, s.id, { version: s.version, roomId: s.roomId, allowDirty: extra.allowDirty, earlyCheckInCharge: 0, deposit: i === 0 ? (extra.deposit ?? input.deposit ?? null) : null }, who(ctx)));
    } catch (e) {
      // the reservation stays (rooms reserved); the clerk can finish the check-in from the arrivals list
      return { reservationId: res.id, confirmationNo: res.confirmationNo, checkedIn: results.length, error: (e as Error).message };
    }
  }
  return { reservationId: res.id, confirmationNo: res.confirmationNo, checkedIn: results.length, folioId: results[0]?.folioId, rooms: results.map((r) => r.roomNumber) };
});

route("POST", "/stays/:id/check-out", { perm: "frontdesk.checkout" }, async (ctx) => {
  const b = await ctx.body(checkOutSchema);
  if (b.payment) ctx.need("folio.payment");
  return checkOut(ctx.db, ctx.params.id, b, who(ctx));
});

route("POST", "/stays/:id/move", { perm: "rooms.move" }, async (ctx) => {
  const b = await ctx.body(moveSchema);
  return moveRoom(ctx.db, ctx.params.id, b, who(ctx));
});

route("POST", "/stays/:id/extend", { perm: ["reservations.edit", "frontdesk.checkin"] }, async (ctx) => {
  const b = await ctx.body(extendSchema);
  return updateStay(ctx.db, ctx.params.id, { version: b.version, departure: b.departure, keepRates: true }, who(ctx));
});

/** Guest ID / photo capture (webcam or file) stored in the uploads folder, linked to the guest. */
route("POST", "/guests/:id/documents", { perm: ["guests.edit", "frontdesk.checkin"] }, async (ctx) => {
  const b = await ctx.body(z.object({ kind: z.enum(["idImage", "idImageBack", "photo"]), dataUrl: z.string().min(20).max(8_000_000) }));
  const g = await ctx.db.guest.findUnique({ where: { id: ctx.params.id } });
  if (!g) throw notFound("Guest");
  const name = await saveDataUrl(b.dataUrl, b.kind === "photo" ? "photo" : "id");
  await ctx.db.guest.update({ where: { id: g.id }, data: { [b.kind]: name, updatedById: ctx.user?.id } });
  await audit(ctx.db, ctx.actor, "guest.document", "Guest", g.id, { after: { kind: b.kind } });
  publish("guests", "updated", g.id, ctx.user?.id);
  return { file: name };
});

// ── shift handover notes ─────────────────────────────────────────────────────
route("GET", "/shift-notes", { perm: ["frontdesk.handover", "frontdesk.checkin", "housekeeping.view"], allowReadOnly: true }, async (ctx) => {
  const from = ctx.query.get("from") ?? ctx.businessDate;
  const rows = await ctx.db.shiftNote.findMany({ where: { businessDate: { gte: from } }, orderBy: { createdAt: "desc" }, take: 100 });
  return rows.map((r) => ({ ...r, acknowledgedBy: parseJson<{ userId: string; name: string; at: string }[]>(r.acknowledgedBy, []) }));
});
route("POST", "/shift-notes", { perm: "frontdesk.handover" }, async (ctx) => {
  const b = await ctx.body(z.object({ text: z.string().trim().min(1).max(4000), shift: z.enum(["", "MORNING", "EVENING", "NIGHT"]).default(""), department: z.string().max(30).default("FRONT_DESK") }));
  const me = ctx.me();
  const n = await ctx.db.shiftNote.create({ data: { ...b, businessDate: ctx.businessDate, authorId: me.id, authorName: me.fullName } });
  publish("notes", "created", n.id, me.id);
  return n;
});
route("POST", "/shift-notes/:id/ack", { perm: ["frontdesk.handover", "frontdesk.checkin", "housekeeping.view"] }, async (ctx) => {
  const me = ctx.me();
  const n = await ctx.db.shiftNote.findUnique({ where: { id: ctx.params.id } });
  if (!n) throw notFound("Note");
  const acks = parseJson<{ userId: string; name: string; at: string }[]>(n.acknowledgedBy, []);
  if (!acks.some((a) => a.userId === me.id)) acks.push({ userId: me.id, name: me.fullName, at: new Date().toISOString() });
  await ctx.db.shiftNote.update({ where: { id: n.id }, data: { acknowledgedBy: JSON.stringify(acks) } });
  publish("notes", "ack", n.id, me.id);
  return { ok: true };
});

// ── foreign guest (police / SB) report ───────────────────────────────────────
export async function policeReportRows(db: Ctx["db"], from: string, to: string) {
  const stays = await db.reservationRoom.findMany({
    where: { status: { in: ["CHECKED_IN", "CHECKED_OUT"] }, arrivalDate: { lte: to }, departureDate: { gte: from } },
    include: { guest: true, reservation: { include: { guest: true } }, room: { select: { number: true } } },
    orderBy: { arrivalDate: "asc" },
  });
  return stays
    .map((s) => ({ s, g: s.guest ?? s.reservation.guest }))
    .filter(({ g }) => g.nationality && g.nationality !== "BD")
    .map(({ s, g }) => ({
      guestName: g.fullName,
      nationality: g.nationality,
      passportNumber: g.passportNumber,
      passportExpiry: g.passportExpiry,
      visaNumber: g.visaNumber,
      visaType: g.visaType,
      visaExpiry: g.visaExpiry,
      dateOfBirth: g.dateOfBirth,
      gender: g.gender,
      occupation: g.occupation,
      arrivalFrom: g.arrivalFrom,
      arrivalDateBd: g.arrivalDateBd,
      portOfEntry: g.portOfEntry,
      purposeOfVisit: g.purposeOfVisit,
      address: g.address,
      phone: g.phone,
      room: s.room?.number ?? "",
      checkIn: s.arrivalDate,
      checkOut: s.departureDate,
      status: s.status,
      confirmationNo: s.reservation.confirmationNo,
    }));
}

route("GET", "/frontdesk/police-report", { perm: "frontdesk.police_export", allowReadOnly: true }, async (ctx) => {
  const q = z.object({ from: zDate, to: zDate }).safeParse({ from: ctx.query.get("from") ?? ctx.businessDate, to: ctx.query.get("to") ?? ctx.businessDate });
  if (!q.success) throw new ApiError(400, "VALIDATION", "Invalid dates");
  const rows = await policeReportRows(ctx.db, q.data.from, q.data.to);
  await audit(ctx.db, ctx.actor, "frontdesk.policeReport", "", "", { after: { from: q.data.from, to: q.data.to, rows: rows.length } });
  return { from: q.data.from, to: q.data.to, rows };
});
