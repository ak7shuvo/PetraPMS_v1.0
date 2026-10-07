import { describe, it, expect } from "vitest";
import { priceStay, rateForNight, type RateRoomType, type RatePlanDef, type SeasonDef } from "../src/rates";
import { computeAvailability, checkAvailability, freeRooms, roomConflicts, nightOccupancy, type InvRoom, type InvStay, type InvBlock } from "../src/availability";

const deluxe: RateRoomType = { id: "DLX", baseRate: 500000, extraAdultRate: 100000, extraChildRate: 50000, extraBedRate: 80000, baseOccupancy: 2, maxAdults: 3, maxChildren: 2, maxOccupancy: 4 };
const bb: RatePlanDef = { id: "BB", mealPlan: "BB", mealPricePerAdult: 50000, mealPricePerChild: 25000, adjustmentType: "NONE", adjustmentValue: 0, weekendDays: [5, 6], weekendAdjustmentBp: 1000, minStay: 1, maxStay: 0, roomRates: [] };
const season = (o: Partial<SeasonDef>): SeasonDef => ({ name: "Peak", ratePlanId: null, roomTypeId: null, startDate: "2026-12-20", endDate: "2026-12-31", adjustmentType: "PERCENT", value: 2000, daysOfWeek: [0, 1, 2, 3, 4, 5, 6], minStay: 0, priority: 0, active: true, ...o });

describe("rates", () => {
  it("prices a plain stay on base rate", () => {
    const q = priceStay({ roomType: deluxe, plan: null, seasons: [], arrival: "2026-10-04", departure: "2026-10-06", adults: 2, children: 0 });
    expect(q.errors).toEqual([]);
    expect(q.nightCount).toBe(2);
    expect(q.total).toBe(1000000);
  });
  it("adds meals, weekend uplift, extras and discount", () => {
    const q = priceStay({ roomType: deluxe, plan: bb, seasons: [], arrival: "2026-10-08", departure: "2026-10-10", adults: 3, children: 1, discountBp: 1000 });
    const thu = q.nights[0];
    expect(thu.room).toBe(500000);
    expect(thu.extras).toBe(100000 + 50000);
    expect(thu.meals).toBe(3 * 50000 + 25000);
    expect(thu.discount).toBe(Math.round((500000 + 150000 + 175000) / 10));
    expect(q.nights[1].room).toBe(550000);
  });
  it("uses plan room rates, plan adjustments and season priority", () => {
    const plan: RatePlanDef = { ...bb, weekendAdjustmentBp: 0, roomRates: [{ roomTypeId: "DLX", rate: 450000 }] };
    expect(priceStay({ roomType: deluxe, plan, seasons: [], arrival: "2026-10-04", departure: "2026-10-05", adults: 1, children: 0 }).nights[0].room).toBe(450000);
    const pct: RatePlanDef = { ...bb, weekendAdjustmentBp: 0, adjustmentType: "PERCENT", adjustmentValue: -1000 };
    expect(priceStay({ roomType: deluxe, plan: pct, seasons: [], arrival: "2026-10-04", departure: "2026-10-05", adults: 1, children: 0 }).nights[0].room).toBe(450000);
    const seasons = [season({}), season({ name: "NewYear", startDate: "2026-12-31", adjustmentType: "FIXED", value: 900000, priority: 10, minStay: 2 })];
    const q = priceStay({ roomType: deluxe, plan: null, seasons, arrival: "2026-12-30", departure: "2027-01-01", adults: 2, children: 0 });
    expect(q.nights.map((n) => n.room)).toEqual([600000, 900000]);
    expect(q.nights[1].season).toBe("NewYear");
    const short = priceStay({ roomType: deluxe, plan: null, seasons, arrival: "2026-12-31", departure: "2027-01-01", adults: 2, children: 0 });
    expect(short.errors.map((e) => e.code)).toContain("MIN_STAY");
  });
  it("validates occupancy, stay length and supports overrides", () => {
    const q = priceStay({ roomType: deluxe, plan: { ...bb, maxStay: 1 }, seasons: [], arrival: "2026-10-04", departure: "2026-10-06", adults: 4, children: 1 });
    expect(q.errors.map((e) => e.code)).toEqual(expect.arrayContaining(["MAX_ADULTS", "MAX_OCCUPANCY", "MAX_STAY"]));
    expect(priceStay({ roomType: deluxe, plan: null, seasons: [], arrival: "2026-10-04", departure: "2026-10-04", adults: 1, children: 0 }).errors[0].code).toBe("NIGHTS");
    const o = priceStay({ roomType: deluxe, plan: null, seasons: [], arrival: "2026-10-04", departure: "2026-10-05", adults: 1, children: 0, overrideRate: 300000 });
    expect(o.total).toBe(300000);
    expect(rateForNight([{ date: "2026-10-04", amount: 5 }], "2026-10-09")).toBe(5);
  });
});

describe("availability", () => {
  const rooms: InvRoom[] = [
    { id: "r101", number: "101", roomTypeId: "STD", active: true },
    { id: "r102", number: "102", roomTypeId: "STD", active: true },
    { id: "r201", number: "201", roomTypeId: "DLX", active: true },
    { id: "r202", number: "202", roomTypeId: "DLX", active: false },
  ];
  const stays: InvStay[] = [
    { id: "s1", roomTypeId: "STD", roomId: "r101", arrivalDate: "2026-10-04", departureDate: "2026-10-06", status: "RESERVED" },
    { id: "s2", roomTypeId: "STD", roomId: null, arrivalDate: "2026-10-05", departureDate: "2026-10-07", status: "RESERVED" },
    { id: "s3", roomTypeId: "STD", roomId: "r102", arrivalDate: "2026-10-04", departureDate: "2026-10-05", status: "CANCELLED" },
    { id: "s4", roomTypeId: "STD", roomId: "r201", arrivalDate: "2026-10-06", departureDate: "2026-10-07", status: "CHECKED_IN" },
  ];
  const blocks: InvBlock[] = [{ roomId: "r102", startDate: "2026-10-07", endDate: "2026-10-08", type: "OOO" }];
  const grid = computeAvailability({ roomTypeIds: ["STD", "DLX"], rooms, stays, blocks, from: "2026-10-04", to: "2026-10-08" });

  it("counts total, sold and blocked per night", () => {
    expect(grid.STD["2026-10-04"]).toEqual({ total: 2, blocked: 0, sold: 1, available: 1 });
    expect(grid.STD["2026-10-05"].available).toBe(0);
    expect(grid.STD["2026-10-06"].sold).toBe(1);
    expect(grid.STD["2026-10-07"]).toEqual({ total: 2, blocked: 1, sold: 0, available: 1 });
    expect(grid.DLX["2026-10-06"]).toEqual({ total: 1, blocked: 0, sold: 1, available: 0 });
  });
  it("rejects requests that would overbook", () => {
    expect(checkAvailability(grid, [{ roomTypeId: "STD", arrival: "2026-10-04", departure: "2026-10-05" }])).toEqual([]);
    expect(checkAvailability(grid, [{ roomTypeId: "STD", arrival: "2026-10-04", departure: "2026-10-06" }])).toEqual([{ roomTypeId: "STD", date: "2026-10-05", requested: 1, available: 0 }]);
    expect(checkAvailability(grid, [{ roomTypeId: "STD", arrival: "2026-10-07", departure: "2026-10-08", qty: 2 }])).toHaveLength(1);
  });
  it("excludes a stay being modified", () => {
    const g = computeAvailability({ roomTypeIds: ["STD"], rooms, stays, blocks, from: "2026-10-05", to: "2026-10-05", excludeStayIds: ["s2"] });
    expect(g.STD["2026-10-05"].available).toBe(1);
  });
  it("finds free physical rooms and conflicts", () => {
    expect(freeRooms("STD", "2026-10-04", "2026-10-06", rooms, stays, blocks).map((r) => r.number)).toEqual(["102"]);
    expect(freeRooms("STD", "2026-10-06", "2026-10-08", rooms, stays, blocks).map((r) => r.number)).toEqual(["101"]);
    expect(roomConflicts("r101", "2026-10-05", "2026-10-06", stays, blocks).stays.map((s) => s.id)).toEqual(["s1"]);
    expect(freeRooms(null, "2026-10-08", "2026-10-09", rooms, stays, blocks)).toHaveLength(3);
  });
  it("computes occupancy", () => {
    expect(nightOccupancy(grid, "2026-10-06")).toMatchObject({ total: 3, sold: 2, sellable: 3, occupancyBp: 6667 });
  });
});
