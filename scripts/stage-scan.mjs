// Shared by build.mjs and release-guard.mjs: scan a directory tree for development data and secrets, and prune files
// that must not ship. Pure Node.
import fs from "node:fs";
import path from "node:path";

const PEM_PRIVATE = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const SECRET_NAMES = new Set(["private.pem", "ledger.json", "licenses.json", "issued.jsonl", ".machine-id", ".license-hwm", "backup.key"]);
const SECRET_DIRS = new Set([".data", "keys", "test-results", ".petra-license-manager"]);
const DATA_EXT = /\.(db|db-wal|db-shm|sqlite|sqlite3|petrabak)$/i;

/** Returns a list of offending paths (with a reason). `skip` lets a caller ignore folders (default: node_modules internals for content checks only). */
export function scanForSecrets(dir, { skipDirs = [] } = {}) {
  const bad = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (skipDirs.includes(e.name)) continue;
        if (SECRET_DIRS.has(e.name)) bad.push(`${p}  (development/secret folder)`);
        else walk(p);
      } else if (/^\.env(\..*)?$/.test(e.name) && e.name !== ".env.example") bad.push(`${p}  (environment file)`);
      else if (DATA_EXT.test(e.name)) bad.push(`${p}  (database or backup file)`);
      else if (SECRET_NAMES.has(e.name)) bad.push(`${p}  (secret/identity file)`);
      else if (!p.includes(`${path.sep}node_modules${path.sep}`) && /\.(pem|key|txt|json|js|mjs|cjs|ts|tsx|env)$/i.test(e.name) && fs.statSync(p).size < 2_000_000 && PEM_PRIVATE.test(fs.readFileSync(p, "utf8"))) bad.push(`${p}  (contains private key material)`);
    }
  })(dir);
  return bad;
}

/** Removes build leftovers that are not needed at run time (sources, configs, source maps, tests). Safe to re-run. */
export function pruneStage(stage) {
  const web = path.join(stage, "apps", "web");
  const removed = [];
  const rm = (p) => {
    if (fs.existsSync(p)) (fs.rmSync(p, { recursive: true, force: true }), removed.push(path.relative(stage, p)));
  };
  for (const n of ["test", "e2e", "src", "next.config.ts", "tsconfig.json", "tsconfig.tsbuildinfo", "postcss.config.mjs", "vitest.config.ts"]) rm(path.join(web, n));
  (function maps(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) maps(p);
      else if (e.name.endsWith(".map")) rm(p);
    }
  })(stage);
  return removed;
}
