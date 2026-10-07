import { describe, it, expect, beforeAll } from "vitest";
import { api, freshApp, setupAndLogin } from "./helpers";

let T = "";
describe("provider secrets are write-only", () => {
  beforeAll(async () => {
    await freshApp();
    ({ token: T } = await setupAndLogin());
  });

  it("masks the API token on read, keeps it when the mask is sent back, and never audits it", async () => {
    const cur = (await api("GET", "/settings", undefined, T)).data.notifications;
    const secret = "Bearer sk_live_SUPERSECRET";
    const put = await api("PUT", "/settings/notifications", { ...cur, sms: { ...cur.sms, url: "https://sms.example.bd/send", headers: JSON.stringify({ "Content-Type": "application/json", Authorization: secret }) } }, T);
    expect(put.ok).toBe(true);
    expect(JSON.stringify(put.data)).not.toContain("SUPERSECRET");
    const read = (await api("GET", "/settings", undefined, T)).data.notifications;
    expect(read.sms.headers).toContain("********");
    expect(JSON.stringify(read)).not.toContain("SUPERSECRET");
    // The UI sends the masked value back unchanged: the stored token must survive.
    const again = await api("PUT", "/settings/notifications", { ...read, sms: { ...read.sms, senderId: "HOTEL" } }, T);
    expect(again.ok).toBe(true);
    const { getSettings } = await import("@/server/settings");
    const { getDb } = await import("@/server/db");
    expect((await getSettings(await getDb())).notifications.sms.headers).toContain("SUPERSECRET");
    const audit = await api("GET", "/audit?take=50", undefined, T);
    expect(JSON.stringify(audit.data)).not.toContain("SUPERSECRET");
  });
});
