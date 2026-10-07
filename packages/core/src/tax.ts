// Tax engine: Bangladesh hotels typically charge Service Charge (10%) on the net amount and VAT (15%) on
// net + service charge. Rules are configurable: each rule has a rate (basis points), a base (NET or
// NET_PLUS_PREVIOUS = compound on the rules before it), and the charge categories it applies to.
// Exclusive mode adds taxes to the entered amount; inclusive mode treats the entered amount as the gross
// and backs out net and taxes so that net + taxes == gross exactly.
import { applyBp, type Poisha } from "./money";

export interface TaxRuleDef {
  code: string;
  name: string;
  rateBp: number;
  base: "NET" | "NET_PLUS_PREVIOUS";
  appliesTo: string[]; // categories or "*"
  sortOrder: number;
  active: boolean;
}

export type TaxMode = "EXCLUSIVE" | "INCLUSIVE";

export interface TaxLine {
  code: string;
  name: string;
  rateBp: number;
  amount: Poisha;
}

export interface TaxResult {
  net: Poisha;
  lines: TaxLine[];
  serviceCharge: Poisha;
  vat: Poisha;
  otherTax: Poisha;
  total: Poisha;
}

export const DEFAULT_TAX_RULES: TaxRuleDef[] = [
  { code: "SC", name: "Service Charge", rateBp: 1000, base: "NET", appliesTo: ["*"], sortOrder: 1, active: true },
  { code: "VAT", name: "VAT", rateBp: 1500, base: "NET_PLUS_PREVIOUS", appliesTo: ["*"], sortOrder: 2, active: true },
];

export const NON_TAXABLE_CATEGORIES = new Set(["ADJUSTMENT", "DEPOSIT", "PAID_OUT", "OPENING_BALANCE", "CANCELLATION"]);

function applicable(rules: TaxRuleDef[], category: string, taxable: boolean) {
  if (!taxable || NON_TAXABLE_CATEGORIES.has(category)) return [];
  return rules.filter((r) => r.active && (r.appliesTo.includes("*") || r.appliesTo.includes(category))).sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Taxes on a net amount (exclusive). Works for negative amounts (allowances) too. */
function taxesOnNet(net: Poisha, rules: TaxRuleDef[]): TaxLine[] {
  const lines: TaxLine[] = [];
  let running = 0;
  for (const r of rules) {
    const base = r.base === "NET_PLUS_PREVIOUS" ? net + running : net;
    const amount = applyBp(base, r.rateBp);
    lines.push({ code: r.code, name: r.name, rateBp: r.rateBp, amount });
    running += amount;
  }
  return lines;
}

/** Effective multiplier of gross over net, scaled by 10^8 for exact integer back-calculation. */
function grossFactor(rules: TaxRuleDef[]): bigint {
  const SCALE = 100_000_000n;
  let running = 0n;
  for (const r of rules) {
    const base = r.base === "NET_PLUS_PREVIOUS" ? SCALE + running : SCALE;
    running += (base * BigInt(r.rateBp)) / 10000n;
  }
  return SCALE + running;
}

export function computeTax(amount: Poisha, opts: { rules: TaxRuleDef[]; mode: TaxMode; category: string; taxable?: boolean }): TaxResult {
  const rules = applicable(opts.rules, opts.category, opts.taxable !== false);
  let net: Poisha;
  let lines: TaxLine[];
  if (opts.mode === "INCLUSIVE" && rules.length) {
    const f = grossFactor(rules);
    const abs = BigInt(Math.abs(amount));
    const n = Number((abs * 100_000_000n * 2n + f) / (f * 2n));
    net = amount < 0 ? -n : n;
    lines = taxesOnNet(net, rules);
    // put any rounding remainder on the last tax line so net + taxes == gross exactly
    const diff = amount - net - lines.reduce((a, l) => a + l.amount, 0);
    if (diff && lines.length) lines[lines.length - 1].amount += diff;
  } else {
    net = amount;
    lines = taxesOnNet(net, rules);
  }
  const sum = (pred: (l: TaxLine) => boolean) => lines.filter(pred).reduce((a, l) => a + l.amount, 0);
  const serviceCharge = sum((l) => l.code === "SC");
  const vat = sum((l) => l.code === "VAT");
  const otherTax = sum((l) => l.code !== "SC" && l.code !== "VAT");
  return { net, lines, serviceCharge, vat, otherTax, total: net + serviceCharge + vat + otherTax };
}

/** Sum of several tax results (for invoices). */
export function sumTax(results: Pick<TaxResult, "net" | "serviceCharge" | "vat" | "otherTax" | "total">[]) {
  return results.reduce(
    (a, r) => ({ net: a.net + r.net, serviceCharge: a.serviceCharge + r.serviceCharge, vat: a.vat + r.vat, otherTax: a.otherTax + r.otherTax, total: a.total + r.total }),
    { net: 0, serviceCharge: 0, vat: 0, otherTax: 0, total: 0 },
  );
}
