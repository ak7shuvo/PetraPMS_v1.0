// License state for this installation: 14-day trial, then a signed key (Ed25519, verified offline).
// When the trial ends or the key is invalid/expired the app becomes read-only: data stays viewable and
// exportable (reports, backups, CSV) but nothing can be changed. Data is never deleted or locked away.
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { calendarToday } from "@petra/core";
import { evaluateLicense, fingerprintFrom, verifyLicense, transferRequestCode, makeActivationRequest, verifyStatusList, LicenseError, type LicensePayload, type LicenseState, type StatusEntry, EDITION_MODULES } from "@petra/core/license";
import type { Db, Tx } from "../db";
import { env } from "../env";
import { getSection, patchSection } from "../settings";
import { ApiError } from "../errors";
import { log } from "../log";

export function machineFingerprint(): string {
  // Test/dev override only: in a production build it would allow spoofing a machine-bound licence.
  if (process.env.PETRA_FINGERPRINT && process.env.NODE_ENV !== "production") return process.env.PETRA_FINGERPRINT;
  const nets = Object.values(os.networkInterfaces())
    .flat()
    .filter((n) => n && !n.internal && n.mac && n.mac !== "00:00:00:00:00:00")
    .map((n) => n!.mac)
    .sort();
  // A persisted machine id keeps the fingerprint stable if network adapters change.
  const idFile = path.join(env().dataDir, ".machine-id");
  let mid = "";
  try {
    mid = fs.readFileSync(idFile, "utf8").trim();
  } catch {
    mid = `${os.hostname()}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    try {
      fs.writeFileSync(idFile, mid);
    } catch {
      /* read-only data dir: fall back to hardware only */
    }
  }
  return fingerprintFrom([os.hostname(), os.platform(), os.arch(), os.cpus()[0]?.model ?? "", nets[0] ?? "", mid]);
}

export interface LicenseInfo {
  state: LicenseState;
  fingerprint: string;
  maxTerminals: number;
  maxRooms: number | null;
  modules: string[];
  edition: string;
  customer: string | null;
  hotel: string | null;
  expiresAt: string | null;
  supportUntil: string | null;
  licenseId: string | null;
  hotelId: string | null;
  plan: string | null;
  ref: string | null;
  statusSeq: number;
  statusAt: string | null;
}

const TRIAL_TERMINALS = 5;

/**
 * Latest calendar date this installation has ever seen, kept in the database AND in a file next to it. Restoring an old
 * backup (or editing the database) therefore cannot move the clock high-water mark backwards.
 */
function hwmFile() {
  return path.join(env().dataDir, ".license-hwm");
}
function readHwm(): string {
  try {
    const v = fs.readFileSync(hwmFile(), "utf8").trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "";
  } catch {
    return "";
  }
}
function writeHwm(d: string) {
  try {
    fs.writeFileSync(hwmFile(), d);
  } catch {
    /* read-only data dir: the database copy still protects us */
  }
}

/** The verified status entry for a license id from the stored signed list (null = nothing against it, or no/invalid list). */
function statusFor(doc: string, id: string | null | undefined): StatusEntry | null {
  if (!doc || !id) return null;
  try {
    return verifyStatusList(doc, env().licensePublicKey).entries.find((e) => e.id === id) ?? null;
  } catch {
    return null;
  }
}

export async function getLicenseInfo(db: Db | Tx): Promise<LicenseInfo> {
  const today = calendarToday();
  const lic = await getSection(db, "license");
  const hwm = [lic.lastSeenDate, readHwm()].filter(Boolean).sort().pop() ?? "";
  if (!lic.trialStart || !lic.lastSeenDate || today > hwm || hwm > lic.lastSeenDate) {
    await patchSection(db, "license", { trialStart: lic.trialStart || today, lastSeenDate: !hwm || today > hwm ? today : hwm });
  }
  if (!hwm || today > hwm) writeHwm(today);
  lic.lastSeenDate = !hwm || today > hwm ? today : hwm;
  const row = await db.license.findUnique({ where: { id: "license" } });
  let payload: LicensePayload | null = null;
  let invalid = false;
  if (row?.key) {
    try {
      payload = verifyLicense(row.key, env().licensePublicKey);
    } catch {
      invalid = true;
    }
  }
  const fp = machineFingerprint();
  const roomCount = await db.room.count({ where: { active: true } });
  const status = payload ? statusFor(lic.statusDoc, payload.id) : null;
  const statusRef = lic.statusAt || (row?.activatedAt ? row.activatedAt.toISOString().slice(0, 10) : "");
  const statusAgeDays = payload && statusRef ? Math.max(0, Math.round((Date.parse(today + "T00:00:00Z") - Date.parse(statusRef.slice(0, 10) + "T00:00:00Z")) / 86400000)) : null;
  const state = evaluateLicense({ payload, invalid, trialStart: lic.trialStart || today, today, lastSeen: hwm || null, fingerprint: fp, roomCount, status, statusAgeDays });
  return {
    state,
    fingerprint: fp,
    maxTerminals: payload ? payload.maxTerminals : TRIAL_TERMINALS,
    maxRooms: payload ? payload.maxRooms : null,
    modules: payload ? payload.modules : [...EDITION_MODULES.PREMIUM],
    edition: payload ? payload.edition : "TRIAL",
    customer: payload?.customer ?? null,
    hotel: payload?.hotel ?? null,
    expiresAt: payload?.expiresAt ?? null,
    supportUntil: payload?.supportUntil ?? null,
    licenseId: payload?.id ?? null,
    hotelId: payload?.hotelId ?? null,
    plan: payload?.plan ?? null,
    ref: payload?.ref ?? null,
    statusSeq: lic.statusSeq,
    statusAt: lic.statusAt || null,
  };
}

/** Activates a key. Rejects keys bound to another machine (the transfer flow re-issues them). */
export async function activateLicense(db: Db, key: string): Promise<LicensePayload> {
  let p: LicensePayload;
  try {
    p = verifyLicense(key, env().licensePublicKey);
  } catch (e) {
    log("warn", "license", `activation refused: ${e instanceof LicenseError ? e.code : "invalid key"}`);
    throw new ApiError(400, "LICENSE_INVALID", e instanceof LicenseError ? e.message : "License key is invalid");
  }
  const fp = machineFingerprint();
  const lic = await getSection(db, "license");
  const st = statusFor(lic.statusDoc, p.id);
  if (st) throw new ApiError(400, st.status === "REVOKED" ? "LICENSE_REVOKED" : "LICENSE_SUSPENDED", `This license is ${st.status.toLowerCase()}. Contact PETRA.`);
  const prev = await db.license.findUnique({ where: { id: "license" } });
  if (prev?.payload) {
    try {
      const old = JSON.parse(prev.payload) as LicensePayload;
      if (old.hotelId && p.hotelId && old.hotelId !== p.hotelId) throw new ApiError(400, "LICENSE_HOTEL_MISMATCH", "This license belongs to a different hotel than the one already activated on this installation.");
    } catch (e) {
      if (e instanceof ApiError) throw e;
    }
  }
  if (p.fingerprint && p.fingerprint !== fp) throw new ApiError(400, "LICENSE_FINGERPRINT", `This key is bound to computer ${p.fingerprint}. This computer is ${fp}. Request a transfer.`);
  const rooms = await db.room.count({ where: { active: true } });
  if (rooms > p.maxRooms) throw new ApiError(400, "LICENSE_ROOMS", `This license covers ${p.maxRooms} rooms but ${rooms} rooms are active.`);
  if (p.expiresAt && p.expiresAt < calendarToday()) throw new ApiError(400, "LICENSE_EXPIRED", `This key expired on ${p.expiresAt}.`);
  await db.license.upsert({ where: { id: "license" }, create: { id: "license", key: key.replace(/\s+/g, ""), payload: JSON.stringify(p), status: "ACTIVE", fingerprint: fp, activatedAt: new Date() }, update: { key: key.replace(/\s+/g, ""), payload: JSON.stringify(p), status: "ACTIVE", fingerprint: fp, activatedAt: new Date() } });
  await patchSection(db, "license", { warnedThreshold: null });
  log("info", "license", `activated ${p.id} (${p.edition}, ${p.maxRooms} rooms, hotel ${p.hotelId ?? "-"})`);
  return p;
}

export async function transferCode(db: Db): Promise<string> {
  const info = await getLicenseInfo(db);
  if (!info.licenseId) throw new ApiError(400, "NO_LICENSE", "No license is activated on this computer");
  const row = await db.license.findUnique({ where: { id: "license" } });
  return transferRequestCode(info.licenseId, row?.fingerprint ?? "", info.fingerprint);
}

export function moduleEnabled(info: LicenseInfo, m: string) {
  return info.modules.includes(m);
}

/** Code the customer sends to PETRA to get a license for this installation (no secrets inside). */
export async function activationRequest(db: Db): Promise<string> {
  const info = await getLicenseInfo(db);
  const hotel = await db.hotel.findUnique({ where: { id: "hotel" }, select: { name: true } });
  const rooms = await db.room.count({ where: { active: true } });
  return makeActivationRequest({ fingerprint: info.fingerprint, hotel: hotel?.name ?? "", appVersion: env().appVersion, rooms, licenseId: info.licenseId, at: calendarToday() });
}

/** Imports a signed status list (suspend/revoke). Older lists are refused so a stale "all clear" cannot be replayed. */
export async function importStatusList(db: Db, doc: string): Promise<{ seq: number; entries: number }> {
  let l;
  try {
    l = verifyStatusList(doc, env().licensePublicKey);
  } catch (e) {
    throw new ApiError(400, "STATUS_INVALID", e instanceof LicenseError ? e.message : "Status list is invalid");
  }
  const cur = await getSection(db, "license");
  if (l.seq < cur.statusSeq) throw new ApiError(409, "STATUS_OLDER", `This status list (#${l.seq}) is older than the one already installed (#${cur.statusSeq}).`);
  await patchSection(db, "license", { statusDoc: doc.replace(/\s+/g, ""), statusSeq: l.seq, statusAt: l.issuedAt });
  log("info", "license", `status list #${l.seq} installed (${l.entries.length} entries)`);
  return { seq: l.seq, entries: l.entries.length };
}

/** Optional online refresh of the status list. Offline hotels simply skip it; failures are never shown as errors. */
export async function refreshStatusFromUrl(db: Db, url: string): Promise<boolean> {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    const res = await fetch(u, { signal: AbortSignal.timeout(10_000), redirect: "error", headers: { accept: "text/plain" } });
    if (!res.ok) return false;
    const text = (await res.text()).slice(0, 200_000);
    await importStatusList(db, text.trim());
    return true;
  } catch (e) {
    log("info", "license", `status refresh skipped: ${(e as Error).message}`);
    return false;
  }
}
