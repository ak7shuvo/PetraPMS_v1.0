// Maintenance tickets with SLA by priority, critical tickets auto-block the room, preventive schedules.
import { z } from "zod";
import { addDays } from "@petra/core";
import { route } from "../api";
import { audit, nextNumber } from "../common";
import { lockedTx } from "../lock";
import { publish } from "../events";
import { ApiError, badRequest, notFound } from "../errors";
import { getSection } from "../settings";
import { saveDataUrl } from "../services/files";
import { TICKET_CATEGORIES, TICKET_PRIORITIES, zDate } from "@/shared/schemas";
import type { Tx } from "../db";
import type { AuditActor } from "../common";

const ticketInput = z.object({
  title: z.string().trim().min(2).max(160),
  description: z.string().trim().max(2000).default(""),
  roomId: z.string().nullable().optional(),
  area: z.string().trim().max(120).default(""),
  category: z.enum(TICKET_CATEGORIES).default("GENERAL"),
  priority: z.enum(TICKET_PRIORITIES).default("MEDIUM"),
  assignedToId: z.string().nullable().optional(),
  photos: z.array(z.string().max(8_000_000)).max(4).default([]),
  blockRoom: z.boolean().optional(),
  blockUntil: zDate.optional(),
});

/** An existing photo may only be referenced by a maintenance upload name (never another file such as a guest ID scan). */
function keepUpload(name: string) {
  if (!/^mt-[a-z0-9]+-[a-f0-9]{12}\.(png|jpg|webp)$/.test(name)) throw badRequest("Invalid photo reference");
  return name;
}

export async function createTicket(t: Tx, b: z.infer<typeof ticketInput> & { scheduleId?: string }, actor: AuditActor, businessDate: string) {
  const s = await getSection(t, "maintenance");
  const number = await nextNumber(t, "maintenance", businessDate);
  const photos: string[] = [];
  for (const p of b.photos) photos.push(p.startsWith("data:") ? await saveDataUrl(p, "mt") : keepUpload(p));
  const ticket = await t.maintenanceTicket.create({
    data: { number, title: b.title, description: b.description, roomId: b.roomId || null, area: b.area, category: b.category, priority: b.priority, assignedToId: b.assignedToId || null, photos: JSON.stringify(photos), slaDueAt: new Date(Date.now() + s.slaHours[b.priority] * 3600_000), scheduleId: b.scheduleId ?? null, createdById: actor.userId ?? null },
  });
  const shouldBlock = b.roomId && (b.blockRoom ?? (b.priority === "CRITICAL" && s.autoBlockCritical));
  if (shouldBlock) {
    // block only when nobody is in the room; an occupied room is flagged instead (guest must be moved first)
    const inHouse = await t.reservationRoom.count({ where: { roomId: b.roomId!, status: "CHECKED_IN" } });
    if (!inHouse) {
      const until = b.blockUntil ?? addDays(businessDate, 1);
      const conflicts = await t.reservationRoom.count({ where: { roomId: b.roomId!, status: "RESERVED", arrivalDate: { lt: until }, departureDate: { gt: businessDate } } });
      if (conflicts) await t.reservationRoom.updateMany({ where: { roomId: b.roomId!, status: "RESERVED", arrivalDate: { lt: until }, departureDate: { gt: businessDate } }, data: { roomId: null, version: { increment: 1 } } }); // unassign: front desk re-assigns
      const block = await t.roomBlock.create({ data: { roomId: b.roomId!, type: "MAINTENANCE", startDate: businessDate, endDate: until, reason: `${number}: ${b.title}`, ticketId: ticket.id, createdById: actor.userId ?? null } });
      await t.maintenanceTicket.update({ where: { id: ticket.id }, data: { blockId: block.id } });
    }
  }
  await audit(t, actor, "maintenance.created", "MaintenanceTicket", ticket.id, { after: { number, title: b.title, priority: b.priority, room: b.roomId } });
  return ticket;
}

route("GET", "/maintenance", { perm: ["maintenance.view", "maintenance.create"], module: "maintenance", allowReadOnly: true }, async (ctx) => {
  const status = ctx.query.get("status");
  const where: Record<string, unknown> = {};
  if (status) where.status = { in: status.split(",") };
  if (ctx.query.get("mine") === "1") where.assignedToId = ctx.user!.id;
  if (ctx.query.get("roomId")) where.roomId = ctx.query.get("roomId");
  const rows = await ctx.db.maintenanceTicket.findMany({ where, include: { room: { select: { number: true } }, assignedTo: { select: { id: true, fullName: true } } }, orderBy: [{ status: "asc" }, { slaDueAt: "asc" }], take: 500 });
  const now = Date.now();
  return rows.map((r) => ({ ...r, photos: JSON.parse(r.photos) as string[], overdue: !["RESOLVED", "CLOSED"].includes(r.status) && r.slaDueAt.getTime() < now }));
});

route("POST", "/maintenance", { perm: "maintenance.create", module: "maintenance" }, async (ctx) => {
  const b = await ctx.body(ticketInput);
  if (b.blockRoom) ctx.need("rooms.block", "maintenance.manage");
  const t = await lockedTx(ctx.db, (t) => createTicket(t, b, ctx.actor, ctx.businessDate));
  publish("maintenance", "created", t.id, ctx.user?.id);
  if (t.roomId) publish("rooms", "blocked", t.roomId, ctx.user?.id);
  return t;
});

route("PATCH", "/maintenance/:id", { perm: "maintenance.manage", module: "maintenance" }, async (ctx) => {
  const b = await ctx.body(
    z.object({
      version: z.number().int(),
      status: z.enum(["OPEN", "IN_PROGRESS", "ON_HOLD", "RESOLVED", "CLOSED"]).optional(),
      assignedToId: z.string().nullable().optional(),
      priority: z.enum(TICKET_PRIORITIES).optional(),
      resolution: z.string().trim().max(2000).optional(),
      releaseBlock: z.boolean().default(true),
    }),
  );
  const out = await lockedTx(ctx.db, async (t) => {
    const before = await t.maintenanceTicket.findUnique({ where: { id: ctx.params.id } });
    if (!before) throw notFound("Ticket");
    if (before.version !== b.version) throw new ApiError(409, "VERSION_CONFLICT", "Ticket changed on another terminal", { current: before });
    if (b.status === "RESOLVED" && !(b.resolution ?? before.resolution)) throw new ApiError(400, "VALIDATION", "Describe the resolution");
    const data: Record<string, unknown> = { version: { increment: 1 } };
    if (b.status) data.status = b.status;
    if (b.assignedToId !== undefined) data.assignedToId = b.assignedToId;
    if (b.resolution !== undefined) data.resolution = b.resolution;
    if (b.priority && b.priority !== before.priority) {
      const s = await getSection(t, "maintenance");
      data.priority = b.priority;
      data.slaDueAt = new Date(before.createdAt.getTime() + s.slaHours[b.priority] * 3600_000);
    }
    if (b.status === "RESOLVED") data.resolvedAt = new Date();
    if (b.status === "CLOSED") data.closedAt = new Date();
    const after = await t.maintenanceTicket.update({ where: { id: before.id }, data });
    if ((b.status === "RESOLVED" || b.status === "CLOSED") && before.blockId && b.releaseBlock) {
      await t.roomBlock.update({ where: { id: before.blockId }, data: { releasedAt: new Date() } });
      if (before.roomId) await t.room.update({ where: { id: before.roomId }, data: { hkStatus: "DIRTY", version: { increment: 1 } } }); // needs cleaning after work
    }
    // preventive schedule: closing a scheduled ticket moves the next due date
    if (b.status === "CLOSED" && before.scheduleId) {
      const sch = await t.preventiveSchedule.findUnique({ where: { id: before.scheduleId } });
      if (sch) await t.preventiveSchedule.update({ where: { id: sch.id }, data: { nextDueDate: addDays(ctx.businessDate, sch.intervalDays) } });
    }
    await audit(t, ctx.actor, "maintenance.updated", "MaintenanceTicket", before.id, { before: { status: before.status, assignedToId: before.assignedToId }, after: data });
    return after;
  });
  publish("maintenance", "updated", out.id, ctx.user?.id);
  if (out.roomId) publish("rooms", "maintenance", out.roomId, ctx.user?.id);
  return out;
});

route("GET", "/maintenance/schedules", { perm: ["maintenance.view", "maintenance.manage"], module: "maintenance", allowReadOnly: true }, async (ctx) => ctx.db.preventiveSchedule.findMany({ orderBy: { nextDueDate: "asc" } }));

const scheduleInput = z.object({ title: z.string().trim().min(2).max(160), roomId: z.string().nullable().optional(), area: z.string().max(120).default(""), category: z.enum(TICKET_CATEGORIES).default("GENERAL"), intervalDays: z.number().int().min(1).max(730), nextDueDate: zDate, assignedToId: z.string().nullable().optional(), active: z.boolean().default(true) });
route("POST", "/maintenance/schedules", { perm: "maintenance.manage", module: "maintenance" }, async (ctx) => {
  const b = await ctx.body(scheduleInput);
  const s = await ctx.db.preventiveSchedule.create({ data: { ...b, roomId: b.roomId || null, assignedToId: b.assignedToId || null } });
  await audit(ctx.db, ctx.actor, "maintenance.scheduleCreated", "PreventiveSchedule", s.id, { after: b });
  return s;
});
route("PUT", "/maintenance/schedules/:id", { perm: "maintenance.manage", module: "maintenance" }, async (ctx) => {
  const b = await ctx.body(scheduleInput);
  const s = await ctx.db.preventiveSchedule.update({ where: { id: ctx.params.id }, data: { ...b, roomId: b.roomId || null, assignedToId: b.assignedToId || null } });
  await audit(ctx.db, ctx.actor, "maintenance.scheduleUpdated", "PreventiveSchedule", s.id, { after: b });
  return s;
});
route("DELETE", "/maintenance/schedules/:id", { perm: "maintenance.manage", module: "maintenance" }, async (ctx) => {
  await ctx.db.preventiveSchedule.delete({ where: { id: ctx.params.id } });
  await audit(ctx.db, ctx.actor, "maintenance.scheduleDeleted", "PreventiveSchedule", ctx.params.id);
  return { ok: true };
});

/** Creates tickets for preventive schedules that are due (scheduler + night audit). */
export async function raiseDuePreventive(t: Tx, businessDate: string, actor: AuditActor) {
  const due = await t.preventiveSchedule.findMany({ where: { active: true, nextDueDate: { lte: businessDate } } });
  let n = 0;
  for (const s of due) {
    const open = await t.maintenanceTicket.count({ where: { scheduleId: s.id, status: { notIn: ["RESOLVED", "CLOSED"] } } });
    if (open) continue;
    await createTicket(t, { title: `Preventive: ${s.title}`, description: `Scheduled every ${s.intervalDays} day(s)`, roomId: s.roomId, area: s.area, category: s.category as (typeof TICKET_CATEGORIES)[number], priority: "LOW", assignedToId: s.assignedToId, photos: [], scheduleId: s.id }, actor, businessDate);
    n++;
  }
  return n;
}
