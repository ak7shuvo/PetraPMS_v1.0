// Hotel statistics shared by the dashboard, night audit summary and reports.
// Definitions (USALI-style): rooms available = active rooms − out-of-order/maintenance blocks; rooms sold = stay
// nights (in-house / checked-out, excluding house use); occupancy = sold / available; ADR = room revenue / sold;
// RevPAR = room revenue / available. Revenue comes from folio charges posted on the business date (net of tax).
import { addDays, eachDay } from "@petra/core";
import type { Db, Tx } from "../db";

export interface DayStats {
  date: string;
  totalRooms: number;
  outOfOrder: number;
  houseUse: number;
  available: number;
  sold: number;
  occupancyBp: number;
  roomRevenue: number;
  otherRevenue: number;
  totalRevenue: number;
  adr: number;
  revpar: number;
  serviceCharge: number;
  vat: number;
  byCategory: Record<string, number>;
  payments: Record<string, number>;
  refunds: number;
  arrivals: number;
  departures: number;
  noShows: number;
  cancellations: number;
  guestsInHouse: number;
}

export async function dayStats(db: Db | Tx, date: string, opts: { forecast?: boolean } = {}): Promise<DayStats> {
  const next = addDays(date, 1);
  const statuses = opts.forecast ? ["RESERVED", "CHECKED_IN", "CHECKED_OUT"] : ["CHECKED_IN", "CHECKED_OUT"];
  const [totalRooms, blocks, stays, charges, payments, arrivals, departures, noShows, cancellations] = await Promise.all([
    db.room.count({ where: { active: true } }),
    db.roomBlock.findMany({ where: { releasedAt: null, startDate: { lte: date }, endDate: { gt: date } }, select: { roomId: true, type: true } }),
    db.reservationRoom.findMany({ where: { status: { in: statuses }, arrivalDate: { lte: date }, departureDate: { gt: date } }, select: { adults: true, children: true, roomId: true } }),
    db.folioCharge.findMany({ where: { businessDate: date, voidedAt: null }, select: { category: true, amount: true, serviceCharge: true, vat: true } }),
    db.payment.findMany({ where: { businessDate: date, voidedAt: null }, select: { method: true, amount: true, type: true } }),
    db.reservationRoom.count({ where: { arrivalDate: date, status: { in: ["CHECKED_IN", "CHECKED_OUT", ...(opts.forecast ? ["RESERVED"] : [])] } } }),
    db.reservationRoom.count({ where: { departureDate: date, status: { in: ["CHECKED_OUT", ...(opts.forecast ? ["CHECKED_IN"] : [])] } } }),
    db.reservationRoom.count({ where: { arrivalDate: date, status: "NO_SHOW" } }),
    db.reservation.count({ where: { status: "CANCELLED", cancelledAt: { gte: new Date(date + "T00:00:00+06:00"), lt: new Date(next + "T00:00:00+06:00") } } }),
  ]);
  const ooo = new Set(blocks.filter((b) => b.type === "OUT_OF_ORDER" || b.type === "MAINTENANCE").map((b) => b.roomId));
  const house = new Set(blocks.filter((b) => b.type === "HOUSE_USE").map((b) => b.roomId));
  const available = Math.max(0, totalRooms - ooo.size);
  const sold = stays.length;
  const byCategory: Record<string, number> = {};
  let sc = 0;
  let vat = 0;
  for (const c of charges) {
    byCategory[c.category] = (byCategory[c.category] ?? 0) + c.amount;
    sc += c.serviceCharge;
    vat += c.vat;
  }
  const roomRevenue = (byCategory.ROOM ?? 0) + (byCategory.EXTRA_BED ?? 0);
  const totalRevenue = Object.entries(byCategory).filter(([k]) => !["DEPOSIT", "PAID_OUT", "OPENING_BALANCE"].includes(k)).reduce((a, [, v]) => a + v, 0);
  const pay: Record<string, number> = {};
  let refunds = 0;
  for (const p of payments) {
    if (p.type === "REFUND") {
      refunds += p.amount;
      pay[p.method] = (pay[p.method] ?? 0) - p.amount;
    } else pay[p.method] = (pay[p.method] ?? 0) + p.amount;
  }
  return {
    date,
    totalRooms,
    outOfOrder: ooo.size,
    houseUse: house.size,
    available,
    sold,
    occupancyBp: available ? Math.round((sold * 10000) / available) : 0,
    roomRevenue,
    otherRevenue: totalRevenue - roomRevenue,
    totalRevenue,
    adr: sold ? Math.round(roomRevenue / sold) : 0,
    revpar: available ? Math.round(roomRevenue / available) : 0,
    serviceCharge: sc,
    vat,
    byCategory,
    payments: pay,
    refunds,
    arrivals,
    departures,
    noShows,
    cancellations,
    guestsInHouse: stays.reduce((a, s) => a + s.adults + s.children, 0),
  };
}

/** Occupancy forecast from reservations (reserved + in-house) for the next `days` nights. */
export async function forecast(db: Db | Tx, from: string, days: number) {
  const to = addDays(from, days - 1);
  const [totalRooms, stays, blocks] = await Promise.all([
    db.room.count({ where: { active: true } }),
    db.reservationRoom.findMany({ where: { status: { in: ["RESERVED", "CHECKED_IN"] }, arrivalDate: { lte: to }, departureDate: { gt: from } }, select: { arrivalDate: true, departureDate: true, nightlyRates: true } }),
    db.roomBlock.findMany({ where: { releasedAt: null, type: { in: ["OUT_OF_ORDER", "MAINTENANCE"] }, startDate: { lte: to }, endDate: { gt: from } }, select: { startDate: true, endDate: true } }),
  ]);
  return eachDay(from, to).map((d) => {
    const sold = stays.filter((s) => s.arrivalDate <= d && d < s.departureDate);
    const ooo = blocks.filter((b) => b.startDate <= d && d < b.endDate).length;
    const available = Math.max(0, totalRooms - ooo);
    const revenue = sold.reduce((a, s) => a + ((JSON.parse(s.nightlyRates) as { date: string; amount: number }[]).find((n) => n.date === d)?.amount ?? 0), 0);
    return { date: d, sold: sold.length, available, occupancyBp: available ? Math.round((sold.length * 10000) / available) : 0, revenue };
  });
}
