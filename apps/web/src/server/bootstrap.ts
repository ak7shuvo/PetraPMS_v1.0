// Idempotent system data: permission catalogue, built-in roles, payment methods, tax rules, charge codes,
// cancellation policies. Runs at every start; never overwrites hotel edits (only creates what is missing,
// and keeps the Super Admin role complete).
import { DEFAULT_ROLES, DEFAULT_TAX_RULES, PERMISSIONS } from "@petra/core";
import type { Db } from "./db";

export const DEFAULT_PAYMENT_METHODS = [
  { code: "CASH", name: "Cash", nameBn: "নগদ", type: "CASH" },
  { code: "CARD", name: "Card (Visa/Master/Amex)", nameBn: "কার্ড", type: "CARD" },
  { code: "BKASH", name: "bKash", nameBn: "বিকাশ", type: "MOBILE" },
  { code: "NAGAD", name: "Nagad", nameBn: "নগদ (মোবাইল)", type: "MOBILE" },
  { code: "ROCKET", name: "Rocket", nameBn: "রকেট", type: "MOBILE" },
  { code: "BANK", name: "Bank transfer / Cheque", nameBn: "ব্যাংক ট্রান্সফার / চেক", type: "BANK" },
  { code: "CITY_LEDGER", name: "Corporate credit (City Ledger)", nameBn: "কর্পোরেট বাকি (সিটি লেজার)", type: "CITY_LEDGER" },
];

export const DEFAULT_CHARGE_CODES = [
  { code: "ROOM", name: "Room charge", nameBn: "রুম ভাড়া", category: "ROOM" },
  { code: "XBED", name: "Extra bed", nameBn: "অতিরিক্ত বেড", category: "EXTRA_BED" },
  { code: "REST", name: "Restaurant", nameBn: "রেস্টুরেন্ট", category: "FNB" },
  { code: "RSVC", name: "Room service", nameBn: "রুম সার্ভিস", category: "FNB" },
  { code: "LNDRY", name: "Laundry", nameBn: "লন্ড্রি", category: "LAUNDRY" },
  { code: "MINI", name: "Minibar", nameBn: "মিনিবার", category: "MINIBAR" },
  { code: "TRANS", name: "Transport / airport transfer", nameBn: "পরিবহন", category: "TRANSPORT" },
  { code: "TOUR", name: "Tour / excursion", nameBn: "ট্যুর", category: "TOUR" },
  { code: "MISC", name: "Miscellaneous", nameBn: "বিবিধ", category: "MISC" },
  { code: "ECI", name: "Early check-in", nameBn: "আগাম চেক-ইন", category: "ROOM" },
  { code: "LCO", name: "Late check-out", nameBn: "দেরিতে চেক-আউট", category: "ROOM" },
  { code: "CXL", name: "Cancellation / no-show fee", nameBn: "বাতিল / নো-শো ফি", category: "CANCELLATION", taxable: false },
  { code: "ADJ", name: "Adjustment / allowance", nameBn: "সমন্বয়", category: "ADJUSTMENT", taxable: false },
  { code: "OPEN", name: "Opening balance", nameBn: "প্রারম্ভিক ব্যালেন্স", category: "OPENING_BALANCE", taxable: false },
  { code: "PAIDOUT", name: "Paid out on behalf of guest", nameBn: "অতিথির পক্ষে পরিশোধ", category: "PAID_OUT", taxable: false },
];

export const DEFAULT_CANCELLATION_POLICIES = [
  { code: "FLEX24", name: "Flexible — free until 24 h before arrival", freeUntilHours: 24, penaltyType: "FIRST_NIGHT", penaltyValue: 0, noShowType: "FIRST_NIGHT" },
  { code: "MOD72", name: "Moderate — free until 72 h, then 50%", freeUntilHours: 72, penaltyType: "PERCENT", penaltyValue: 5000, noShowType: "FULL" },
  { code: "NONREF", name: "Non-refundable", freeUntilHours: 0, penaltyType: "FULL", penaltyValue: 0, noShowType: "FULL" },
];

export async function ensureSystemData(db: Db) {
  // permission catalogue (add new, update labels, remove retired)
  const existing = new Map((await db.permission.findMany()).map((p) => [p.code, p]));
  for (const p of PERMISSIONS) {
    const e = existing.get(p.code);
    if (!e) await db.permission.create({ data: { code: p.code, module: p.module, label: p.label } });
    else if (e.label !== p.label || e.module !== p.module) await db.permission.update({ where: { code: p.code }, data: { label: p.label, module: p.module } });
  }
  const retired = [...existing.keys()].filter((c) => !PERMISSIONS.some((p) => p.code === c));
  if (retired.length) await db.permission.deleteMany({ where: { code: { in: retired } } });

  for (const r of DEFAULT_ROLES) {
    let role = await db.role.findUnique({ where: { code: r.code } });
    if (!role) {
      role = await db.role.create({ data: { code: r.code, name: r.name, nameBn: r.nameBn, builtin: true } });
      await db.rolePermission.createMany({ data: r.permissions.map((code) => ({ roleId: role!.id, permissionCode: code })) });
    } else if (r.code === "SUPER_ADMIN") {
      const have = new Set((await db.rolePermission.findMany({ where: { roleId: role.id } })).map((x) => x.permissionCode));
      const missing = r.permissions.filter((c) => !have.has(c));
      if (missing.length) await db.rolePermission.createMany({ data: missing.map((code) => ({ roleId: role!.id, permissionCode: code })) });
    }
  }

  if ((await db.paymentMethod.count()) === 0) await db.paymentMethod.createMany({ data: DEFAULT_PAYMENT_METHODS.map((m, i) => ({ ...m, sortOrder: i })) });
  if ((await db.taxRule.count()) === 0)
    await db.taxRule.createMany({
      data: DEFAULT_TAX_RULES.map((t) => ({ code: t.code, name: t.name, nameBn: t.code === "VAT" ? "ভ্যাট" : "সার্ভিস চার্জ", rateBp: t.rateBp, base: t.base, appliesTo: JSON.stringify(t.appliesTo), sortOrder: t.sortOrder })),
    });
  const codes = new Set((await db.chargeCode.findMany({ select: { code: true } })).map((c) => c.code));
  const missingCodes = DEFAULT_CHARGE_CODES.filter((c) => !codes.has(c.code));
  if (missingCodes.length) await db.chargeCode.createMany({ data: missingCodes.map((c, i) => ({ ...c, taxable: c.taxable ?? true, sortOrder: i })) });
  if ((await db.cancellationPolicy.count()) === 0) await db.cancellationPolicy.createMany({ data: DEFAULT_CANCELLATION_POLICIES });
  if (!(await db.license.findUnique({ where: { id: "license" } }))) await db.license.create({ data: { id: "license" } });
}
