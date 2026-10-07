// Real-process check: data survives an orderly stop, a hard kill (crash) and a restart; the DB is intact afterwards.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { standaloneWeb } from "./_util.mjs";

const data = fs.mkdtempSync(path.join(os.tmpdir(), "petra-restart-"));
const port = 3197;
const base = `http://127.0.0.1:${port}/api`;
const start = async () => {
  const p = spawn(process.execPath, [path.join(standaloneWeb, "server.js")], { cwd: standaloneWeb, stdio: "ignore", env: { ...process.env, PETRA_DATA_DIR: data, PORT: String(port), HOSTNAME: "127.0.0.1", NODE_ENV: "production" } });
  for (let i = 0; i < 80; i++) {
    if (await fetch(`${base}/status`).then((r) => r.ok).catch(() => false)) return p;
    await new Promise((r) => setTimeout(r, 400));
  }
  p.kill();
  throw new Error("server did not start");
};
const call = async (m, p, body, token) => (await fetch(base + p, { method: m, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })).json();
const results = [];
const check = (name, ok) => (results.push([name, ok]), console.log(ok ? "PASS" : "FAIL", name));
const killed = (p, sig) => new Promise((r) => (p.once("exit", r), p.kill(sig)));

let srv = await start();
const setup = await call("POST", "/setup", {
  locale: "en",
  hotel: { name: "Restart Hotel", address: "Gulshan 2", city: "Dhaka", phone: "+8801711000000", email: "fo@test.bd", bin: "000123456789", checkInTime: "14:00", checkOutTime: "12:00" },
  floors: [{ floor: "1", firstNumber: 101, count: 4 }, { floor: "2", firstNumber: 201, count: 4 }],
  roomTypes: [{ code: "STD", name: "Standard", bedType: "DOUBLE", baseOccupancy: 2, maxAdults: 2, maxChildren: 1, maxOccupancy: 3, baseRate: 400000, extraBedRate: 80000 }, { code: "DLX", name: "Deluxe", bedType: "KING", baseOccupancy: 2, maxAdults: 3, maxChildren: 2, maxOccupancy: 4, baseRate: 650000, extraBedRate: 100000 }],
  assignments: [{ roomTypeCode: "DLX", from: "201", to: "204" }],
  tax: { vatBp: 1500, scBp: 1000, mode: "EXCLUSIVE" },
  admin: { fullName: "Admin User", username: "admin", password: "Admin1234", pin: "7392" },
  loadDemo: true,
});
check("setup on a fresh data folder", setup.ok === true); if (!setup.ok) console.log(JSON.stringify(setup).slice(0, 400));
let login = await call("POST", "/auth/login", { username: "admin", password: "Admin1234", windowId: "w", terminalId: "t" });
check("login", login.ok);
const guestsBefore = (await call("GET", "/guests?limit=500", null, login.data.token)).data;
const countBefore = JSON.stringify(guestsBefore).length;

await killed(srv, "SIGKILL"); // crash: no shutdown hooks run
srv = await start();
login = await call("POST", "/auth/login", { username: "admin", password: "Admin1234", windowId: "w", terminalId: "t" });
check("restart after hard kill: login still works", login.ok);
const after = (await call("GET", "/guests?limit=500", null, login.data.token)).data;
check("restart after hard kill: data unchanged", JSON.stringify(after).length === countBefore);
const st = await call("GET", "/status");
check("restart after hard kill: setup still complete", st.data?.setupComplete === true);

await killed(srv, "SIGTERM"); // orderly stop
srv = await start();
login = await call("POST", "/auth/login", { username: "admin", password: "Admin1234", windowId: "w", terminalId: "t" });
check("restart after SIGTERM: login works", login.ok);
const bk = await call("POST", "/backups", {}, login.data.token);
check("backup works after restarts", bk.ok === true);
await killed(srv, "SIGTERM");
fs.rmSync(data, { recursive: true, force: true });
process.exit(results.every(([, ok]) => ok) ? 0 : 1);
