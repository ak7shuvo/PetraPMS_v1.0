// Backup storage providers. Business logic (createBackup) only knows this interface; where the second copy goes
// (another folder/NAS/USB, AWS S3, Cloudflare R2, MinIO, …) is a configuration choice. New providers (Google Drive,
// OneDrive, SFTP) are added by implementing BackupStorageProvider and registering it in `buildProvider`.
// Local backup in the primary folder always happens first; a provider failure never fails the local backup.
import fs from "node:fs";
import path from "node:path";
import { createHash, createHmac } from "node:crypto";
import type { Settings } from "../settings";
import { validateUserFolder, safeChild } from "../fsSafe";
import { ApiError } from "../errors";

export interface RemoteObject {
  name: string;
  size: number;
}
export interface BackupStorageProvider {
  readonly id: string;
  /** Verifies credentials/connectivity without writing real data. */
  test(): Promise<void>;
  put(name: string, data: Buffer): Promise<void>;
  get(name: string): Promise<Buffer>;
  list(): Promise<RemoteObject[]>;
  remove(name: string): Promise<void>;
}

const NAME = /^petrapms-[a-z-]+-\d{14}\.petrabak$/;
function checkName(n: string) {
  if (!NAME.test(n)) throw new ApiError(400, "BAD_BACKUP_NAME", "Invalid backup file name");
  return n;
}

/* ---- folder (second drive, NAS share, USB stick) --------------------------------------------------------------- */
export class FolderProvider implements BackupStorageProvider {
  readonly id = "folder";
  private dir: string;
  constructor(folder: string) {
    this.dir = validateUserFolder(folder, "Second backup folder");
  }
  async test() {
    fs.mkdirSync(this.dir, { recursive: true });
    const probe = path.join(this.dir, `.petra-probe-${Date.now()}`);
    fs.writeFileSync(probe, "ok");
    fs.rmSync(probe, { force: true });
  }
  async put(name: string, data: Buffer) {
    fs.mkdirSync(this.dir, { recursive: true });
    const f = safeChild(this.dir, checkName(name));
    fs.writeFileSync(f + ".part", data);
    fs.renameSync(f + ".part", f);
  }
  async get(name: string) {
    return fs.readFileSync(safeChild(this.dir, checkName(name)));
  }
  async list() {
    if (!fs.existsSync(this.dir)) return [];
    return fs.readdirSync(this.dir).filter((n) => NAME.test(n)).map((name) => ({ name, size: fs.statSync(path.join(this.dir, name)).size }));
  }
  async remove(name: string) {
    fs.rmSync(safeChild(this.dir, checkName(name)), { force: true });
  }
}

/* ---- S3-compatible (AWS S3, Cloudflare R2, MinIO, Wasabi…) — AWS Signature V4, no SDK dependency -------------------- */
const sha256 = (d: string | Buffer) => createHash("sha256").update(d).digest("hex");
const hmac = (k: string | Buffer, d: string) => createHmac("sha256", k).update(d).digest();
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

/** Exported for the test vector from the AWS documentation. */
export function signV4(o: { method: string; host: string; path: string; query?: Record<string, string>; headers?: Record<string, string>; payloadHash: string; region: string; accessKeyId: string; secretAccessKey: string; amzDate: string; service?: string }) {
  const service = o.service ?? "s3";
  const date = o.amzDate.slice(0, 8);
  const headers: Record<string, string> = { host: o.host, "x-amz-content-sha256": o.payloadHash, "x-amz-date": o.amzDate, ...(o.headers ?? {}) };
  const names = Object.keys(headers).map((h) => h.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v.trim()]));
  const canonicalQuery = Object.entries(o.query ?? {})
    .map(([k, v]) => [enc(k), enc(v)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const canonical = [o.method, o.path, canonicalQuery, names.map((n) => `${n}:${lower[n]}\n`).join(""), names.join(";"), o.payloadHash].join("\n");
  const scope = `${date}/${o.region}/${service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", o.amzDate, scope, sha256(canonical)].join("\n");
  const key = hmac(hmac(hmac(hmac("AWS4" + o.secretAccessKey, date), o.region), service), "aws4_request");
  const signature = createHmac("sha256", key).update(toSign).digest("hex");
  return { signature, authorization: `AWS4-HMAC-SHA256 Credential=${o.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`, headers };
}

export class S3Provider implements BackupStorageProvider {
  readonly id = "s3";
  private base: URL;
  constructor(private c: Settings["backup"]["remote"]) {
    if (!c.endpoint || !c.bucket || !c.accessKeyId || !c.secretAccessKey) throw new ApiError(400, "REMOTE_CONFIG", "Cloud backup needs endpoint, bucket, access key and secret key");
    let u: URL;
    try {
      u = new URL(c.endpoint);
    } catch {
      throw new ApiError(400, "REMOTE_CONFIG", "Cloud backup endpoint is not a valid URL");
    }
    if (u.protocol !== "https:" && !/^(localhost|127\.0\.0\.1)$/.test(u.hostname)) throw new ApiError(400, "REMOTE_CONFIG", "Cloud backup endpoint must use https://");
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(c.bucket)) throw new ApiError(400, "REMOTE_CONFIG", "Invalid bucket name");
    this.base = u;
  }
  private key(name: string) {
    const p = this.c.prefix.replace(/^\/+/, "");
    return (p && !p.endsWith("/") ? p + "/" : p) + name;
  }
  private async call(method: string, objectKey: string, query: Record<string, string> = {}, body?: Buffer): Promise<Response> {
    // path-style addressing works for S3, R2 and MinIO alike
    const pathname = "/" + [this.c.bucket, ...objectKey.split("/").filter(Boolean)].map(enc).join("/") + (objectKey.endsWith("/") ? "/" : "");
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
    const payloadHash = sha256(body ?? "");
    const host = this.base.host;
    const s = signV4({ method, host, path: pathname, query, payloadHash, region: this.c.region || "auto", accessKeyId: this.c.accessKeyId, secretAccessKey: this.c.secretAccessKey, amzDate });
    const qs = Object.keys(query).length ? "?" + Object.entries(query).map(([k, v]) => `${enc(k)}=${enc(v)}`).join("&") : "";
    const res = await fetch(`${this.base.origin}${pathname}${qs}`, { method, headers: { ...s.headers, Authorization: s.authorization }, body: body as unknown as BodyInit, signal: AbortSignal.timeout(120_000) });
    return res;
  }
  private async ok(res: Response, what: string) {
    if (res.ok) return res;
    // Never include the response body verbatim in user-facing text; keep the code only.
    const text = (await res.text().catch(() => "")).match(/<Code>([^<]+)<\/Code>/)?.[1] ?? "";
    throw new ApiError(502, "REMOTE_FAILED", `Cloud backup ${what} failed (HTTP ${res.status}${text ? " " + text : ""})`);
  }
  async test() {
    await this.ok(await this.call("GET", "", { "list-type": "2", "max-keys": "1" }), "connection test");
  }
  async put(name: string, data: Buffer) {
    await this.ok(await this.call("PUT", this.key(checkName(name)), {}, data), "upload");
  }
  async get(name: string) {
    const r = await this.ok(await this.call("GET", this.key(checkName(name))), "download");
    return Buffer.from(await r.arrayBuffer());
  }
  async list() {
    const r = await this.ok(await this.call("GET", "", { "list-type": "2", prefix: this.key("") }), "list");
    const xml = await r.text();
    const out: RemoteObject[] = [];
    for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const k = m[1].match(/<Key>([^<]+)<\/Key>/)?.[1] ?? "";
      const size = Number(m[1].match(/<Size>(\d+)<\/Size>/)?.[1] ?? 0);
      const name = k.split("/").pop() ?? "";
      if (NAME.test(name)) out.push({ name, size });
    }
    return out;
  }
  async remove(name: string) {
    await this.ok(await this.call("DELETE", this.key(checkName(name))), "delete");
  }
}

export function buildProvider(s: Settings["backup"]): BackupStorageProvider | null {
  const r = s.remote;
  if (r.provider === "none") return null;
  if (r.provider === "folder") return new FolderProvider(r.folder);
  if (r.provider === "s3") {
    if (!s.encrypt) throw new ApiError(400, "REMOTE_NEEDS_ENCRYPTION", "Turn on backup encryption before sending backups to cloud storage");
    return new S3Provider(r);
  }
  throw new ApiError(400, "REMOTE_CONFIG", "Unknown backup storage provider");
}
