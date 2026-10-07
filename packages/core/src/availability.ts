// Availability engine. Inventory is counted per room type and night:
//   available = active rooms of the type − rooms blocked that night − stays occupying the type that night
// A stay occupies the type of its assigned room (so upgrades consume the physical room), or its booked type
// while unassigned. Callers evaluate this inside the inventory lock + transaction so the check and the write
// are atomic (apps/web/src/server/lock.ts) — that is what makes overbooking impossible.
import { eachNight, eachDay, overlaps, type ISODate } from "./dates";

export const ACTIVE_STAY_STATUSES = ["RESERVED", "CHECKED_IN"] as const;

export interface InvRoom {
  id: string;
  number?: string;
  roomTypeId: string;
  active: boolean;
}
export interface InvStay {
  id: string;
  roomTypeId: string;
  roomId: string | null;
  arrivalDate: ISODate;
  departureDate: ISODate;
  status: string;
}
export interface InvBlock {
  id?: string;
  roomId: string;
  startDate: ISODate;
  endDate: ISODate; // exclusive
  type: string;
}

export interface DayAvailability {
  total: number;
  blocked: number;
  sold: number;
  available: number;
}

export type AvailabilityGrid = Record<string, Record<ISODate, DayAvailability>>;

export const isActiveStay = (s: { status: string }) => (ACTIVE_STAY_STATUSES as readonly string[]).includes(s.status);

export function computeAvailability(input: { roomTypeIds: string[]; rooms: InvRoom[]; stays: InvStay[]; blocks: InvBlock[]; from: ISODate; to: ISODate; excludeStayIds?: string[] }): AvailabilityGrid {
  const exclude = new Set(input.excludeStayIds ?? []);
  const roomType = new Map(input.rooms.map((r) => [r.id, r.roomTypeId]));
  const activeRooms = input.rooms.filter((r) => r.active);
  const activeIds = new Set(activeRooms.map((r) => r.id));
  const days = eachDay(input.from, input.to);
  const grid: AvailabilityGrid = {};
  for (const t of input.roomTypeIds) {
    grid[t] = {};
    const total = activeRooms.filter((r) => r.roomTypeId === t).length;
    for (const d of days) grid[t][d] = { total, blocked: 0, sold: 0, available: total };
  }
  for (const b of input.blocks) {
    const t = roomType.get(b.roomId);
    if (!t || !grid[t] || !activeIds.has(b.roomId)) continue;
    for (const d of days) if (b.startDate <= d && d < b.endDate) grid[t][d].blocked++;
  }
  for (const s of input.stays) {
    if (!isActiveStay(s) || exclude.has(s.id)) continue;
    const t = s.roomId ? (roomType.get(s.roomId) ?? s.roomTypeId) : s.roomTypeId;
    if (!grid[t]) continue;
    for (const d of days) if (s.arrivalDate <= d && d < s.departureDate) grid[t][d].sold++;
  }
  for (const t of Object.keys(grid)) for (const d of days) grid[t][d].available = grid[t][d].total - grid[t][d].blocked - grid[t][d].sold;
  return grid;
}

export interface Shortfall {
  roomTypeId: string;
  date: ISODate;
  requested: number;
  available: number;
}

/** Checks that `requests` (per room type, possibly several rooms) fit every night. */
export function checkAvailability(grid: AvailabilityGrid, requests: { roomTypeId: string; arrival: ISODate; departure: ISODate; qty?: number }[]): Shortfall[] {
  const need = new Map<string, number>();
  for (const r of requests) for (const d of eachNight(r.arrival, r.departure)) need.set(`${r.roomTypeId}|${d}`, (need.get(`${r.roomTypeId}|${d}`) ?? 0) + (r.qty ?? 1));
  const out: Shortfall[] = [];
  for (const [k, qty] of need) {
    const [t, d] = k.split("|");
    const available = grid[t]?.[d]?.available ?? 0;
    if (available < qty) out.push({ roomTypeId: t, date: d, requested: qty, available });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** Is a specific room free (no overlapping assigned active stay and no block) for [arrival, departure)? */
export function roomConflicts(roomId: string, arrival: ISODate, departure: ISODate, stays: InvStay[], blocks: InvBlock[], excludeStayIds: string[] = []): { stays: InvStay[]; blocks: InvBlock[] } {
  const ex = new Set(excludeStayIds);
  return {
    stays: stays.filter((s) => s.roomId === roomId && isActiveStay(s) && !ex.has(s.id) && overlaps(arrival, departure, s.arrivalDate, s.departureDate)),
    blocks: blocks.filter((b) => b.roomId === roomId && overlaps(arrival, departure, b.startDate, b.endDate)),
  };
}

/** Rooms of a type that are free for the whole stay, sorted by number. */
export function freeRooms(roomTypeId: string | null, arrival: ISODate, departure: ISODate, rooms: InvRoom[], stays: InvStay[], blocks: InvBlock[], excludeStayIds: string[] = []): InvRoom[] {
  return rooms
    .filter((r) => r.active && (roomTypeId === null || r.roomTypeId === roomTypeId))
    .filter((r) => {
      const c = roomConflicts(r.id, arrival, departure, stays, blocks, excludeStayIds);
      return c.stays.length === 0 && c.blocks.length === 0;
    })
    .sort((a, b) => String(a.number ?? a.id).localeCompare(String(b.number ?? b.id), undefined, { numeric: true }));
}

/** Occupancy statistics for one night (used by dashboard, forecast and night audit). */
export function nightOccupancy(grid: AvailabilityGrid, date: ISODate) {
  let total = 0,
    blocked = 0,
    sold = 0;
  for (const t of Object.keys(grid)) {
    const d = grid[t][date];
    if (!d) continue;
    total += d.total;
    blocked += d.blocked;
    sold += d.sold;
  }
  const sellable = total - blocked;
  return { total, blocked, sold, sellable, occupancyBp: sellable > 0 ? Math.round((sold * 10000) / sellable) : 0 };
}
