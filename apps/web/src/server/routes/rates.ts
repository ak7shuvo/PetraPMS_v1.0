// Rate plans (with per-room-type rates), seasonal/event pricing, quotes.
import { z } from "zod";
import { route } from "../api";
import { audit, parseJson } from "../common";
import { ApiError, notFound } from "../errors";
import { publish } from "../events";
import { quoteStay } from "../services/pricing";
import { ratePlanSchema, seasonSchema, zDate } from "@/shared/schemas";

route("GET", "/rate-plans", { perm: ["rates.view", "reservations.view"], allowReadOnly: true }, async (ctx) => {
  const rows = await ctx.db.ratePlan.findMany({ include: { roomRates: true, cancellationPolicy: { select: { id: true, code: true, name: true } } }, orderBy: [{ active: "desc" }, { code: "asc" }] });
  return rows.map((p) => ({ ...p, weekendDays: parseJson<number[]>(p.weekendDays, [5, 6]) }));
});

async function saveRates(db: Parameters<Parameters<typeof route>[3]>[0]["db"], planId: string, rates: z.infer<typeof ratePlanSchema>["roomRates"]) {
  await db.ratePlanRoomType.deleteMany({ where: { ratePlanId: planId } });
  if (rates.length) await db.ratePlanRoomType.createMany({ data: rates.map((r) => ({ ratePlanId: planId, roomTypeId: r.roomTypeId, rate: r.rate, extraAdultRate: r.extraAdultRate ?? null, extraChildRate: r.extraChildRate ?? null, extraBedRate: r.extraBedRate ?? null })) });
}

route("POST", "/rate-plans", { perm: "rates.manage" }, async (ctx) => {
  const b = await ctx.body(ratePlanSchema);
  const { roomRates, weekendDays, ...data } = b;
  const p = await ctx.db.$transaction(async (tx) => {
    const p = await tx.ratePlan.create({ data: { ...data, weekendDays: JSON.stringify(weekendDays), createdById: ctx.me().id } });
    await saveRates(tx as never, p.id, roomRates);
    await audit(tx, ctx.actor, "ratePlan.created", "RatePlan", p.id, { after: b });
    return p;
  });
  publish("settings", "rates");
  return p;
});

route("PUT", "/rate-plans/:id", { perm: "rates.manage" }, async (ctx) => {
  const b = await ctx.body(ratePlanSchema);
  const before = await ctx.db.ratePlan.findUnique({ where: { id: ctx.params.id }, include: { roomRates: true } });
  if (!before) throw notFound("Rate plan");
  const { roomRates, weekendDays, ...data } = b;
  await ctx.db.$transaction(async (tx) => {
    await tx.ratePlan.update({ where: { id: before.id }, data: { ...data, weekendDays: JSON.stringify(weekendDays), updatedById: ctx.me().id } });
    await saveRates(tx as never, before.id, roomRates);
    await audit(tx, ctx.actor, "ratePlan.updated", "RatePlan", before.id, { before, after: b });
  });
  publish("settings", "rates");
  return { ok: true };
});

route("DELETE", "/rate-plans/:id", { perm: "rates.manage" }, async (ctx) => {
  const p = await ctx.db.ratePlan.findUnique({ where: { id: ctx.params.id } });
  if (!p) throw notFound("Rate plan");
  const used = await ctx.db.reservationRoom.count({ where: { ratePlanId: p.id } });
  if (used) throw new ApiError(409, "IN_USE", "Reservations use this rate plan. Deactivate it instead.");
  await ctx.db.ratePlan.delete({ where: { id: p.id } });
  await audit(ctx.db, ctx.actor, "ratePlan.deleted", "RatePlan", p.id, { before: { code: p.code } });
  return { ok: true };
});

route("GET", "/seasons", { perm: ["rates.view"], allowReadOnly: true }, async (ctx) => {
  const rows = await ctx.db.rateSeason.findMany({ include: { ratePlan: { select: { code: true, name: true } }, roomType: { select: { code: true, name: true } } }, orderBy: { startDate: "asc" } });
  return rows.map((s) => ({ ...s, daysOfWeek: parseJson<number[]>(s.daysOfWeek, []) }));
});

route("POST", "/seasons", { perm: "rates.manage" }, async (ctx) => {
  const b = await ctx.body(seasonSchema);
  const s = await ctx.db.rateSeason.create({ data: { ...b, ratePlanId: b.ratePlanId || null, roomTypeId: b.roomTypeId || null, daysOfWeek: JSON.stringify(b.daysOfWeek) } });
  await audit(ctx.db, ctx.actor, "season.created", "RateSeason", s.id, { after: b });
  publish("settings", "rates");
  return s;
});

route("PUT", "/seasons/:id", { perm: "rates.manage" }, async (ctx) => {
  const b = await ctx.body(seasonSchema);
  const before = await ctx.db.rateSeason.findUnique({ where: { id: ctx.params.id } });
  if (!before) throw notFound("Season");
  await ctx.db.rateSeason.update({ where: { id: before.id }, data: { ...b, ratePlanId: b.ratePlanId || null, roomTypeId: b.roomTypeId || null, daysOfWeek: JSON.stringify(b.daysOfWeek) } });
  await audit(ctx.db, ctx.actor, "season.updated", "RateSeason", before.id, { before, after: b });
  publish("settings", "rates");
  return { ok: true };
});

route("DELETE", "/seasons/:id", { perm: "rates.manage" }, async (ctx) => {
  const s = await ctx.db.rateSeason.findUnique({ where: { id: ctx.params.id } });
  if (!s) throw notFound("Season");
  await ctx.db.rateSeason.delete({ where: { id: s.id } });
  await audit(ctx.db, ctx.actor, "season.deleted", "RateSeason", s.id, { before: s });
  return { ok: true };
});

route("POST", "/rates/quote", { perm: ["reservations.create", "reservations.edit", "rates.view"], allowReadOnly: true }, async (ctx) => {
  const b = await ctx.body(
    z.object({
      roomTypeId: z.string().min(1),
      ratePlanId: z.string().nullable().optional(),
      arrival: zDate,
      departure: zDate,
      adults: z.number().int().min(1).max(12),
      children: z.number().int().min(0).max(12).default(0),
      extraBeds: z.number().int().min(0).max(4).default(0),
      discountBp: z.number().int().min(0).max(10000).default(0),
    }),
  );
  return quoteStay(ctx.db, b);
});

/** Rate calendar: nightly room rate per room type for a plan over a range (for the rates screen). */
route("GET", "/rates/calendar", { perm: "rates.view", allowReadOnly: true }, async (ctx) => {
  const from = ctx.query.get("from") ?? ctx.businessDate;
  const days = Math.min(Number(ctx.query.get("days") ?? 14) || 14, 62);
  const planId = ctx.query.get("ratePlanId") || null;
  const types = await ctx.db.roomType.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } });
  const { addDays } = await import("@petra/core");
  const to = addDays(from, days);
  const out = [];
  for (const t of types) {
    const q = await quoteStay(ctx.db, { roomTypeId: t.id, ratePlanId: planId, arrival: from, departure: to, adults: Math.min(t.baseOccupancy, t.maxAdults), children: 0 });
    out.push({ roomType: { id: t.id, code: t.code, name: t.name }, nights: q.nights.map((n) => ({ date: n.date, amount: n.amount, season: n.season ?? null })) });
  }
  return { from, days, rows: out };
});
