// Folio math: balances, routing of charges to split folios, city-ledger aging.
import type { Poisha } from "./money";
import { nightsBetween, type ISODate } from "./dates";

export interface FolioChargeLike {
  total: Poisha;
  amount?: Poisha;
  serviceCharge?: Poisha;
  vat?: Poisha;
  otherTax?: Poisha;
  category?: string;
  voidedAt?: Date | string | null;
}
export interface PaymentLike {
  type: "PAYMENT" | "REFUND" | "DEPOSIT" | string;
  amount: Poisha;
  method?: string;
  voidedAt?: Date | string | null;
}

export interface FolioBalance {
  charges: Poisha;
  net: Poisha;
  serviceCharge: Poisha;
  vat: Poisha;
  otherTax: Poisha;
  payments: Poisha; // payments + deposits − refunds
  refunds: Poisha;
  balance: Poisha; // positive = guest owes; negative = credit (refund due)
}

export function folioBalance(charges: FolioChargeLike[], payments: PaymentLike[]): FolioBalance {
  const live = charges.filter((c) => !c.voidedAt);
  const sum = (f: (c: FolioChargeLike) => number) => live.reduce((a, c) => a + (f(c) || 0), 0);
  const livePay = payments.filter((p) => !p.voidedAt);
  const received = livePay.filter((p) => p.type !== "REFUND").reduce((a, p) => a + p.amount, 0);
  const refunds = livePay.filter((p) => p.type === "REFUND").reduce((a, p) => a + p.amount, 0);
  const chargesTotal = sum((c) => c.total);
  return {
    charges: chargesTotal,
    net: sum((c) => c.amount ?? c.total),
    serviceCharge: sum((c) => c.serviceCharge ?? 0),
    vat: sum((c) => c.vat ?? 0),
    otherTax: sum((c) => c.otherTax ?? 0),
    payments: received - refunds,
    refunds,
    balance: chargesTotal - (received - refunds),
  };
}

export interface RoutableFolio {
  id: string;
  type: string;
  status: string;
  parentFolioId: string | null;
  routing: string[]; // categories, or "*" for all
}

/**
 * Chooses the folio that receives a charge of `category`: an open split folio whose routing includes the
 * category wins, then an open folio routing "*", then the guest's primary folio.
 */
export function routeCharge(primaryFolioId: string, folios: RoutableFolio[], category: string): string {
  const open = folios.filter((f) => f.status === "OPEN" && f.id !== primaryFolioId);
  const exact = open.find((f) => f.routing.includes(category));
  if (exact) return exact.id;
  const all = open.find((f) => f.routing.includes("*"));
  return all ? all.id : primaryFolioId;
}

export const AGING_BUCKETS = ["CURRENT", "D1_30", "D31_60", "D61_90", "D90_PLUS"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export function agingBucket(dueDate: ISODate, asOf: ISODate): AgingBucket {
  const days = nightsBetween(dueDate, asOf);
  if (days <= 0) return "CURRENT";
  if (days <= 30) return "D1_30";
  if (days <= 60) return "D31_60";
  if (days <= 90) return "D61_90";
  return "D90_PLUS";
}

export function agingReport(items: { companyId: string; balance: Poisha; dueDate: ISODate }[], asOf: ISODate) {
  const rows = new Map<string, Record<AgingBucket, Poisha> & { total: Poisha }>();
  for (const it of items) {
    if (!it.balance) continue;
    const r = rows.get(it.companyId) ?? { CURRENT: 0, D1_30: 0, D31_60: 0, D61_90: 0, D90_PLUS: 0, total: 0 };
    r[agingBucket(it.dueDate, asOf)] += it.balance;
    r.total += it.balance;
    rows.set(it.companyId, r);
  }
  return rows;
}

/** A folio can be settled only when its balance is exactly zero. */
export function canCloseFolio(b: FolioBalance): { ok: boolean; reason?: string } {
  if (b.balance > 0) return { ok: false, reason: "Folio has an outstanding balance" };
  if (b.balance < 0) return { ok: false, reason: "Folio has a credit balance; refund it or transfer it first" };
  return { ok: true };
}

/** Totals of a set of payments grouped by method (cashier / shift reports). */
export function paymentsByMethod(payments: PaymentLike[]): Record<string, Poisha> {
  const out: Record<string, Poisha> = {};
  for (const p of payments) {
    if (p.voidedAt) continue;
    const m = p.method ?? "UNKNOWN";
    out[m] = (out[m] ?? 0) + (p.type === "REFUND" ? -p.amount : p.amount);
  }
  return out;
}
