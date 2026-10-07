// Money is always an integer number of poisha (1 BDT = 100 poisha). Never floats in storage or arithmetic.

export type Poisha = number;

export class MoneyError extends Error {}

const BN_DIGITS = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];
export function toBanglaDigits(s: string): string {
  return s.replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]);
}
export function fromBanglaDigits(s: string): string {
  return s.replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));
}

/** Parses "1,25,000.50", "1250", "১২৫০" or a number into poisha. Max 2 decimals. Throws MoneyError. */
export function parseMoney(input: unknown, label = "Amount"): Poisha {
  if (typeof input === "number") {
    if (!Number.isFinite(input)) throw new MoneyError(`${label} is not a number`);
    input = input.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  }
  if (typeof input !== "string") throw new MoneyError(`${label} is required`);
  const s = fromBanglaDigits(input)
    .trim()
    .replace(/[,\s৳]/g, "")
    .replace(/^BDT/i, "")
    .replace(/^Tk\.?/i, "");
  const m = /^(-)?(\d*)(?:\.(\d*))?$/.exec(s);
  if (!s || !m || (m[2] === "" && (m[3] ?? "") === "")) throw new MoneyError(`${label} is not a valid amount`);
  let frac = m[3] ?? "";
  if (frac.length > 2) {
    if (/^0*$/.test(frac.slice(2))) frac = frac.slice(0, 2);
    else throw new MoneyError(`${label} can have at most 2 decimals`);
  }
  const v = Number(m[2] || "0") * 100 + Number(frac.padEnd(2, "0"));
  if (!Number.isSafeInteger(v)) throw new MoneyError(`${label} is too large`);
  return m[1] ? -v : v;
}

/** Half-up rounding of a / b for integers (b ≠ 0), exact via BigInt. */
export function divRound(a: number, b: number): number {
  const A = BigInt(Math.trunc(a));
  const B = BigInt(Math.trunc(b));
  if (B === 0n) return 0;
  const neg = A < 0n !== B < 0n;
  const aa = A < 0n ? -A : A;
  const bb = B < 0n ? -B : B;
  const q = (aa * 2n + bb) / (bb * 2n);
  return Number(neg ? -q : q);
}

/** amount × basis points / 10000, half-up. */
export const applyBp = (amount: Poisha, bp: number): Poisha => divRound(amount * bp, 10000);

/** Splits total proportionally to weights so that parts sum exactly to total. */
export function allocate(total: Poisha, weights: number[]): Poisha[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!sum || !total) return weights.map(() => 0);
  const parts = weights.map((w) => Math.trunc((total * w) / sum));
  let rest = total - parts.reduce((a, b) => a + b, 0);
  const order = weights.map((w, i) => [w, i] as const).sort((a, b) => b[0] - a[0]);
  for (let k = 0; rest !== 0; k++) {
    const i = order[k % order.length][1];
    const step = rest > 0 ? 1 : -1;
    parts[i] += step;
    rest -= step;
  }
  return parts;
}

export interface MoneyFormat {
  /** "lakh" → 1,25,000.00 ; "intl" → 125,000.00 */
  grouping?: "lakh" | "intl";
  banglaDigits?: boolean;
  symbol?: boolean;
  decimals?: boolean;
}

function group(intPart: string, grouping: "lakh" | "intl"): string {
  if (grouping === "intl") return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (intPart.length <= 3) return intPart;
  const last3 = intPart.slice(-3);
  const rest = intPart.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${rest},${last3}`;
}

export function formatMoney(p: Poisha | null | undefined, f: MoneyFormat = {}): string {
  const v = Math.trunc(Number(p) || 0);
  const neg = v < 0;
  const abs = Math.abs(v);
  const int = group(String(Math.floor(abs / 100)), f.grouping ?? "lakh");
  const frac = String(abs % 100).padStart(2, "0");
  let s = f.decimals === false && abs % 100 === 0 ? int : `${int}.${frac}`;
  if (f.symbol !== false) s = `৳${s}`;
  if (neg) s = `-${s}`;
  return f.banglaDigits ? toBanglaDigits(s) : s;
}

/** Plain decimal string for inputs/CSV: 1250050 → "12500.50" */
export const toDecimalString = (p: Poisha): string => {
  const neg = p < 0;
  const a = Math.abs(Math.trunc(p));
  return `${neg ? "-" : ""}${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
};

export function formatUsd(p: Poisha, poishaPerUsd: number): string {
  if (!poishaPerUsd) return "";
  const cents = divRound(p * 100, poishaPerUsd);
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatNumber(n: number, f: { banglaDigits?: boolean; grouping?: "lakh" | "intl" } = {}): string {
  const neg = n < 0;
  const s = group(String(Math.abs(Math.trunc(n))), f.grouping ?? "lakh");
  const out = (neg ? "-" : "") + s;
  return f.banglaDigits ? toBanglaDigits(out) : out;
}

/** Percentage from basis points: 6667 → "66.7%" */
export const formatBp = (bp: number, digits = 1) => `${(bp / 100).toFixed(digits)}%`;

/** Amount in words (English) for invoices: 1250.50 → "One Thousand Two Hundred Fifty Taka and Fifty Poisha Only" */
export function amountInWords(p: Poisha): string {
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (n: number) => (n < 20 ? ones[n] : `${tens[Math.floor(n / 10)]}${n % 10 ? " " + ones[n % 10] : ""}`);
  const three = (n: number) => (n >= 100 ? `${ones[Math.floor(n / 100)]} Hundred${n % 100 ? " " + two(n % 100) : ""}` : two(n));
  const words = (n: number): string => {
    if (n === 0) return "Zero";
    const parts: string[] = [];
    const crore = Math.floor(n / 10000000);
    n %= 10000000;
    const lakh = Math.floor(n / 100000);
    n %= 100000;
    const thousand = Math.floor(n / 1000);
    n %= 1000;
    if (crore) parts.push(`${words(crore)} Crore`);
    if (lakh) parts.push(`${two(lakh)} Lakh`);
    if (thousand) parts.push(`${two(thousand)} Thousand`);
    if (n) parts.push(three(n));
    return parts.join(" ");
  };
  const abs = Math.abs(Math.trunc(p));
  const taka = Math.floor(abs / 100);
  const poisha = abs % 100;
  return `${p < 0 ? "Minus " : ""}${words(taka)} Taka${poisha ? ` and ${two(poisha)} Poisha` : ""} Only`;
}
