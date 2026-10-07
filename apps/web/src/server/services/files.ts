// Uploaded files (guest ID scans, photos, room type photos) live in <data>/uploads with random names.
// They are served only through the authenticated /api/files/:name route, never as public static files.
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { env } from "../env";
import { ApiError } from "../errors";
import { assertRegularFile, safeChild } from "../fsSafe";

const TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "application/pdf": "pdf" };
const MAX = 5 * 1024 * 1024;

export async function saveDataUrl(dataUrl: string, prefix: string): Promise<string> {
  const m = /^data:([a-z/+.-]+);base64,(.+)$/.exec(dataUrl);
  if (!m || !TYPES[m[1]]) throw new ApiError(400, "BAD_FILE", "Only PNG, JPEG, WebP or PDF files are accepted");
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > MAX) throw new ApiError(413, "TOO_LARGE", "File is larger than 5 MB");
  // magic-number check so a renamed file cannot pretend to be an image
  const sig = buf.subarray(0, 4).toString("hex");
  const ok = (m[1] === "image/png" && sig === "89504e47") || (m[1] === "image/jpeg" && sig.startsWith("ffd8")) || (m[1] === "image/webp" && buf.subarray(8, 12).toString() === "WEBP") || (m[1] === "application/pdf" && buf.subarray(0, 4).toString() === "%PDF");
  if (!ok) throw new ApiError(400, "BAD_FILE", "The file content does not match its type");
  const name = `${prefix}-${Date.now().toString(36)}-${randomBytes(6).toString("hex")}.${TYPES[m[1]]}`;
  fs.writeFileSync(safeChild(env().uploadsDir, name), buf, { flag: "wx" });
  return name;
}

export function readUpload(name: string): { data: Buffer; type: string } {
  if (!/^[a-z]+-[a-z0-9]+-[a-f0-9]{12}\.(png|jpg|webp|pdf)$/.test(name)) throw new ApiError(400, "BAD_NAME", "Invalid file name");
  const p = safeChild(env().uploadsDir, name);
  if (!fs.existsSync(p)) throw new ApiError(404, "NOT_FOUND", "File not found");
  assertRegularFile(p);
  const ext = name.split(".").pop()!;
  const type = Object.entries(TYPES).find(([, e]) => e === ext)?.[0] ?? "application/octet-stream";
  return { data: fs.readFileSync(p), type };
}
