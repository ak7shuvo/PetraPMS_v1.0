// Guest profiles: creation with normalized phone, duplicate detection, stay statistics, merging.
import type { z } from "zod";
import { normalizePhone } from "@petra/core";
import type { Db, Tx } from "../db";
import { audit, nextNumber, type AuditActor } from "../common";
import { ApiError, notFound } from "../errors";
import type { guestSchema } from "@/shared/schemas";

export type GuestInput = z.infer<typeof guestSchema>;

export function fullNameOf(g: { title?: string; firstName: string; lastName?: string }) {
  return [g.firstName, g.lastName].filter(Boolean).join(" ").trim();
}

export function cleanGuest(g: GuestInput) {
  let phone = "";
  if (g.phone) {
    const p = normalizePhone(g.phone);
    if (!p) throw new ApiError(400, "BAD_PHONE", `Phone number "${g.phone}" is not valid`, { issues: [{ path: "phone", message: "Invalid phone number" }] });
    phone = p;
  }
  return { ...g, phone, fullName: fullNameOf(g), companyId: g.companyId || null };
}

export async function createGuest(tx: Tx | Db, g: GuestInput, actor: AuditActor, businessDate: string, extra: { isDemo?: boolean; importBatchId?: string } = {}) {
  const data = cleanGuest(g);
  const code = await nextNumber(tx, "guest", businessDate);
  const guest = await tx.guest.create({ data: { ...data, code, createdById: actor.userId ?? null, ...extra } });
  if (!extra.importBatchId) await audit(tx, actor, "guest.created", "Guest", guest.id, { after: { code, fullName: guest.fullName, phone: guest.phone } });
  return guest;
}

/** Possible duplicates by phone, ID number, passport or email. */
export async function findDuplicates(db: Db | Tx, g: { phone?: string; idNumber?: string; passportNumber?: string; email?: string }, excludeId?: string) {
  const or: Record<string, string>[] = [];
  const phone = g.phone ? normalizePhone(g.phone) : null;
  if (phone) or.push({ phone });
  if (g.idNumber) or.push({ idNumber: g.idNumber });
  if (g.passportNumber) or.push({ passportNumber: g.passportNumber });
  if (g.email) or.push({ email: g.email.toLowerCase() });
  if (!or.length) return [];
  return db.guest.findMany({
    where: { OR: or, deletedAt: null, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true, code: true, fullName: true, phone: true, email: true, idNumber: true, passportNumber: true, blacklisted: true, vip: true },
    take: 10,
  });
}

export async function assertNotBlacklisted(db: Db | Tx, guestId: string) {
  const g = await db.guest.findUnique({ where: { id: guestId }, select: { blacklisted: true, blacklistReason: true, fullName: true, deletedAt: true } });
  if (!g || g.deletedAt) throw notFound("Guest");
  if (g.blacklisted) throw new ApiError(409, "GUEST_BLACKLISTED", `${g.fullName} is blacklisted${g.blacklistReason ? `: ${g.blacklistReason}` : ""}`);
}

/** Recomputes stay statistics from completed stays (called at check-out and after merges). */
export async function refreshGuestStats(tx: Tx | Db, guestId: string) {
  const stays = await tx.reservationRoom.findMany({ where: { OR: [{ guestId }, { guestId: null, reservation: { guestId } }], status: "CHECKED_OUT" }, select: { arrivalDate: true, departureDate: true, id: true } });
  const { nightsBetween } = await import("@petra/core");
  const nights = stays.reduce((a, s) => a + Math.max(0, nightsBetween(s.arrivalDate, s.departureDate)), 0);
  const folios = await tx.folio.findMany({ where: { guestId }, select: { charges: { where: { voidedAt: null }, select: { total: true } } } });
  const spend = folios.reduce((a, f) => a + f.charges.reduce((b, c) => b + c.total, 0), 0);
  const last = stays.map((s) => s.departureDate).sort().pop() ?? "";
  await tx.guest.update({ where: { id: guestId }, data: { totalStays: stays.length, totalNights: nights, totalSpend: spend, lastStayAt: last } });
}

/** Merges `fromId` into `intoId`: moves reservations, stays and folios, keeps non-empty fields, soft-deletes the source. */
export async function mergeGuests(tx: Tx, intoId: string, fromId: string, actor: AuditActor) {
  if (intoId === fromId) throw new ApiError(400, "SAME_GUEST", "Choose two different guests");
  const [into, from] = await Promise.all([tx.guest.findUnique({ where: { id: intoId } }), tx.guest.findUnique({ where: { id: fromId } })]);
  if (!into || !from || into.deletedAt || from.deletedAt) throw notFound("Guest");
  await tx.reservation.updateMany({ where: { guestId: fromId }, data: { guestId: intoId } });
  await tx.reservationRoom.updateMany({ where: { guestId: fromId }, data: { guestId: intoId } });
  await tx.folio.updateMany({ where: { guestId: fromId }, data: { guestId: intoId } });
  const fill: Record<string, unknown> = {};
  for (const k of ["phone", "email", "idType", "idNumber", "idImage", "idImageBack", "photo", "passportNumber", "passportExpiry", "visaNumber", "visaExpiry", "address", "city", "occupation", "dateOfBirth", "gender"] as const) {
    if (!into[k] && from[k]) fill[k] = from[k];
  }
  if (from.notes) fill.notes = [into.notes, from.notes].filter(Boolean).join("\n");
  if (from.preferences) fill.preferences = [into.preferences, from.preferences].filter(Boolean).join("\n");
  fill.vip = Math.max(into.vip, from.vip);
  fill.loyaltyPoints = into.loyaltyPoints + from.loyaltyPoints;
  await tx.guest.update({ where: { id: intoId }, data: fill });
  await tx.guest.update({ where: { id: fromId }, data: { deletedAt: new Date(), notes: `${from.notes}\n[merged into ${into.code}]`.trim() } });
  await refreshGuestStats(tx, intoId);
  await audit(tx, actor, "guest.merged", "Guest", intoId, { before: { from: from.code, fromName: from.fullName }, after: { into: into.code } });
}
