// pnpm e2e — starts the production build on a throw-away data folder and runs the Playwright suite.
import { run, pnpm, standaloneWeb, stageStandalone, root } from "./_util.mjs";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ghaEscape = (s) => String(s).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
function fail(title, detail) {
  console.error(`\n${title}\n${detail}`);
  console.log(`::error title=${ghaEscape(title)}::${ghaEscape(detail).slice(0, 8000)}`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n## e2e: ${title}\n\n\`\`\`\n${detail.slice(-4000)}\n\`\`\`\n`);
}

stageStandalone();
const data = fs.mkdtempSync(path.join(os.tmpdir(), "petra-e2e-"));
const port = process.env.E2E_PORT || "3199";
const server = spawn(process.execPath, [path.join(standaloneWeb, "server.js")], { cwd: standaloneWeb, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PETRA_DATA_DIR: data, PORT: port, HOSTNAME: "127.0.0.1", NODE_ENV: "production" } });
// Captured (not just inherited) so a startup failure can be reported as a GitHub Actions annotation: this session's
// network policy blocks the raw job-log download, so console output alone is not always retrievable afterwards.
let serverOutput = "";
const appendOutput = (c) => {
  const s = c.toString("utf8");
  process.stdout.write(s);
  serverOutput = (serverOutput + s).slice(-8000);
};
server.stdout.on("data", appendOutput);
server.stderr.on("data", appendOutput);
let serverExit = null;
server.once("exit", (code, signal) => (serverExit = { code, signal }));
const stop = () => {
  try {
    server.kill();
  } catch {
    /* already gone */
  }
};
process.on("exit", stop);

let ready = false;
let lastProbeError = "";
// Bounded by wall-clock time (45s), not a fixed attempt count, so a slow CI runner gets the same real budget as a
// fast one. The loop also exits the moment the server process itself dies — no point polling out a full timeout
// against a process that is already gone, and that early exit is itself the most useful diagnostic.
const deadline = Date.now() + 45_000;
while (!ready && !serverExit && Date.now() < deadline) {
  ready = await fetch(`http://127.0.0.1:${port}/api/status`)
    .then((r) => r.ok)
    .catch((e) => {
      lastProbeError = String(e && e.message ? e.message : e);
      return false;
    });
  if (!ready) await new Promise((r) => setTimeout(r, 500));
}
if (!ready) {
  stop();
  const why = serverExit ? `the server process exited (code ${serverExit.code}, signal ${serverExit.signal}) before it ever answered /api/status` : `the server never answered /api/status within 45s (last probe error: ${lastProbeError || "none — it may have been refusing connections"})`;
  fail("e2e: server did not become ready", `${why}\n\n--- last server output ---\n${serverOutput || "(none captured)"}`);
  fs.rmSync(data, { recursive: true, force: true });
  process.exit(1);
}

let code = 0;
try {
  await run(pnpm, ["exec", "playwright", "test"], { env: { E2E_URL: `http://127.0.0.1:${port}` }, cwd: root });
} catch {
  code = 1;
  fail("e2e: Playwright suite failed", `See the "list" reporter output above and the e2e-traces artifact (test-results/) for per-test traces.\n\n--- server output during the run ---\n${serverOutput || "(none captured)"}`);
}
stop();
fs.rmSync(data, { recursive: true, force: true });
process.exit(code);
