// Shared helpers for the db scripts (cross-platform: no shell features used).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Generating the Postgres client and diffing Postgres migrations go through the pg adapter, which needs a
// reachable server. Developers set DATABASE_URL to a scratch database (see docs/DEVELOPMENT.md).
export const env = {
  DATABASE_URL: "postgresql://petra:petra@127.0.0.1:5432/petrapms",
  ...process.env,
  PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING: "1",
  PRISMA_HIDE_UPDATE_MESSAGE: "1",
  CHECKPOINT_DISABLE: "1",
};

export function prisma(args, opts = {}) {
  const bin = path.join(root, "..", "..", "node_modules", "prisma", "build", "index.js");
  const r = spawnSync(process.execPath, [bin, ...args], { cwd: root, env, encoding: "utf8", ...opts });
  if (r.status !== 0) {
    process.stderr.write(r.stdout ?? "");
    process.stderr.write(r.stderr ?? "");
    throw new Error(`prisma ${args.join(" ")} failed`);
  }
  return r.stdout;
}

/** PostgreSQL schema is derived from the SQLite schema (single source of truth). */
export function toPostgres(schema) {
  return (
    "// GENERATED from schema.prisma by scripts/generate.mjs — do not edit.\n" +
    schema
      .replace(/\r\n/g, "\n")
      .replace(/provider\s*=\s*"sqlite"/, 'provider = "postgresql"')
      .replace(/url\s*=\s*"file:[^"]*"/, 'url      = env("DATABASE_URL")')
      .replace(/output\s*=\s*"\.\.\/generated\/sqlite"/, 'output       = "../generated/postgres"')
  );
}

export function read(p) {
  return fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");
}
export function write(p, s) {
  fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
  fs.writeFileSync(path.join(root, p), s);
}
