import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { api, freshApp, setupAndLogin } from "./helpers";
import { signV4, FolderProvider, S3Provider } from "@/server/services/backupStorage";
import { maybeAutoBackup } from "@/server/services/backup";
import { getDb } from "@/server/db";

const N1 = "petrapms-manual-20260101000000.petrabak";

describe("SigV4", () => {
  it("matches the AWS documentation test vector", () => {
    const r = signV4({ method: "GET", host: "examplebucket.s3.amazonaws.com", path: "/test.txt", headers: { Range: "bytes=0-9" }, payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", region: "us-east-1", accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", amzDate: "20130524T000000Z" });
    expect(r.signature).toBe("f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
  });
});

describe("FolderProvider", () => {
  beforeAll(async () => {
    await freshApp("petra-fp-env-");
  });
  it("stores, lists, reads, removes and refuses odd names", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "petra-fp-"));
    const p = new FolderProvider(dir);
    await p.test();
    await p.put(N1, Buffer.from("abc"));
    expect(await p.list()).toEqual([{ name: N1, size: 3 }]);
    expect((await p.get(N1)).toString()).toBe("abc");
    await expect(p.get("../../etc/passwd")).rejects.toThrow();
    await expect(p.put("evil.exe", Buffer.from("x"))).rejects.toThrow();
    await p.remove(N1);
    expect(await p.list()).toEqual([]);
  });
  it("refuses system folders", () => {
    expect(() => new FolderProvider("C:\\Windows\\System32")).toThrow();
  });
});

describe("S3Provider + replication", () => {
  const store = new Map<string, Buffer>();
  let srv: http.Server;
  let port = 0;
  const seen: { auth: string; hashOk: boolean }[] = [];
  beforeAll(async () => {
    srv = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const body = Buffer.concat(chunks);
        seen.push({ auth: String(req.headers.authorization ?? ""), hashOk: createHash("sha256").update(body).digest("hex") === req.headers["x-amz-content-sha256"] });
        const u = new URL(req.url!, "http://x");
        const key = decodeURIComponent(u.pathname.replace(/^\/bkt\/?/, ""));
        if (!req.headers.authorization?.startsWith("AWS4-HMAC-SHA256 Credential=AK/")) return void res.writeHead(403).end("<Error><Code>AccessDenied</Code></Error>");
        if (req.method === "PUT") return store.set(key, body), void res.writeHead(200).end();
        if (req.method === "DELETE") return store.delete(key), void res.writeHead(204).end();
        if (req.method === "GET" && u.searchParams.get("list-type")) {
          const pre = u.searchParams.get("prefix") ?? "";
          const xml = [...store].filter(([k]) => k.startsWith(pre)).map(([k, v]) => `<Contents><Key>${k}</Key><Size>${v.length}</Size></Contents>`).join("");
          return void res.writeHead(200).end(`<ListBucketResult>${xml}</ListBucketResult>`);
        }
        const v = store.get(key);
        return v ? void res.writeHead(200).end(v) : void res.writeHead(404).end("<Error><Code>NoSuchKey</Code></Error>");
      });
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    port = (srv.address() as { port: number }).port;
  });
  afterAll(() => srv.close());
  const cfg = () => ({ provider: "s3" as const, folder: "", endpoint: `http://127.0.0.1:${port}`, region: "auto", bucket: "bkt", prefix: "petrapms/", accessKeyId: "AK", secretAccessKey: "SK" });

  it("talks S3 (put/list/get/delete) with signed requests and correct payload hashes", async () => {
    const p = new S3Provider(cfg());
    await p.test();
    await p.put(N1, Buffer.from("hello"));
    expect(await p.list()).toEqual([{ name: N1, size: 5 }]);
    expect((await p.get(N1)).toString()).toBe("hello");
    await p.remove(N1);
    expect(await p.list()).toEqual([]);
    expect(seen.every((s) => s.hashOk && s.auth.includes("SignedHeaders=host;x-amz-content-sha256;x-amz-date"))).toBe(true);
    await expect(new S3Provider({ ...cfg(), secretAccessKey: "SK", accessKeyId: "BAD" }).test()).rejects.toThrow(/AccessDenied/);
  });
  it("rejects plain-http remote endpoints and bad config", () => {
    expect(() => new S3Provider({ ...cfg(), endpoint: "http://example.com" })).toThrow(/https/);
    expect(() => new S3Provider({ ...cfg(), bucket: "" })).toThrow();
  });

  describe("end to end", () => {
    let T = "";
    beforeAll(async () => {
      await freshApp("petra-bk-");
      ({ token: T } = await setupAndLogin());
    });
    it("cloud copy requires encryption, hides the secret, then replicates and restores from remote", async () => {
      const bad = await api("PUT", "/settings/backup", { remote: cfg(), encrypt: false }, T);
      expect(bad.ok).toBe(true);
      const manual = await api("POST", "/backups", {}, T);
      expect(manual.ok).toBe(true); // local backup still succeeds
      const h = await api("GET", "/settings", undefined, T);
      expect(h.data.backup.lastRemote.ok).toBe(false);
      expect(h.data.backup.lastRemote.error).toMatch(/encryption/i);
      expect(JSON.stringify(h.data)).not.toContain('"SK"');
      expect(h.data.backup.remote.secretAccessKey).toBe("********");

      const dash = await api("GET", "/dashboard", undefined, T);
      expect(dash.data.backup.state).toBe("REMOTE_FAILED");

      // saving with the mask must keep the stored secret
      await api("PUT", "/settings/backup", { ...h.data.backup, encrypt: true }, T);
      const again = await api("POST", "/backups", {}, T);
      expect(again.ok).toBe(true);
      const s2 = await api("GET", "/settings", undefined, T);
      expect(s2.data.backup.lastRemote.ok).toBe(true);
      expect(store.size).toBe(1);
      const rem = await api("GET", "/backups/remote", undefined, T);
      expect(rem.data).toHaveLength(1);
      const insp = await api("POST", "/backups/inspect", { remoteName: rem.data[0].name }, T);
      expect(insp.ok).toBe(true);
      expect(insp.data.ok).toBe(true);
      expect((await api("POST", "/backups/remote/test", {}, T)).ok).toBe(true);
    });
    it("a failing backup is recorded, friendly, and retried after 30 minutes", async () => {
      const f = path.join(os.tmpdir(), `petra-notdir-${Date.now()}`);
      fs.writeFileSync(f, "i am a file"); // backup folder that is actually a file → ENOTDIR
      const db = await getDb();
      const t = await api("PUT", "/settings/backup", { folder: f, remote: { provider: "none" } }, T);
      expect(t.ok).toBe(false); // refused at save time
      // force the bad value directly (e.g. a USB drive that was unplugged after saving)
      await db.setting.update({ where: { key: "backup" }, data: { value: JSON.stringify({ ...(await (await import("@/server/settings")).getSection(db, "backup")), folder: f, remote: { provider: "none" }, lastRunDate: "", lastFailAt: "", enabled: true, time: "00:00" }) } });
      const er = await maybeAutoBackup(db, "2030-01-01", "23:59").catch((x) => x);
      expect(er.code).toBe("STORAGE_UNAVAILABLE");
      expect(await maybeAutoBackup(db, "2030-01-01", "23:59")).toBeNull(); // throttled
      const h = await api("GET", "/dashboard", undefined, T);
      expect(h.data.backup.state).toBe("FAILED");
    });
  });
});
