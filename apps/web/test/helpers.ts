// Test harness: runs the real API router against a fresh SQLite database in a temp folder.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dispatch, markSetupDone, invalidateLicenseCache, type Method } from "@/server/api";
import { resetEnvCache } from "@/server/env";
import { closeDb, getDb } from "@/server/db";

export async function freshApp(prefix = "petra-test-") {
  await closeDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  process.env.PETRA_DATA_DIR = dir;
  process.env.PETRA_FINGERPRINT = "test-machine";
  // PETRA_TEST_PG=postgresql://… runs the whole suite against PostgreSQL (use with --no-file-parallelism).
  if (process.env.PETRA_TEST_PG) {
    const { Client } = await import("pg");
    const c = new Client({ connectionString: process.env.PETRA_TEST_PG });
    await c.connect();
    await c.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await c.end();
    process.env.DATABASE_PROVIDER = "postgres";
    process.env.DATABASE_URL = process.env.PETRA_TEST_PG;
  }
  resetEnvCache();
  markSetupDone(false);
  invalidateLicenseCache();
  await getDb();
  return dir;
}

export interface ApiResult<T = any> {
  status: number;
  ok: boolean;
  data: T;
  error?: { code: string; message: string; details?: any };
}

export async function api<T = any>(method: Method, p: string, body?: unknown, token?: string, headers: Record<string, string> = {}): Promise<ApiResult<T>> {
  const [pathname, query = ""] = p.split("?");
  const req = new Request(`http://localhost/api${pathname}${query ? "?" + query : ""}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), "x-petra-window": "w1", "x-petra-terminal": "t1", ...headers },
    body: body === undefined || method === "GET" ? undefined : JSON.stringify(body),
  });
  const res = await dispatch(req, method, pathname.split("/").filter(Boolean));
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("json") || res.headers.get("content-disposition")) return { status: res.status, ok: res.ok, data: (await res.arrayBuffer()) as any };
  const j = (await res.json()) as { ok: boolean; data?: T; error?: ApiResult["error"] };
  return { status: res.status, ok: j.ok, data: j.data as T, error: j.error };
}

export const setupBody = (over: Record<string, unknown> = {}) => ({
  locale: "en",
  hotel: { name: "Hotel Test Dhaka", address: "Gulshan 2", city: "Dhaka", phone: "+8801711000000", email: "fo@test.bd", bin: "000123456789", checkInTime: "14:00", checkOutTime: "12:00" },
  floors: [
    { floor: "1", firstNumber: 101, count: 4 },
    { floor: "2", firstNumber: 201, count: 4 },
  ],
  roomTypes: [
    { code: "STD", name: "Standard", bedType: "DOUBLE", baseOccupancy: 2, maxAdults: 2, maxChildren: 1, maxOccupancy: 3, baseRate: 400000, extraBedRate: 80000 },
    { code: "DLX", name: "Deluxe", bedType: "KING", baseOccupancy: 2, maxAdults: 3, maxChildren: 2, maxOccupancy: 4, baseRate: 650000, extraBedRate: 100000 },
  ],
  assignments: [{ roomTypeCode: "DLX", from: "201", to: "204" }],
  tax: { vatBp: 1500, scBp: 1000, mode: "EXCLUSIVE" },
  admin: { fullName: "Admin User", username: "admin", password: "Admin1234", pin: "7392" },
  loadDemo: false,
  ...over,
});

export async function setupAndLogin(over: Record<string, unknown> = {}) {
  const s = await api("POST", "/setup", setupBody(over));
  if (!s.ok) throw new Error(`setup failed: ${JSON.stringify(s.error)}`);
  const l = await api<{ token: string; businessDate: string }>("POST", "/auth/login", { username: "admin", password: "Admin1234", windowId: "w1", terminalId: "t1" });
  if (!l.ok) throw new Error(`login failed: ${JSON.stringify(l.error)}`);
  return { token: l.data.token, businessDate: l.data.businessDate };
}
