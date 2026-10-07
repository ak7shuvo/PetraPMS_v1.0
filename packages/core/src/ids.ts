// Human-readable document numbers from named sequences (e.g. "RES-2610-00042").
export interface SequenceFormat {
  prefix: string;
  /** include YYMM of the business date (resets monthly) */
  period?: boolean;
  pad?: number;
}

export const SEQUENCES: Record<string, SequenceFormat> = {
  reservation: { prefix: "RES", period: true, pad: 5 },
  folio: { prefix: "F", period: true, pad: 5 },
  receipt: { prefix: "RCT", period: true, pad: 5 },
  invoice: { prefix: "INV", period: true, pad: 5 },
  maintenance: { prefix: "MT", pad: 5 },
  lostfound: { prefix: "LF", pad: 5 },
  guest: { prefix: "G", pad: 6 },
  company: { prefix: "C", pad: 4 },
};

export function sequenceKey(name: string, businessDate: string): string {
  const f = SEQUENCES[name];
  return f?.period ? `${name}:${businessDate.slice(2, 4)}${businessDate.slice(5, 7)}` : name;
}

export function formatSequence(name: string, value: number, businessDate: string): string {
  const f = SEQUENCES[name] ?? { prefix: name.toUpperCase(), pad: 5 };
  const n = String(value).padStart(f.pad ?? 5, "0");
  return f.period ? `${f.prefix}-${businessDate.slice(2, 4)}${businessDate.slice(5, 7)}-${n}` : `${f.prefix}-${n}`;
}

/** Random URL-safe token (works in browser and Node ≥ 19). */
export function randomToken(bytes = 32): string {
  const a = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(a);
  let s = "";
  for (const b of a) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Short numeric code. */
export function randomDigits(n = 6): string {
  const a = new Uint32Array(n);
  globalThis.crypto.getRandomValues(a);
  return Array.from(a, (x) => String(x % 10)).join("");
}

/** Readable temporary password (no ambiguous characters). */
export function tempPassword(len = 10): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const a = new Uint32Array(len);
  globalThis.crypto.getRandomValues(a);
  return Array.from(a, (x) => alphabet[x % alphabet.length]).join("");
}
