// Quick Setup wizard: hotel profile → floors × rooms generator → room types by range → base rates → tax →
// admin user. Produces a working hotel in one transaction.
import { z } from "zod";
import { calendarToday } from "@petra/core";
import type { Db } from "../db";
import { ApiError } from "../errors";
import { hashSecret, validatePasswordStrength, validatePin } from "../auth";
import { audit } from "../common";
import { BED_TYPES, zBp, zMoney, zTime, zUsername } from "@/shared/schemas";
import { getSettings, patchSection } from "../settings";

export const setupSchema = z.object({
  locale: z.enum(["en", "bn"]).default("en"),
  hotel: z.object({
    name: z.string().trim().min(2).max(120),
    address: z.string().trim().max(300).default(""),
    city: z.string().trim().max(80).default(""),
    phone: z.string().trim().max(40).default(""),
    email: z.string().trim().max(120).default(""),
    bin: z.string().trim().max(30).default(""),
    checkInTime: zTime.default("14:00"),
    checkOutTime: zTime.default("12:00"),
  }),
  floors: z
    .array(z.object({ floor: z.string().trim().min(1).max(10), firstNumber: z.number().int().min(1).max(99999), count: z.number().int().min(1).max(60) }))
    .min(1)
    .max(40),
  roomTypes: z
    .array(
      z.object({
        code: z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9_-]+$/),
        name: z.string().trim().min(1).max(80),
        bedType: z.enum(BED_TYPES).default("DOUBLE"),
        baseOccupancy: z.number().int().min(1).max(10).default(2),
        maxAdults: z.number().int().min(1).max(10).default(2),
        maxChildren: z.number().int().min(0).max(10).default(1),
        maxOccupancy: z.number().int().min(1).max(12).default(3),
        baseRate: zMoney,
        extraBedRate: zMoney.default(0),
      }),
    )
    .min(1)
    .max(30),
  /** room-number ranges per type, e.g. { roomTypeCode: "DLX", from: "201", to: "212" } — unmatched rooms get the first type */
  assignments: z.array(z.object({ roomTypeCode: z.string(), from: z.string(), to: z.string() })).default([]),
  tax: z.object({ vatBp: zBp.default(1500), scBp: zBp.default(1000), mode: z.enum(["EXCLUSIVE", "INCLUSIVE"]).default("EXCLUSIVE") }),
  admin: z.object({ fullName: z.string().trim().min(2).max(80), username: zUsername, password: z.string().min(1).max(200), pin: z.string().optional().default("") }),
  loadDemo: z.boolean().default(false),
});
export type SetupInput = z.infer<typeof setupSchema>;

/** Generates room numbers for a floor: firstNumber, firstNumber+1, … */
export function generateRooms(floors: SetupInput["floors"]): { number: string; floor: string }[] {
  const out: { number: string; floor: string }[] = [];
  for (const f of floors) for (let i = 0; i < f.count; i++) out.push({ number: String(f.firstNumber + i), floor: f.floor });
  const seen = new Set<string>();
  for (const r of out) {
    if (seen.has(r.number)) throw new ApiError(400, "DUPLICATE_ROOM", `Room number ${r.number} is generated twice; check the floor ranges`);
    seen.add(r.number);
  }
  return out;
}

const num = (s: string) => (/^\d+$/.test(s) ? Number(s) : NaN);

export function typeForRoom(number: string, assignments: SetupInput["assignments"], fallback: string): string {
  for (const a of assignments) {
    const n = num(number);
    if (!Number.isNaN(n) && !Number.isNaN(num(a.from)) && !Number.isNaN(num(a.to))) {
      if (n >= num(a.from) && n <= num(a.to)) return a.roomTypeCode.toUpperCase();
    } else if (number >= a.from && number <= a.to) return a.roomTypeCode.toUpperCase();
  }
  return fallback;
}

export async function runSetup(db: Db, input: SetupInput, ctx: { ip: string }) {
  const existing = await db.hotel.findUnique({ where: { id: "hotel" } });
  if (existing?.setupComplete) throw new ApiError(409, "ALREADY_SETUP", "Setup has already been completed");
  const s = await getSettings(db);
  validatePasswordStrength(input.admin.password, s.security.minPasswordLength);
  if (input.admin.pin) validatePin(input.admin.pin);
  const rooms = generateRooms(input.floors);
  const codes = input.roomTypes.map((t) => t.code.toUpperCase());
  if (new Set(codes).size !== codes.length) throw new ApiError(400, "DUPLICATE_TYPE", "Room type codes must be unique");
  for (const a of input.assignments) if (!codes.includes(a.roomTypeCode.toUpperCase())) throw new ApiError(400, "UNKNOWN_TYPE", `Unknown room type ${a.roomTypeCode} in assignments`);
  const passwordHash = await hashSecret(input.admin.password);
  const pinHash = input.admin.pin ? await hashSecret(input.admin.pin) : null;
  const today = calendarToday();

  const result = await db.$transaction(
    async (tx) => {
      await tx.hotel.upsert({ where: { id: "hotel" }, create: { id: "hotel", ...input.hotel, setupComplete: false }, update: { ...input.hotel } });
      const typeIds = new Map<string, string>();
      for (const [i, t] of input.roomTypes.entries()) {
        const rt = await tx.roomType.upsert({
          where: { code: t.code.toUpperCase() },
          create: { ...t, code: t.code.toUpperCase(), sortOrder: i },
          update: { ...t, code: t.code.toUpperCase(), sortOrder: i },
        });
        typeIds.set(rt.code, rt.id);
      }
      const fallback = codes[0];
      for (const [i, r] of rooms.entries()) {
        const code = typeForRoom(r.number, input.assignments, fallback);
        await tx.room.upsert({ where: { number: r.number }, create: { number: r.number, floor: r.floor, roomTypeId: typeIds.get(code)!, sortOrder: i }, update: { floor: r.floor, roomTypeId: typeIds.get(code)! } });
      }
      await tx.taxRule.upsert({ where: { code: "VAT" }, create: { code: "VAT", name: "VAT", nameBn: "ভ্যাট", rateBp: input.tax.vatBp, base: "NET_PLUS_PREVIOUS", sortOrder: 2 }, update: { rateBp: input.tax.vatBp, active: input.tax.vatBp > 0 } });
      await tx.taxRule.upsert({ where: { code: "SC" }, create: { code: "SC", name: "Service Charge", nameBn: "সার্ভিস চার্জ", rateBp: input.tax.scBp, base: "NET", sortOrder: 1 }, update: { rateBp: input.tax.scBp, active: input.tax.scBp > 0 } });
      // default rack + walk-in rate plans so bookings work immediately
      const flex = await tx.cancellationPolicy.findUnique({ where: { code: "FLEX24" } });
      await tx.ratePlan.upsert({ where: { code: "RACK" }, create: { code: "RACK", name: "Rack Rate (Room Only)", nameBn: "র‍্যাক রেট", type: "RACK", mealPlan: "RO", cancellationPolicyId: flex?.id }, update: {} });
      await tx.ratePlan.upsert({ where: { code: "WALKIN" }, create: { code: "WALKIN", name: "Walk-in", nameBn: "ওয়াক-ইন", type: "WALKIN", mealPlan: "RO", cancellationPolicyId: flex?.id }, update: {} });
      const role = await tx.role.findUniqueOrThrow({ where: { code: "SUPER_ADMIN" } });
      const admin = await tx.user.upsert({
        where: { username: input.admin.username },
        create: { username: input.admin.username, fullName: input.admin.fullName, roleId: role.id, passwordHash, pinHash, locale: input.locale },
        update: { fullName: input.admin.fullName, roleId: role.id, passwordHash, pinHash, active: true, locale: input.locale },
      });
      await tx.businessDate.upsert({ where: { date: today }, create: { date: today }, update: {} });
      await patchSection(tx as unknown as Db, "billing", { taxMode: input.tax.mode });
      await patchSection(tx as unknown as Db, "locale", { defaultLocale: input.locale });
      await tx.hotel.update({ where: { id: "hotel" }, data: { setupComplete: true, updatedById: admin.id } });
      await audit(tx, { userId: admin.id, username: admin.username, ip: ctx.ip, businessDate: today }, "setup.complete", "Hotel", "hotel", { after: { rooms: rooms.length, roomTypes: codes } });
      return { adminId: admin.id, rooms: rooms.length, roomTypes: codes.length };
    },
    { timeout: 120_000, maxWait: 30_000 },
  );
  return result;
}
