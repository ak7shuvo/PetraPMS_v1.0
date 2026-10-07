// Window-scoped authentication.
// Each browser tab / Electron window signs in separately and keeps its own bearer token (sessionStorage in the
// browser, a per-window partition in Electron). The server stores only the SHA-256 of the token in
// UserWindowSession, so two windows on one PC can be signed in as two different users at the same time.
// Passwords and PINs are hashed with argon2id (WASM build, no native module). Accounts lock after repeated
// failures; sessions end after the configured idle time.
import { createHash, randomBytes } from "node:crypto";
import { argon2id, argon2Verify } from "hash-wasm";
import type { Db, Tx } from "./db";
import { getSettings } from "./settings";
import { ApiError, unauthorized } from "./errors";
import { log } from "./log";

export interface SessionUser {
  id: string;
  username: string;
  fullName: string;
  roleId: string;
  roleCode: string;
  roleName: string;
  roleNameBn: string;
  locale: string;
  banglaDigits: boolean;
  uiScale: number;
  theme: string;
  mustChangePassword: boolean;
  discountLimitBp: number;
  hasPin: boolean;
  permissions: string[];
}

export async function hashSecret(secret: string): Promise<string> {
  return argon2id({ password: secret, salt: randomBytes(16), parallelism: 1, iterations: 3, memorySize: 19456, hashLength: 32, outputType: "encoded" });
}

export async function verifySecret(secret: string, hash: string | null | undefined): Promise<boolean> {
  if (!hash) return false;
  try {
    return await argon2Verify({ password: secret, hash });
  } catch {
    return false;
  }
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function validatePasswordStrength(pw: string, minLength: number) {
  if (pw.length < minLength) throw new ApiError(400, "WEAK_PASSWORD", `Password must be at least ${minLength} characters`);
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) throw new ApiError(400, "WEAK_PASSWORD", "Password must contain letters and numbers");
  if (pw.length > 200) throw new ApiError(400, "WEAK_PASSWORD", "Password is too long");
}

export function validatePin(pin: string) {
  if (!/^\d{4,6}$/.test(pin)) throw new ApiError(400, "WEAK_PIN", "PIN must be 4 to 6 digits");
  if (/^(\d)\1+$/.test(pin) || "0123456789".includes(pin) || "9876543210".includes(pin)) throw new ApiError(400, "WEAK_PIN", "Choose a less predictable PIN");
}

export async function loadSessionUser(db: Db | Tx, userId: string): Promise<SessionUser | null> {
  const u = await db.user.findUnique({ where: { id: userId }, include: { role: { include: { permissions: true } } } });
  if (!u || !u.active || u.deletedAt) return null;
  return {
    id: u.id,
    username: u.username,
    fullName: u.fullName,
    roleId: u.roleId,
    roleCode: u.role.code,
    roleName: u.role.name,
    roleNameBn: u.role.nameBn,
    locale: u.locale,
    banglaDigits: u.banglaDigits,
    uiScale: u.uiScale,
    theme: u.theme,
    mustChangePassword: u.mustChangePassword,
    discountLimitBp: u.discountLimitBp,
    hasPin: !!u.pinHash,
    permissions: u.role.permissions.map((p) => p.permissionCode),
  };
}

// Constant-ish work for unknown usernames so response time does not reveal valid accounts.
const DUMMY_HASH = "$argon2id$v=19$m=19456,t=3,p=1$hipimVHbM6AR1xG6gytv4A$yvw1Xz0h2AEeLDyEE6cjRyXlM/SKiLSD9iomeTC771I";

/** Checks a username + password (or PIN) and applies the lockout policy. Returns the user id. */
/**
 * Per-IP brute-force brake in front of the per-account lockout: 20 failed sign-ins from one address in 10 minutes
 * block further attempts from it for the rest of the window (429). Cleared by a successful sign-in. In memory only.
 */
const ipFails = new Map<string, { n: number; since: number }>();
const IP_WINDOW = 10 * 60_000;
const IP_MAX = 20;
export const loginGuard = {
  check(ip: string) {
    const f = ipFails.get(ip);
    if (!f) return;
    if (Date.now() - f.since > IP_WINDOW) return void ipFails.delete(ip);
    if (f.n >= IP_MAX) {
      log("warn", "security", `sign-in blocked: too many failed attempts from ${ip}`);
      throw new ApiError(429, "TOO_MANY_ATTEMPTS", "Too many failed sign-in attempts from this computer. Wait a few minutes and try again.", { bn: "এই কম্পিউটার থেকে অনেকবার ভুল চেষ্টা হয়েছে। কয়েক মিনিট পর আবার চেষ্টা করুন।" });
    }
  },
  fail(ip: string) {
    const f = ipFails.get(ip);
    if (!f || Date.now() - f.since > IP_WINDOW) ipFails.set(ip, { n: 1, since: Date.now() });
    else f.n++;
    if (ipFails.size > 5000) ipFails.clear();
  },
  ok(ip: string) {
    ipFails.delete(ip);
  },
  reset() {
    ipFails.clear();
  },
};

/** Runs a credential check under the per-IP guard. */
export async function guardedCredentials(db: Db, ip: string, username: string, secret: string, kind: "password" | "pin"): Promise<string> {
  loginGuard.check(ip);
  try {
    const id = await checkCredentials(db, username, secret, kind);
    loginGuard.ok(ip);
    return id;
  } catch (e) {
    if (e instanceof ApiError && (e.code === "BAD_CREDENTIALS" || e.code === "LOCKED")) loginGuard.fail(ip);
    throw e;
  }
}

export async function checkCredentials(db: Db, username: string, secret: string, kind: "password" | "pin"): Promise<string> {
  const s = await getSettings(db);
  const u = await db.user.findUnique({ where: { username: username.trim().toLowerCase() } });
  if (!u || !u.active || u.deletedAt) {
    await verifySecret(secret, DUMMY_HASH);
    // the typed name is not logged: people sometimes type their password into the username box
    log("warn", "security", `login failed: unknown or inactive user (${kind})`);
    throw new ApiError(401, "BAD_CREDENTIALS", "Incorrect username or password", { bn: "ইউজারনেম বা পাসওয়ার্ড ভুল।" });
  }
  if (u.lockedUntil && u.lockedUntil.getTime() > Date.now()) {
    const mins = Math.ceil((u.lockedUntil.getTime() - Date.now()) / 60000);
    log("warn", "security", `login refused: account ${u.username} is locked`);
    throw new ApiError(423, "LOCKED", `Account locked after too many failed attempts. Try again in ${mins} minute(s) or ask a manager to reset it.`, { bn: `অনেকবার ভুল করায় অ্যাকাউন্ট লক হয়েছে। ${mins} মিনিট পর আবার চেষ্টা করুন অথবা ম্যানেজারকে রিসেট করতে বলুন।` });
  }
  const ok = await verifySecret(secret, kind === "pin" ? u.pinHash : u.passwordHash);
  if (!ok) {
    const failed = u.failedAttempts + 1;
    const lock = failed >= s.security.maxFailedAttempts;
    await db.user.update({ where: { id: u.id }, data: { failedAttempts: lock ? 0 : failed, lockedUntil: lock ? new Date(Date.now() + s.security.lockMinutes * 60000) : null } });
    await db.auditLog.create({ data: { userId: u.id, username: u.username, action: lock ? "auth.locked" : "auth.failed", entity: "User", entityId: u.id, reason: kind } });
    log("warn", "security", `login failed (${kind}) for ${u.username}, attempt ${failed}${lock ? " — account locked" : ""}`);
    if (lock) throw new ApiError(423, "LOCKED", `Too many failed attempts. The account is locked for ${s.security.lockMinutes} minutes.`, { bn: `অনেকবার ভুল করায় অ্যাকাউন্ট ${s.security.lockMinutes} মিনিটের জন্য লক হয়েছে।` });
    throw new ApiError(401, "BAD_CREDENTIALS", kind === "pin" ? "Incorrect PIN" : "Incorrect username or password", { bn: kind === "pin" ? "পিন ভুল।" : "ইউজারনেম বা পাসওয়ার্ড ভুল।" });
  }
  await db.user.update({ where: { id: u.id }, data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() } });
  return u.id;
}

export interface NewSession {
  token: string;
  sessionId: string;
  expiresAt: Date;
}

/** Creates a window session. `maxTerminals` comes from the license (distinct terminals with live sessions). */
export async function createSession(db: Db, userId: string, info: { windowId: string; terminalId: string; ip: string; userAgent: string; deviceLabel?: string; replaceSessionId?: string | null }, maxTerminals: number): Promise<NewSession> {
  const s = await getSettings(db);
  const idleCutoff = new Date(Date.now() - s.security.idleMinutes * 60000);
  if (info.replaceSessionId) await db.userWindowSession.updateMany({ where: { id: info.replaceSessionId }, data: { revokedAt: new Date() } });
  const live = await db.userWindowSession.findMany({ where: { revokedAt: null, expiresAt: { gt: new Date() }, lastSeenAt: { gt: idleCutoff } }, select: { terminalId: true } });
  const terminals = new Set(live.map((l) => l.terminalId));
  if (!terminals.has(info.terminalId) && terminals.size >= maxTerminals) {
    throw new ApiError(429, "TERMINAL_LIMIT", `Your license allows ${maxTerminals} concurrent terminal(s), and all are in use. Sign out on another computer or upgrade the license.`);
  }
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + s.security.sessionHours * 3600000);
  const row = await db.userWindowSession.create({
    data: { tokenHash: sha256(token), userId, windowId: info.windowId.slice(0, 64), terminalId: info.terminalId.slice(0, 64), ip: info.ip.slice(0, 64), userAgent: info.userAgent.slice(0, 300), deviceLabel: (info.deviceLabel ?? "").slice(0, 80), expiresAt },
  });
  return { token, sessionId: row.id, expiresAt };
}

const touchCache = new Map<string, number>();

/** Validates a bearer token. Applies idle timeout; updates lastSeenAt at most every 30 s. */
export async function authenticate(db: Db, token: string | null): Promise<{ user: SessionUser; sessionId: string; terminalId: string; windowId: string } | null> {
  if (!token || token.length < 20 || token.length > 100) return null;
  const sess = await db.userWindowSession.findUnique({ where: { tokenHash: sha256(token) } });
  if (!sess || sess.revokedAt || sess.expiresAt.getTime() < Date.now()) return null;
  const s = await getSettings(db);
  if (s.security.idleMinutes > 0 && Date.now() - sess.lastSeenAt.getTime() > s.security.idleMinutes * 60000) {
    await db.userWindowSession.update({ where: { id: sess.id }, data: { revokedAt: new Date() } });
    throw new ApiError(401, "IDLE_TIMEOUT", "Signed out after inactivity. Please sign in again.");
  }
  const user = await loadSessionUser(db, sess.userId);
  if (!user) return null;
  const last = touchCache.get(sess.id) ?? 0;
  if (Date.now() - last > 30_000) {
    touchCache.set(sess.id, Date.now());
    await db.userWindowSession.update({ where: { id: sess.id }, data: { lastSeenAt: new Date() } }).catch((e) => log("warn", "auth", `touch failed: ${e}`));
  }
  return { user, sessionId: sess.id, terminalId: sess.terminalId, windowId: sess.windowId };
}

export async function revokeSession(db: Db, sessionId: string) {
  await db.userWindowSession.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
}

export function bearer(req: Request): string | null {
  const h = req.headers.get("authorization");
  if (h?.startsWith("Bearer ")) return h.slice(7).trim();
  return null;
}

export function requireAuthUser<T>(v: T | null): T {
  if (!v) throw unauthorized();
  return v;
}

/**
 * Manager override: a supervisor types their username + PIN (or password) on the requesting terminal.
 * Returns the approver's user id when they hold `perm`; failed attempts count toward their lockout.
 */
export async function approveWith(db: Db, approval: { username: string; secret: string } | null | undefined, perm: string, requester: SessionUser): Promise<string> {
  if (requester.permissions.includes(perm)) return requester.id;
  if (!approval?.username || !approval.secret) throw new ApiError(403, "APPROVAL_REQUIRED", "A manager must approve this action", { permission: perm });
  const kind = /^\d{4,6}$/.test(approval.secret) ? "pin" : "password";
  const id = await checkCredentials(db, approval.username, approval.secret, kind);
  const u = await loadSessionUser(db, id);
  if (!u || !u.permissions.includes(perm)) throw new ApiError(403, "APPROVAL_REQUIRED", `${approval.username} is not allowed to approve this action`, { permission: perm });
  return id;
}
