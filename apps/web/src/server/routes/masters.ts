// Configuration masters editable in Settings: payment methods, tax rules, charge codes, cancellation
// policies, discount rules, amenities, staff.
import { z } from "zod";
import { route } from "../api";
import { audit, parseJson } from "../common";
import { ApiError, notFound } from "../errors";
import { publish } from "../events";
import { CHARGE_CATEGORIES, zBp, zCode, zMoney, zName, zOptText } from "@/shared/schemas";

type ModelName = "paymentMethod" | "taxRule" | "chargeCode" | "cancellationPolicy" | "discountRule" | "amenity" | "staff";

interface MasterDef {
  path: string;
  model: ModelName;
  schema: z.ZodType<Record<string, unknown>>;
  viewPerm: string[];
  editPerm: string;
  orderBy: Record<string, "asc" | "desc">;
  jsonFields?: string[];
  inUse?: (db: Parameters<Parameters<typeof route>[3]>[0]["db"], row: Record<string, unknown>) => Promise<number>;
}

const MASTERS: MasterDef[] = [
  {
    path: "payment-methods",
    model: "paymentMethod",
    schema: z.object({ code: zCode, name: zName, nameBn: zOptText(80), type: z.enum(["CASH", "CARD", "MOBILE", "BANK", "CITY_LEDGER", "OTHER"]), active: z.boolean().default(true), sortOrder: z.number().int().default(0) }),
    viewPerm: ["folio.view", "settings.view", "settings.manage"],
    editPerm: "settings.manage",
    orderBy: { sortOrder: "asc" },
    inUse: (db, r) => db.payment.count({ where: { method: r.code as string } }),
  },
  {
    path: "tax-rules",
    model: "taxRule",
    schema: z.object({ code: zCode, name: zName, nameBn: zOptText(80), rateBp: zBp, base: z.enum(["NET", "NET_PLUS_PREVIOUS"]), appliesTo: z.array(z.string()).min(1).default(["*"]), sortOrder: z.number().int().default(0), active: z.boolean().default(true) }),
    viewPerm: ["folio.view", "settings.view", "settings.manage"],
    editPerm: "settings.manage",
    orderBy: { sortOrder: "asc" },
    jsonFields: ["appliesTo"],
  },
  {
    path: "charge-codes",
    model: "chargeCode",
    schema: z.object({ code: zCode, name: zName, nameBn: zOptText(80), category: z.enum(CHARGE_CATEGORIES), defaultAmount: zMoney.default(0), taxable: z.boolean().default(true), active: z.boolean().default(true), sortOrder: z.number().int().default(0) }),
    viewPerm: ["folio.view", "folio.charge", "settings.view", "settings.manage"],
    editPerm: "settings.manage",
    orderBy: { sortOrder: "asc" },
    inUse: (db, r) => db.folioCharge.count({ where: { chargeCodeId: r.id as string } }),
  },
  {
    path: "cancellation-policies",
    model: "cancellationPolicy",
    schema: z.object({ code: zCode, name: zName, description: zOptText(500), freeUntilHours: z.number().int().min(0).max(24 * 60), penaltyType: z.enum(["NONE", "FIRST_NIGHT", "PERCENT", "FULL"]), penaltyValue: zBp.default(0), noShowType: z.enum(["NONE", "FIRST_NIGHT", "PERCENT", "FULL"]), active: z.boolean().default(true) }),
    viewPerm: ["reservations.view", "rates.view", "settings.view"],
    editPerm: "rates.manage",
    orderBy: { code: "asc" },
    inUse: (db, r) => db.ratePlan.count({ where: { cancellationPolicyId: r.id as string } }),
  },
  {
    path: "discount-rules",
    model: "discountRule",
    schema: z.object({ code: zCode, name: zName, type: z.enum(["PERCENT", "AMOUNT"]), value: z.number().int().min(0).max(100_000_000), requiresApproval: z.boolean().default(false), active: z.boolean().default(true) }),
    viewPerm: ["reservations.create", "folio.charge", "rates.view", "settings.view"],
    editPerm: "rates.manage",
    orderBy: { code: "asc" },
  },
  {
    path: "amenities",
    model: "amenity",
    schema: z.object({ code: zCode, name: zName, nameBn: zOptText(80) }),
    viewPerm: ["rooms.view", "settings.view"],
    editPerm: "rooms.manage",
    orderBy: { name: "asc" },
  },
  {
    path: "staff",
    model: "staff",
    schema: z.object({ code: zCode, fullName: zName, department: zOptText(40), designation: zOptText(80), phone: zOptText(30), userId: z.string().nullable().optional(), active: z.boolean().default(true) }),
    viewPerm: ["users.view", "settings.view", "housekeeping.assign", "maintenance.manage"],
    editPerm: "users.manage",
    orderBy: { fullName: "asc" },
  },
];

const out = (def: MasterDef, row: Record<string, unknown>) => {
  const r = { ...row };
  for (const f of def.jsonFields ?? []) r[f] = parseJson(r[f] as string, []);
  return r;
};
const toDb = (def: MasterDef, data: Record<string, unknown>) => {
  const r = { ...data };
  for (const f of def.jsonFields ?? []) r[f] = JSON.stringify(r[f]);
  return r;
};

for (const def of MASTERS) {
  // Prisma delegates share the same CRUD API; typed loosely here because the router is generic.
  const repo = (db: unknown) => (db as Record<ModelName, { findMany: Function; create: Function; update: Function; delete: Function; findUnique: Function }>)[def.model];
  route("GET", `/${def.path}`, { perm: def.viewPerm, allowReadOnly: true }, async (ctx) => {
    const rows = (await repo(ctx.db).findMany({ orderBy: def.orderBy })) as Record<string, unknown>[];
    return rows.map((r) => out(def, r));
  });
  route("POST", `/${def.path}`, { perm: def.editPerm }, async (ctx) => {
    const b = await ctx.body(def.schema);
    const row = await repo(ctx.db).create({ data: toDb(def, b) });
    await audit(ctx.db, ctx.actor, `${def.model}.created`, def.model, row.id, { after: b });
    publish("settings", def.path);
    return out(def, row);
  });
  route("PUT", `/${def.path}/:id`, { perm: def.editPerm }, async (ctx) => {
    const b = await ctx.body(def.schema);
    const before = await repo(ctx.db).findUnique({ where: { id: ctx.params.id } });
    if (!before) throw notFound();
    if (def.model === "paymentMethod" && before.code !== b.code && (await def.inUse!(ctx.db, before))) throw new ApiError(409, "IN_USE", "Payments use this code; it cannot be renamed");
    const row = await repo(ctx.db).update({ where: { id: ctx.params.id }, data: toDb(def, b) });
    await audit(ctx.db, ctx.actor, `${def.model}.updated`, def.model, row.id, { before, after: b });
    publish("settings", def.path);
    return out(def, row);
  });
  route("DELETE", `/${def.path}/:id`, { perm: def.editPerm }, async (ctx) => {
    const before = await repo(ctx.db).findUnique({ where: { id: ctx.params.id } });
    if (!before) throw notFound();
    if (def.inUse && (await def.inUse(ctx.db, before))) throw new ApiError(409, "IN_USE", "This record is in use. Deactivate it instead.");
    await repo(ctx.db).delete({ where: { id: ctx.params.id } });
    await audit(ctx.db, ctx.actor, `${def.model}.deleted`, def.model, before.id, { before });
    publish("settings", def.path);
    return { ok: true };
  });
}
