// Phone normalisation. Bangladesh numbers become +8801XXXXXXXXX; foreign numbers in +E.164 are kept.
import { fromBanglaDigits } from "./money";

export function normalizePhone(input: unknown): string | null {
  if (input === null || input === undefined) return null;
  let s = fromBanglaDigits(String(input)).trim();
  if (!s) return null;
  const plus = s.startsWith("+") || s.startsWith("00");
  s = s.replace(/[^\d]/g, "");
  if (s.startsWith("00")) s = s.slice(2);
  if (/^01[3-9]\d{8}$/.test(s)) return `+88${s}`;
  if (/^8801[3-9]\d{8}$/.test(s)) return `+${s}`;
  if (!plus && /^1[3-9]\d{8}$/.test(s)) return `+880${s}`;
  if (!plus && /^0[2-9]\d{6,9}$/.test(s)) return `+880${s.slice(1)}`;
  if (/^880[2-9]\d{6,9}$/.test(s)) return `+${s}`;
  if (plus && /^[1-9]\d{6,14}$/.test(s)) return `+${s}`;
  return null;
}

export const isBdMobile = (p: string | null) => !!p && /^\+8801[3-9]\d{8}$/.test(p);

/** Local display: +8801712345678 → 01712-345678 */
export function formatPhone(p: string | null | undefined): string {
  if (!p) return "";
  if (isBdMobile(p)) {
    const l = "0" + p.slice(4);
    return `${l.slice(0, 5)}-${l.slice(5)}`;
  }
  return p;
}
