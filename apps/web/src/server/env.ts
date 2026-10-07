// Runtime configuration. Everything is driven by environment variables so that the same build runs as
// standalone desktop, LAN server (Windows Service) or cloud container.
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import type { Provider } from "@petra/db";
import { LICENSE_PUBLIC_KEY } from "./license-public-key";
import { validateDataDir } from "./fsSafe";

function defaultDataDir(): string {
  if (process.platform === "win32") return path.join(process.env.ProgramData || "C:\\ProgramData", "PetraPMS");
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "PetraPMS");
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "PetraPMS");
}

/** True for the shipped build. Developer/test overrides (fingerprint, licence public key) are ignored in production. */
/** Version of this web app when the desktop shell did not pass one (development, tests): read from package.json, never a stale literal. */
function packageVersion(): string {
  for (const f of [path.join(process.cwd(), "package.json"), path.join(process.cwd(), "apps", "web", "package.json")]) {
    try {
      const j = JSON.parse(fs.readFileSync(f, "utf8")) as { name?: string; version?: string };
      if (j.name === "@petra/web" && j.version) return j.version;
    } catch {
      /* try the next location */
    }
  }
  return "0.0.0-dev";
}

export const isProduction = () => process.env.NODE_ENV === "production";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/** Reads a secret from VAR or from the file named by VAR_FILE (Docker/Kubernetes secrets, keeps it out of `docker inspect`). */
function secret(name: string): string | undefined {
  const file = process.env[`${name}_FILE`];
  if (file) {
    try {
      return fs.readFileSync(file, "utf8").trim();
    } catch {
      throw new ConfigError(`${name}_FILE points to a file that cannot be read: ${file}`);
    }
  }
  return process.env[name];
}

export interface AppEnv {
  dataDir: string;
  dbFile: string;
  uploadsDir: string;
  backupsDir: string;
  logsDir: string;
  exportsDir: string;
  tempDir: string;
  updatesDir: string;
  provider: Provider;
  databaseUrl: string | undefined;
  mode: "standalone" | "server" | "cloud";
  port: number;
  appVersion: string;
  /** Public key (PEM) used to verify license keys; may be overridden for testing via PETRA_LICENSE_PUBKEY */
  licensePublicKey: string;
}

let cached: AppEnv | null = null;

export function env(): AppEnv {
  if (cached) return cached;
  const provider: Provider = process.env.DATABASE_PROVIDER === "postgres" ? "postgres" : "sqlite";
  if (process.env.DATABASE_PROVIDER && !["sqlite", "postgres"].includes(process.env.DATABASE_PROVIDER)) throw new ConfigError(`DATABASE_PROVIDER must be "sqlite" or "postgres" (got "${process.env.DATABASE_PROVIDER}")`);
  const databaseUrl = secret("DATABASE_URL");
  if (provider === "postgres" && !databaseUrl) throw new ConfigError("DATABASE_PROVIDER=postgres needs DATABASE_URL (or DATABASE_URL_FILE).");
  if (provider === "postgres" && !/^postgres(ql)?:\/\//.test(databaseUrl ?? "")) throw new ConfigError("DATABASE_URL must start with postgresql://");
  const mode = (process.env.PETRA_MODE || "standalone") as AppEnv["mode"];
  if (!["standalone", "server", "cloud"].includes(mode)) throw new ConfigError(`PETRA_MODE must be standalone, server or cloud (got "${mode}")`);
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ConfigError(`PORT must be 1-65535 (got "${process.env.PORT}")`);
  const dataDir = path.resolve(/*turbopackIgnore: true*/ process.env.PETRA_DATA_DIR || defaultDataDir());
  const e: AppEnv = {
    dataDir,
    dbFile: path.join(dataDir, "petrapms.db"),
    uploadsDir: path.join(dataDir, "uploads"),
    backupsDir: process.env.PETRA_BACKUP_DIR ? path.resolve(process.env.PETRA_BACKUP_DIR) : path.join(dataDir, "backups"),
    logsDir: path.join(dataDir, "logs"),
    exportsDir: path.join(dataDir, "exports"),
    tempDir: path.join(dataDir, "temp"),
    updatesDir: path.join(dataDir, "updates"),
    provider,
    databaseUrl,
    mode,
    port,
    appVersion: process.env.PETRA_APP_VERSION || packageVersion(),
    // Overriding the verification key would let anyone mint their own licences, so it is a development/test feature only.
    licensePublicKey: ((!isProduction() && process.env.PETRA_LICENSE_PUBKEY) || LICENSE_PUBLIC_KEY).replace(/\\n/g, "\n"),
  };
  try {
    validateDataDir(dataDir);
  } catch (err) {
    throw new ConfigError((err as Error).message);
  }
  for (const d of [e.dataDir, e.uploadsDir, e.backupsDir, e.logsDir, e.exportsDir, e.tempDir, e.updatesDir]) fs.mkdirSync(d, { recursive: true });
  cached = e;
  return e;
}

/** Test helper: forget cached configuration (tests point PETRA_DATA_DIR at temp folders). */
export function resetEnvCache() {
  cached = null;
}
