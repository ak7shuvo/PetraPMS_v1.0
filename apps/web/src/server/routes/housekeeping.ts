// Housekeeping board, task assignment and status, lost & found, linen inventory.
import { z } from "zod";
import { route, type Ctx } from "../api";
import { audit, nextNumber } from "../common";
import { lockedTx, tx } from "../lock";
import { publish } from "../events";
import { ApiError, notFound } from "../errors";
import { createHkTask, generateDailyTasks, HK_TASK_STATUSES, HK_TASK_TYPES, setTaskStatus } from "../services/housekeeping";
import { HK_STATUSES } from "@/shared/schemas";

const isSup = (ctx: Ctx) => ctx.can("housekeeping.assign");

route("GET", "/housekeeping/board", { perm: "housekeeping.view", module: "housekeeping", allowReadOnly: true }, async (ctx) => {
  const d = ctx.query.get("date") ?? ctx.businessDate;
  const mine = ctx.query.get("mine") === "1" || !isSup(ctx);
  const [rooms, tasks, stays, blocks, staff] = await Promise.all([
    ctx.db.room.findMany({ where: { active: true }, orderBy: [{ floor: "asc" }, { sortOrder: "asc" }, { number: "asc" }], include: { roomType: { select: { code: true, name: true } } } }),
    ctx.db.housekeepingTask.findMany({ where: { OR: [{ businessDate: d }, { status: { in: ["PENDING", "IN_PROGRESS"] } }], ...(mine && !isSup(ctx) ? { assignedToId: ctx.user!.id } : {}) }, include: { assignedTo: { select: { id: true, fullName: true } }, room: { select: { number: true, floor: true } } }, orderBy: [{ priority: "asc" }, { createdAt: "asc" }] }),
    ctx.db.reservationRoom.findMany({ where: { roomId: { not: null }, OR: [{ status: "CHECKED_IN" }, { status: "RESERVED", arrivalDate: d }] }, select: { roomId: true, status: true, departureDate: true, arrivalDate: true, adults: true, children: true } }),
    ctx.db.roomBlock.findMany({ where: { releasedAt: null, startDate: { lte: d }, endDate: { gt: d } }, select: { roomId: true, type: true, reason: true } }),
    isSup(ctx) ? ctx.db.user.findMany({ where: { active: true, deletedAt: null, role: { permissions: { some: { permission: { code: "housekeeping.update" } } } } }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" } }) : Promise.resolve([]),
  ]);
  const occ = new Map<string, (typeof stays)[number]>();
  const arriving = new Set<string>();
  for (const s of stays) {
    if (s.status === "CHECKED_IN") occ.set(s.roomId!, s);
    else arriving.add(s.roomId!);
  }
  const blocked = new Map(blocks.map((b) => [b.roomId, b]));
  return {
    date: d,
    rooms: rooms.map((r) => {
      const s = occ.get(r.id);
      return { id: r.id, number: r.number, floor: r.floor, type: r.roomType, hkStatus: r.hkStatus, version: r.version, occupied: !!s, departing: !!s && s.departureDate <= d, arriving: arriving.has(r.id), block: blocked.get(r.id) ?? null, guests: s ? s.adults + s.children : 0 };
    }),
    tasks,
    staff,
    summary: {
      dirty: rooms.filter((r) => r.hkStatus === "DIRTY").length,
      inProgress: rooms.filter((r) => r.hkStatus === "IN_PROGRESS").length,
      clean: rooms.filter((r) => r.hkStatus === "CLEAN").length,
      inspected: rooms.filter((r) => r.hkStatus === "INSPECTED").length,
      pendingTasks: tasks.filter((t) => t.status === "PENDING").length,
    },
  };
});

route("POST", "/housekeeping/tasks", { perm: "housekeeping.assign", module: "housekeeping" }, async (ctx) => {
  const b = await ctx.body(z.object({ roomIds: z.array(z.string()).min(1).max(300), type: z.enum(HK_TASK_TYPES), priority: z.number().int().min(1).max(3).default(2), assignedToId: z.string().nullable().optional(), notes: z.string().max(500).default("") }));
  const created = await tx(ctx.db, async (t) => {
    const out = [];
    for (const roomId of b.roomIds) out.push(await createHkTask(t, { roomId, type: b.type, priority: b.priority, businessDate: ctx.businessDate, notes: b.notes, assignedToId: b.assignedToId }, ctx.actor));
    return out;
  });
  publish("housekeeping", "tasks", undefined, ctx.user?.id);
  return { created: created.length };
});

route("POST", "/housekeeping/generate", { perm: "housekeeping.assign", module: "housekeeping" }, async (ctx) => {
  const n = await tx(ctx.db, (t) => generateDailyTasks(t, ctx.businessDate, ctx.actor));
  publish("housekeeping", "tasks", undefined, ctx.user?.id);
  return { created: n };
});

route("POST", "/housekeeping/assign", { perm: "housekeeping.assign", module: "housekeeping" }, async (ctx) => {
  const b = await ctx.body(z.object({ taskIds: z.array(z.string()).min(1).max(500), assignedToId: z.string().nullable() }));
  await ctx.db.housekeepingTask.updateMany({ where: { id: { in: b.taskIds } }, data: { assignedToId: b.assignedToId, version: { increment: 1 } } });
  await audit(ctx.db, ctx.actor, "housekeeping.assigned", "HousekeepingTask", b.taskIds.join(",").slice(0, 190), { after: b });
  publish("housekeeping", "assigned", undefined, ctx.user?.id);
  return { ok: true };
});

route("POST", "/housekeeping/tasks/:id/status", { perm: ["housekeeping.update", "housekeeping.assign"], module: "housekeeping" }, async (ctx) => {
  const b = await ctx.body(z.object({ status: z.enum(HK_TASK_STATUSES), version: z.number().int().optional(), notes: z.string().max(500).optional() }));
  const t = await lockedTx(ctx.db, (t) => setTaskStatus(t, ctx.params.id, b.status, ctx.actor, { version: b.version, notes: b.notes, isSupervisor: isSup(ctx) }), "inventory");
  publish("housekeeping", "status", t.id, ctx.user?.id);
  publish("rooms", "hk", t.roomId, ctx.user?.id);
  return t;
});

/** Quick room status change from the board / rack (supervisors), or by housekeepers for their rooms. */
route("POST", "/housekeeping/rooms/:id/status", { perm: ["housekeeping.update", "housekeeping.assign"], module: "housekeeping" }, async (ctx) => {
  const b = await ctx.body(z.object({ hkStatus: z.enum(HK_STATUSES), version: z.number().int().optional() }));
  if (b.hkStatus === "INSPECTED" && !isSup(ctx)) throw new ApiError(403, "FORBIDDEN", "Only a supervisor can mark a room inspected", { permission: "housekeeping.assign" });
  const r = await ctx.db.room.findUnique({ where: { id: ctx.params.id } });
  if (!r) throw notFound("Room");
  if (b.version !== undefined && r.version !== b.version) throw new ApiError(409, "VERSION_CONFLICT", "Room status changed on another terminal", { current: r });
  if (!isSup(ctx)) {
    const mine = await ctx.db.housekeepingTask.count({ where: { roomId: r.id, assignedToId: ctx.user!.id, status: { in: ["PENDING", "IN_PROGRESS", "DONE"] } } });
    if (!mine) throw new ApiError(403, "NOT_YOUR_ROOM", "This room is not assigned to you");
  }
  await ctx.db.room.update({ where: { id: r.id }, data: { hkStatus: b.hkStatus, version: { increment: 1 } } });
  if (["CLEAN", "INSPECTED"].includes(b.hkStatus)) await ctx.db.housekeepingTask.updateMany({ where: { roomId: r.id, status: { in: ["PENDING", "IN_PROGRESS"] }, type: { in: ["CHECKOUT_CLEAN", "DEEP_CLEAN", "STAYOVER"] } }, data: { status: b.hkStatus === "INSPECTED" ? "INSPECTED" : "DONE", completedAt: new Date() } });
  await audit(ctx.db, ctx.actor, "room.hkStatus", "Room", r.id, { before: { hkStatus: r.hkStatus }, after: { hkStatus: b.hkStatus } });
  publish("rooms", "hk", r.id, ctx.user?.id);
  publish("housekeeping", "status", r.id, ctx.user?.id);
  return { ok: true };
});

// ── lost & found ─────────────────────────────────────────────────────────────
route("GET", "/lost-found", { perm: ["housekeeping.lostfound", "frontdesk.checkin"], allowReadOnly: true }, async (ctx) =>
  ctx.db.lostFound.findMany({ where: ctx.query.get("status") ? { status: ctx.query.get("status")! } : {}, include: { room: { select: { number: true } } }, orderBy: { foundAt: "desc" }, take: 300 }),
);
route("POST", "/lost-found", { perm: "housekeeping.lostfound" }, async (ctx) => {
  const b = await ctx.body(z.object({ description: z.string().trim().min(2).max(300), roomId: z.string().nullable().optional(), location: z.string().max(120).default(""), foundBy: z.string().max(80).default(""), guestName: z.string().max(120).default(""), notes: z.string().max(500).default("") }));
  const item = await tx(ctx.db, async (t) => t.lostFound.create({ data: { ...b, roomId: b.roomId || null, itemNo: await nextNumber(t, "lostfound", ctx.businessDate), createdById: ctx.user?.id } }));
  await audit(ctx.db, ctx.actor, "lostfound.created", "LostFound", item.id, { after: b });
  return item;
});
route("PATCH", "/lost-found/:id", { perm: "housekeeping.lostfound" }, async (ctx) => {
  const b = await ctx.body(z.object({ status: z.enum(["STORED", "RETURNED", "DISPOSED"]), returnedTo: z.string().max(120).default(""), notes: z.string().max(500).optional() }));
  if (b.status === "RETURNED" && !b.returnedTo) throw new ApiError(400, "VALIDATION", "Enter who received the item");
  const item = await ctx.db.lostFound.update({ where: { id: ctx.params.id }, data: { status: b.status, returnedTo: b.returnedTo, returnedAt: b.status === "RETURNED" ? new Date() : null, ...(b.notes !== undefined ? { notes: b.notes } : {}) } });
  await audit(ctx.db, ctx.actor, "lostfound.updated", "LostFound", item.id, { after: b });
  return item;
});

// ── linen ────────────────────────────────────────────────────────────────────
route("GET", "/linen", { perm: ["housekeeping.linen", "housekeeping.view"], allowReadOnly: true }, async (ctx) => ctx.db.linenItem.findMany({ orderBy: { name: "asc" } }));
route("POST", "/linen", { perm: "housekeeping.linen" }, async (ctx) => {
  const b = await ctx.body(z.object({ code: z.string().trim().min(1).max(20).toUpperCase(), name: z.string().trim().min(1).max(80), par: z.number().int().min(0).default(0), inStore: z.number().int().min(0).default(0) }));
  return ctx.db.linenItem.create({ data: b });
});
/** Linen movement: store→use (issue), use→laundry (collect), laundry→store (return), any→damaged. */
route("POST", "/linen/:id/move", { perm: "housekeeping.linen" }, async (ctx) => {
  const b = await ctx.body(z.object({ from: z.enum(["inStore", "inUse", "inLaundry", "damaged"]), to: z.enum(["inStore", "inUse", "inLaundry", "damaged"]), qty: z.number().int().min(1).max(10000) }));
  if (b.from === b.to) throw new ApiError(400, "VALIDATION", "Choose different locations");
  const out = await tx(ctx.db, async (t) => {
    const it = await t.linenItem.findUnique({ where: { id: ctx.params.id } });
    if (!it) throw notFound("Linen item");
    if (it[b.from] < b.qty) throw new ApiError(409, "INSUFFICIENT", `Only ${it[b.from]} available`);
    return t.linenItem.update({ where: { id: it.id }, data: { [b.from]: { decrement: b.qty }, [b.to]: { increment: b.qty } } });
  });
  await audit(ctx.db, ctx.actor, "linen.moved", "LinenItem", out.id, { after: b });
  return out;
});
