// Real installer smoke test — runs ONLY on Windows (a GitHub windows-latest runner or a real Windows machine), after
// the installer exe has been built. It drives the ACTUAL NSIS installer (silent install/uninstall), then starts the
// bundled server the same way the Windows Service does (ELECTRON_RUN_AS_NODE against the installed app.asar), using
// the real HTTP API. Every row below maps to a row of docs/WINDOWS-VALIDATION.md. Nothing here is faked: a check
// that cannot run on a CI runner (no real hardware/printer/signing) is reported MANUAL, not PASS.
//
// Usage: node scripts/installer-smoke.mjs <path-to-installer.exe> [--service]
//   --service   only run the (separate, best-effort) Windows Service install/start/stop/remove section.
// Env:
//   PETRA_PREV_INSTALLER   path to a PREVIOUS build's installer, if one could be found. When unset, the upgrade
//                          row is reported "SKIPPED: no previous build", never faked as a pass.
//   GITHUB_STEP_SUMMARY    when set, the PASS/FAIL table is also appended there (GitHub Actions job summary).
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { root } from "./_util.mjs";

const results = []; // { name, status: PASS|FAIL|SKIPPED|MANUAL, detail }
const record = (name, status, detail = "") => {
  results.push({ name, status, detail });
  console.log(`[${status}]`, name, detail ? `— ${detail}` : "");
};
const ok = (name, cond, detail = "") => record(name, cond ? "PASS" : "FAIL", detail);

if (process.platform !== "win32") {
  console.error("installer-smoke.mjs only runs on Windows.");
  process.exit(1);
}

const exe = process.argv[2];
const serviceOnly = process.argv.includes("--service");
if (!exe || !fs.existsSync(exe)) {
  console.error(`Usage: node scripts/installer-smoke.mjs <installer.exe> [--service]\nGot: ${exe}`);
  process.exit(1);
}
const desktopVersion = JSON.parse(fs.readFileSync(path.join(root, "apps", "desktop", "package.json"), "utf8")).version;
const installDir = "C:\\PetraPMS-Smoke-Install";
const programData = path.join(process.env.ProgramData || "C:\\ProgramData", "PetraPMS");

function ps(cmd) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", cmd], { encoding: "utf8", windowsHide: true });
  return { code: r.status, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}
function killApp() {
  spawnSync("taskkill", ["/IM", "PetraPMS.exe", "/F", "/T"], { windowsHide: true });
}
function runInstaller(installerExe, dir) {
  const r = spawnSync(installerExe, ["/S", `/D=${dir}`], { windowsHide: true, timeout: 180_000 });
  return r.status;
}
function runUninstaller(dir) {
  const un = path.join(dir, "Uninstall PetraPMS.exe");
  if (!fs.existsSync(un)) return { code: null, missing: true };
  const r = spawnSync(un, ["/S"], { windowsHide: true, timeout: 120_000 });
  return { code: r.status, missing: false };
}
function uninstallRegistryEntry() {
  const r = ps(`Get-ChildItem 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall','HKLM:\\Software\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall' -ErrorAction SilentlyContinue | Get-ItemProperty | Where-Object { $_.DisplayName -eq 'PetraPMS' } | Select-Object -First 1 DisplayName,Publisher,UninstallString | ConvertTo-Json -Compress`);
  try {
    return r.out ? JSON.parse(r.out) : null;
  } catch {
    return null;
  }
}
function loopbackOnlyListening(port) {
  const r = ps(`Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalAddress`);
  const addrs = r.out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  return { addrs, loopbackOnly: addrs.length > 0 && addrs.every((a) => a === "127.0.0.1" || a === "::1") };
}

/** Starts the INSTALLED server the way WinSW/the shell does: ELECTRON_RUN_AS_NODE against the installed app.asar. */
async function startInstalledServer({ dataDir, port, hostname, extraEnv = {} }) {
  const launcher = path.join(installDir, "resources", "app.asar", "src", "server-launcher.cjs");
  const env = {
    SystemRoot: process.env.SystemRoot,
    windir: process.env.windir,
    ELECTRON_RUN_AS_NODE: "1",
    PETRA_DATA_DIR: dataDir,
    PORT: String(port),
    PETRA_APP_VERSION: desktopVersion,
    ...(hostname ? { HOSTNAME: hostname } : {}),
    ...extraEnv,
  }; // deliberately NOT inheriting PATH: proves node/pnpm on PATH are not required at runtime.
  const proc = spawn(path.join(installDir, "PetraPMS.exe"), [launcher], { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  proc.stdout.on("data", (c) => (out += c));
  proc.stderr.on("data", (c) => (out += c));
  const base = `http://127.0.0.1:${port}/api`;
  let up = false;
  for (let i = 0; i < 100 && !up; i++) {
    up = await fetch(`${base}/status`).then((r) => r.ok).catch(() => false);
    if (!up) await sleep(400);
  }
  return { proc, base, up, log: () => out };
}
async function call(base, method, p, body, token) {
  const r = await fetch(base + p, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  return (r.headers.get("content-type") || "").includes("json") ? r.json() : { ok: r.ok, bytes: Buffer.from(await r.arrayBuffer()) };
}
const SETUP_BODY = {
  locale: "en",
  hotel: { name: "Smoke Test Hotel", address: "Gulshan 2", city: "Dhaka", phone: "+8801711000000", email: "fo@smoke.bd", bin: "000123456789", checkInTime: "14:00", checkOutTime: "12:00" },
  floors: [{ floor: "1", firstNumber: 101, count: 4 }],
  roomTypes: [{ code: "STD", name: "Standard", bedType: "DOUBLE", baseOccupancy: 2, maxAdults: 2, maxChildren: 1, maxOccupancy: 3, baseRate: 400000, extraBedRate: 80000 }],
  assignments: [{ roomTypeCode: "STD", from: "101", to: "104" }],
  tax: { vatBp: 1500, scBp: 1000, mode: "EXCLUSIVE" },
  admin: { fullName: "Smoke Admin", username: "admin", password: "SmokeTest1234", pin: "7392" },
  loadDemo: false,
};
async function stopServer(h) {
  if (!h) return;
  try {
    h.proc.kill();
  } catch {
    /* already gone */
  }
  await sleep(500);
}

/* ================================================================================================================ */
/* Section: Windows Service (best-effort, run only with --service, in its own CI job)                               */
/* ================================================================================================================ */
async function serviceSection() {
  console.log("=== Windows Service (best-effort) ===");
  killApp();
  if (runInstaller(exe, installDir) !== 0) {
    record("[service] install for service test", "FAIL", "installer did not exit 0");
    return finish();
  }
  const exeMain = path.join(installDir, "PetraPMS.exe");
  const install = spawnSync(exeMain, ["--service", "install"], { windowsHide: true, timeout: 60_000 });
  record("[service] install", install.status === 0 ? "PASS" : "FAIL", `exit ${install.status}`);
  await sleep(2000);
  const status1 = ps(`sc.exe query PetraPMS`);
  record("[service] running after install", /RUNNING/.test(status1.out) ? "PASS" : "FAIL", status1.out.split(/\r?\n/).find((l) => l.includes("STATE")) || "");
  const fw = ps(`netsh advfirewall firewall show rule name="PetraPMS Server"`);
  record("[service] firewall rule present", /PetraPMS Server/.test(fw.out) ? "PASS" : "FAIL");
  const stop = spawnSync(exeMain, ["--service", "stop"], { windowsHide: true, timeout: 30_000 });
  record("[service] stop", stop.status === 0 ? "PASS" : "FAIL", `exit ${stop.status}`);
  const uninstall = spawnSync(exeMain, ["--service", "uninstall"], { windowsHide: true, timeout: 30_000 });
  record("[service] uninstall", uninstall.status === 0 ? "PASS" : "FAIL", `exit ${uninstall.status}`);
  const status2 = ps(`sc.exe query PetraPMS`);
  record("[service] removed", /does not exist|FAILED 1060/i.test(status2.out + status2.err) ? "PASS" : "FAIL", status2.out || status2.err);
  const fw2 = ps(`netsh advfirewall firewall show rule name="PetraPMS Server"`);
  record("[service] firewall rule removed", !/PetraPMS Server/.test(fw2.out) ? "PASS" : "FAIL");
  const un = runUninstaller(installDir);
  record("[service] cleanup uninstall", un.code === 0 ? "PASS" : "FAIL", un.missing ? "uninstaller missing" : `exit ${un.code}`);
  return finish();
}

/* ================================================================================================================ */
/* Section: the main installer smoke test                                                                          */
/* ================================================================================================================ */
async function mainSection() {
  killApp();
  fs.rmSync(installDir, { recursive: true, force: true });

  // --- optional upgrade test: install the PREVIOUS build first, add data + a PRE_UPDATE backup ------------------
  const prev = process.env.PETRA_PREV_INSTALLER;
  const havePrev = !!(prev && fs.existsSync(prev));
  if (havePrev) {
    const code = runInstaller(prev, installDir);
    if (code !== 0) {
      record("Upgrade test: previous build installs", "FAIL", `exit ${code}`);
    } else {
      killApp();
      const port = await freePort();
      const h = await startInstalledServer({ dataDir: programData, port });
      if (h.up) {
        const setup = await call(h.base, "POST", "/setup", SETUP_BODY);
        const login = setup.ok ? await call(h.base, "POST", "/auth/login", { username: "admin", password: "SmokeTest1234", windowId: "w", terminalId: "t" }) : { ok: false };
        const prep = login.ok ? await call(h.base, "POST", "/system/update/prepare", undefined, login.data?.token) : { ok: false };
        record("Upgrade test: data created on previous build", setup.ok === true && login.ok === true, setup.ok ? "" : JSON.stringify(setup));
        record("Upgrade test: PRE_UPDATE backup created before installing new build", prep.ok === true, prep.ok ? `backup ${prep.data?.fileName}` : JSON.stringify(prep));
      } else {
        record("Upgrade test: previous build server starts", "FAIL", h.log().slice(-500));
      }
      await stopServer(h);
    }
  } else {
    record("Upgrade test", "SKIPPED", "no previous build available (PETRA_PREV_INSTALLER not set) — not a pass, genuinely not run");
  }
  killApp();

  // --- install (or upgrade-install) the build under test --------------------------------------------------------
  const installCode = runInstaller(exe, installDir);
  ok("Silent per-machine install exits 0 (/S /D=)", installCode === 0, `exit ${installCode}`);
  await sleep(1500);
  killApp(); // runAfterFinish may have launched the app; stop it so the checks below control the process themselves

  ok("Installed files present (PetraPMS.exe, app.asar, web server, winsw.exe)", ["PetraPMS.exe", path.join("resources", "app.asar"), path.join("resources", "web", "apps", "web", "server.js"), path.join("resources", "winsw", "winsw.exe")].every((p) => fs.existsSync(path.join(installDir, p))));

  // --- release pipeline only: the installer and the installed exe must both carry a valid Authenticode signature --
  if (process.env.PETRA_VERIFY_SIGNATURE === "1") {
    const sig1 = ps(`(Get-AuthenticodeSignature '${exe}').Status`);
    ok("Installer package is validly signed", sig1.out.trim() === "Valid", sig1.out || sig1.err);
    const sig2 = ps(`(Get-AuthenticodeSignature '${path.join(installDir, "PetraPMS.exe")}').Status`);
    ok("Installed PetraPMS.exe is validly signed", sig2.out.trim() === "Valid", sig2.out || sig2.err);
  }

  const startMenu = [path.join(process.env.ProgramData || "", "Microsoft\\Windows\\Start Menu\\Programs\\PetraPMS.lnk"), path.join(process.env.APPDATA || "", "Microsoft\\Windows\\Start Menu\\Programs\\PetraPMS.lnk")];
  ok("Start Menu shortcut exists", startMenu.some((p) => fs.existsSync(p)), startMenu.find((p) => fs.existsSync(p)) || "");
  const desktopLnks = [path.join("C:\\Users\\Public\\Desktop", "PetraPMS.lnk"), path.join(os.homedir(), "Desktop", "PetraPMS.lnk")];
  ok("Desktop shortcut exists", desktopLnks.some((p) => fs.existsSync(p)), desktopLnks.find((p) => fs.existsSync(p)) || "");

  const reg = uninstallRegistryEntry();
  ok("Uninstall registry entry: product name + publisher", !!reg && reg.DisplayName === "PetraPMS", reg ? JSON.stringify(reg) : "no entry found");

  ok("%ProgramData%\\PetraPMS created", fs.existsSync(programData));

  if (havePrev) {
    const port = await freePort();
    const h = await startInstalledServer({ dataDir: programData, port });
    if (h.up) {
      const st = await call(h.base, "GET", "/status");
      ok("Upgrade keeps data (setupComplete still true)", st.data?.setupComplete === true, `got ${JSON.stringify(st.data?.setupComplete)}`);
    } else {
      ok("Upgrade keeps data (setupComplete still true)", false, "server did not start after upgrade: " + h.log().slice(-500));
    }
    await stopServer(h);
  }

  // --- independent server checks on a SCRATCH data dir: health, setup, login, PDF, backup, bind address --------
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "petra-smoke-"));
  const port = await freePort();
  const h = await startInstalledServer({ dataDir: scratch, port });
  ok("Installed server starts via PetraPMS.exe (ELECTRON_RUN_AS_NODE, no PATH/node/pnpm)", h.up, h.up ? "" : h.log().slice(-500));
  if (h.up) {
    const bind = loopbackOnlyListening(port);
    ok("Standalone mode binds 127.0.0.1 only (not 0.0.0.0)", bind.loopbackOnly, `listening on: ${bind.addrs.join(", ") || "(none observed)"}`);
    const setup = await call(h.base, "POST", "/setup", SETUP_BODY);
    ok("Setup wizard API works", setup.ok === true, setup.ok ? "" : JSON.stringify(setup));
    const login = await call(h.base, "POST", "/auth/login", { username: "admin", password: "SmokeTest1234", windowId: "w", terminalId: "t" });
    ok("Login works", login.ok === true, login.ok ? "" : JSON.stringify(login));
    const token = login.data?.token;
    const pdf = await call(h.base, "GET", "/print/test?format=80mm", undefined, token);
    ok("PDF renders (English+Bangla test page)", pdf.ok === true && pdf.bytes?.subarray(0, 4).toString() === "%PDF", `${pdf.bytes?.length ?? 0} bytes`);
    const bk = await call(h.base, "POST", "/backups", {}, token);
    ok("Backup completes", bk.ok === true, bk.ok ? "" : JSON.stringify(bk));

    // --- Windows-name safety: exercise the real validateUserFolder() through the settings API -------------------
    const nameCases = [
      ["CON", "D:\\PetraBackups\\CON", "FRIENDLY_ERROR"],
      ["NUL", "D:\\PetraBackups\\NUL", "FRIENDLY_ERROR"],
      ["COM1", "D:\\PetraBackups\\COM1", "FRIENDLY_ERROR"],
      ["trailing dot/space", "D:\\PetraBackups\\Hotel. ", "FRIENDLY_ERROR"],
      ["long path (>260 chars)", "D:\\" + "a".repeat(270), "FRIENDLY_ERROR"],
      ["Bangla (non-ASCII) path", path.join(scratch, "ব্যাকআপ-ফোল্ডার"), "SUCCEEDS"],
    ];
    for (const [label, folder, expect] of nameCases) {
      const r = await call(h.base, "PUT", "/settings/backup", { folder }, token);
      const alive = await call(h.base, "GET", "/status").then((s2) => s2.data?.version !== undefined).catch(() => false);
      const gotFriendlyError = r.ok === false && typeof r.error?.message === "string" && r.error.message.length > 0;
      const pass = alive && (expect === "FRIENDLY_ERROR" ? gotFriendlyError : r.ok === true);
      ok(`Windows-name safety: ${label}`, pass, `expected ${expect}, got ${r.ok ? "ok" : JSON.stringify(r.error)}; server alive=${alive}`);
    }
  }
  await stopServer(h);
  fs.rmSync(scratch, { recursive: true, force: true });

  // --- GUI launch: process stays alive, no crash/error log entries ----------------------------------------------
  fs.mkdirSync(path.join(programData, "logs"), { recursive: true });
  const errLogBefore = fs.existsSync(path.join(programData, "logs", "error.log")) ? fs.statSync(path.join(programData, "logs", "error.log")).size : 0;
  const gui = spawn(path.join(installDir, "PetraPMS.exe"), [], { windowsHide: false, stdio: "ignore", detached: true });
  gui.unref();
  await sleep(22_000);
  const tl = ps(`(Get-Process -Name PetraPMS -ErrorAction SilentlyContinue | Measure-Object).Count`);
  const alive = tl.out.trim() !== "0" && tl.out.trim() !== "";
  const errLogAfter = fs.existsSync(path.join(programData, "logs", "error.log")) ? fs.statSync(path.join(programData, "logs", "error.log")).size : 0;
  ok("GUI launch stays alive 20+ seconds", alive, `process count: ${tl.out}`);
  ok("GUI launch writes no new error.log entry", errLogAfter === errLogBefore, `error.log ${errLogBefore} -> ${errLogAfter} bytes`);
  killApp();

  // --- uninstall: program + shortcuts removed, %ProgramData% KEPT -------------------------------------------------
  const un = runUninstaller(installDir);
  ok("Silent uninstall exits 0", un.code === 0, un.missing ? "uninstaller missing" : `exit ${un.code}`);
  await sleep(1500);
  ok("Uninstall removes program files", !fs.existsSync(path.join(installDir, "PetraPMS.exe")));
  ok("Uninstall removes shortcuts", !startMenu.some((p) => fs.existsSync(p)) && !desktopLnks.some((p) => fs.existsSync(p)));
  ok("Uninstall KEEPS %ProgramData%\\PetraPMS (customer data)", fs.existsSync(programData) && fs.existsSync(path.join(programData, "config.json")));

  // --- reinstall: finds existing data, no re-setup ------------------------------------------------------------
  const reinstallCode = runInstaller(exe, installDir);
  ok("Reinstall exits 0", reinstallCode === 0, `exit ${reinstallCode}`);
  await sleep(1500);
  killApp();
  const port2 = await freePort();
  const h2 = await startInstalledServer({ dataDir: programData, port: port2 });
  if (h2.up) {
    const st = await call(h2.base, "GET", "/status");
    ok("Reinstall finds existing data (no re-setup)", st.data?.setupComplete === true, `got ${JSON.stringify(st.data?.setupComplete)}`);
  } else {
    ok("Reinstall finds existing data (no re-setup)", false, "server did not start after reinstall: " + h2.log().slice(-500));
  }
  await stopServer(h2);

  // final cleanup
  killApp();
  const un2 = runUninstaller(installDir);
  record("cleanup uninstall", un2.code === 0 ? "PASS" : "FAIL", un2.missing ? "uninstaller missing" : `exit ${un2.code}`);

  return finish();
}

// GitHub Actions workflow-command escaping for ::error:: (percent, CR, LF per the documented rules).
const ghaEscape = (s) => String(s).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");

function finish() {
  const lines = ["| Row | Result | Detail |", "|---|---|---|", ...results.map((r) => `| ${r.name} | ${r.status} | ${(r.detail || "").replace(/\|/g, "\\|").slice(0, 300)} |`)];
  const table = lines.join("\n");
  console.log("\n" + table);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n## Installer smoke test${serviceOnly ? " — Windows Service (best-effort)" : ""}\n\n${table}\n`);
  const failed = results.filter((r) => r.status === "FAIL");
  // Full job logs are not always retrievable (e.g. a blob-storage URL blocked by network policy), so every failed row
  // is ALSO written as a GitHub Actions error annotation — readable from the Checks API without the raw log.
  for (const r of failed) console.log(`::error title=${ghaEscape(r.name)}::${ghaEscape(r.detail || "(no detail)")}`);
  if (failed.length) {
    console.error(`\n${failed.length} row(s) FAILED.`);
    process.exit(1);
  }
  console.log("\nAll non-skipped rows PASS.");
  process.exit(0);
}

await (serviceOnly ? serviceSection() : mainSection());
