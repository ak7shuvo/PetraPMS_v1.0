import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const v = require("../../desktop/src/ipc-validate.cjs");
const pdf = (n = 100) => Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(n)]);

describe("desktop IPC validation", () => {
  it("origin check rejects look-alike hosts", () => {
    expect(v.sameOrigin("http://127.0.0.1:38080/x", "http://127.0.0.1:38080")).toBe(true);
    expect(v.sameOrigin("http://127.0.0.1:38080.evil.com/x", "http://127.0.0.1:38080")).toBe(false);
    expect(v.sameOrigin("file:///c:/x", "http://127.0.0.1:38080")).toBe(false);
    expect(v.sameOrigin("garbage", "http://a")).toBe(false);
  });
  it("routes cannot leave the origin", () => {
    for (const r of ["//evil.com", "http://evil.com", "/a\\b", "javascript:alert(1)", 5, null, "/x\n"]) expect(v.safeRoute(r)).toBe("/");
    expect(v.safeRoute("/reservations?id=1")).toBe("/reservations?id=1");
  });
  it("print accepts only real PDFs of sane size", () => {
    expect(v.printArgs(new Uint8Array(pdf()).buffer, { silent: true, printer: "EPSON" }).silent).toBe(true);
    expect(() => v.printArgs(Buffer.from("MZ not a pdf"), {})).toThrow();
    expect(() => v.printArgs("string", {})).toThrow();
    expect(() => v.printArgs(Buffer.alloc(v.MAX_PDF + 10), {})).toThrow();
    expect(v.printArgs(pdf(), { printer: "a\u0000b", silent: "yes" })).toMatchObject({ printer: undefined, silent: false });
  });
  it("file names are sanitised", () => {
    expect(v.fileName("..\\..\\evil.exe")).not.toMatch(/[\\/]/);
    expect(v.fileName("../../x")).not.toContain("/");
    expect(v.fileName("CON.txt")).toBe("_CON.txt");
    expect(v.fileName(undefined)).toBe("file");
    expect(v.fileName("a".repeat(500)).length).toBe(120);
  });
  it("window options and workspace are clamped", () => {
    expect(v.windowOpts({ bounds: { x: "1", width: 800, height: Infinity }, title: 5 })).toEqual({ bounds: { width: 800 }, displayId: undefined, title: undefined });
    expect(() => v.workspace("x")).toThrow();
    expect(() => v.workspace(new Array(9).fill({}))).toThrow();
    expect(v.workspace([{ route: "//evil", bounds: { width: 500 } }])[0].route).toBe("/");
  });
  it("external urls: http(s) only, no credentials", () => {
    expect(v.externalUrl("https://example.com/a")).toBe("https://example.com/a");
    for (const u of ["file:///c:/windows/system32/calc.exe", "javascript:alert(1)", "ms-msdt:/x", "https://u:p@x.com", "nope"]) expect(v.externalUrl(u)).toBeNull();
  });
  it("server url normalised", () => {
    expect(v.serverUrl("http://192.168.1.5:38080/path?x")).toBe("http://192.168.1.5:38080");
    expect(() => v.serverUrl("ftp://x")).toThrow();
  });
  it("security-critical webPreferences stay on and no dangerous APIs are used", () => {
    const dir = path.join(__dirname, "../../desktop/src");
    for (const f of ["main.cjs"]) {
      const src = fs.readFileSync(path.join(dir, f), "utf8");
      expect(src).not.toMatch(/nodeIntegration:\s*true|contextIsolation:\s*false|sandbox:\s*false|webSecurity:\s*false|enableRemoteModule|allowRunningInsecureContent:\s*true/);
      expect(src).not.toMatch(/\beval\(|new Function\(|\bexec\(|shell\.openPath\((?!config\.dataDir|file\)|logger\.dir)/);
    }
    const pre = fs.readFileSync(path.join(dir, "preload.cjs"), "utf8");
    expect(pre).not.toMatch(/exposeInMainWorld\([^)]*ipcRenderer\b[^.]/);
  });
});

describe("desktop PDF IPC", () => {
  it("pdfBytes accepts only real, bounded PDFs", () => {
    expect(v.pdfBytes(new Uint8Array(pdf()).buffer).length).toBeGreaterThan(5);
    expect(() => v.pdfBytes(Buffer.from("<html>"))).toThrow();
    expect(() => v.pdfBytes({})).toThrow();
  });
});

describe("desktop logger", () => {
  it("rotates, redacts and writes errors to error.log", () => {
    const dir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "petra-dl-"));
    process.env.PETRA_DATA_DIR = dir;
    const logger = require("../../desktop/src/logger.cjs");
    logger.log("info", "desktop", "hello Bearer abcdefghijklmnop12345");
    logger.log("error", "update", "boom");
    const rd = (n: string) => fs.readFileSync(path.join(dir, "logs", n), "utf8");
    expect(rd("desktop.log")).toContain("hello Bearer [redacted]");
    expect(rd("update.log")).toContain("boom");
    expect(rd("error.log")).toContain("boom");
    fs.writeFileSync(path.join(dir, "logs", "desktop.log"), "x".repeat(2 * 1024 * 1024 + 5));
    logger.log("info", "desktop", "after");
    expect(fs.existsSync(path.join(dir, "logs", "desktop.log.1"))).toBe(true);
    logger.rotatingStream("server-stdio.log").write("token=abc123secret\n");
    expect(rd("server-stdio.log")).not.toContain("abc123secret");
    delete process.env.PETRA_DATA_DIR;
  });
});
