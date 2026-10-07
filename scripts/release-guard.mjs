// Release guard: `pnpm release:check`, and the first step of `pnpm build:win`.
// Refuses to continue unless the source tree is production-ready. Development builds (`pnpm build`) never call it.
// It reads, it never writes, and it never needs (or looks for) the vendor's private key.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { scanForSecrets } from "./stage-scan.mjs";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(here, "..");

/** Environment variables that change security-critical behaviour and therefore must not be set for a release build. */
export const FORBIDDEN_ENV = ["PETRA_LICENSE_PUBKEY", "PETRA_FINGERPRINT", "PETRA_ALLOW_REPO_KEYS", "PETRA_TEST_PG", "PETRA_TRUST_PROXY"];

const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const spkiFingerprint = (pem) => crypto.createHash("sha256").update(crypto.createPublicKey(pem).export({ type: "spki", format: "der" })).digest("hex");

/** Effective release settings: environment overrides release/release.config.json. */
export function releaseSettings(root = defaultRoot, env = process.env) {
  const f = path.join(root, "release", "release.config.json");
  const file = fs.existsSync(f) ? readJson(f) : {};
  return { updateUrl: env.PETRA_UPDATE_URL || file.updateUrl || "", homepage: env.PETRA_HOMEPAGE || file.homepage || "", iconApproved: file.iconApproved === true };
}

/** @returns {string[]} one human-readable line per problem; empty = ready. */
export function checkRelease({ root = defaultRoot, env = process.env } = {}) {
  const { urlProblem } = require(path.join(root, "apps", "desktop", "src", "release-config.cjs"));
  const problems = [];

  // 1. License public key: must be a production Ed25519 key, never a known development key.
  const keyFile = path.join(root, "apps", "web", "src", "server", "license-public-key.ts");
  try {
    const src = fs.readFileSync(keyFile, "utf8");
    const channel = /LICENSE_KEY_CHANNEL[^=]*=\s*"([a-z]+)"/.exec(src)?.[1];
    const pem = /LICENSE_PUBLIC_KEY\s*=\s*"((?:[^"\\]|\\.)*)"/.exec(src)?.[1]?.replace(/\\n/g, "\n");
    if (!pem) problems.push("LICENSE KEY: no public key found in apps/web/src/server/license-public-key.ts");
    else {
      let fp = "";
      try {
        const k = crypto.createPublicKey(pem);
        if (k.asymmetricKeyType !== "ed25519") problems.push(`LICENSE KEY: public key must be Ed25519 (found ${k.asymmetricKeyType})`);
        fp = spkiFingerprint(pem);
      } catch {
        problems.push("LICENSE KEY: the embedded public key cannot be parsed");
      }
      const devFile = path.join(root, "release", "dev-license-keys.json");
      const dev = fs.existsSync(devFile) ? readJson(devFile).development ?? [] : [];
      if (fp && dev.includes(fp)) problems.push(`LICENSE KEY: PRODUCTION LICENSE PUBLIC KEY NOT CONFIGURED — the embedded key (${fp.slice(0, 16)}…) is a DEVELOPMENT key. On the vendor machine run: pnpm license init --write-app --production  (or pnpm license write-app-key --production), then commit only license-public-key.ts`);
      if (channel !== "production") problems.push(`LICENSE KEY: channel is "${channel ?? "missing"}"; a release needs LICENSE_KEY_CHANNEL = "production" (written by the License Manager with --production)`);
      if (/PRIVATE KEY/.test(src)) problems.push("LICENSE KEY: license-public-key.ts contains private key material");
    }
  } catch (e) {
    problems.push(`LICENSE KEY: cannot read ${keyFile} (${e.message})`);
  }

  // 2. Vendor-supplied URLs and branding approval.
  const s = releaseSettings(root, env);
  const u = urlProblem(s.updateUrl, { release: true });
  if (u) problems.push(`UPDATE FEED: updateUrl ${u}. Set release/release.config.json "updateUrl" (or PETRA_UPDATE_URL) to the real https:// feed`);
  const h = urlProblem(s.homepage, { release: true });
  if (h) problems.push(`HOMEPAGE: homepage ${h}. Set release/release.config.json "homepage" (or PETRA_HOMEPAGE) to the real website`);
  if (!s.iconApproved) problems.push("BRANDING: icon not approved. apps/desktop/build/icon.png is a development placeholder; replace it with the approved logo and set iconApproved to true in release/release.config.json");

  // 3. No placeholder metadata in shipped config.
  const yml = fs.readFileSync(path.join(root, "apps", "desktop", "electron-builder.yml"), "utf8");
  if (/\.invalid|example\.(com|org|net)/i.test(yml)) problems.push("INSTALLER: electron-builder.yml still contains a placeholder (.invalid / example.*) URL");
  const pkgs = ["package.json", "apps/web/package.json", "apps/desktop/package.json"].map((f) => readJson(path.join(root, f)));
  if (/\.invalid|example\.(com|org|net)/i.test(JSON.stringify(pkgs[2]))) problems.push("INSTALLER: apps/desktop/package.json contains a placeholder URL");
  const versions = pkgs.map((p) => p.version);
  if (new Set(versions).size !== 1) problems.push(`VERSION: root / web / desktop versions differ (${versions.join(" / ")}); keep them identical (desktop is the installer version)`);
  if (!/^\d+\.\d+\.\d+$/.test(versions[2] ?? "")) problems.push(`VERSION: desktop version "${versions[2]}" is not a plain semver release`);
  if (pkgs[2].author?.name !== "PETRA" && pkgs[2].author !== "PETRA") problems.push('INSTALLER: publisher (apps/desktop/package.json author.name) must be "PETRA"');

  // 4. No development overrides in the build environment.
  for (const v of FORBIDDEN_ENV) if (env[v]) problems.push(`ENVIRONMENT: ${v} is set; unset it for a release build`);
  if (["development", "test"].includes(env.NODE_ENV ?? "")) problems.push(`ENVIRONMENT: NODE_ENV=${env.NODE_ENV}; a release build must run with production settings`);

  // 5. No secrets or development data anywhere in the source tree being packaged.
  for (const b of scanForSecrets(root, { skipDirs: ["node_modules", ".next", "stage", "dist", ".git", "test-results", "playwright-report"] })) problems.push(`SECRETS: ${path.relative(root, b.split("  (")[0])}  ${b.includes("  (") ? "(" + b.split("  (")[1] : ""}`.trim());
  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = checkRelease();
  if (problems.length) {
    console.error(`RELEASE GUARD: NOT READY (${problems.length} problem${problems.length === 1 ? "" : "s"})\n- ${problems.join("\n- ")}\n\nSee docs/RELEASE.md for the exact steps.`);
    process.exit(1);
  }
  console.log("RELEASE GUARD: OK — license key, update feed, homepage, branding, versions, environment and source tree are production-ready.");
}
