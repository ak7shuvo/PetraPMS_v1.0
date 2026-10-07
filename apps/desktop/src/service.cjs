"use strict";
// Windows Service + firewall management for "Server + Terminals" mode. Requires an elevated process
// (the installer or the app's "Install as service" action starts it with UAC). Uses WinSW (bundled by node-windows).
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const config = require("./config.cjs");

const SERVICE_ID = "PetraPMS";
const FW_RULE = "PetraPMS Server";

function winswExe() {
  const base = process.resourcesPath || path.join(__dirname, "..", "resources");
  const p = path.join(base, "winsw", "winsw.exe");
  if (!fs.existsSync(p)) throw new Error("winsw.exe not found at " + p);
  return p;
}

function xml(execPath, launcher, cfg, account) {
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<service>
  <id>${SERVICE_ID}</id>
  <name>PetraPMS Server</name>
  <description>PetraPMS hotel management server (LAN terminals connect to this)</description>
  <executable>${esc(execPath)}</executable>
  <arguments>"${esc(launcher)}"</arguments>
  <env name="ELECTRON_RUN_AS_NODE" value="1"/>
  <env name="PETRA_DATA_DIR" value="${esc(config.dataDir())}"/>
  <env name="PORT" value="${cfg.port}"/>
  <env name="HOSTNAME" value="${esc(cfg.bindHost || "0.0.0.0")}"/>
  <env name="PETRA_MODE" value="server"/>
  <startmode>Automatic</startmode>
${account === "LocalService" ? "  <serviceaccount><domain>NT AUTHORITY</domain><user>LocalService</user><password></password><allowservicelogon>true</allowservicelogon></serviceaccount>\n" : ""}
  <onfailure action="restart" delay="10 sec"/>
  <onfailure action="restart" delay="30 sec"/>
  <logpath>${esc(path.join(config.dataDir(), "logs"))}</logpath>
  <log mode="roll-by-size"><sizeThreshold>5120</sizeThreshold><keepFiles>5</keepFiles></log>
</service>
`;
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8", windowsHide: true });
  return { ok: r.status === 0, out: `${r.stdout || ""}${r.stderr || ""}`.trim() };
}

/**
 * Server mode ACL: only SYSTEM, Administrators and the service account (LocalService) can touch the data folder;
 * ordinary Windows users cannot read the database or backups from disk. They reach the data only through the app.
 * config.json (no secrets) stays readable so the desktop app can find the server address.
 */
function hardenAcl() {
  const d = config.dataDir();
  const r = [run("icacls", [d, "/inheritance:r"]), run("icacls", [d, "/grant", "*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F", "*S-1-5-19:(OI)(CI)M"])];
  const cfgFile = config.file();
  if (fs.existsSync(cfgFile)) r.push(run("icacls", [cfgFile, "/grant", "*S-1-5-32-545:R"]));
  return r.map((x) => x.out).filter(Boolean).join("\n");
}

function waitRunning(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (status().running) return true;
    spawnSync("powershell.exe", ["-NoProfile", "-Command", "Start-Sleep -Milliseconds 500"], { windowsHide: true });
  }
  return false;
}

function install() {
  if (process.platform !== "win32") throw new Error("Windows only");
  const cfg = config.load();
  const dir = path.join(config.dataDir(), "service");
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(config.dataDir(), "logs"), { recursive: true });
  const exe = path.join(dir, `${SERVICE_ID}.exe`);
  fs.copyFileSync(winswExe(), exe);
  const out = [hardenAcl()];
  // Preferred: low-privilege LocalService. If Windows refuses to start the service that way, fall back to LocalSystem
  // (the ACL above already allows both) and say so in the log.
  let account = cfg.serviceAccount === "LocalSystem" ? "LocalSystem" : "LocalService";
  for (let attempt = 0; attempt < 2; attempt++) {
    fs.writeFileSync(path.join(dir, `${SERVICE_ID}.xml`), xml(process.execPath, path.join(__dirname, "server-launcher.cjs"), cfg, account));
    out.push(run(exe, ["install"]).out, run(exe, ["start"]).out);
    if (waitRunning(20000)) break;
    out.push(`service did not start as ${account}`);
    run(exe, ["stop"]);
    run(exe, ["uninstall"]);
    if (account === "LocalSystem") throw new Error("Service failed to start:\n" + out.join("\n"));
    account = "LocalSystem";
    out.push("retrying as LocalSystem");
  }
  out.push(firewallAdd(cfg.port).out, `service account: ${account}`);
  return out.filter(Boolean).join("\n");
}

function uninstall() {
  const exe = path.join(config.dataDir(), "service", `${SERVICE_ID}.exe`);
  const out = [];
  if (fs.existsSync(exe)) {
    out.push(run(exe, ["stop"]).out, run(exe, ["uninstall"]).out);
  }
  out.push(firewallRemove().out);
  return out.filter(Boolean).join("\n");
}

/** Upgrade helper: stop the running service so installer files are not locked (no-op when not installed). */
function stop() {
  const exe = path.join(config.dataDir(), "service", `${SERVICE_ID}.exe`);
  if (!fs.existsSync(exe)) return "service not installed";
  return run(exe, ["stop"]).out;
}

/**
 * Upgrade helper, run by the installer after the new files are in place: re-register the service so it points at the
 * NEW executable/launcher paths (the install directory or version may have changed), then start it. The server applies
 * pending database migrations on start-up. No-op when Server mode was never installed.
 */
function refresh() {
  const exe = path.join(config.dataDir(), "service", `${SERVICE_ID}.exe`);
  if (!fs.existsSync(exe)) return "service not installed; nothing to refresh";
  run(exe, ["stop"]);
  run(exe, ["uninstall"]);
  return install();
}

function firewallAdd(port) {
  firewallRemove();
  // Private/domain profiles only: the server is not exposed on public networks.
  return run("netsh", ["advfirewall", "firewall", "add", "rule", `name=${FW_RULE}`, "dir=in", "action=allow", "protocol=TCP", `localport=${port}`, "profile=private,domain"]);
}
function firewallRemove() {
  return run("netsh", ["advfirewall", "firewall", "delete", "rule", `name=${FW_RULE}`]);
}

function status() {
  const r = run("sc", ["query", SERVICE_ID]);
  return { installed: r.ok, running: /RUNNING/.test(r.out) };
}

module.exports = { install, uninstall, stop, refresh, status, firewallAdd, firewallRemove };
