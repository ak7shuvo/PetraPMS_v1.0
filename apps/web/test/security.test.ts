import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { api, freshApp, setupAndLogin } from "./helpers";
import { loginGuard } from "@/server/auth";
import { dispatch } from "@/server/api";

let token = "";
beforeAll(async () => {
  await freshApp("petra-sec-");
  token = (await setupAndLogin()).token;
});
beforeEach(() => loginGuard.reset());

const login = (username: string, password: string) => api("POST", "/auth/login", { username, password, windowId: "wx", terminalId: "tx" });

describe("authentication hardening", () => {
  it("blocks an address after 20 failed sign-ins, and a success resets the count", async () => {
    for (let i = 0; i < 19; i++) await login("nobody", "WrongPassword9");
    expect((await login("admin", "Admin1234")).ok).toBe(true); // success clears the counter
    for (let i = 0; i < 20; i++) await login("nobody", "WrongPassword9");
    const r = await login("admin", "Admin1234");
    expect(r.status).toBe(429);
    expect(r.error?.code).toBe("TOO_MANY_ATTEMPTS");
    expect(r.error?.details?.bn).toBeTruthy();
  });

  it("does not list the Super Admin on the public PIN screen", async () => {
    const r = await api<{ username: string }[]>("GET", "/auth/pin-users");
    expect(r.ok).toBe(true);
    expect(r.data.find((u) => u.username === "admin")).toBeUndefined();
  });

  it("public status exposes no database engine", async () => {
    const r = await api<Record<string, unknown>>("GET", "/status");
    expect(r.ok).toBe(true);
    expect(r.data).not.toHaveProperty("provider");
  });

  it("rejects oversized request bodies on public routes before reading them", async () => {
    const big = JSON.stringify({ username: "x", password: "y".repeat(2 * 1024 * 1024) });
    const req = new Request("http://localhost/api/auth/login", { method: "POST", headers: { "content-type": "application/json", "content-length": String(big.length) }, body: big });
    const res = await dispatch(req, "POST", ["auth", "login"]);
    expect(res.status).toBe(413);
  });

  it("rejects missing, malformed and unknown tokens", async () => {
    for (const t of [undefined, "", "abc", "Bearer", "x".repeat(300)]) {
      const r = await api("GET", "/auth/me", undefined, t);
      expect(r.status).toBe(401);
    }
  });
});

describe("files and uploads", () => {
  it("serves only well-formed upload names (path traversal)", async () => {
    for (const n of ["..%2F..%2Fetc%2Fpasswd", "..%5C..%5Cwindows%5Cwin.ini", "id-1-aaaaaaaaaaaa.exe", "%2e%2e%2fsecret"]) {
      const r = await api("GET", `/files/${n}`, undefined, token);
      expect([400, 404]).toContain(r.status);
    }
  });

  it("a maintenance ticket cannot reference another file (e.g. a guest ID scan)", async () => {
    const r = await api("POST", "/maintenance", { title: "Leaking tap", photos: ["id-abc123-aaaaaaaaaaaa.png"] }, token);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
  });

  it("rejects a file whose content does not match its type", async () => {
    const fake = "data:image/png;base64," + Buffer.from("<script>alert(1)</script>").toString("base64").padEnd(40, "A");
    const r = await api("POST", "/maintenance", { title: "Broken lamp", photos: [fake] }, token);
    expect(r.ok).toBe(false);
  });
});

describe("authorization", () => {
  it("a housekeeper cannot read guest identity documents, settings changes or backups", async () => {
    const roles = await api<{ roles: { id: string; code: string }[] }>("GET", "/roles", undefined, token);
    const hk = roles.data.roles.find((r) => r.code === "HOUSEKEEPER")!;
    const u = await api<{ temporaryPassword: string }>("POST", "/users", { username: "hk2", fullName: "House Keeper", roleId: hk.id }, token);
    const l = await login("hk2", u.data.temporaryPassword);
    expect(l.ok).toBe(true);
    const t = (l.data as { token: string }).token;
    expect((await api("GET", "/files/id-abc-aaaaaaaaaaaa.png", undefined, t)).status).toBe(403);
    expect((await api("GET", "/backups", undefined, t)).status).toBe(403);
    expect((await api("PUT", "/settings/security", { idleMinutes: 9999 }, t)).status).toBe(403);
    expect((await api("GET", "/users", undefined, t)).status).toBe(403);
    expect((await api("POST", "/users", { username: "evil", fullName: "Evil", roleId: hk.id }, t)).status).toBe(403);
  });

  it("every route that is not public declares authentication", async () => {
    const { listRoutes } = await import("@/server/api");
    const open = listRoutes().filter((r) => r.auth === "public").map((r) => `${r.method} ${r.path}`);
    expect(open.sort()).toEqual(
      ["GET /auth/pin-users", "GET /events", "GET /pos/v1/openapi.json", "GET /setup/environment", "GET /setup/request-code", "GET /status", "POST /auth/login", "POST /auth/pin", "POST /setup"].sort(),
    );
  });
});
