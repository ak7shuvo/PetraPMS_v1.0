// API router used by the catch-all route handler (app/api/[...path]/route.ts).
// Every route declares its auth mode and permission; the router authenticates the window session (or POS API
// key), checks the permission, enforces read-only licensing on mutations, validates input with Zod, and turns
// errors into a consistent JSON shape. Business logic never lives in the browser.
import { z, ZodError, type ZodType } from "zod";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { getDb, type Db } from "./db";
import { authenticate, bearer, sha256, type SessionUser } from "./auth";
import { ApiError, badRequest, forbidden, unauthorized, readOnly, mapSystemError } from "./errors";
import { getBusinessDate, type AuditActor } from "./common";
import { getLicenseInfo, type LicenseInfo } from "./services/license";
import { errText, log } from "./log";

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type AuthMode = "public" | "user" | "apikey";

export interface Ctx {
  db: Db;
  req: Request;
  method: Method;
  params: Record<string, string>;
  query: URLSearchParams;
  user: SessionUser | null;
  sessionId: string | null;
  apiKey: { id: string; name: string } | null;
  ip: string;
  terminalId: string;
  windowId: string;
  businessDate: string;
  actor: AuditActor;
  can(perm: string): boolean;
  need(...perms: string[]): void;
  body<T>(schema: ZodType<T>): Promise<T>;
  rawBody(): Promise<unknown>;
  license(): Promise<LicenseInfo>;
  me(): SessionUser;
}

export interface RouteOpts {
  auth?: AuthMode;
  /** user needs ANY of these permissions */
  perm?: string | string[];
  /** allowed while the license is read-only (exports, activation, sign-in) */
  allowReadOnly?: boolean;
  /** allowed before the Quick Setup wizard finished */
  beforeSetup?: boolean;
  /** license module required */
  module?: string;
}

interface RouteDef extends RouteOpts {
  method: Method;
  path: string;
  regex: RegExp;
  keys: string[];
  handler: (ctx: Ctx) => Promise<unknown>;
}

const routes: RouteDef[] = [];

export function route(method: Method, path: string, opts: RouteOpts, handler: (ctx: Ctx) => Promise<unknown>) {
  const keys: string[] = [];
  const regex = new RegExp("^" + path.replace(/\/:([A-Za-z_]+)/g, (_m, k) => (keys.push(k), "/([^/]+)")) + "/?$");
  routes.push({ method, path, regex, keys, handler, auth: "user", ...opts });
}

export const listRoutes = () => routes.map((r) => ({ method: r.method, path: r.path, auth: r.auth, perm: r.perm }));

function match(method: Method, path: string) {
  let pathMatched = false;
  for (const r of routes) {
    const m = r.regex.exec(path);
    if (!m) continue;
    pathMatched = true;
    if (r.method !== method) continue;
    const params: Record<string, string> = {};
    r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
    return { route: r, params };
  }
  return pathMatched ? "METHOD" : null;
}

export function zodMessage(e: ZodError): { message: string; issues: { path: string; message: string }[] } {
  const issues = e.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
  const first = issues[0];
  return { message: first ? `${first.path ? first.path + ": " : ""}${first.message}` : "Invalid input", issues };
}

function prismaToApi(e: unknown): ApiError | null {
  const pe = e as { code?: string; meta?: { target?: string[] | string; modelName?: string; cause?: string } };
  if (typeof pe?.code !== "string" || !pe.code.startsWith("P")) return null;
  if (pe.code === "P2002") {
    const t = pe.meta?.target;
    const fields = Array.isArray(t) ? t.join(", ") : (t ?? "value");
    return new ApiError(409, "DUPLICATE", `A record with the same ${fields} already exists`, { fields });
  }
  if (pe.code === "P2025") return new ApiError(404, "NOT_FOUND", "Record not found");
  if (pe.code === "P2003") return new ApiError(409, "IN_USE", "This record is referenced by other records and cannot be changed or deleted");
  return null;
}

const licenseCache: { at: number; info: LicenseInfo | null } = { at: 0, info: null };
export function invalidateLicenseCache() {
  licenseCache.at = 0;
}
async function cachedLicense(db: Db) {
  if (licenseCache.info && Date.now() - licenseCache.at < 30_000) return licenseCache.info;
  licenseCache.info = await getLicenseInfo(db);
  licenseCache.at = Date.now();
  return licenseCache.info;
}

let setupDone = false;
export function markSetupDone(v = true) {
  setupDone = v;
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

/**
 * Forwarded-for headers are client-controlled, so they are only believed when an operator who runs the app behind
 * their own reverse proxy sets PETRA_TRUST_PROXY=1. Otherwise the address is not attributable from inside the route
 * handler and the terminal id (also audited) identifies the workstation. Nothing security-relevant keys on this value
 * (lockout is per user), so a spoofed header can no longer forge audit entries either.
 */
export function clientIp(req: Request) {
  if (process.env.PETRA_TRUST_PROXY !== "1") return "lan";
  const raw = (req.headers.get("x-forwarded-for")?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "").trim();
  return /^[0-9a-fA-F:.]{3,45}$/.test(raw) ? raw : "lan";
}

export async function dispatch(req: Request, method: Method, segments: string[]): Promise<Response> {
  await import("./routes");
  const path = "/" + segments.map(encodeURIComponent).join("/");
  const found = match(method, path.replace(/%2F/gi, "/"));
  if (found === null) return json(404, { ok: false, error: { code: "NOT_FOUND", message: `No API route ${method} ${path}` } });
  if (found === "METHOD") return json(405, { ok: false, error: { code: "METHOD_NOT_ALLOWED", message: `${method} not allowed` } });
  const { route: r, params } = found;
  let db: Db;
  try {
    db = await getDb();
  } catch (e) {
    log("error", "database", `database unavailable: ${errText(e)}`);
    const m = mapSystemError(e);
    return json(503, { ok: false, error: { code: m?.code ?? "DB_UNAVAILABLE", message: m?.message ?? "The hotel database is not available. Contact your administrator.", details: m?.details ?? { bn: "হোটেলের ডেটাবেস পাওয়া যাচ্ছে না। অ্যাডমিনের সাথে যোগাযোগ করুন।" } } });
  }
  const url = new URL(req.url);
  let bodyCache: unknown = undefined;
  let bodyRead = false;
  const ctx: Ctx = {
    db,
    req,
    method,
    params,
    query: url.searchParams,
    user: null,
    sessionId: null,
    apiKey: null,
    ip: clientIp(req),
    terminalId: (req.headers.get("x-petra-terminal") ?? "").slice(0, 64),
    windowId: (req.headers.get("x-petra-window") ?? "").slice(0, 64),
    businessDate: "",
    actor: {},
    can: () => false,
    need: () => undefined,
    async rawBody() {
      if (!bodyRead) {
        bodyRead = true;
        // Unauthenticated routes (login, setup…) never need more than ~1 MB (setup may carry a logo); everything else is capped at 12 MB.
        // Content-Length is checked before the body is read so an oversized upload cannot exhaust memory.
        const max = r.auth === "public" ? 1024 * 1024 : 12 * 1024 * 1024;
        if (Number(req.headers.get("content-length") ?? 0) > max) throw new ApiError(413, "TOO_LARGE", "Request is too large");
        const text = await req.text();
        if (text.length > max) throw new ApiError(413, "TOO_LARGE", "Request is too large");
        try {
          bodyCache = text ? JSON.parse(text) : {};
        } catch {
          throw badRequest("Request body is not valid JSON");
        }
      }
      return bodyCache;
    },
    async body<T>(schema: ZodType<T>) {
      const raw = await ctx.rawBody();
      const res = schema.safeParse(raw);
      if (!res.success) {
        const m = zodMessage(res.error);
        throw badRequest(m.message, { issues: m.issues });
      }
      return res.data;
    },
    license: () => cachedLicense(db),
    me() {
      if (!ctx.user) throw unauthorized();
      return ctx.user;
    },
  };
  try {
    if (r.auth === "user") {
      const a = await authenticate(db, bearer(req));
      if (!a) throw unauthorized();
      ctx.user = a.user;
      ctx.sessionId = a.sessionId;
      ctx.terminalId = a.terminalId;
      ctx.windowId = a.windowId;
      const perms = new Set(a.user.permissions);
      ctx.can = (p) => perms.has(p);
      ctx.need = (...ps) => {
        if (!ps.some((p) => perms.has(p))) throw forbidden(ps.join(" or "));
      };
      if (a.user.mustChangePassword && !r.path.startsWith("/auth/")) throw new ApiError(403, "PASSWORD_CHANGE_REQUIRED", "You must change your password before continuing");
    } else if (r.auth === "apikey") {
      const key = req.headers.get("x-api-key") ?? bearer(req);
      if (!key || !key.startsWith("ppk_")) throw unauthorized("API key required (X-API-Key header)");
      const row = await db.apiKey.findUnique({ where: { prefix: key.slice(0, 12) } });
      const given = Buffer.from(sha256(key));
      const want = Buffer.from(row?.keyHash ?? "");
      if (!row || !row.active || given.length !== want.length || !timingSafeEqual(given, want)) throw unauthorized("Invalid API key");
      ctx.apiKey = { id: row.id, name: row.name };
      ctx.can = () => true;
      ctx.terminalId = `api:${row.prefix}`;
      void db.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
    }
    if (r.perm) ctx.need(...(Array.isArray(r.perm) ? r.perm : [r.perm]));

    if (!r.beforeSetup && !setupDone) {
      const hotel = await db.hotel.findUnique({ where: { id: "hotel" }, select: { setupComplete: true } });
      if (hotel?.setupComplete) setupDone = true;
      else throw new ApiError(409, "SETUP_REQUIRED", "Complete the Quick Setup wizard first");
    }
    if (method !== "GET" && !r.allowReadOnly) {
      const lic = await cachedLicense(db);
      if (lic.state.readOnly) throw readOnly(lic.state.warnings[0] ?? "License is read-only");
    }
    if (r.module) {
      const lic = await cachedLicense(db);
      if (!lic.modules.includes(r.module)) throw new ApiError(403, "MODULE_NOT_LICENSED", `The ${r.module} module is not included in your license edition`);
    }
    ctx.businessDate = await getBusinessDate(db);
    ctx.actor = { userId: ctx.user?.id ?? null, username: ctx.user?.username ?? (ctx.apiKey ? `api:${ctx.apiKey.name}` : "system"), ip: ctx.ip, terminalId: ctx.terminalId, businessDate: ctx.businessDate };

    const result = await r.handler(ctx);
    if (result instanceof Response) return result;
    return json(200, { ok: true, data: result ?? null });
  } catch (e) {
    const known = e instanceof ApiError ? e : e instanceof ZodError ? badRequest(zodMessage(e).message, { issues: zodMessage(e).issues }) : (prismaToApi(e) ?? mapSystemError(e));
    if (known && !(e instanceof ApiError) && known.status >= 500) log("error", "api", `${method} ${path}: ${errText(e)}`);
    if (known && known.status === 403) log("warn", "security", `forbidden ${method} ${path} user=${ctx.user?.username ?? "-"} terminal=${ctx.terminalId || "-"} code=${known.code}`);
    if (known) return json(known.status, { ok: false, error: { code: known.code, message: known.message, details: known.details ?? null } });
    const ref = randomBytes(4).toString("hex");
    log("error", "api", `[${ref}] ${method} ${path}: ${errText(e, 10)}`);
    return json(500, { ok: false, error: { code: "INTERNAL", message: `Unexpected error (reference ${ref}). Your data is safe; please try again or contact support with this reference.`, ref, details: { bn: `অপ্রত্যাশিত ত্রুটি (রেফারেন্স ${ref})। আপনার ডেটা নিরাপদ আছে; আবার চেষ্টা করুন অথবা এই রেফারেন্সসহ সাপোর্টে যোগাযোগ করুন।`, ref } } });
  }
}

// ── shared Zod helpers ──────────────────────────────────────────────────────
export const zId = z.string().min(1).max(64);
export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
/** money in poisha as integer (the UI converts from taka) */
export const zMoney = z.number().int().min(-1_000_000_000_00).max(1_000_000_000_00);
export const zPositiveMoney = z.number().int().min(0).max(1_000_000_000_00);
export const zText = (max = 200) => z.string().trim().max(max);

export function pageArgs(q: URLSearchParams, maxTake = 200) {
  const take = Math.min(Math.max(Number(q.get("take") ?? 50) || 50, 1), maxTake);
  const skip = Math.max(Number(q.get("skip") ?? 0) || 0, 0);
  return { take, skip };
}
