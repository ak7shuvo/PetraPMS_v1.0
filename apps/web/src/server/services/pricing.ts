// Loads rate data and prices stays with @petra/core's rate engine.
import { priceStay, type RatePlanDef, type SeasonDef, type StayQuote } from "@petra/core";
import type { Db, Tx } from "../db";
import { parseJson } from "../common";
import { ApiError } from "../errors";

export async function loadPlan(db: Db | Tx, ratePlanId: string | null | undefined): Promise<(RatePlanDef & { name: string; code: string; cancellationPolicyId: string | null }) | null> {
  if (!ratePlanId) return null;
  const p = await db.ratePlan.findUnique({ where: { id: ratePlanId }, include: { roomRates: true } });
  if (!p) throw new ApiError(400, "UNKNOWN_RATE_PLAN", "Unknown rate plan");
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    cancellationPolicyId: p.cancellationPolicyId,
    mealPlan: p.mealPlan,
    mealPricePerAdult: p.mealPricePerAdult,
    mealPricePerChild: p.mealPricePerChild,
    adjustmentType: p.adjustmentType,
    adjustmentValue: p.adjustmentValue,
    weekendDays: parseJson<number[]>(p.weekendDays, [5, 6]),
    weekendAdjustmentBp: p.weekendAdjustmentBp,
    minStay: p.minStay,
    maxStay: p.maxStay,
    roomRates: p.roomRates.map((r) => ({ roomTypeId: r.roomTypeId, rate: r.rate, extraAdultRate: r.extraAdultRate, extraChildRate: r.extraChildRate, extraBedRate: r.extraBedRate })),
  };
}

export async function loadSeasons(db: Db | Tx, from: string, to: string): Promise<SeasonDef[]> {
  const rows = await db.rateSeason.findMany({ where: { active: true, startDate: { lte: to }, endDate: { gte: from } } });
  return rows.map((s) => ({ name: s.name, ratePlanId: s.ratePlanId, roomTypeId: s.roomTypeId, startDate: s.startDate, endDate: s.endDate, adjustmentType: s.adjustmentType, value: s.value, daysOfWeek: parseJson<number[]>(s.daysOfWeek, [0, 1, 2, 3, 4, 5, 6]), minStay: s.minStay, priority: s.priority, active: s.active }));
}

export interface QuoteInput {
  roomTypeId: string;
  ratePlanId?: string | null;
  arrival: string;
  departure: string;
  adults: number;
  children: number;
  extraBeds?: number;
  discountBp?: number;
  overrideRate?: number | null;
}

export async function quoteStay(db: Db | Tx, q: QuoteInput): Promise<StayQuote> {
  const rt = await db.roomType.findUnique({ where: { id: q.roomTypeId } });
  if (!rt) throw new ApiError(400, "UNKNOWN_ROOM_TYPE", "Unknown room type");
  const plan = await loadPlan(db, q.ratePlanId);
  const seasons = await loadSeasons(db, q.arrival, q.departure);
  return priceStay({ roomType: rt, plan, seasons, arrival: q.arrival, departure: q.departure, adults: q.adults, children: q.children, extraBeds: q.extraBeds, discountBp: q.discountBp, overrideRate: q.overrideRate });
}
