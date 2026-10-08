import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { safeChild, assertRegularFile, validateUserFolder, validateDataDir, storageHealth, windowsNameProblem } from "@/server/fsSafe";
import { mapSystemError } from "@/server/errors";
import { readUpload } from "@/server/services/files";
import { freshApp } from "./helpers";

describe("filesystem safety", () => {
  it("blocks path traversal in file names", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "fs-"));
    for (const bad of ["../x", "..\\x", "a/b", "C:\\x", "..", "a..b", "", "x\0y"]) expect(() => safeChild(base, bad)).toThrow();
    expect(safeChild(base, "ok-1.png")).toBe(path.join(base, "ok-1.png"));
  });
  it("refuses symbolic links", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "fs-"));
    fs.writeFileSync(path.join(base, "real.txt"), "x");
    fs.symlinkSync(path.join(base, "real.txt"), path.join(base, "link.txt"));
    expect(() => assertRegularFile(path.join(base, "real.txt"))).not.toThrow();
    expect(() => assertRegularFile(path.join(base, "link.txt"))).toThrow();
  });
  it("upload reader rejects traversal and symlinked uploads", async () => {
    const dir = await freshApp();
    expect(() => readUpload("../../etc/passwd")).toThrow();
    const secret = path.join(dir, "secret.txt");
    fs.writeFileSync(secret, "top secret");
    fs.symlinkSync(secret, path.join(dir, "uploads", "id-abc-0123456789ab.png"));
    expect(() => readUpload("id-abc-0123456789ab.png")).toThrow();
  });
  it("validates administrator-chosen folders", () => {
    const ok = path.join(os.tmpdir(), "petra-backups");
    expect(validateUserFolder(ok)).toBe(ok);
    for (const bad of ["", "relative/dir", os.tmpdir() + "/../x", "/", "/etc", "/usr/lib/x"]) expect(() => validateUserFolder(bad)).toThrow();
  });
  it("flags Windows-reserved device names and trailing dot/space in any path segment", () => {
    for (const bad of ["D:\\PetraBackups\\CON", "D:\\CON.txt\\backups", "D:\\backups\\com3", "D:\\LPT9", "D:\\backups\\nul\\x", "D:\\backups\\x.", "D:\\backups\\x ", "D:\\backups \\x"]) expect(windowsNameProblem(bad)).not.toBeNull();
    for (const ok of ["D:\\PetraBackups", "D:\\PetraBackups\\Hotel-Dhaka", "D:\\backups\\confirmed", "D:\\backups\\console"]) expect(windowsNameProblem(ok)).toBeNull();
  });
  it("rejects dangerous data directories", () => {
    expect(() => validateDataDir("/")).toThrow();
    expect(() => validateDataDir("/etc/petra")).toThrow();
    expect(() => validateDataDir(os.tmpdir())).not.toThrow();
  });
  it("on Windows, requires a drive letter (a bare '/etc' is not a safe path — it resolves against whatever the current drive happens to be)", () => {
    // Found by the installer smoke-test gate: `pnpm test` had never run on an actual Windows runner before, and a
    // path like "/etc" is NOT caught by the POSIX-only protected-folder list once process.platform is win32, because
    // path.resolve("/etc") on Windows becomes "<current drive>:\etc", which matches nothing in WIN_PROTECTED.
    const original = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { value: "win32" });
    try {
      for (const bad of ["/etc", "/etc/petra", "/usr/lib/x", "\\foo\\bar", "relative\\dir"]) {
        expect(() => validateUserFolder(bad)).toThrow();
        expect(() => validateDataDir(bad)).toThrow();
      }
      for (const ok of ["D:\\PetraBackups", "\\\\server\\share\\PetraBackups"]) expect(() => validateDataDir(ok)).not.toThrow();
    } finally {
      Object.defineProperty(process, "platform", original);
    }
  });
  it("reports storage health and maps disk errors to friendly messages", () => {
    const h = storageHealth(os.tmpdir());
    expect(h.writable).toBe(true);
    expect(storageHealth("/proc/nope").writable).toBe(false);
    const full = mapSystemError(Object.assign(new Error("write failed"), { code: "ENOSPC" }));
    expect(full?.code).toBe("DISK_FULL");
    expect((full?.details as { bn: string }).bn).toContain("ডিস্ক");
    expect(mapSystemError(Object.assign(new Error("x"), { code: "EROFS" }))?.code).toBe("STORAGE_READONLY");
    expect(mapSystemError(new Error("connect ECONNREFUSED 127.0.0.1:5432"))?.message).not.toContain("5432");
    expect(mapSystemError(new Error("random bug"))).toBeNull();
  });
});
