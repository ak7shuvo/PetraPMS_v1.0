// Shared helpers for repo scripts. Pure Node, so they run unchanged in PowerShell, cmd and bash.
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const webDir = path.join(root, "apps", "web");
export const standaloneWeb = path.join(webDir, ".next", "standalone", "apps", "web");

export function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "inherit", shell: process.platform === "win32", cwd: root, ...opts, env: { ...process.env, ...(opts.env ?? {}) } });
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(" ")} exited with ${code}`))));
    p.on("error", reject);
  });
}

export const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

/** Copies static assets next to the standalone server (Next does not do this itself). */
export function stageStandalone() {
  if (!fs.existsSync(path.join(standaloneWeb, "server.js"))) throw new Error("Run the build first (pnpm build).");
  fs.cpSync(path.join(webDir, ".next", "static"), path.join(standaloneWeb, ".next", "static"), { recursive: true });
  if (fs.existsSync(path.join(webDir, "public"))) fs.cpSync(path.join(webDir, "public"), path.join(standaloneWeb, "public"), { recursive: true });
}
