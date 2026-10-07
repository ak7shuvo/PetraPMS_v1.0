// Loads inventory from the database and evaluates availability with @petra/core.
// Always call the check-and-write paths inside lockedTx() (server/lock.ts).
import { addDays, checkAvailability, computeAvailability, freeRooms, roomConflicts, type AvailabilityGrid, type InvBlock, type InvRoom, type InvStay, type Shortfall } from "@petra/core";
import type { Db, Tx } from "../db";
import { ApiError } from "../errors";

export interface Inventory {
  rooms: (InvRoom & { number: string; floor: string })[];
  stays: InvStay[];
  blocks: InvBlock[];
  roomTypeIds: string[];
}

/** Inventory overlapping [from, to] (inclusive dates). */
export async function loadInventory(db: Db | Tx, from: string, to: string): Promise<Inventory> {
  const toExclusive = addDays(to, 1);
  const [types, rooms, stays, blocks] = await Promise.all([
    db.roomType.findMany({ select: { id: true } }),
    db.room.findMany({ select: { id: true, number: true, floor: true, roomTypeId: true, active: true } }),
    db.reservationRoom.findMany({
      where: { status: { in: ["RESERVED", "CHECKED_IN"] }, arrivalDate: { lt: toExclusive }, departureDate: { gt: from } },
      select: { id: true, roomTypeId: true, roomId: true, arrivalDate: true, departureDate: true, status: true },
    }),
    db.roomBlock.findMany({ where: { releasedAt: null, startDate: { lt: toExclusive }, endDate: { gt: from } }, select: { id: true, roomId: true, startDate: true, endDate: true, type: true } }),
  ]);
  return { rooms, stays, blocks, roomTypeIds: types.map((t) => t.id) };
}

export async function availabilityGrid(db: Db | Tx, from: string, to: string, excludeStayIds: string[] = []): Promise<{ grid: AvailabilityGrid; inv: Inventory }> {
  const inv = await loadInventory(db, from, to);
  return { grid: computeAvailability({ ...inv, from, to, excludeStayIds }), inv };
}

export interface StayRequest {
  roomTypeId: string;
  arrival: string;
  departure: string;
  roomId?: string | null;
  excludeStayId?: string;
}

/**
 * Throws a 409 NO_AVAILABILITY / ROOM_CONFLICT if the requested stays do not fit. Checks both room-type
 * inventory per night and, for stays with a specific room, that the physical room is free and not blocked.
 */
export async function assertAvailable(db: Db | Tx, requests: StayRequest[], roomTypeNames?: Map<string, string>) {
  if (!requests.length) return;
  const from = requests.reduce((m, r) => (r.arrival < m ? r.arrival : m), requests[0].arrival);
  const to = addDays(
    requests.reduce((m, r) => (r.departure > m ? r.departure : m), requests[0].departure),
    -1,
  );
  const exclude = requests.map((r) => r.excludeStayId).filter((x): x is string => !!x);
  const { grid, inv } = await availabilityGrid(db, from, to, exclude);
  const roomTypeOf = new Map(inv.rooms.map((r) => [r.id, r.roomTypeId]));
  const roomNumber = new Map(inv.rooms.map((r) => [r.id, r.number]));
  // a stay assigned to a room consumes that room's type (upgrades)
  const shortfalls: Shortfall[] = checkAvailability(
    grid,
    requests.map((r) => ({ roomTypeId: r.roomId ? (roomTypeOf.get(r.roomId) ?? r.roomTypeId) : r.roomTypeId, arrival: r.arrival, departure: r.departure })),
  );
  if (shortfalls.length) {
    const s = shortfalls[0];
    const name = roomTypeNames?.get(s.roomTypeId) ?? (await db.roomType.findUnique({ where: { id: s.roomTypeId }, select: { name: true } }))?.name ?? "room type";
    throw new ApiError(409, "NO_AVAILABILITY", `No ${name} available on ${s.date} (requested ${s.requested}, available ${Math.max(0, s.available)}). Overbooking is not allowed.`, { shortfalls });
  }
  // physical rooms: inactive, blocked, or double-assigned (also within this request set)
  const claimed: { roomId: string; arrival: string; departure: string }[] = [];
  for (const r of requests) {
    if (!r.roomId) continue;
    const room = inv.rooms.find((x) => x.id === r.roomId);
    if (!room) throw new ApiError(404, "NOT_FOUND", "Room not found");
    if (!room.active) throw new ApiError(409, "ROOM_INACTIVE", `Room ${room.number} is inactive`);
    const c = roomConflicts(r.roomId, r.arrival, r.departure, inv.stays, inv.blocks, exclude);
    if (c.blocks.length) throw new ApiError(409, "ROOM_BLOCKED", `Room ${room.number} is blocked (${c.blocks[0].type.replace(/_/g, " ").toLowerCase()}) from ${c.blocks[0].startDate}`);
    if (c.stays.length) throw new ApiError(409, "ROOM_CONFLICT", `Room ${room.number} is already assigned from ${c.stays[0].arrivalDate} to ${c.stays[0].departureDate}`);
    if (claimed.some((x) => x.roomId === r.roomId && x.arrival < r.departure && r.arrival < x.departure)) throw new ApiError(409, "ROOM_CONFLICT", `Room ${roomNumber.get(r.roomId)} is selected twice for overlapping dates`);
    claimed.push({ roomId: r.roomId, arrival: r.arrival, departure: r.departure });
  }
}

/** Picks the first free room of a type (lowest number), avoiding rooms already picked in this batch. */
export async function pickFreeRoom(db: Db | Tx, roomTypeId: string, arrival: string, departure: string, avoid: string[] = [], excludeStayIds: string[] = [], preferClean = false) {
  const inv = await loadInventory(db, arrival, addDays(departure, -1));
  let candidates = freeRooms(roomTypeId, arrival, departure, inv.rooms, inv.stays, inv.blocks, excludeStayIds).filter((r) => !avoid.includes(r.id));
  if (preferClean && candidates.length) {
    const status = new Map((await db.room.findMany({ where: { id: { in: candidates.map((c) => c.id) } }, select: { id: true, hkStatus: true } })).map((r) => [r.id, r.hkStatus]));
    const clean = candidates.filter((c) => ["CLEAN", "INSPECTED"].includes(status.get(c.id) ?? ""));
    if (clean.length) candidates = clean;
  }
  return candidates[0] ?? null;
}
