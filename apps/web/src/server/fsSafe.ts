// Filesystem safety helpers: path traversal / symlink protection, user-chosen folder validation, storage health.
import fs from "node:fs";
import path from "node:path";
import { ApiError } from "./errors";
import { env } from "./env";

/** Joins `name` under `base`, refusing separators, `..`, drive letters and anything that resolves outside `base`. */
export function safeChild(base: string, name: string): string {
  if (!name || name.length > 200 || /[\\/:*?"<>|\0]/.test(name) || name === "." || name === ".." || name.includes("..")) throw new ApiError(400, "BAD_NAME", "Invalid file name");
  const root = path.resolve(base);
  const p = path.resolve(root, name);
  if (path.dirname(p) !== root) throw new ApiError(400, "BAD_NAME", "Invalid file name");
  return p;
}

/** Refuses symbolic links / junctions so a planted link cannot redirect a read or write outside the data folder. */
export function assertRegularFile(p: string): void {
  const st = fs.lstatSync(p);
  if (st.isSymbolicLink() || !st.isFile()) throw new ApiError(400, "BAD_FILE", "Not a regular file");
}

const WIN_PROTECTED = [/^[a-z]:\\windows(\\|$)/i, /^[a-z]:\\program files( \(x86\))?(\\|$)/i, /^[a-z]:\\programdata\\microsoft(\\|$)/i, /^[a-z]:\\users\\[^\\]+\\appdata\\(local|roaming)\\(microsoft|programs)(\\|$)/i];
const POSIX_PROTECTED = ["/bin", "/boot", "/dev", "/etc", "/lib", "/proc", "/root", "/sbin", "/sys", "/usr", "/var/lib", "/var/run"];
// Windows reserved device names: not usable as a file or folder name on any path segment, with or without an
// extension (CON, CON.txt, com3, lpt9 are all reserved). A segment ending in a dot or space is also rejected by
// Windows itself. Checking these ourselves turns a raw ENOENT/EINVAL from fs into a message the admin can act on.
const WIN_RESERVED_NAME = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.[^\\/]*)?$/i;

/** Exported for testing on any platform: the check itself does not depend on process.platform. */
export function windowsNameProblem(p: string): string | null {
  for (const seg of p.split(/[\\/]/).filter(Boolean)) {
    if (WIN_RESERVED_NAME.test(seg)) return `"${seg}" is a reserved Windows name and cannot be used in a path`;
    if (/[ .]$/.test(seg)) return `"${seg}" cannot end with a space or a dot on Windows`;
  }
  return null;
}

/** Validates a folder an administrator typed into Settings (backup folder, report export folder). */
export function validateUserFolder(input: string, what = "Folder"): string {
  const raw = (input ?? "").trim();
  if (!raw) throw new ApiError(400, "BAD_FOLDER", `${what} is empty`);
  if (raw.includes("\0") || raw.length > 260) throw new ApiError(400, "BAD_FOLDER", `${what} is not a valid path`);
  if (!path.isAbsolute(raw)) throw new ApiError(400, "BAD_FOLDER", `${what} must be a full path such as D:\\PetraBackups`);
  if (raw.split(/[\\/]/).includes("..")) throw new ApiError(400, "BAD_FOLDER", `${what} must not contain ".."`);
  const p = path.resolve(raw);
  if (path.parse(p).root === p) throw new ApiError(400, "BAD_FOLDER", `${what} cannot be a drive root; create a folder on it first`);
  const protectedHit = process.platform === "win32" ? WIN_PROTECTED.some((r) => r.test(p)) : POSIX_PROTECTED.some((d) => p === d || p.startsWith(d + "/"));
  if (protectedHit) throw new ApiError(400, "BAD_FOLDER", `${what} cannot be inside a system or program folder`);
  if (process.platform === "win32") {
    const nameProblem = windowsNameProblem(p);
    if (nameProblem) throw new ApiError(400, "BAD_FOLDER", `${what}: ${nameProblem}`);
  }
  const e = env();
  const inside = (a: string, b: string) => a === b || a.startsWith(b + path.sep);
  if (inside(p, path.resolve(e.uploadsDir)) || inside(p, path.resolve(e.logsDir)) || p === path.resolve(e.dataDir)) throw new ApiError(400, "BAD_FOLDER", `${what} cannot be the data, uploads or logs folder itself`);
  return p;
}

/** The data folder must be a real, writable directory that is not a system location (portable-mode safety). */
export function validateDataDir(dir: string): void {
  const p = path.resolve(dir);
  if (path.parse(p).root === p) throw new Error(`PETRA_DATA_DIR must not be a drive root (${p})`);
  const bad = process.platform === "win32" ? WIN_PROTECTED.some((r) => r.test(p)) : POSIX_PROTECTED.some((d) => p === d || p.startsWith(d + "/"));
  if (bad) throw new Error(`PETRA_DATA_DIR must not be a system or program folder (${p})`);
}

export interface StorageHealth {
  writable: boolean;
  freeBytes: number | null;
  low: boolean;
  error?: string;
}

/** Quick probe used by /status and the dashboard: can we write, and is there room? */
export function storageHealth(dir = env().dataDir, minFree = 500 * 1024 * 1024): StorageHealth {
  let writable = true;
  let error: string | undefined;
  const probe = path.join(dir, `.write-test-${process.pid}`);
  try {
    fs.writeFileSync(probe, "ok");
    fs.rmSync(probe, { force: true });
  } catch (e) {
    writable = false;
    error = (e as NodeJS.ErrnoException).code ?? "ERROR";
  }
  let freeBytes: number | null = null;
  try {
    const s = fs.statfsSync(dir);
    freeBytes = Number(s.bavail) * Number(s.bsize);
  } catch {
    /* not supported */
  }
  return { writable, freeBytes, low: freeBytes !== null && freeBytes < minFree, error };
}
