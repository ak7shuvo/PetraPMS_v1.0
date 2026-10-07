// Offline licensing with Ed25519 (node:crypto). The vendor signs a JSON payload with the private key
// (tools/license-keygen, never shipped); the app embeds only the public key and verifies offline.
// Key format: "PETRA1.<base64url(payload JSON)>.<base64url(signature)>"
import { createPublicKey, createPrivateKey, sign, verify, generateKeyPairSync, createHash, type KeyObject } from "node:crypto";

export type Edition = "BASIC" | "STANDARD" | "PREMIUM";

export const MODULES = ["core", "housekeeping", "maintenance", "pos", "reports", "cityledger", "import", "multiwindow", "notifications"] as const;
export type LicenseModule = (typeof MODULES)[number];

export const EDITION_MODULES: Record<Edition, LicenseModule[]> = {
  BASIC: ["core", "housekeeping", "reports", "import"],
  STANDARD: ["core", "housekeeping", "maintenance", "reports", "cityledger", "import", "multiwindow"],
  PREMIUM: [...MODULES],
};

export const PRODUCT = "PetraPMS";

/**
 * Signed license payload. Contains NO secrets: it is data the customer can read.
 * v1 = original format (still accepted). v2 adds product/hotel/plan identity, installation limit, grace and status-refresh policy.
 * `fingerprint` is the Installation identity (hash of this computer's identifiers); null = not bound.
 */
export interface LicensePayload {
  v: 1 | 2;
  id: string;
  customer: string;
  hotel: string;
  edition: Edition;
  maxRooms: number;
  maxTerminals: number; // concurrent signed-in windows / terminals
  modules: LicenseModule[];
  issuedAt: string; // YYYY-MM-DD
  expiresAt: string | null; // null = perpetual
  supportUntil: string | null;
  fingerprint: string | null; // null = not bound (floating)
  // ---- v2 ----
  product?: typeof PRODUCT;
  hotelId?: string; // stable vendor-assigned hotel identity, e.g. HTL-7F3A9C
  plan?: string; // commercial plan label: PERPETUAL | ANNUAL | MONTHLY | TRIAL-EXT …
  ref?: string; // activation reference PETRA-XXXX-XXXX-XXXX-XXXX (lookup only, grants nothing)
  maxInstallations?: number; // computers this license may be installed on (tracked by the vendor)
  graceDays?: number; // days after expiry in which the app keeps working with a warning
  statusMaxAgeDays?: number | null; // if set, the signed status list must be refreshed at least this often
  features?: string[]; // additional feature flags for future use
}

const PREFIX = "PETRA1";
const b64u = (b: Buffer) => b.toString("base64url");

export function generateKeyPair(): { publicKeyPem: string; privateKeyPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(), privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
}

export function signLicense(payload: LicensePayload, privateKeyPem: string | KeyObject): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const sig = sign(null, body, typeof privateKeyPem === "string" ? createPrivateKey(privateKeyPem) : privateKeyPem);
  return `${PREFIX}.${b64u(body)}.${b64u(sig)}`;
}

export type LicenseErrorCode = "FORMAT" | "SIGNATURE" | "PAYLOAD" | "FINGERPRINT";
export class LicenseError extends Error {
  code: LicenseErrorCode;
  constructor(code: LicenseErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export function verifyLicense(key: string, publicKeyPem: string): LicensePayload {
  const clean = key.replace(/\s+/g, "");
  const parts = clean.split(".");
  if (parts.length !== 3 || parts[0] !== PREFIX) throw new LicenseError("FORMAT", "Not a PetraPMS license key");
  const body = Buffer.from(parts[1], "base64url");
  const sig = Buffer.from(parts[2], "base64url");
  let ok = false;
  try {
    ok = verify(null, body, createPublicKey(publicKeyPem), sig);
  } catch {
    ok = false;
  }
  if (!ok) throw new LicenseError("SIGNATURE", "License signature is invalid");
  let p: LicensePayload;
  try {
    p = JSON.parse(body.toString("utf8"));
  } catch {
    throw new LicenseError("PAYLOAD", "License payload is unreadable");
  }
  if ((p.v !== 1 && p.v !== 2) || !p.customer || !p.edition || !Array.isArray(p.modules) || typeof p.maxRooms !== "number") throw new LicenseError("PAYLOAD", "License payload is incomplete");
  if (p.v === 2) {
    if (p.product !== PRODUCT) throw new LicenseError("PAYLOAD", "This license is for a different product");
    if (!p.hotelId || !/^[A-Z0-9-]{4,32}$/.test(p.hotelId)) throw new LicenseError("PAYLOAD", "License has no valid hotel identity");
  }
  return p;
}

/* ---- activation reference + request ---------------------------------------------------------------------------------- */
const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
export const REF_PATTERN = /^PETRA-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/;
/** Human-friendly reference printed on invoices/emails. It is only an index into the vendor's ledger. */
export function newActivationRef(random: (n: number) => Uint8Array): string {
  const b = random(16);
  const g = (o: number) => Array.from({ length: 4 }, (_, i) => REF_ALPHABET[b[o + i] % 32]).join("");
  return `PETRA-${g(0)}-${g(4)}-${g(8)}-${g(12)}`;
}

/** What the customer sends to the vendor to obtain a license for this installation. Contains no secrets. */
export interface ActivationRequest {
  fingerprint: string;
  hotel: string;
  appVersion: string;
  rooms: number;
  licenseId: string | null;
  at: string;
}
export const makeActivationRequest = (r: ActivationRequest) => `PETRAREQ1.${Buffer.from(JSON.stringify(r)).toString("base64url")}`;
export function parseActivationRequest(code: string): ActivationRequest {
  const [pre, body] = code.replace(/\s+/g, "").split(".");
  if (pre !== "PETRAREQ1" || !body) throw new LicenseError("FORMAT", "Not an activation request");
  const r = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as ActivationRequest;
  if (!r.fingerprint || typeof r.fingerprint !== "string") throw new LicenseError("PAYLOAD", "Activation request is incomplete");
  return r;
}

/* ---- signed status list (suspend / revoke) ----------------------------------------------------------------------------- */
export interface StatusEntry {
  id: string; // license id
  status: "SUSPENDED" | "REVOKED";
  reason: string;
  at: string;
}
/** `seq` only ever grows; the app refuses an older list so a stale "all clear" cannot be replayed. */
export interface StatusList {
  v: 1;
  seq: number;
  issuedAt: string;
  entries: StatusEntry[];
}
export function signStatusList(list: StatusList, privateKeyPem: string | KeyObject): string {
  const body = Buffer.from(JSON.stringify(list), "utf8");
  return `PETRAS1.${b64u(body)}.${b64u(sign(null, body, typeof privateKeyPem === "string" ? createPrivateKey(privateKeyPem) : privateKeyPem))}`;
}
export function verifyStatusList(doc: string, publicKeyPem: string): StatusList {
  const parts = doc.replace(/\s+/g, "").split(".");
  if (parts.length !== 3 || parts[0] !== "PETRAS1") throw new LicenseError("FORMAT", "Not a PetraPMS license status list");
  const body = Buffer.from(parts[1], "base64url");
  let ok = false;
  try {
    ok = verify(null, body, createPublicKey(publicKeyPem), Buffer.from(parts[2], "base64url"));
  } catch {
    ok = false;
  }
  if (!ok) throw new LicenseError("SIGNATURE", "Status list signature is invalid");
  const l = JSON.parse(body.toString("utf8")) as StatusList;
  if (l.v !== 1 || !Number.isInteger(l.seq) || !Array.isArray(l.entries)) throw new LicenseError("PAYLOAD", "Status list is unreadable");
  return l;
}

export const TRIAL_DAYS = 14;

export type LicenseState =
  | { mode: "TRIAL"; daysLeft: number; readOnly: false; payload: null; warnings: string[] }
  | { mode: "ACTIVE"; daysLeft: number | null; readOnly: false; payload: LicensePayload; warnings: string[]; inGrace?: boolean }
  | { mode: "READ_ONLY"; reason: "TRIAL_ENDED" | "EXPIRED" | "FINGERPRINT" | "CLOCK" | "INVALID" | "ROOMS" | "REVOKED" | "SUSPENDED" | "STATUS_STALE"; readOnly: true; payload: LicensePayload | null; warnings: string[] };

const days = (from: string, to: string) => Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000);

/**
 * Evaluates the license state. `lastSeen` is the latest calendar date the app has ever observed (persisted);
 * a current date more than 1 day before it means the clock was rolled back.
 */
export function evaluateLicense(opts: { payload: LicensePayload | null; invalid?: boolean; trialStart: string; today: string; lastSeen: string | null; fingerprint: string; roomCount: number; status?: StatusEntry | null; statusAgeDays?: number | null }): LicenseState {
  const warnings: string[] = [];
  if (opts.lastSeen && days(opts.today, opts.lastSeen) > 1) return { mode: "READ_ONLY", reason: "CLOCK", readOnly: true, payload: opts.payload, warnings: ["The system clock appears to have been set back. Correct the date to continue."] };
  if (opts.invalid) return { mode: "READ_ONLY", reason: "INVALID", readOnly: true, payload: null, warnings: ["The stored license key is invalid."] };
  const p = opts.payload;
  if (!p) {
    const left = TRIAL_DAYS - days(opts.trialStart, opts.today);
    if (left <= 0) return { mode: "READ_ONLY", reason: "TRIAL_ENDED", readOnly: true, payload: null, warnings: ["The 14-day trial has ended. Activate a license to continue editing; your data stays viewable and exportable."] };
    if (left <= 3) warnings.push(`Trial ends in ${left} day(s).`);
    return { mode: "TRIAL", daysLeft: left, readOnly: false, payload: null, warnings };
  }
  if (opts.status && opts.status.id === p.id) {
    const rev = opts.status.status === "REVOKED";
    return { mode: "READ_ONLY", reason: rev ? "REVOKED" : "SUSPENDED", readOnly: true, payload: p, warnings: [rev ? "This license has been revoked. Contact PETRA." : "This license is suspended. Contact PETRA to restore it."] };
  }
  if (p.fingerprint && p.fingerprint !== opts.fingerprint) return { mode: "READ_ONLY", reason: "FINGERPRINT", readOnly: true, payload: p, warnings: ["This license is bound to another computer. Request a license transfer."] };
  if (opts.roomCount > p.maxRooms) return { mode: "READ_ONLY", reason: "ROOMS", readOnly: true, payload: p, warnings: [`Room count ${opts.roomCount} exceeds licensed ${p.maxRooms}. Deactivate rooms or upgrade.`] };
  let left: number | null = null;
  if (p.expiresAt) {
    left = days(opts.today, p.expiresAt);
    const grace = Math.max(0, Math.min(90, p.graceDays ?? 0));
    if (left < 0 && -left <= grace) {
      return { mode: "ACTIVE", daysLeft: left, readOnly: false, payload: p, inGrace: true, warnings: [`License expired on ${p.expiresAt}. Grace period ends in ${grace + left} day(s) — renew now.`] };
    }
    if (left < 0) return { mode: "READ_ONLY", reason: "EXPIRED", readOnly: true, payload: p, warnings: [`License expired on ${p.expiresAt}.`] };
    if (left <= 1) warnings.push(`License expires ${left === 0 ? "today" : "tomorrow"}.`);
    else if (left <= 30) warnings.push(`License expires in ${left} days.`);
  }
  if (p.v === 2 && p.statusMaxAgeDays && opts.statusAgeDays != null) {
    const over = opts.statusAgeDays - p.statusMaxAgeDays;
    const grace = Math.max(0, Math.min(90, p.graceDays ?? 0)) || 14;
    if (over > grace) return { mode: "READ_ONLY", reason: "STATUS_STALE", readOnly: true, payload: p, warnings: ["The license status has not been refreshed for too long. Connect to the internet once or import the latest status file from PETRA."] };
    if (over > 0) warnings.push(`License status needs a refresh within ${grace - over} day(s): connect to the internet once or import the status file from PETRA.`);
  }
  if (p.supportUntil && days(opts.today, p.supportUntil) < 0) warnings.push(`Support and updates ended on ${p.supportUntil}.`);
  return { mode: "ACTIVE", daysLeft: left, readOnly: false, payload: p, warnings };
}

/** Which warning threshold (30/7/1 days) applies — used to send one notification per threshold. */
export function expiryThreshold(daysLeft: number | null): 30 | 7 | 1 | null {
  if (daysLeft === null) return null;
  if (daysLeft <= 1) return 1;
  if (daysLeft <= 7) return 7;
  if (daysLeft <= 30) return 30;
  return null;
}

/** Stable machine fingerprint from hardware-ish identifiers (supplied by the host). */
export function fingerprintFrom(parts: string[]): string {
  return createHash("sha256")
    .update(parts.filter(Boolean).join("|"))
    .digest("hex")
    .slice(0, 20)
    .toUpperCase()
    .replace(/(.{5})(?=.)/g, "$1-");
}

/** Transfer request code: lets the vendor re-issue the key for a new fingerprint. */
export function transferRequestCode(licenseId: string, oldFp: string, newFp: string): string {
  return Buffer.from(JSON.stringify({ licenseId, oldFp, newFp, at: new Date().toISOString().slice(0, 10) })).toString("base64url");
}
export function parseTransferRequest(code: string): { licenseId: string; oldFp: string; newFp: string; at: string } {
  return JSON.parse(Buffer.from(code.trim(), "base64url").toString("utf8"));
}
