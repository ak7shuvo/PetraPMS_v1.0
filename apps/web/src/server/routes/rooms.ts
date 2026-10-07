// Room types, rooms, blocks/out-of-order, Room Rack (live floor grid) and Tape Chart data.
import { z } from "zod";
import { addDays, eachDay, nightOccupancy } from "@petra/core";
import { route } from "../api";
import { audit, diff, parseJson } from "../common";
import { ApiError, badRequest, notFound, versionConflict } from "../errors";
import { lockedTx } from "../lock";
import { publish } from "../events";
import { availabilityGrid } from "../services/inventory";
import { roomSchema, roomTypeSchema, BLOCK_TYPES, zDate } from "@/shared/schemas";

// ── room types ─────────────────────────────────────────────────────────────
route("GET", "/room-types", { perm: ["rooms.view", "reservations.view", "rates.view"], allowReadOnly: true }, async (ctx) => {
  const rows = await ctx.db.roomType.findMany({ orderBy: [{ sortOrder: "asc" }, { code: "asc" }], include: { _count: { select: { rooms: true } } } });
  return rows.map((t) => ({ ...t, amenities: parseJson<string[]>(t.amenities, []), photos: parseJson<string[]>(t.photos, []), roomCount: t._count.rooms }));
});

route("POST", "/room-types", { perm: "rooms.manage" }, async (ctx) => {
  const b = await ctx.body(roomTypeSchema);
  const t = await ctx.db.roomType.create({ data: { ...b, amenities: JSON.stringify(b.amenities), createdById: ctx.me().id } });
  await audit(ctx.db, ctx.actor, "roomType.created", "RoomType", t.id, { after: b });
  publish("rooms", "types");
  return t;
});

route("PUT", "/room-types/:id", { perm: "rooms.manage" }, async (ctx) => {
  const b = await ctx.body(roomTypeSchema);
  const before = await ctx.db.roomType.findUnique({ where: { id: ctx.params.id } });
  if (!before) throw notFound("Room type");
  const t = await ctx.db.roomType.update({ where: { id: before.id }, data: { ...b, amenities: JSON.stringify(b.amenities), updatedById: ctx.me().id } });
  await audit(ctx.db, ctx.actor, "roomType.updated", "RoomType", t.id, diff(before as unknown as Record<string, unknown>, { ...b, amenities: JSON.stringify(b.amenities) }));
  publish("rooms", "types");
  return t;
});

route("DELETE", "/room-types/:id", { perm: "rooms.manage" }, async (ctx) => {
  const t = await ctx.db.roomType.findUnique({ where: { id: ctx.params.id }, include: { _count: { select: { rooms: true, reservedRooms: true } } } });
  if (!t) throw notFound("Room type");
  if (t._count.rooms || t._count.reservedRooms) throw new ApiError(409, "IN_USE", "This room type has rooms or reservations. Deactivate it instead.");
  await ctx.db.roomType.delete({ where: { id: t.id } });
  await audit(ctx.db, ctx.actor, "roomType.deleted", "RoomType", t.id, { before: { code: t.code, name: t.name } });
  publish("rooms", "types");
  return { ok: true };
});

route("POST", "/room-types/:id/photos", { perm: "rooms.manage" }, async (ctx) => {
  const b = await ctx.body(z.object({ photos: z.array(z.string().max(1_500_000)).max(8) }));
  for (const p of b.photos) if (!/^data:image\/(png|jpeg|webp);base64,/.test(p)) throw badRequest("Photos must be PNG, JPEG or WebP images");
  const { saveDataUrl } = await import("../services/files");
  const names = await Promise.all(b.photos.map((p) => saveDataUrl(p, "roomtype")));
  await ctx.db.roomType.update({ where: { id: ctx.params.id }, data: { photos: JSON.stringify(names) } });
  return { photos: names };
});

// ── rooms ──────────────────────────────────────────────────────────────────
route("GET", "/rooms", { perm: ["rooms.view", "housekeeping.view", "maintenance.view", "reservations.view"], allowReadOnly: true }, async (ctx) => {
  return ctx.db.room.findMany({ include: { roomType: { select: { id: true, code: true, name: true, nameBn: true } } }, orderBy: [{ floor: "asc" }, { sortOrder: "asc" }, { number: "asc" }] });
});

route("POST", "/rooms", { perm: "rooms.manage" }, async (ctx) => {
  const b = await ctx.body(roomSchema);
  const lic = await ctx.license();
  if (b.active && lic.maxRooms !== null && (await ctx.db.room.count({ where: { active: true } })) >= lic.maxRooms) throw new ApiError(403, "LICENSE_ROOMS", `Your license allows ${lic.maxRooms} active rooms`);
  const r = await ctx.db.room.create({ data: { ...b, createdById: ctx.me().id } });
  await audit(ctx.db, ctx.actor, "room.created", "Room", r.id, { after: b });
  publish("rooms", "created", r.id);
  return r;
});

/** Bulk generator (floors × rooms) also available after setup. */
route("POST", "/rooms/generate", { perm: "rooms.manage" }, async (ctx) => {
  const b = await ctx.body(z.object({ floor: z.string().trim().min(1).max(10), firstNumber: z.number().int().min(1).max(99999), count: z.number().int().min(1).max(60), roomTypeId: z.string().min(1) }));
  const lic = await ctx.license();
  const active = await ctx.db.room.count({ where: { active: true } });
  if (lic.maxRooms !== null && active + b.count > lic.maxRooms) throw new ApiError(403, "LICENSE_ROOMS", `Your license allows ${lic.maxRooms} active rooms`);
  const numbers = Array.from({ length: b.count }, (_, i) => String(b.firstNumber + i));
  const clash = await ctx.db.room.findMany({ where: { number: { in: numbers } }, select: { number: true } });
  if (clash.length) throw new ApiError(409, "DUPLICATE", `Rooms already exist: ${clash.map((c) => c.number).join(", ")}`);
  await ctx.db.room.createMany({ data: numbers.map((n, i) => ({ number: n, floor: b.floor, roomTypeId: b.roomTypeId, sortOrder: i, createdById: ctx.me().id })) });
  await audit(ctx.db, ctx.actor, "room.generated", "Room", "", { after: b });
  publish("rooms", "created");
  return { created: numbers.length };
});

route("PUT", "/rooms/:id", { perm: "rooms.manage" }, async (ctx) => {
  const b = await ctx.body(roomSchema.extend({ version: z.number().int() }));
  return lockedTx(ctx.db, async (tx) => {
    const before = await tx.room.findUnique({ where: { id: ctx.params.id } });
    if (!before) throw notFound("Room");
    if (before.version !== b.version) throw versionConflict("room", before);
    if (b.roomTypeId !== before.roomTypeId || (!b.active && before.active)) {
      const future = await tx.reservationRoom.count({ where: { roomId: before.id, status: { in: ["RESERVED", "CHECKED_IN"] }, departureDate: { gt: ctx.businessDate } } });
      if (future) throw new ApiError(409, "IN_USE", `Room ${before.number} has ${future} current or future stay(s). Move them before changing its type or deactivating it.`);
    }
    const { version: _v, ...data } = b;
    const r = await tx.room.update({ where: { id: before.id }, data: { ...data, version: { increment: 1 }, updatedById: ctx.me().id } });
    await audit(tx, ctx.actor, "room.updated", "Room", r.id, diff(before as unknown as Record<string, unknown>, data as Record<string, unknown>));
    publish("rooms", "updated", r.id);
    return r;
  });
});

route("DELETE", "/rooms/:id", { perm: "rooms.manage" }, async (ctx) => {
  const r = await ctx.db.room.findUnique({ where: { id: ctx.params.id }, include: { _count: { select: { assignments: true, hkTasks: true, tickets: true } } } });
  if (!r) throw notFound("Room");
  if (r._count.assignments || r._count.tickets) throw new ApiError(409, "IN_USE", "This room has history. Deactivate it instead.");
  await ctx.db.room.delete({ where: { id: r.id } });
  await audit(ctx.db, ctx.actor, "room.deleted", "Room", r.id, { before: { number: r.number } });
  publish("rooms", "deleted", r.id);
  return { ok: true };
});

/** Housekeeping status change (also used by the HK board). */
route("PATCH", "/rooms/:id/hk-status", { perm: ["housekeeping.update", "housekeeping.assign", "rooms.manage"] }, async (ctx) => {
  const b = await ctx.body(z.object({ hkStatus: z.enum(["CLEAN", "DIRTY", "IN_PROGRESS", "INSPECTED"]) }));
  const before = await ctx.db.room.findUnique({ where: { id: ctx.params.id } });
  if (!before) throw notFound("Room");
  if (b.hkStatus === "INSPECTED") ctx.need("housekeeping.assign");
  const r = await ctx.db.room.update({ where: { id: before.id }, data: { hkStatus: b.hkStatus, version: { increment: 1 } } });
  await audit(ctx.db, ctx.actor, "room.hk_status", "Room", r.id, { before: { hkStatus: before.hkStatus }, after: { hkStatus: b.hkStatus } });
  publish("rooms", "hk", r.id);
  publish("housekeeping", "status", r.id);
  return r;
});

// ── blocks / out of order ──────────────────────────────────────────────────
const blockSchema = z
  .object({ roomId: z.string().min(1), type: z.enum(BLOCK_TYPES), startDate: zDate, endDate: zDate, reason: z.string().trim().min(3, "Give a reason").max(300) })
  .refine((b) => b.endDate > b.startDate, { message: "End date must be after start date", path: ["endDate"] });

route("GET", "/blocks", { perm: ["rooms.view", "housekeeping.view", "maintenance.view"], allowReadOnly: true }, async (ctx) => {
  const from = ctx.query.get("from") ?? ctx.businessDate;
  return ctx.db.roomBlock.findMany({ where: { releasedAt: null, endDate: { gt: from } }, include: { room: { select: { number: true, floor: true } } }, orderBy: { startDate: "asc" } });
});

/** Creates a block only if no active stay is assigned to the room in that period. */
export async function createBlock(ctx: Parameters<Parameters<typeof route>[3]>[0], b: z.infer<typeof blockSchema>, ticketId?: string) {
  return lockedTx(ctx.db, async (tx) => {
    const room = await tx.room.findUnique({ where: { id: b.roomId } });
    if (!room) throw notFound("Room");
    const clash = await tx.reservationRoom.findFirst({ where: { roomId: b.roomId, status: { in: ["RESERVED", "CHECKED_IN"] }, arrivalDate: { lt: b.endDate }, departureDate: { gt: b.startDate } }, include: { reservation: { select: { confirmationNo: true } } } });
    if (clash) throw new ApiError(409, "ROOM_CONFLICT", `Room ${room.number} is assigned to ${clash.reservation.confirmationNo} (${clash.arrivalDate} → ${clash.departureDate}). Move the guest first.`);
    const overlap = await tx.roomBlock.findFirst({ where: { roomId: b.roomId, releasedAt: null, startDate: { lt: b.endDate }, endDate: { gt: b.startDate } } });
    if (overlap) throw new ApiError(409, "ALREADY_BLOCKED", `Room ${room.number} is already blocked from ${overlap.startDate} to ${overlap.endDate}`);
    const blk = await tx.roomBlock.create({ data: { ...b, ticketId, createdById: ctx.user?.id } });
    await audit(tx, ctx.actor, "room.blocked", "Room", room.id, { after: { ...b, number: room.number } });
    return blk;
  });
}

route("POST", "/blocks", { perm: "rooms.block" }, async (ctx) => {
  const b = await ctx.body(blockSchema);
  const blk = await createBlock(ctx, b);
  publish("rooms", "blocked", b.roomId);
  return blk;
});

route("POST", "/blocks/:id/release", { perm: "rooms.block" }, async (ctx) => {
  const blk = await ctx.db.roomBlock.findUnique({ where: { id: ctx.params.id } });
  if (!blk || blk.releasedAt) throw notFound("Block");
  // releasing today ends the block now (keeps history for past days)
  const end = blk.startDate >= ctx.businessDate ? null : ctx.businessDate;
  if (end) await ctx.db.roomBlock.update({ where: { id: blk.id }, data: { endDate: end, releasedAt: new Date() } });
  else await ctx.db.roomBlock.update({ where: { id: blk.id }, data: { releasedAt: new Date() } });
  await audit(ctx.db, ctx.actor, "room.unblocked", "Room", blk.roomId, { before: blk });
  publish("rooms", "unblocked", blk.roomId);
  return { ok: true };
});

// ── room rack & tape chart ─────────────────────────────────────────────────
export type RackStatus = "VACANT_CLEAN" | "VACANT_DIRTY" | "OCCUPIED" | "RESERVED" | "OUT_OF_ORDER" | "MAINTENANCE";

route("GET", "/rack", { perm: ["rooms.view", "housekeeping.view"], allowReadOnly: true }, async (ctx) => {
  const date = ctx.query.get("date") ?? ctx.businessDate;
  const tomorrow = addDays(date, 1);
  const [rooms, stays, blocks] = await Promise.all([
    ctx.db.room.findMany({ where: { active: true }, include: { roomType: { select: { code: true, name: true } } }, orderBy: [{ floor: "asc" }, { sortOrder: "asc" }, { number: "asc" }] }),
    ctx.db.reservationRoom.findMany({
      where: { roomId: { not: null }, status: { in: ["RESERVED", "CHECKED_IN"] }, arrivalDate: { lte: date }, departureDate: { gte: date } },
      include: { reservation: { select: { id: true, confirmationNo: true, guest: { select: { fullName: true, vip: true } }, groupName: true } }, guest: { select: { fullName: true, vip: true } } },
    }),
    ctx.db.roomBlock.findMany({ where: { releasedAt: null, startDate: { lte: date }, endDate: { gt: date } } }),
  ]);
  const out = rooms.map((r) => {
    const here = stays.filter((s) => s.roomId === r.id);
    const inHouse = here.find((s) => s.status === "CHECKED_IN" && s.departureDate >= date);
    const arriving = here.find((s) => s.status === "RESERVED" && s.arrivalDate === date);
    const departing = here.find((s) => s.departureDate === date && s.status === "CHECKED_IN");
    const block = blocks.find((b) => b.roomId === r.id);
    let status: RackStatus;
    if (block) status = block.type === "MAINTENANCE" ? "MAINTENANCE" : "OUT_OF_ORDER";
    else if (inHouse) status = "OCCUPIED";
    else if (arriving) status = "RESERVED";
    else status = r.hkStatus === "DIRTY" || r.hkStatus === "IN_PROGRESS" ? "VACANT_DIRTY" : "VACANT_CLEAN";
    const stay = inHouse ?? arriving;
    return {
      id: r.id,
      number: r.number,
      floor: r.floor,
      roomType: r.roomType,
      hkStatus: r.hkStatus,
      version: r.version,
      features: r.features,
      status,
      block: block ? { id: block.id, type: block.type, reason: block.reason, endDate: block.endDate } : null,
      stay: stay
        ? { id: stay.id, reservationId: stay.reservation.id, confirmationNo: stay.reservation.confirmationNo, guestName: stay.guest?.fullName ?? stay.reservation.guest.fullName, vip: stay.guest?.vip ?? stay.reservation.guest.vip, arrivalDate: stay.arrivalDate, departureDate: stay.departureDate, status: stay.status, adults: stay.adults, children: stay.children, groupName: stay.reservation.groupName }
        : null,
      departingToday: !!departing && departing.departureDate === date,
      arrivingToday: !!arriving,
    };
  });
  const counts = out.reduce<Record<string, number>>((a, r) => ((a[r.status] = (a[r.status] ?? 0) + 1), a), {});
  return { date, tomorrow, rooms: out, counts };
});

route("GET", "/tape-chart", { perm: "rooms.view", allowReadOnly: true }, async (ctx) => {
  const from = ctx.query.get("from") ?? addDays(ctx.businessDate, -2);
  const days = Math.min(Math.max(Number(ctx.query.get("days") ?? 21) || 21, 7), 62);
  const to = addDays(from, days - 1);
  const [rooms, stays, blocks, unassigned] = await Promise.all([
    ctx.db.room.findMany({ where: { active: true }, include: { roomType: { select: { id: true, code: true, name: true } } }, orderBy: [{ floor: "asc" }, { sortOrder: "asc" }, { number: "asc" }] }),
    ctx.db.reservationRoom.findMany({
      where: { roomId: { not: null }, status: { in: ["RESERVED", "CHECKED_IN", "CHECKED_OUT"] }, arrivalDate: { lte: to }, departureDate: { gt: from } },
      include: { reservation: { select: { id: true, confirmationNo: true, status: true, source: true, groupName: true, guest: { select: { fullName: true, vip: true } } } }, guest: { select: { fullName: true } } },
    }),
    ctx.db.roomBlock.findMany({ where: { releasedAt: null, startDate: { lte: to }, endDate: { gt: from } } }),
    ctx.db.reservationRoom.findMany({
      where: { roomId: null, status: { in: ["RESERVED"] }, arrivalDate: { lte: to }, departureDate: { gt: from } },
      include: { roomType: { select: { code: true, name: true } }, reservation: { select: { id: true, confirmationNo: true, groupName: true, guest: { select: { fullName: true } } } } },
      orderBy: { arrivalDate: "asc" },
    }),
  ]);
  const { grid } = await availabilityGrid(ctx.db, from, to);
  const occupancy = eachDay(from, to).map((d) => ({ date: d, ...nightOccupancy(grid, d) }));
  return {
    from,
    to,
    businessDate: ctx.businessDate,
    rooms: rooms.map((r) => ({ id: r.id, number: r.number, floor: r.floor, roomType: r.roomType, hkStatus: r.hkStatus })),
    stays: stays.map((s) => ({
      id: s.id,
      roomId: s.roomId,
      roomTypeId: s.roomTypeId,
      reservationId: s.reservation.id,
      confirmationNo: s.reservation.confirmationNo,
      guestName: s.guest?.fullName ?? s.reservation.guest.fullName,
      vip: s.reservation.guest.vip,
      groupName: s.reservation.groupName,
      source: s.reservation.source,
      arrivalDate: s.arrivalDate,
      departureDate: s.departureDate,
      status: s.status,
      version: s.version,
    })),
    blocks: blocks.map((b) => ({ id: b.id, roomId: b.roomId, type: b.type, startDate: b.startDate, endDate: b.endDate, reason: b.reason })),
    unassigned: unassigned.map((s) => ({ id: s.id, roomTypeId: s.roomTypeId, roomType: s.roomType, reservationId: s.reservation.id, confirmationNo: s.reservation.confirmationNo, guestName: s.reservation.guest.fullName, groupName: s.reservation.groupName, arrivalDate: s.arrivalDate, departureDate: s.departureDate, version: s.version })),
    occupancy,
  };
});

route("GET", "/availability", { perm: ["reservations.view", "rooms.view", "rates.view"], allowReadOnly: true }, async (ctx) => {
  const from = ctx.query.get("from") ?? ctx.businessDate;
  const to = ctx.query.get("to") ?? addDays(from, 13);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) throw badRequest("Invalid date range");
  const { grid } = await availabilityGrid(ctx.db, from, to);
  const types = await ctx.db.roomType.findMany({ where: { active: true }, select: { id: true, code: true, name: true, baseRate: true }, orderBy: { sortOrder: "asc" } });
  return { from, to, types, grid, days: eachDay(from, to).map((d) => ({ date: d, ...nightOccupancy(grid, d) })) };
});
