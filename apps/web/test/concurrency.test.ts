import { describe, it, expect, beforeAll } from "vitest";
import { addDays } from "@petra/core";
import { api, freshApp, setupAndLogin } from "./helpers";
import { clientIp } from "@/server/api";

let T = "";
let BD = "";
describe("LAN concurrency", () => {
  beforeAll(async () => {
    await freshApp("petra-conc-");
    ({ token: T, businessDate: BD } = await setupAndLogin());
  });

  it("serves 120 parallel mixed requests with no 5xx", async () => {
    const paths = ["/rooms", "/room-types", "/reservations", "/dashboard", "/auth/me", "/status"];
    const res = await Promise.all(Array.from({ length: 120 }, (_, i) => api("GET", paths[i % paths.length], undefined, T)));
    expect(res.filter((r) => r.status >= 500)).toHaveLength(0);
    expect(res.every((r) => r.ok)).toBe(true);
  });

  it("two terminals racing for the last rooms never overbook", async () => {
    const types = (await api("GET", "/room-types", undefined, T)).data as { id: string; code: string }[];
    const std = types.find((t) => t.code === "STD")!;
    const guest = { firstName: "Race", lastName: "Test", phone: "01711000000", idType: "NID", idNumber: "99999" };
    const out = await Promise.all(
      Array.from({ length: 24 }, (_, i) => api("POST", "/reservations", { guest, arrival: addDays(BD, 30), departure: addDays(BD, 31), rooms: [{ roomTypeId: std.id, adults: 1 }] }, T, { "X-Petra-Terminal": `t${i % 2}` })),
    );
    expect(out.filter((r) => r.status >= 500)).toHaveLength(0);
    expect(out.filter((r) => r.ok)).toHaveLength(4);
    expect(out.filter((r) => r.status === 409)).toHaveLength(20);
  });

  it("forwarded-for is ignored unless a trusted proxy is configured", () => {
    const req = new Request("http://x/api", { headers: { "x-forwarded-for": "6.6.6.6" } });
    delete process.env.PETRA_TRUST_PROXY;
    expect(clientIp(req)).toBe("lan");
    process.env.PETRA_TRUST_PROXY = "1";
    expect(clientIp(req)).toBe("6.6.6.6");
    expect(clientIp(new Request("http://x/api", { headers: { "x-forwarded-for": "<script>" } }))).toBe("lan");
    delete process.env.PETRA_TRUST_PROXY;
  });
});
