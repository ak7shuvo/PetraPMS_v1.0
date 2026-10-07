// pnpm e2e — starts the production build on a throw-away data folder and runs the Playwright suite.
import { run, pnpm, standaloneWeb, stageStandalone, root } from "./_util.mjs";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
stageStandalone();
const data = fs.mkdtempSync(path.join(os.tmpdir(), "petra-e2e-"));
const port = process.env.E2E_PORT || "3199";
const server = spawn(process.execPath, [path.join(standaloneWeb, "server.js")], { cwd: standaloneWeb, stdio: "inherit", env: { ...process.env, PETRA_DATA_DIR: data, PORT: port, HOSTNAME: "127.0.0.1", NODE_ENV: "production" } });
const stop = () => { try { server.kill(); } catch {} };
process.on("exit", stop);
let ready = false;
for (let i = 0; i < 60 && !ready; i++) {
  ready = await fetch(`http://127.0.0.1:${port}/api/status`).then((r) => r.ok).catch(() => false);
  if (!ready) await new Promise((r) => setTimeout(r, 500));
}
if (!ready) { stop(); throw new Error("Server did not start"); }
let code = 0;
try {
  await run(pnpm, ["exec", "playwright", "test"], { env: { E2E_URL: `http://127.0.0.1:${port}` }, cwd: root });
} catch { code = 1; }
stop();
fs.rmSync(data, { recursive: true, force: true });
process.exit(code);
