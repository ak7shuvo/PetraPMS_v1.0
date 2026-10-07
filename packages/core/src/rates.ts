// Rate engine: computes the nightly price of a stay from room type, rate plan, seasons, occupancy and meal plan.
import { applyBp, type Poisha } from "./money";
import { dayOfWeek, eachNight, nightsBetween, type ISODate } from "./dates";

export interface RateRoomType {
  id: string;
  code?: string;
  baseRate: Poisha;
  extraAdultRate: Poisha;
  extraChildRate: Poisha;
  extraBedRate: Poisha;
  baseOccupancy: number;
  maxAdults: number;
  maxChildren: number;
  maxOccupancy: number;
}

export interface RatePlanRoomRate {
  roomTypeId: string;
  rate: Poisha;
  extraAdultRate?: Poisha | null;
  extraChildRate?: Poisha | null;
  extraBedRate?: Poisha | null;
}

export interface RatePlanDef {
  id: string;
  code?: string;
  mealPlan: string;
  mealPricePerAdult: Poisha;
  mealPricePerChild: Poisha;
  adjustmentType: "NONE" | "PERCENT" | "AMOUNT" | string;
  adjustmentValue: number;
  weekendDays: number[];
  weekendAdjustmentBp: number;
  minStay: number;
  maxStay: number;
  roomRates: RatePlanRoomRate[];
}

export interface SeasonDef {
  name: string;
  ratePlanId: string | null;
  roomTypeId: string | null;
  startDate: ISODate; // inclusive
  endDate: ISODate; // inclusive
  adjustmentType: "PERCENT" | "AMOUNT" | "FIXED" | string;
  value: number;
  daysOfWeek: number[];
  minStay: number;
  priority: number;
  active: boolean;
}

export interface NightPrice {
  date: ISODate;
  room: Poisha; // room rate after plan/weekend/season adjustments
  extras: Poisha; // extra adults/children/beds
  meals: Poisha;
  discount: Poisha; // positive number subtracted
  amount: Poisha; // room + extras + meals - discount (before tax)
  season?: string;
}

export interface StayQuote {
  nights: NightPrice[];
  nightCount: number;
  total: Poisha;
  minStay: number;
  maxStay: number;
  errors: { code: string; message: string }[];
}

export interface StayInput {
  roomType: RateRoomType;
  plan: RatePlanDef | null;
  seasons: SeasonDef[];
  arrival: ISODate;
  departure: ISODate;
  adults: number;
  children: number;
  extraBeds?: number;
  discountBp?: number;
  /** manual nightly room rate (permission controlled): replaces the computed room rate */
  overrideRate?: Poisha | null;
}

export function seasonFor(date: ISODate, roomTypeId: string, planId: string | null, seasons: SeasonDef[]): SeasonDef | undefined {
  const dow = dayOfWeek(date);
  return seasons
    .filter((s) => s.active && s.startDate <= date && date <= s.endDate && s.daysOfWeek.includes(dow) && (s.roomTypeId === null || s.roomTypeId === roomTypeId) && (s.ratePlanId === null || s.ratePlanId === planId))
    .sort((a, b) => b.priority - a.priority || (a.ratePlanId ? -1 : 1))[0];
}

export function priceStay(input: StayInput): StayQuote {
  const { roomType: rt, plan, seasons } = input;
  const extraBeds = input.extraBeds ?? 0;
  const errors: StayQuote["errors"] = [];
  const nightCount = nightsBetween(input.arrival, input.departure);
  if (nightCount < 1) errors.push({ code: "NIGHTS", message: "Departure must be after arrival" });
  if (input.adults < 1) errors.push({ code: "ADULTS", message: "At least one adult is required" });
  if (input.adults > rt.maxAdults + extraBeds) errors.push({ code: "MAX_ADULTS", message: `Maximum ${rt.maxAdults} adults for this room type (plus extra beds)` });
  if (input.children > rt.maxChildren + extraBeds) errors.push({ code: "MAX_CHILDREN", message: `Maximum ${rt.maxChildren} children for this room type` });
  if (input.adults + input.children > rt.maxOccupancy + extraBeds) errors.push({ code: "MAX_OCCUPANCY", message: `Maximum occupancy is ${rt.maxOccupancy} (plus extra beds)` });

  const planRate = plan?.roomRates.find((r) => r.roomTypeId === rt.id);
  const extraAdultRate = planRate?.extraAdultRate ?? rt.extraAdultRate;
  const extraChildRate = planRate?.extraChildRate ?? rt.extraChildRate;
  const extraBedRate = planRate?.extraBedRate ?? rt.extraBedRate;
  const extraAdults = Math.max(0, input.adults - rt.baseOccupancy);
  const freeForChildren = Math.max(0, rt.baseOccupancy - input.adults);
  const extraChildren = Math.max(0, input.children - freeForChildren);

  const nights: NightPrice[] = [];
  let minStay = plan?.minStay ?? 1;
  const maxStay = plan?.maxStay ?? 0;
  for (const date of nightCount > 0 ? eachNight(input.arrival, input.departure) : []) {
    let room: Poisha;
    let seasonName: string | undefined;
    if (input.overrideRate !== undefined && input.overrideRate !== null) {
      room = input.overrideRate;
    } else {
      room = planRate ? planRate.rate : rt.baseRate;
      if (!planRate && plan) {
        if (plan.adjustmentType === "PERCENT") room += applyBp(room, plan.adjustmentValue);
        else if (plan.adjustmentType === "AMOUNT") room += plan.adjustmentValue;
      }
      if (plan && plan.weekendAdjustmentBp && plan.weekendDays.includes(dayOfWeek(date))) room += applyBp(room, plan.weekendAdjustmentBp);
      const season = seasonFor(date, rt.id, plan?.id ?? null, seasons);
      if (season) {
        seasonName = season.name;
        if (season.adjustmentType === "PERCENT") room += applyBp(room, season.value);
        else if (season.adjustmentType === "AMOUNT") room += season.value;
        else room = season.value;
        if (date === input.arrival && season.minStay > minStay) minStay = season.minStay;
      }
      room = Math.max(0, room);
    }
    const extras = extraAdults * extraAdultRate + extraChildren * extraChildRate + extraBeds * extraBedRate;
    const meals = plan ? input.adults * plan.mealPricePerAdult + input.children * plan.mealPricePerChild : 0;
    const subtotal = room + extras + meals;
    const discount = input.discountBp ? applyBp(subtotal, input.discountBp) : 0;
    nights.push({ date, room, extras, meals, discount, amount: subtotal - discount, season: seasonName });
  }
  if (nightCount > 0 && nightCount < minStay) errors.push({ code: "MIN_STAY", message: `Minimum stay is ${minStay} night(s)` });
  if (maxStay > 0 && nightCount > maxStay) errors.push({ code: "MAX_STAY", message: `Maximum stay is ${maxStay} night(s)` });
  return { nights, nightCount, total: nights.reduce((a, n) => a + n.amount, 0), minStay, maxStay, errors };
}

/** Nightly rates as stored on a reservation room: [{date, amount}] */
export const toNightlyRates = (q: StayQuote) => q.nights.map((n) => ({ date: n.date, amount: n.amount }));

export function rateForNight(nightlyRates: { date: string; amount: number }[], date: ISODate): Poisha {
  const hit = nightlyRates.find((n) => n.date === date);
  if (hit) return hit.amount;
  // extended stays: use the last known nightly rate
  return nightlyRates.length ? nightlyRates[nightlyRates.length - 1].amount : 0;
}
