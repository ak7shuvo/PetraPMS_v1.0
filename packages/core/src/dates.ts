// Business dates are plain "YYYY-MM-DD" strings. All arithmetic is done in UTC to avoid DST/timezone drift.

export type ISODate = string;

const RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isISODate(s: unknown): s is ISODate {
  if (typeof s !== "string" || !RE.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const toUTC = (s: ISODate) => new Date(s + "T00:00:00Z");
const fromUTC = (d: Date): ISODate => d.toISOString().slice(0, 10);

export function addDays(s: ISODate, n: number): ISODate {
  const d = toUTC(s);
  d.setUTCDate(d.getUTCDate() + n);
  return fromUTC(d);
}

/** Number of nights between arrival and departure (departure exclusive). */
export function nightsBetween(arrival: ISODate, departure: ISODate): number {
  return Math.round((toUTC(departure).getTime() - toUTC(arrival).getTime()) / 86400000);
}

/** Every night of a stay: arrival … departure-1 */
export function eachNight(arrival: ISODate, departure: ISODate): ISODate[] {
  const n = nightsBetween(arrival, departure);
  const out: ISODate[] = [];
  for (let i = 0; i < n; i++) out.push(addDays(arrival, i));
  return out;
}

/** Inclusive range from..to */
export function eachDay(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let d = from, i = 0; d <= to && i < 4000; d = addDays(d, 1), i++) out.push(d);
  return out;
}

/** 0 = Sunday … 6 = Saturday */
export const dayOfWeek = (s: ISODate): number => toUTC(s).getUTCDay();

/** Half-open interval overlap: [a1, d1) ∩ [a2, d2) */
export const overlaps = (a1: ISODate, d1: ISODate, a2: ISODate, d2: ISODate): boolean => a1 < d2 && a2 < d1;

/** Calendar date "today" in a given IANA timezone (default Asia/Dhaka). */
export function calendarToday(timeZone = "Asia/Dhaka", now = new Date()): ISODate {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** "HH:MM" now in a timezone. */
export function clockNow(timeZone = "Asia/Dhaka", now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("hour") === "24" ? "00" : get("hour")}:${get("minute")}`;
}

/** Accepts YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY and Excel serial numbers. Returns null if invalid. */
export function parseFlexibleDate(input: unknown): ISODate | null {
  if (input === null || input === undefined || input === "") return null;
  if (input instanceof Date && !Number.isNaN(input.getTime())) return fromUTC(new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate())));
  if (typeof input === "number" && input > 20000 && input < 80000) {
    // Excel serial date (1900 system)
    return addDays("1899-12-30", Math.floor(input));
  }
  const s = String(input).trim();
  if (isISODate(s)) return s;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s);
  if (iso) {
    const c = `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
    return isISODate(c) ? c : null;
  }
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (dmy) {
    const c = `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
    return isISODate(c) ? c : null;
  }
  return null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function formatDate(s: ISODate | null | undefined, style: "DD/MM/YYYY" | "DD MMM YYYY" | "YYYY-MM-DD" | "DD MMM" = "DD/MM/YYYY"): string {
  if (!s || !isISODate(s)) return s ?? "";
  const [y, m, d] = s.split("-");
  if (style === "YYYY-MM-DD") return s;
  if (style === "DD MMM") return `${d} ${MONTHS[Number(m) - 1]}`;
  if (style === "DD MMM YYYY") return `${d} ${MONTHS[Number(m) - 1]} ${y}`;
  return `${d}/${m}/${y}`;
}

export const minDate = (a: ISODate, b: ISODate) => (a < b ? a : b);
export const maxDate = (a: ISODate, b: ISODate) => (a > b ? a : b);
export const monthStart = (d: ISODate) => d.slice(0, 8) + "01";
