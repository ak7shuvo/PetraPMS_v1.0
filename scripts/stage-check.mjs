// pnpm stage-check — runs the STAGED production bundle (the exact files that go into the installer) through the real
// desktop launcher, the way the Windows Service starts it (no Electron, no version passed from the shell).
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { root } from "./_util.mjs";
import { scanForSecrets } from "./stage-scan.mjs";

const stage = path.join(root, "apps", "desktop", "stage", "web");
const desktopVersion = JSON.parse(fs.readFileSync(path.join(root, "apps", "desktop", "package.json"), "utf8")).version;
const results = [];
const check = (name, ok, extra = "") => (results.push(ok), console.log(ok ? "PASS" : "FAIL", name, extra));

if (!fs.existsSync(path.join(stage, "apps", "web", "server.js"))) throw new Error("No stage: run `node scripts/build.mjs` first");
const web = path.join(stage, "apps", "web");
check("stage has no secrets or development data", scanForSecrets(stage).length === 0, scanForSecrets(stage).slice(0, 3).join("; "));
check("stage has no TypeScript sources, configs, tests or source maps", !["src", "test", "next.config.ts", "tsconfig.json"].some((n) => fs.existsSync(path.join(web, n))) && !JSON.stringify(fs.readdirSync(path.join(web, ".next", "server"), { recursive: true })).includes(".map"));

const data = fs.mkdtempSync(path.join(os.tmpdir(), "petra-stage-"));
const port = 3196;
const env = { ...process.env, PETRA_WEB_DIR: stage, PETRA_DATA_DIR: data, PORT: String(port), HOSTNAME: "127.0.0.1" };
delete env.PETRA_APP_VERSION;
delete env.NODE_ENV;
const srv = spawn(process.execPath, [path.join(root, "apps", "desktop", "src", "server-launcher.cjs")], { env, stdio: "ignore" });
const base = `http://127.0.0.1:${port}/api`;
const call = async (m, p, body, token) => {
  const r = await fetch(base + p, { method: m, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return (r.headers.get("content-type") || "").includes("json") ? r.json() : { ok: r.ok, bytes: Buffer.from(await r.arrayBuffer()) };
};
try {
  let up = false;
  for (let i = 0; i < 80 && !up; i++) {
    up = await fetch(`${base}/status`).then((r) => r.ok).catch(() => false);
    if (!up) await new Promise((r) => setTimeout(r, 400));
  }
  check("staged bundle starts through server-launcher.cjs", up);
  const st = await call("GET", "/status");
  check(`service-mode version = desktop package version (${desktopVersion})`, st.data?.version === desktopVersion, `got ${st.data?.version}`);
  check("public status does not expose the database engine", !("provider" in (st.data ?? {})));
  const setup = await call("POST", "/setup", {
    locale: "en",
    hotel: { name: "Stage Hotel", address: "Gulshan 2", city: "Dhaka", phone: "+8801711000000", email: "fo@stage.bd", bin: "000123456789", checkInTime: "14:00", checkOutTime: "12:00" },
    floors: [{ floor: "1", firstNumber: 101, count: 4 }],
    roomTypes: [{ code: "STD", name: "Standard", bedType: "DOUBLE", baseOccupancy: 2, maxAdults: 2, maxChildren: 1, maxOccupancy: 3, baseRate: 400000, extraBedRate: 80000 }],
    assignments: [{ roomTypeCode: "STD", from: "101", to: "104" }],
    tax: { vatBp: 1500, scBp: 1000, mode: "EXCLUSIVE" },
    admin: { fullName: "Admin User", username: "admin", password: "Admin1234", pin: "7392" },
    loadDemo: false,
  });
  check("first-run setup", setup.ok === true);
  const login = await call("POST", "/auth/login", { username: "admin", password: "Admin1234", windowId: "w", terminalId: "t" });
  check("login", login.ok === true);
  const token = login.data?.token;
  const pdf = await call("GET", "/print/test?format=80mm", undefined, token);
  check("PDF engine and bundled fonts work from the pruned stage (English+Bangla test page)", pdf.ok === true && pdf.bytes?.subarray(0, 4).toString() === "%PDF", `${pdf.bytes?.length ?? 0} bytes`);
  const bk = await call("POST", "/backups", {}, token);
  check("backup", bk.ok === true);
  const lic = await call("GET", "/license", undefined, token);
  check("licensing runs in production mode with the embedded public key (trial, no key bundled)", lic.ok === true && !JSON.stringify(lic.data).includes("PETRA1."), `mode ${lic.data?.state?.mode ?? lic.data?.mode}`);
} finally {
  srv.kill();
  fs.rmSync(data, { recursive: true, force: true });
}
process.exit(results.every(Boolean) ? 0 : 1);
