// pnpm crash-test — kills the production server with SIGKILL in the middle of a booking storm (3 cycles),
// restarts it each time and verifies: database integrity, no overbooking, server healthy again.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { standaloneWeb, stageStandalone } from "./_util.mjs";

stageStandalone();
const data = fs.mkdtempSync(path.join(os.tmpdir(), "petra-crash-"));
const port = process.env.CRASH_PORT || "3198";
const base = `http://127.0.0.1:${port}`;
let srv;
const start = async () => {
  srv = spawn(process.execPath, [path.join(standaloneWeb, "server.js")], { cwd: standaloneWeb, stdio: "ignore", env: { ...process.env, PETRA_DATA_DIR: data, PORT: port, HOSTNAME: "127.0.0.1", NODE_ENV: "production" } });
  for (let i = 0; i < 80; i++) {
    if (await fetch(base + "/api/status").then((r) => r.ok, () => false)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("server did not start");
};
const kill = () => new Promise((r) => (srv.once("exit", r), srv.kill("SIGKILL")));
const H = { "content-type": "application/json", "x-petra-window": "w1", "x-petra-terminal": "t1" };
const call = (m, p, b, t) => fetch(base + "/api" + p, { method: m, headers: { ...H, ...(t ? { authorization: "Bearer " + t } : {}) }, body: b ? JSON.stringify(b) : undefined }).then((r) => r.json()).catch(() => null);

await start();
const setup = await call("POST", "/setup", {
  locale: "en", hotel: { name: "Crash Hotel", address: "x", city: "Dhaka", phone: "01711000000", email: "a@b.bd", bin: "1", checkInTime: "14:00", checkOutTime: "12:00" },
  floors: [{ floor: "1", firstNumber: 101, count: 6 }, { floor: "2", firstNumber: 201, count: 6 }],
  roomTypes: [{ code: "STD", name: "Std", bedType: "DOUBLE", baseOccupancy: 2, maxAdults: 2, maxChildren: 1, maxOccupancy: 3, baseRate: 400000, extraBedRate: 80000 }, { code: "DLX", name: "Dlx", bedType: "KING", baseOccupancy: 2, maxAdults: 3, maxChildren: 2, maxOccupancy: 4, baseRate: 650000, extraBedRate: 100000 }],
  assignments: [{ roomTypeCode: "DLX", from: "201", to: "206" }], tax: { vatBp: 1500, scBp: 1000, mode: "EXCLUSIVE" },
  admin: { fullName: "Admin User", username: "admin", password: "Admin1234", pin: "7392" }, loadDemo: false,
});
if (!setup?.ok) throw new Error("setup failed " + JSON.stringify(setup));
let token = null;
const login = async () => (token = (await call("POST", "/auth/login", { username: "admin", password: "Admin1234", windowId: "w1", terminalId: "t1" })).data.token);
await login();
const types = (await call("GET", "/room-types", null, token)).data;
const bd = (await call("GET", "/status", null, token)).data?.businessDate ?? new Date().toISOString().slice(0, 10);
const add = (d, n) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);
const guest = { firstName: "Crash", lastName: "Test", phone: "01711223344", idType: "NID", idNumber: "1234567890" };

let sent = 0, ok = 0;
for (let cycle = 1; cycle <= 3; cycle++) {
  const inflight = [];
  for (let i = 0; i < 80; i++) {
    const t = types[i % 2];
    const a = add(bd, 5 + (i % 6));
    inflight.push(call("POST", "/reservations", { guest, arrival: a, departure: add(a, 1 + (i % 3)), rooms: [{ roomTypeId: t.id, adults: 2 }] }, token).then((r) => { sent++; if (r?.ok) ok++; }));
  }
  await new Promise((r) => setTimeout(r, 400 + cycle * 200));
  await kill(); // power cut
  await Promise.allSettled(inflight);
  await start();
  await login();
  console.log(`cycle ${cycle}: server killed mid-storm and restarted OK`);
}
// final verification straight from the database file
await kill();
const db = new DatabaseSync(path.join(data, "petrapms.db"));
const integrity = db.prepare("PRAGMA integrity_check").get().integrity_check;
const fk = db.prepare("PRAGMA foreign_key_check").all().length;
const tcount = Object.fromEntries(db.prepare("SELECT id, (SELECT COUNT(*) FROM Room r WHERE r.roomTypeId = t.id) n FROM RoomType t").all().map((r) => [r.id, r.n]));
const rows = db.prepare("SELECT roomTypeId, arrivalDate a, departureDate d FROM ReservationRoom WHERE status NOT IN ('CANCELLED','NO_SHOW','CHECKED_OUT')").all();
const load = new Map();
for (const r of rows) for (let d = r.a; d < r.d; d = add(d, 1)) load.set(r.roomTypeId + d, (load.get(r.roomTypeId + d) ?? 0) + 1);
let over = 0;
for (const [k, v] of load) {
  const id = Object.keys(tcount).find((i) => k.startsWith(i));
  if (v > tcount[id]) over++;
}
const orphans = db.prepare("SELECT COUNT(*) c FROM ReservationRoom rr LEFT JOIN Reservation r ON r.id = rr.reservationId WHERE r.id IS NULL").get().c;
console.log({ requestsAnswered: sent, bookingsAccepted: ok, bookingsInDb: rows.length, integrity, foreignKeyViolations: fk, overbookedNights: over, orphanRoomRows: orphans });
fs.rmSync(data, { recursive: true, force: true });
if (integrity !== "ok" || fk || over || orphans) { console.error("CRASH TEST FAILED"); process.exit(1); }
console.log("CRASH TEST PASSED");
