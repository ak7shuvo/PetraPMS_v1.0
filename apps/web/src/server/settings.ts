// Typed application settings stored as JSON rows in the Setting table, merged over defaults.
import type { Db, Tx } from "./db";

export interface Settings {
  security: { idleMinutes: number; maxFailedAttempts: number; lockMinutes: number; sessionHours: number; minPasswordLength: number };
  billing: { taxMode: "EXCLUSIVE" | "INCLUSIVE"; roundToTaka: boolean; invoiceLayout: "STANDARD" | "MUSHAK"; invoiceFooter: string; showQr: boolean; showUsd: boolean; cityLedgerPaymentTermsDays: number };
  frontdesk: { requireIdForCheckIn: boolean; requireDepositAtCheckIn: boolean; autoAssignRoom: boolean; earlyCheckInFrom: string; allowCheckoutWithBalance: boolean };
  audit: { autoTime: string; requireDeparturesResolved: boolean; postNoShowPenalty: boolean; autoReminder: boolean };
  housekeeping: { stayoverDaily: boolean; inspectionRequired: boolean };
  maintenance: { slaHours: Record<"LOW" | "MEDIUM" | "HIGH" | "CRITICAL", number>; autoBlockCritical: boolean };
  backup: {
    enabled: boolean;
    time: string;
    folder: string;
    retentionDays: number;
    encrypt: boolean;
    lastRunDate: string;
    lastFailAt: string;
    /** Second copy of every backup: another folder/NAS/USB ("folder") or S3-compatible storage ("s3" = AWS S3, Cloudflare R2, MinIO, …). Cloud copies must be encrypted. */
    remote: { provider: "none" | "folder" | "s3"; folder: string; endpoint: string; region: string; bucket: string; prefix: string; accessKeyId: string; secretAccessKey: string };
    lastRemote: { at: string; ok: boolean; error: string; fileName: string };
  };
  reports: { scheduledExportEnabled: boolean; scheduledExportFolder: string; lastExportDate: string };
  network: { lanUrl: string; httpsEnabled: boolean };
  branding: { appName: string; primaryColor: string; poweredBy: boolean; loginMessage: string };
  notifications: {
    smsEnabled: boolean;
    sms: { url: string; method: "GET" | "POST"; bodyTemplate: string; headers: string; senderId: string };
    emailEnabled: boolean;
    email: { url: string; headers: string; bodyTemplate: string; from: string };
    whatsappEnabled: boolean;
    whatsapp: { url: string; headers: string; bodyTemplate: string };
    events: Record<string, { sms: boolean; email: boolean; whatsapp: boolean }>;
  };
  locale: { defaultLocale: "en" | "bn"; grouping: "lakh" | "intl"; dateFormat: "DD/MM/YYYY" | "DD MMM YYYY" | "YYYY-MM-DD" };
  license: { trialStart: string; lastSeenDate: string; warnedThreshold: number | null; statusDoc: string; statusSeq: number; statusAt: string };
  setup: { checklistDismissed: boolean };
}

export const DEFAULT_SETTINGS: Settings = {
  security: { idleMinutes: 30, maxFailedAttempts: 5, lockMinutes: 15, sessionHours: 16, minPasswordLength: 8 },
  billing: { taxMode: "EXCLUSIVE", roundToTaka: false, invoiceLayout: "STANDARD", invoiceFooter: "Thank you for staying with us.", showQr: true, showUsd: false, cityLedgerPaymentTermsDays: 30 },
  frontdesk: { requireIdForCheckIn: true, requireDepositAtCheckIn: false, autoAssignRoom: true, earlyCheckInFrom: "08:00", allowCheckoutWithBalance: false },
  audit: { autoTime: "02:00", requireDeparturesResolved: true, postNoShowPenalty: true, autoReminder: true },
  housekeeping: { stayoverDaily: true, inspectionRequired: true },
  maintenance: { slaHours: { LOW: 72, MEDIUM: 24, HIGH: 8, CRITICAL: 2 }, autoBlockCritical: true },
  backup: { enabled: true, time: "03:00", folder: "", retentionDays: 30, encrypt: false, lastRunDate: "", lastFailAt: "", remote: { provider: "none", folder: "", endpoint: "", region: "auto", bucket: "", prefix: "petrapms/", accessKeyId: "", secretAccessKey: "" }, lastRemote: { at: "", ok: true, error: "", fileName: "" } },
  reports: { scheduledExportEnabled: false, scheduledExportFolder: "", lastExportDate: "" },
  network: { lanUrl: "", httpsEnabled: false },
  branding: { appName: "PetraPMS", primaryColor: "#C8102E", poweredBy: true, loginMessage: "" },
  notifications: {
    smsEnabled: false,
    sms: { url: "", method: "POST", bodyTemplate: '{"to":"{{to}}","message":"{{message}}","sender":"{{sender}}"}', headers: '{"Content-Type":"application/json"}', senderId: "" },
    emailEnabled: false,
    email: { url: "", headers: '{"Content-Type":"application/json"}', bodyTemplate: '{"to":"{{to}}","subject":"{{subject}}","text":"{{message}}","from":"{{from}}"}', from: "" },
    whatsappEnabled: false,
    whatsapp: { url: "", headers: '{"Content-Type":"application/json"}', bodyTemplate: '{"to":"{{to}}","message":"{{message}}"}' },
    events: {
      RESERVATION_CONFIRMED: { sms: true, email: true, whatsapp: false },
      CHECKED_IN: { sms: false, email: false, whatsapp: false },
      CHECKED_OUT: { sms: true, email: true, whatsapp: false },
      LICENSE_EXPIRY: { sms: false, email: true, whatsapp: false },
    },
  },
  locale: { defaultLocale: "en", grouping: "lakh", dateFormat: "DD/MM/YYYY" },
  license: { trialStart: "", lastSeenDate: "", warnedThreshold: null, statusDoc: "", statusSeq: 0, statusAt: "" },
  setup: { checklistDismissed: false },
};

export type SettingsSection = keyof Settings;

function merge<T>(def: T, val: unknown): T {
  if (!val || typeof val !== "object" || Array.isArray(val) || typeof def !== "object" || def === null || Array.isArray(def)) return (val ?? def) as T;
  const out: Record<string, unknown> = { ...(def as Record<string, unknown>) };
  for (const [k, v] of Object.entries(val as Record<string, unknown>)) out[k] = k in out ? merge(out[k], v) : v;
  return out as T;
}

export async function getSettings(db: Db | Tx): Promise<Settings> {
  const rows = await db.setting.findMany();
  const out = structuredClone(DEFAULT_SETTINGS) as unknown as Record<string, unknown>;
  for (const r of rows) {
    if (!(r.key in out)) continue;
    try {
      out[r.key] = merge(out[r.key], JSON.parse(r.value));
    } catch {
      /* keep default */
    }
  }
  return out as unknown as Settings;
}

export async function getSection<K extends SettingsSection>(db: Db | Tx, key: K): Promise<Settings[K]> {
  const r = await db.setting.findUnique({ where: { key } });
  if (!r) return structuredClone(DEFAULT_SETTINGS[key]);
  try {
    return merge(structuredClone(DEFAULT_SETTINGS[key]), JSON.parse(r.value));
  } catch {
    return structuredClone(DEFAULT_SETTINGS[key]);
  }
}

export async function setSection<K extends SettingsSection>(db: Db | Tx, key: K, value: Settings[K], userId?: string) {
  const json = JSON.stringify(value);
  await db.setting.upsert({ where: { key }, create: { key, value: json, updatedById: userId }, update: { value: json, updatedById: userId } });
}

export async function patchSection<K extends SettingsSection>(db: Db | Tx, key: K, patch: Partial<Settings[K]>, userId?: string) {
  const cur = await getSection(db, key);
  const next = { ...cur, ...patch } as Settings[K];
  await setSection(db, key, next, userId);
  return next;
}

// ── secret masking ─────────────────────────────────────────────────────────────
// Provider headers (JSON) usually carry an API token. They are write-only for the browser: reads return a mask,
// writes that send the mask back keep the stored value, and audit entries never contain the real value.
export const SECRET_MASK = "********";
const SECRET_HEADER = /auth|token|key|secret|pass|bearer|signature/i;
const CHANNELS = ["sms", "email", "whatsapp"] as const;

function maskHeaders(json: string): string {
  try {
    const o = JSON.parse(json) as Record<string, unknown>;
    if (!o || typeof o !== "object" || Array.isArray(o)) return json;
    for (const k of Object.keys(o)) if (SECRET_HEADER.test(k) && o[k]) o[k] = SECRET_MASK;
    return JSON.stringify(o);
  } catch {
    return json ? SECRET_MASK : json; // not JSON: do not reveal it
  }
}
function unmaskHeaders(incoming: string, existing: string): string {
  try {
    const n = JSON.parse(incoming) as Record<string, unknown>;
    const old = (JSON.parse(existing || "{}") as Record<string, unknown>) ?? {};
    for (const k of Object.keys(n)) if (n[k] === SECRET_MASK) n[k] = old[k] ?? "";
    return JSON.stringify(n);
  } catch {
    return incoming === SECRET_MASK ? existing : incoming;
  }
}
export function maskNotifications(n: Settings["notifications"]): Settings["notifications"] {
  const out = { ...n } as Settings["notifications"];
  for (const c of CHANNELS) out[c] = { ...n[c], headers: maskHeaders(n[c].headers) } as never;
  return out;
}
export function restoreNotificationSecrets(incoming: Settings["notifications"], existing: Settings["notifications"]): Settings["notifications"] {
  const out = { ...incoming } as Settings["notifications"];
  for (const c of CHANNELS) out[c] = { ...incoming[c], headers: unmaskHeaders(incoming[c].headers, existing[c].headers) } as never;
  return out;
}

export function maskBackup(b: Settings["backup"]): Settings["backup"] {
  return { ...b, remote: { ...b.remote, secretAccessKey: b.remote.secretAccessKey ? SECRET_MASK : "" } };
}
export function restoreBackupSecrets(incoming: Settings["backup"], existing: Settings["backup"]): Settings["backup"] {
  const secret = incoming.remote.secretAccessKey === SECRET_MASK ? existing.remote.secretAccessKey : incoming.remote.secretAccessKey;
  // status fields are written by the server only
  return { ...incoming, lastRunDate: existing.lastRunDate, lastFailAt: existing.lastFailAt, lastRemote: existing.lastRemote, remote: { ...incoming.remote, secretAccessKey: secret } };
}
