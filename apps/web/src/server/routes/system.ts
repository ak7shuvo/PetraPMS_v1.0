// Status, Quick Setup, authentication, users/roles/sessions, preferences, workspaces, settings, audit log.
import { z } from "zod";
import { DEFAULT_ROLES, PERMISSIONS, tempPassword, homeFor } from "@petra/core";
import { route, pageArgs, markSetupDone, invalidateLicenseCache, type Ctx } from "../api";
import { getDb } from "../db";
import { ApiError, badRequest, notFound } from "../errors";
import { guardedCredentials, createSession, hashSecret, loadSessionUser, revokeSession, validatePasswordStrength, validatePin, verifySecret, bearer, authenticate } from "../auth";
import { audit, diff, getBusinessDate, parseJson } from "../common";
import { getSettings, setSection, maskNotifications, maskBackup, restoreBackupSecrets, restoreNotificationSecrets, DEFAULT_SETTINGS, type Settings, type SettingsSection } from "../settings";
import { runSetup, setupSchema } from "../services/setup";
import { activateLicense, activationRequest, getLicenseInfo, importStatusList, transferCode } from "../services/license";
import { env } from "../env";
import { publish } from "../events";
import { zUsername, zTime } from "@/shared/schemas";
import { lastMigration } from "../db";
import { latestSchemaVersion } from "@petra/db";

const loginSchema = z.object({ username: z.string().trim().min(1).max(60), password: z.string().min(1).max(200), windowId: z.string().max(64).default(""), terminalId: z.string().max(64).default(""), deviceLabel: z.string().max(80).default("") });

async function sessionPayload(db: Awaited<ReturnType<typeof getDb>>, userId: string, token: string, expiresAt: Date) {
  const user = await loadSessionUser(db, userId);
  return { token, expiresAt, user, home: homeFor(user!.permissions), businessDate: await getBusinessDate(db) };
}

// ── status & setup ─────────────────────────────────────────────────────────
route("GET", "/status", { auth: "public", beforeSetup: true }, async (ctx) => {
  const hotel = await ctx.db.hotel.findUnique({ where: { id: "hotel" } });
  const s = await getSettings(ctx.db);
  const lic = await ctx.license();
  return {
    setupComplete: !!hotel?.setupComplete,
    hotel: hotel ? { name: hotel.name, logo: hotel.logo, address: hotel.address, phone: hotel.phone } : null,
    branding: s.branding,
    locale: s.locale,
    license: { mode: lic.state.mode, readOnly: lic.state.readOnly, warnings: lic.state.warnings, edition: lic.edition },
    version: env().appVersion,
    mode: env().mode,
    businessDate: hotel?.setupComplete ? await getBusinessDate(ctx.db) : null,
    idleMinutes: s.security.idleMinutes,
  };
});

/** First-run helpers (only before setup is complete; afterwards the normal authenticated pages are used). */
async function requireFirstRun(ctx: Ctx) {
  const hotel = await ctx.db.hotel.findUnique({ where: { id: "hotel" }, select: { setupComplete: true } });
  if (hotel?.setupComplete) throw new ApiError(403, "SETUP_DONE", "Setup is already complete");
}
route("GET", "/setup/environment", { auth: "public", beforeSetup: true, allowReadOnly: true }, async (ctx) => {
  await requireFirstRun(ctx);
  const { storageHealth } = await import("../fsSafe");
  const e = env();
  const h = storageHealth(e.dataDir);
  return { provider: e.provider, mode: e.mode, version: e.appVersion, dataDir: e.dataDir, writable: h.writable, freeBytes: h.freeBytes, low: h.low, error: h.error ?? null, sqliteFile: e.provider === "sqlite" ? e.dbFile : null };
});
route("GET", "/setup/request-code", { auth: "public", beforeSetup: true, allowReadOnly: true }, async (ctx) => {
  await requireFirstRun(ctx);
  const { machineFingerprint } = await import("../services/license");
  const { makeActivationRequest } = await import("@petra/core/license");
    // eslint-disable-next-line no-control-regex
  const hotel = (ctx.query.get("hotel") ?? "").replace(/[\u0000-\u001f]/g, "").slice(0, 120);
  const rooms = Math.min(2000, Math.max(0, Number(ctx.query.get("rooms")) || 0));
  return { code: makeActivationRequest({ fingerprint: machineFingerprint(), hotel, appVersion: env().appVersion, rooms, licenseId: null, at: new Date().toISOString().slice(0, 10) }), fingerprint: machineFingerprint() };
});

route("POST", "/setup", { auth: "public", beforeSetup: true, allowReadOnly: true }, async (ctx) => {
  const input = await ctx.body(setupSchema);
  const res = await runSetup(ctx.db, input, { ip: ctx.ip });
  markSetupDone(true);
  invalidateLicenseCache();
  if (input.loadDemo) {
    const { loadDemoData } = await import("../services/demo");
    await loadDemoData(ctx.db, { userId: res.adminId, username: input.admin.username, ip: ctx.ip });
  }
  return res;
});

// ── authentication (window-scoped) ─────────────────────────────────────────
route("POST", "/auth/login", { auth: "public", allowReadOnly: true }, async (ctx) => {
  const b = await ctx.body(loginSchema);
  const userId = await guardedCredentials(ctx.db, ctx.ip, b.username, b.password, "password");
  const lic = await ctx.license();
  const s = await createSession(ctx.db, userId, { windowId: b.windowId, terminalId: b.terminalId || ctx.ip, ip: ctx.ip, userAgent: ctx.req.headers.get("user-agent") ?? "", deviceLabel: b.deviceLabel }, lic.maxTerminals);
  const u = await ctx.db.user.findUniqueOrThrow({ where: { id: userId } });
  await audit(ctx.db, { userId, username: u.username, ip: ctx.ip, terminalId: b.terminalId }, "auth.login", "User", userId);
  publish("users", "login", userId);
  return sessionPayload(ctx.db, userId, s.token, s.expiresAt);
});

/** Quick PIN switch: replaces the current window's session with another user's (or signs in a pop-out). */
route("POST", "/auth/pin", { auth: "public", allowReadOnly: true }, async (ctx) => {
  const b = await ctx.body(z.object({ username: z.string().trim().min(1).max(60), pin: z.string().min(4).max(6), windowId: z.string().max(64).default(""), terminalId: z.string().max(64).default("") }));
  const userId = await guardedCredentials(ctx.db, ctx.ip, b.username, b.pin, "pin");
  const lic = await ctx.license();
  let replace: string | null = null;
  try {
    replace = (await authenticate(ctx.db, bearer(ctx.req)))?.sessionId ?? null;
  } catch {
    replace = null;
  }
  const s = await createSession(ctx.db, userId, { windowId: b.windowId, terminalId: b.terminalId || ctx.ip, ip: ctx.ip, userAgent: ctx.req.headers.get("user-agent") ?? "", replaceSessionId: replace }, lic.maxTerminals);
  const u = await ctx.db.user.findUniqueOrThrow({ where: { id: userId } });
  await audit(ctx.db, { userId, username: u.username, ip: ctx.ip, terminalId: b.terminalId }, "auth.pin_switch", "User", userId);
  return sessionPayload(ctx.db, userId, s.token, s.expiresAt);
});

route("POST", "/auth/logout", { allowReadOnly: true }, async (ctx) => {
  if (ctx.sessionId) await revokeSession(ctx.db, ctx.sessionId);
  await audit(ctx.db, ctx.actor, "auth.logout", "User", ctx.me().id);
  return { ok: true };
});

route("GET", "/auth/me", { allowReadOnly: true }, async (ctx) => {
  const lic = await ctx.license();
  return { user: ctx.me(), businessDate: ctx.businessDate, home: homeFor(ctx.me().permissions), license: { mode: lic.state.mode, readOnly: lic.state.readOnly, warnings: lic.state.warnings, modules: lic.modules } };
});

route("POST", "/auth/change-password", { allowReadOnly: true }, async (ctx) => {
  const b = await ctx.body(z.object({ current: z.string().min(1).max(200), next: z.string().min(1).max(200) }));
  const u = await ctx.db.user.findUniqueOrThrow({ where: { id: ctx.me().id } });
  if (!(await verifySecret(b.current, u.passwordHash))) throw new ApiError(400, "BAD_PASSWORD", "Current password is incorrect");
  validatePasswordStrength(b.next, (await getSettings(ctx.db)).security.minPasswordLength);
  if (b.current === b.next) throw badRequest("The new password must be different");
  await ctx.db.user.update({ where: { id: u.id }, data: { passwordHash: await hashSecret(b.next), mustChangePassword: false } });
  await audit(ctx.db, ctx.actor, "user.password_changed", "User", u.id);
  return { ok: true };
});

route("POST", "/auth/pin/set", { allowReadOnly: true }, async (ctx) => {
  const b = await ctx.body(z.object({ password: z.string().min(1).max(200), pin: z.string().max(6) }));
  const u = await ctx.db.user.findUniqueOrThrow({ where: { id: ctx.me().id } });
  if (!(await verifySecret(b.password, u.passwordHash))) throw new ApiError(400, "BAD_PASSWORD", "Password is incorrect");
  if (b.pin) validatePin(b.pin);
  await ctx.db.user.update({ where: { id: u.id }, data: { pinHash: b.pin ? await hashSecret(b.pin) : null } });
  await audit(ctx.db, ctx.actor, b.pin ? "user.pin_set" : "user.pin_removed", "User", u.id);
  return { ok: true };
});

route("PATCH", "/auth/preferences", { allowReadOnly: true }, async (ctx) => {
  const b = await ctx.body(z.object({ locale: z.enum(["en", "bn"]).optional(), banglaDigits: z.boolean().optional(), uiScale: z.number().int().min(90).max(150).optional(), theme: z.enum(["light", "dark", "system"]).optional() }));
  await ctx.db.user.update({ where: { id: ctx.me().id }, data: b });
  return loadSessionUser(ctx.db, ctx.me().id);
});

/** Users who have a PIN (for the quick-switch picker). Names only. */
route("GET", "/auth/pin-users", { auth: "public", allowReadOnly: true }, async (ctx) => {
  const users = await ctx.db.user.findMany({ where: { active: true, deletedAt: null, pinHash: { not: null }, role: { code: { not: "SUPER_ADMIN" } } }, select: { username: true, fullName: true, role: { select: { name: true } } }, orderBy: { fullName: "asc" } });
  return users.map((u) => ({ username: u.username, fullName: u.fullName, role: u.role.name }));
});

// ── users ──────────────────────────────────────────────────────────────────
const userSchema = z.object({
  username: zUsername,
  fullName: z.string().trim().min(2).max(80),
  email: z.union([z.literal(""), z.string().email().max(120)]).default(""),
  phone: z.string().trim().max(30).default(""),
  roleId: z.string().min(1),
  locale: z.enum(["en", "bn"]).default("en"),
  discountLimitBp: z.number().int().min(0).max(10000).default(1000),
  active: z.boolean().default(true),
});

route("GET", "/users", { perm: ["users.view", "users.manage", "housekeeping.assign", "maintenance.manage"] }, async (ctx) => {
  const q = ctx.query.get("q")?.trim();
  const users = await ctx.db.user.findMany({
    where: { deletedAt: null, ...(q ? { OR: [{ username: { contains: q } }, { fullName: { contains: q } }] } : {}), ...(ctx.query.get("role") ? { role: { code: ctx.query.get("role")! } } : {}) },
    include: { role: { select: { id: true, code: true, name: true, nameBn: true } } },
    orderBy: { fullName: "asc" },
  });
  return users.map(({ passwordHash: _p, pinHash, ...u }) => ({ ...u, hasPin: !!pinHash, locked: !!u.lockedUntil && u.lockedUntil.getTime() > Date.now() }));
});

route("POST", "/users", { perm: "users.manage" }, async (ctx) => {
  const b = await ctx.body(userSchema);
  const role = await ctx.db.role.findUnique({ where: { id: b.roleId } });
  if (!role) throw badRequest("Unknown role");
  if (role.code === "SUPER_ADMIN" && ctx.me().roleCode !== "SUPER_ADMIN") throw new ApiError(403, "FORBIDDEN", "Only a Super Admin can create Super Admin accounts");
  const temp = tempPassword(10) + "7";
  const u = await ctx.db.user.create({ data: { ...b, passwordHash: await hashSecret(temp), mustChangePassword: true, createdById: ctx.me().id } });
  await audit(ctx.db, ctx.actor, "user.created", "User", u.id, { after: { ...b, role: role.code } });
  publish("users", "created", u.id);
  return { id: u.id, temporaryPassword: temp };
});

route("PATCH", "/users/:id", { perm: "users.manage" }, async (ctx) => {
  const b = await ctx.body(userSchema.partial());
  const before = await ctx.db.user.findUnique({ where: { id: ctx.params.id }, include: { role: true } });
  if (!before || before.deletedAt) throw notFound("User");
  if (b.roleId && b.roleId !== before.roleId) {
    const role = await ctx.db.role.findUnique({ where: { id: b.roleId } });
    if (!role) throw badRequest("Unknown role");
    if ((role.code === "SUPER_ADMIN" || before.role.code === "SUPER_ADMIN") && ctx.me().roleCode !== "SUPER_ADMIN") throw new ApiError(403, "FORBIDDEN", "Only a Super Admin can change Super Admin roles");
  }
  if (before.role.code === "SUPER_ADMIN" && (b.active === false || (b.roleId && b.roleId !== before.roleId))) {
    const admins = await ctx.db.user.count({ where: { role: { code: "SUPER_ADMIN" }, active: true, deletedAt: null, id: { not: before.id } } });
    if (admins === 0) throw new ApiError(409, "LAST_ADMIN", "At least one active Super Admin is required");
  }
  const u = await ctx.db.user.update({ where: { id: before.id }, data: { ...b, updatedById: ctx.me().id } });
  if (b.active === false) await ctx.db.userWindowSession.updateMany({ where: { userId: u.id, revokedAt: null }, data: { revokedAt: new Date() } });
  const d = diff(before as unknown as Record<string, unknown>, b as Record<string, unknown>);
  await audit(ctx.db, ctx.actor, "user.updated", "User", u.id, d);
  publish("users", "updated", u.id);
  return { ok: true };
});

route("POST", "/users/:id/reset-password", { perm: "users.manage" }, async (ctx) => {
  const u = await ctx.db.user.findUnique({ where: { id: ctx.params.id }, include: { role: true } });
  if (!u || u.deletedAt) throw notFound("User");
  if (u.role.code === "SUPER_ADMIN" && ctx.me().roleCode !== "SUPER_ADMIN") throw new ApiError(403, "FORBIDDEN", "Only a Super Admin can reset a Super Admin password");
  const temp = tempPassword(10) + "7";
  await ctx.db.user.update({ where: { id: u.id }, data: { passwordHash: await hashSecret(temp), mustChangePassword: true, failedAttempts: 0, lockedUntil: null } });
  await ctx.db.userWindowSession.updateMany({ where: { userId: u.id, revokedAt: null }, data: { revokedAt: new Date() } });
  await audit(ctx.db, ctx.actor, "user.password_reset", "User", u.id);
  return { temporaryPassword: temp };
});

route("POST", "/users/:id/unlock", { perm: "users.manage" }, async (ctx) => {
  await ctx.db.user.update({ where: { id: ctx.params.id }, data: { failedAttempts: 0, lockedUntil: null } });
  await audit(ctx.db, ctx.actor, "user.unlocked", "User", ctx.params.id);
  return { ok: true };
});

route("DELETE", "/users/:id", { perm: "users.manage" }, async (ctx) => {
  if (ctx.params.id === ctx.me().id) throw badRequest("You cannot delete your own account");
  const u = await ctx.db.user.findUnique({ where: { id: ctx.params.id }, include: { role: true } });
  if (!u || u.deletedAt) throw notFound("User");
  if (u.role.code === "SUPER_ADMIN") {
    const admins = await ctx.db.user.count({ where: { role: { code: "SUPER_ADMIN" }, active: true, deletedAt: null, id: { not: u.id } } });
    if (admins === 0) throw new ApiError(409, "LAST_ADMIN", "At least one active Super Admin is required");
  }
  // soft delete: history (audit, folios) keeps referring to this user
  await ctx.db.user.update({ where: { id: u.id }, data: { deletedAt: new Date(), active: false, username: `${u.username}#deleted-${Date.now()}` } });
  await ctx.db.userWindowSession.updateMany({ where: { userId: u.id, revokedAt: null }, data: { revokedAt: new Date() } });
  await audit(ctx.db, ctx.actor, "user.deleted", "User", u.id, { before: { username: u.username, role: u.role.code } });
  return { ok: true };
});

// ── roles ──────────────────────────────────────────────────────────────────
route("GET", "/roles", { perm: ["users.view", "users.manage", "users.roles"] }, async (ctx) => {
  const roles = await ctx.db.role.findMany({ include: { permissions: true, _count: { select: { users: true } } }, orderBy: { createdAt: "asc" } });
  return {
    roles: roles.map((r) => ({ id: r.id, code: r.code, name: r.name, nameBn: r.nameBn, builtin: r.builtin, users: r._count.users, permissions: r.permissions.map((p) => p.permissionCode) })),
    catalogue: PERMISSIONS,
  };
});

route("POST", "/roles", { perm: "users.roles" }, async (ctx) => {
  const b = await ctx.body(z.object({ code: z.string().trim().min(2).max(30).regex(/^[A-Z0-9_]+$/i), name: z.string().trim().min(2).max(60), nameBn: z.string().max(60).default(""), copyFromRoleId: z.string().optional() }));
  const role = await ctx.db.role.create({ data: { code: b.code.toUpperCase(), name: b.name, nameBn: b.nameBn } });
  if (b.copyFromRoleId) {
    const src = await ctx.db.rolePermission.findMany({ where: { roleId: b.copyFromRoleId } });
    if (src.length) await ctx.db.rolePermission.createMany({ data: src.map((p) => ({ roleId: role.id, permissionCode: p.permissionCode })) });
  }
  await audit(ctx.db, ctx.actor, "role.created", "Role", role.id, { after: b });
  return { id: role.id };
});

route("PUT", "/roles/:id/permissions", { perm: "users.roles" }, async (ctx) => {
  const b = await ctx.body(z.object({ permissions: z.array(z.string()).max(500) }));
  const role = await ctx.db.role.findUnique({ where: { id: ctx.params.id }, include: { permissions: true } });
  if (!role) throw notFound("Role");
  if (role.code === "SUPER_ADMIN") throw new ApiError(409, "PROTECTED", "The Super Admin role always has every permission");
  const valid = new Set(PERMISSIONS.map((p) => p.code));
  const next = [...new Set(b.permissions.filter((p) => valid.has(p)))];
  const before = role.permissions.map((p) => p.permissionCode).sort();
  await ctx.db.$transaction([ctx.db.rolePermission.deleteMany({ where: { roleId: role.id } }), ctx.db.rolePermission.createMany({ data: next.map((code) => ({ roleId: role.id, permissionCode: code })) })]);
  await audit(ctx.db, ctx.actor, "role.permissions_changed", "Role", role.id, { before: { added: [], removed: before.filter((p) => !next.includes(p)) }, after: { added: next.filter((p) => !before.includes(p)) } });
  publish("users", "roles");
  return { ok: true };
});

route("POST", "/roles/:id/reset", { perm: "users.roles" }, async (ctx) => {
  const role = await ctx.db.role.findUnique({ where: { id: ctx.params.id } });
  const def = DEFAULT_ROLES.find((r) => r.code === role?.code);
  if (!role || !def) throw badRequest("Only built-in roles can be reset to defaults");
  await ctx.db.$transaction([ctx.db.rolePermission.deleteMany({ where: { roleId: role.id } }), ctx.db.rolePermission.createMany({ data: def.permissions.map((code) => ({ roleId: role.id, permissionCode: code })) })]);
  await audit(ctx.db, ctx.actor, "role.reset", "Role", role.id);
  return { ok: true };
});

route("DELETE", "/roles/:id", { perm: "users.roles" }, async (ctx) => {
  const role = await ctx.db.role.findUnique({ where: { id: ctx.params.id }, include: { _count: { select: { users: true } } } });
  if (!role) throw notFound("Role");
  if (role.builtin) throw new ApiError(409, "PROTECTED", "Built-in roles cannot be deleted");
  if (role._count.users) throw new ApiError(409, "IN_USE", "Move the users to another role first");
  await ctx.db.role.delete({ where: { id: role.id } });
  await audit(ctx.db, ctx.actor, "role.deleted", "Role", role.id, { before: { code: role.code } });
  return { ok: true };
});

// ── window sessions ───────────────────────────────────────────────────────
route("GET", "/sessions", { perm: ["users.manage", "users.view"] }, async (ctx) => {
  const s = await getSettings(ctx.db);
  const cutoff = new Date(Date.now() - s.security.idleMinutes * 60000);
  const rows = await ctx.db.userWindowSession.findMany({ where: { revokedAt: null, expiresAt: { gt: new Date() }, lastSeenAt: { gt: cutoff } }, include: { user: { select: { fullName: true, username: true, role: { select: { name: true } } } } }, orderBy: { lastSeenAt: "desc" } });
  const lic = await ctx.license();
  return { sessions: rows.map(({ tokenHash: _t, ...r }) => ({ ...r, current: r.id === ctx.sessionId })), terminals: new Set(rows.map((r) => r.terminalId)).size, maxTerminals: lic.maxTerminals };
});

route("DELETE", "/sessions/:id", { perm: "users.manage", allowReadOnly: true }, async (ctx) => {
  await revokeSession(ctx.db, ctx.params.id);
  await audit(ctx.db, ctx.actor, "session.revoked", "UserWindowSession", ctx.params.id);
  return { ok: true };
});

// ── saved workspaces (multi-monitor layouts) ───────────────────────────────
const layoutSchema = z.array(z.object({ path: z.string().max(200), title: z.string().max(80).default(""), screenId: z.string().max(40).default(""), screenLabel: z.string().max(80).default(""), bounds: z.object({ x: z.number(), y: z.number(), width: z.number().min(200), height: z.number().min(150) }).nullable().default(null), fullscreen: z.boolean().default(false) })).max(12);

route("GET", "/workspaces", { allowReadOnly: true }, async (ctx) => {
  const rows = await ctx.db.savedWorkspace.findMany({ where: { userId: ctx.me().id }, orderBy: { updatedAt: "desc" } });
  return rows.map((w) => ({ ...w, layout: parseJson(w.layout, []) }));
});
route("POST", "/workspaces", { allowReadOnly: true }, async (ctx) => {
  const b = await ctx.body(z.object({ name: z.string().trim().min(1).max(60), layout: layoutSchema, isDefault: z.boolean().default(false) }));
  if (b.isDefault) await ctx.db.savedWorkspace.updateMany({ where: { userId: ctx.me().id }, data: { isDefault: false } });
  const existing = await ctx.db.savedWorkspace.findFirst({ where: { userId: ctx.me().id, name: b.name } });
  const w = existing
    ? await ctx.db.savedWorkspace.update({ where: { id: existing.id }, data: { layout: JSON.stringify(b.layout), isDefault: b.isDefault } })
    : await ctx.db.savedWorkspace.create({ data: { userId: ctx.me().id, name: b.name, layout: JSON.stringify(b.layout), isDefault: b.isDefault } });
  return { id: w.id };
});
route("DELETE", "/workspaces/:id", { allowReadOnly: true }, async (ctx) => {
  await ctx.db.savedWorkspace.deleteMany({ where: { id: ctx.params.id, userId: ctx.me().id } });
  return { ok: true };
});

// ── hotel profile & settings ───────────────────────────────────────────────
const hotelSchema = z.object({
  name: z.string().trim().min(2).max(120),
  legalName: z.string().trim().max(160).default(""),
  address: z.string().trim().max(300).default(""),
  city: z.string().trim().max(80).default(""),
  country: z.string().trim().length(2).default("BD"),
  phone: z.string().trim().max(40).default(""),
  email: z.string().trim().max(120).default(""),
  website: z.string().trim().max(120).default(""),
  bin: z.string().trim().max(30).default(""),
  tradeLicense: z.string().trim().max(40).default(""),
  logo: z.string().max(600_000).default("").refine((s) => !s || /^data:image\/(png|jpeg|webp|svg\+xml);base64,/.test(s), "Logo must be a PNG, JPEG, WebP or SVG image"),
  checkInTime: zTime,
  checkOutTime: zTime,
  usdRate: z.number().int().min(1).max(100000_00),
  showUsd: z.boolean().default(false),
});

route("GET", "/hotel", { allowReadOnly: true }, async (ctx) => ctx.db.hotel.findUnique({ where: { id: "hotel" } }));
route("PUT", "/hotel", { perm: "settings.manage" }, async (ctx) => {
  const b = await ctx.body(hotelSchema);
  const before = await ctx.db.hotel.findUniqueOrThrow({ where: { id: "hotel" } });
  await ctx.db.hotel.update({ where: { id: "hotel" }, data: { ...b, updatedById: ctx.me().id } });
  await audit(ctx.db, ctx.actor, "hotel.updated", "Hotel", "hotel", diff(before as unknown as Record<string, unknown>, b as Record<string, unknown>));
  publish("settings", "hotel");
  return { ok: true };
});

const EDITABLE: SettingsSection[] = ["security", "billing", "frontdesk", "audit", "housekeeping", "maintenance", "backup", "reports", "network", "branding", "notifications", "locale"];
route("GET", "/settings", { allowReadOnly: true }, async (ctx) => {
  const s = await getSettings(ctx.db);
  const { license: _l, ...rest } = s;
  return { ...rest, notifications: maskNotifications(rest.notifications), backup: maskBackup(rest.backup) };
});
route("PUT", "/settings/:section", { perm: ["settings.manage", "settings.branding"] }, async (ctx) => {
  const section = ctx.params.section as SettingsSection;
  if (!EDITABLE.includes(section)) throw notFound("Settings section");
  if (section === "branding") ctx.need("settings.branding");
  else ctx.need("settings.manage");
  const raw = (await ctx.rawBody()) as Settings[typeof section];
  const def = DEFAULT_SETTINGS[section];
  // shape check: only known keys of the right primitive type
  let clean = sanitize(def, raw) as Settings[typeof section];
  if (section === "notifications") clean = restoreNotificationSecrets(clean as Settings["notifications"], (await getSettings(ctx.db)).notifications) as Settings[typeof section];
  if (section === "backup") clean = restoreBackupSecrets(clean as Settings["backup"], (await getSettings(ctx.db)).backup) as Settings[typeof section];
  if (section === "security") {
    const sec = clean as Settings["security"];
    if (sec.idleMinutes < 0 || sec.idleMinutes > 480 || sec.maxFailedAttempts < 3 || sec.maxFailedAttempts > 20 || sec.minPasswordLength < 6 || sec.sessionHours < 1 || sec.sessionHours > 72) throw badRequest("Security values are out of range");
  }
  if (section === "backup") {
    const f = (clean as Settings["backup"]).folder;
    if (f && f.trim()) {
      const { validateUserFolder, storageHealth } = await import("../fsSafe");
      const dir = validateUserFolder(f, "Backup folder");
      try {
        (await import("node:fs")).mkdirSync(dir, { recursive: true });
      } catch (e) {
        throw badRequest(`Cannot create or use this folder (${(e as NodeJS.ErrnoException).code ?? "error"}). Check that the drive is connected and writable.`);
      }
      if (!storageHealth(dir, 0).writable) throw badRequest("This folder is not writable. Choose another folder or fix its permissions.");
    }
  }
  if (section === "reports") {
    const f = (clean as Settings["reports"]).scheduledExportFolder;
    if (f && f.trim()) (await import("../fsSafe")).validateUserFolder(f, "Export folder");
  }
  const before = (await getSettings(ctx.db))[section];
  await setSection(ctx.db, section, clean, ctx.me().id);
  const shown = (v: unknown) => (section === "notifications" ? maskNotifications(v as Settings["notifications"]) : section === "backup" ? maskBackup(v as Settings["backup"]) : v);
  await audit(ctx.db, ctx.actor, "settings.updated", "Setting", section, { before: shown(before), after: shown(clean) });
  publish("settings", section);
  return shown(clean);
});

function sanitize(def: unknown, val: unknown): unknown {
  if (def === null || typeof def !== "object") {
    if (def === null) return val ?? null;
    if (typeof def === typeof val) return typeof val === "string" ? (val as string).slice(0, 4000) : val;
    if (typeof def === "number" && typeof val === "string" && val.trim() !== "" && Number.isFinite(Number(val))) return Number(val);
    return def;
  }
  if (Array.isArray(def)) return Array.isArray(val) ? val : def;
  const out: Record<string, unknown> = {};
  const v = (val && typeof val === "object" ? val : {}) as Record<string, unknown>;
  const keys = new Set([...Object.keys(def as object), ...(isRecordMap(def) ? Object.keys(v) : [])]);
  for (const k of keys) {
    const d = (def as Record<string, unknown>)[k] ?? Object.values(def as object)[0];
    out[k] = k in v ? sanitize(d, v[k]) : d;
  }
  return out;
}
const isRecordMap = (o: unknown) => o !== null && typeof o === "object" && Object.keys(o as object).every((k) => /^[A-Z_]+$/.test(k));

// ── license ────────────────────────────────────────────────────────────────
route("GET", "/license", { allowReadOnly: true }, async (ctx) => {
  const info = await getLicenseInfo(ctx.db);
  const sessions = await ctx.db.userWindowSession.findMany({ where: { revokedAt: null, expiresAt: { gt: new Date() } }, select: { terminalId: true } });
  return { ...info, roomsActive: await ctx.db.room.count({ where: { active: true } }), terminalsInUse: new Set(sessions.map((s) => s.terminalId)).size };
});
route("POST", "/license/activate", { perm: "license.manage", allowReadOnly: true }, async (ctx) => {
  const b = await ctx.body(z.object({ key: z.string().min(20).max(4000) }));
  const before = await ctx.db.license.findUnique({ where: { id: "license" } });
  const p = await activateLicense(ctx.db, b.key);
  invalidateLicenseCache();
  await audit(ctx.db, ctx.actor, "license.activated", "License", p.id, { before: { payload: parseJson(before?.payload, {}) }, after: { payload: p } });
  publish("system", "license");
  return p;
});
route("GET", "/license/request-code", { perm: "license.manage", allowReadOnly: true }, async (ctx) => ({ code: await activationRequest(ctx.db) }));
route("POST", "/license/status", { perm: "license.manage", allowReadOnly: true }, async (ctx) => {
  const b = await ctx.body(z.object({ doc: z.string().min(20).max(200_000) }));
  const r = await importStatusList(ctx.db, b.doc);
  invalidateLicenseCache();
  await audit(ctx.db, ctx.actor, "license.statusImported", "License", "", { after: r });
  publish("system", "license");
  return r;
});
route("GET", "/license/transfer-code", { perm: "license.manage", allowReadOnly: true }, async (ctx) => ({ code: await transferCode(ctx.db) }));

// ── support bundle ─────────────────────────────────────────────────────────
route("GET", "/system/diagnostics", { perm: "settings.manage", allowReadOnly: true }, async (ctx) => {
  const { tailLogs } = await import("../log");
  const { storageHealth } = await import("../fsSafe");
  const { backupHealth } = await import("../services/backup");
  const lic = await getLicenseInfo(ctx.db);
  const e = env();
  const head = [
    `PetraPMS support bundle — ${new Date().toISOString()}`,
    `version ${e.appVersion} · mode ${e.mode} · database ${e.provider} · node ${process.versions.node} · ${process.platform} ${process.arch}`,
    `data folder ${e.dataDir}`,
    `license ${lic.state.mode}${lic.state.readOnly ? ` (read-only: ${(lic.state as { reason?: string }).reason})` : ""} · edition ${lic.edition} · id ${lic.licenseId ?? "-"} · hotel ${lic.hotelId ?? "-"}`,
    `storage ${JSON.stringify(storageHealth())}`,
    `backup ${JSON.stringify({ ...(await backupHealth(ctx.db)), folder: undefined })}`,
    "",
    "Contains no passwords, tokens or keys (redacted at write time). Please send this file to support.",
  ].join("\n");
  const body = [head, ...Object.entries(tailLogs(200)).map(([k, v]) => `\n===== ${k}.log (last 200 lines) =====\n${v}`)].join("\n");
  await audit(ctx.db, ctx.actor, "system.diagnostics", "System", "");
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8", "content-disposition": 'attachment; filename="petrapms-support.txt"', "cache-control": "no-store" } });
});

// ── audit log & system info ────────────────────────────────────────────────
route("GET", "/audit", { perm: "audit.view", allowReadOnly: true }, async (ctx) => {
  const { take, skip } = pageArgs(ctx.query, 500);
  const q = ctx.query.get("q")?.trim();
  const where = {
    ...(q ? { OR: [{ action: { contains: q } }, { username: { contains: q } }, { entityId: { contains: q } }, { entity: { contains: q } }] } : {}),
    ...(ctx.query.get("from") ? { businessDate: { gte: ctx.query.get("from")! } } : {}),
    ...(ctx.query.get("action") ? { action: { startsWith: ctx.query.get("action")! } } : {}),
  };
  const [rows, total] = await Promise.all([ctx.db.auditLog.findMany({ where, orderBy: { at: "desc" }, take, skip }), ctx.db.auditLog.count({ where })]);
  return { rows, total };
});

route("GET", "/system/info", { perm: ["settings.view", "settings.manage"], allowReadOnly: true }, async (ctx) => {
  const e = env();
  return { version: e.appVersion, mode: e.mode, provider: e.provider, dataDir: e.dataDir, schemaVersion: latestSchemaVersion(e.provider), migration: lastMigration(), node: process.version, platform: process.platform, uptimeSeconds: Math.round(process.uptime()) };
});

route("GET", "/business-date", { allowReadOnly: true }, async (ctx) => ({ businessDate: ctx.businessDate }));
