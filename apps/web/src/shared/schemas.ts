// Zod schemas shared by the browser (form validation) and the server (authoritative validation).
// Money fields are integer poisha; the UI converts from taka with parseMoney().
import { z } from "zod";

export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
export const zTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24 h)");
export const zMoney = z.number().int().min(0).max(100_000_000_00);
export const zSignedMoney = z.number().int().min(-100_000_000_00).max(100_000_000_00);
export const zBp = z.number().int().min(0).max(10000);
export const zCode = z
  .string()
  .trim()
  .min(1, "Required")
  .max(20)
  .regex(/^[A-Za-z0-9_-]+$/, "Letters, digits, - and _ only")
  .transform((s) => s.toUpperCase());
export const zName = z.string().trim().min(1, "Required").max(120);
export const zOptText = (max = 500) => z.string().trim().max(max).optional().default("");
export const zUsername = z
  .string()
  .trim()
  .min(3, "At least 3 characters")
  .max(40)
  .regex(/^[a-zA-Z0-9._-]+$/, "Letters, digits, . _ - only")
  .transform((s) => s.toLowerCase());

export const BED_TYPES = ["SINGLE", "DOUBLE", "TWIN", "QUEEN", "KING", "TRIPLE"] as const;
export const MEAL_PLANS = ["RO", "BB", "HB", "FB"] as const;
export const RATE_PLAN_TYPES = ["RACK", "CORPORATE", "WEEKEND", "SEASONAL", "PACKAGE", "WALKIN", "OTA"] as const;
export const SOURCES = ["WALK_IN", "PHONE", "WEBSITE", "OTA", "CORPORATE", "AGENT", "EMAIL"] as const;
export const ID_TYPES = ["NID", "PASSPORT", "DRIVING_LICENSE", "BIRTH_CERT", "OTHER"] as const;
export const CHARGE_CATEGORIES = ["ROOM", "EXTRA_BED", "FNB", "LAUNDRY", "MINIBAR", "TRANSPORT", "TOUR", "MISC", "CANCELLATION", "ADJUSTMENT", "OPENING_BALANCE", "PAID_OUT"] as const;
export const BLOCK_TYPES = ["OUT_OF_ORDER", "MAINTENANCE", "HOUSE_USE", "BLOCK"] as const;
export const HK_STATUSES = ["CLEAN", "DIRTY", "IN_PROGRESS", "INSPECTED"] as const;
export const TICKET_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export const TICKET_CATEGORIES = ["ELECTRICAL", "PLUMBING", "AC", "FURNITURE", "IT", "GENERAL"] as const;

export const roomTypeSchema = z
  .object({
    code: zCode,
    name: zName,
    nameBn: zOptText(120),
    description: zOptText(1000),
    baseOccupancy: z.number().int().min(1).max(10),
    maxAdults: z.number().int().min(1).max(10),
    maxChildren: z.number().int().min(0).max(10),
    maxOccupancy: z.number().int().min(1).max(12),
    bedType: z.enum(BED_TYPES),
    amenities: z.array(z.string().max(40)).max(50).default([]),
    baseRate: zMoney,
    extraAdultRate: zMoney.default(0),
    extraChildRate: zMoney.default(0),
    extraBedRate: zMoney.default(0),
    sortOrder: z.number().int().default(0),
    active: z.boolean().default(true),
  })
  .refine((v) => v.maxOccupancy >= v.baseOccupancy, { message: "Max occupancy must be at least the base occupancy", path: ["maxOccupancy"] })
  .refine((v) => v.maxAdults <= v.maxOccupancy, { message: "Max adults cannot exceed max occupancy", path: ["maxAdults"] });

export const roomSchema = z.object({
  number: z.string().trim().min(1).max(10).regex(/^[A-Za-z0-9-]+$/, "Letters, digits and - only"),
  floor: z.string().trim().min(1).max(10),
  roomTypeId: z.string().min(1),
  features: zOptText(200),
  notes: zOptText(500),
  active: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

export const ratePlanSchema = z.object({
  code: zCode,
  name: zName,
  nameBn: zOptText(120),
  type: z.enum(RATE_PLAN_TYPES),
  mealPlan: z.enum(MEAL_PLANS),
  mealPricePerAdult: zMoney.default(0),
  mealPricePerChild: zMoney.default(0),
  adjustmentType: z.enum(["NONE", "PERCENT", "AMOUNT"]).default("NONE"),
  adjustmentValue: z.number().int().min(-1_000_000_00).max(1_000_000_00).default(0),
  weekendDays: z.array(z.number().int().min(0).max(6)).default([5, 6]),
  weekendAdjustmentBp: z.number().int().min(-10000).max(10000).default(0),
  minStay: z.number().int().min(1).max(365).default(1),
  maxStay: z.number().int().min(0).max(365).default(0),
  companyId: z.string().nullable().optional(),
  cancellationPolicyId: z.string().nullable().optional(),
  description: zOptText(1000),
  active: z.boolean().default(true),
  roomRates: z
    .array(z.object({ roomTypeId: z.string().min(1), rate: zMoney, extraAdultRate: zMoney.nullable().optional(), extraChildRate: zMoney.nullable().optional(), extraBedRate: zMoney.nullable().optional() }))
    .default([]),
});

export const seasonSchema = z
  .object({
    name: zName,
    ratePlanId: z.string().nullable().optional(),
    roomTypeId: z.string().nullable().optional(),
    startDate: zDate,
    endDate: zDate,
    adjustmentType: z.enum(["PERCENT", "AMOUNT", "FIXED"]),
    value: z.number().int().min(-10_000_000_00).max(10_000_000_00),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).default([0, 1, 2, 3, 4, 5, 6]),
    minStay: z.number().int().min(0).max(60).default(0),
    priority: z.number().int().min(0).max(100).default(0),
    active: z.boolean().default(true),
  })
  .refine((v) => v.endDate >= v.startDate, { message: "End date must be on or after start date", path: ["endDate"] });

export const guestSchema = z.object({
  title: zOptText(10),
  firstName: z.string().trim().min(1, "Required").max(80),
  lastName: zOptText(80),
  phone: zOptText(30),
  email: z.union([z.literal(""), z.string().trim().email("Invalid email").max(120)]).default(""),
  gender: z.enum(["", "M", "F", "O"]).default(""),
  dateOfBirth: z.union([z.literal(""), zDate]).default(""),
  nationality: z.string().trim().length(2).toUpperCase().default("BD"),
  idType: z.enum(["", ...ID_TYPES]).default(""),
  idNumber: zOptText(40),
  passportNumber: zOptText(30),
  passportExpiry: z.union([z.literal(""), zDate]).default(""),
  passportIssuedAt: zOptText(60),
  visaNumber: zOptText(40),
  visaType: zOptText(40),
  visaExpiry: z.union([z.literal(""), zDate]).default(""),
  arrivalFrom: zOptText(80),
  arrivalDateBd: z.union([z.literal(""), zDate]).default(""),
  portOfEntry: zOptText(80),
  purposeOfVisit: zOptText(120),
  occupation: zOptText(80),
  address: zOptText(300),
  city: zOptText(80),
  country: z.string().trim().length(2).toUpperCase().default("BD"),
  companyId: z.string().nullable().optional(),
  vip: z.number().int().min(0).max(3).default(0),
  preferences: zOptText(1000),
  notes: zOptText(2000),
  marketingOptIn: z.boolean().default(false),
});

export const companySchema = z.object({
  code: zCode.optional(),
  name: zName,
  contactPerson: zOptText(80),
  phone: zOptText(30),
  email: z.union([z.literal(""), z.string().trim().email().max(120)]).default(""),
  address: zOptText(300),
  bin: zOptText(30),
  creditLimit: zMoney.default(0),
  paymentTermsDays: z.number().int().min(0).max(365).default(30),
  ratePlanId: z.string().nullable().optional(),
  discountBp: zBp.default(0),
  cityLedger: z.boolean().default(true),
  notes: zOptText(1000),
  active: z.boolean().default(true),
});
