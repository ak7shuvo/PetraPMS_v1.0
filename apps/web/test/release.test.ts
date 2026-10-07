import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
// @ts-expect-error plain .mjs modules without types
import { checkRelease } from "../../../scripts/release-guard.mjs";
// @ts-expect-error plain .mjs module
import { scanForSecrets, pruneStage } from "../../../scripts/stage-scan.mjs";
// @ts-expect-error plain .mjs module
import { writeAppKey } from "../../../tools/license-keygen/keygen.mjs";

const repo = path.resolve(__dirname, "../../..");
const req = createRequire(import.meta.url);
const { urlProblem } = req(path.join(repo, "apps/desktop/src/release-config.cjs"));
const config = req(path.join(repo, "apps/desktop/src/config.cjs"));

const FILES = ["package.json", "apps/web/package.json", "apps/desktop/package.json", "apps/desktop/electron-builder.yml", "apps/desktop/src/release-config.cjs", "release/dev-license-keys.json", "release/release.config.json"];
const GOOD_URL = "https://downloads.acme-hotels.net/petrapms";
const freshPublicPem = () => crypto.generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString();

/** A minimal copy of the release-relevant files, set up as a READY production tree; tests then break one thing at a time. */
function tree(mutate: (root: string) => void = () => undefined) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "petra-rel-"));
  for (const f of FILES) {
    fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    fs.copyFileSync(path.join(repo, f), path.join(root, f));
  }
  fs.mkdirSync(path.join(root, "apps/web/src/server"), { recursive: true });
  writeAppKey(freshPublicPem(), path.join(root, "apps/web/src/server/license-public-key.ts"), "production");
  fs.writeFileSync(path.join(root, "release/release.config.json"), JSON.stringify({ updateUrl: GOOD_URL, homepage: "https://petra-hotels.net", iconApproved: true }));
  const pj = path.join(root, "apps/desktop/package.json");
  const d = JSON.parse(fs.readFileSync(pj, "utf8"));
  fs.writeFileSync(pj, JSON.stringify(d));
  mutate(root);
  return root;
}
const edit = (root: string, f: string, fn: (s: string) => string) => fs.writeFileSync(path.join(root, f), fn(fs.readFileSync(path.join(root, f), "utf8")));
const cfg = (root: string, over: Record<string, unknown>) => fs.writeFileSync(path.join(root, "release/release.config.json"), JSON.stringify({ updateUrl: GOOD_URL, homepage: "https://petra-hotels.net", iconApproved: true, ...over }));
const problems = (root: string, env: Record<string, string> = {}) => checkRelease({ root, env }) as string[];

describe("release guard", () => {
  it("passes a fully configured production tree", () => {
    expect(problems(tree())).toEqual([]);
  });

  it("refuses the development license key even when it is labelled production", () => {
    const devPem = fs.readFileSync(path.join(repo, "apps/web/src/server/license-public-key.ts"), "utf8").match(/"(-----BEGIN[^"]+)"/)![1].replace(/\\n/g, "\n");
    const root = tree((r) => writeAppKey(devPem, path.join(r, "apps/web/src/server/license-public-key.ts"), "production"));
    expect(problems(root).join("\n")).toMatch(/PRODUCTION LICENSE PUBLIC KEY NOT CONFIGURED/);
  });

  it("refuses a key whose channel is not production", () => {
    const root = tree((r) => writeAppKey(freshPublicPem(), path.join(r, "apps/web/src/server/license-public-key.ts"), "development"));
    expect(problems(root).join("\n")).toMatch(/channel is "development"/);
  });

  it("refuses a malformed or non-Ed25519 key", () => {
    const rsa = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ type: "spki", format: "pem" }).toString();
    expect(problems(tree((r) => writeAppKey(rsa, path.join(r, "apps/web/src/server/license-public-key.ts"), "production"))).join("\n")).toMatch(/Ed25519/);
    expect(problems(tree((r) => writeAppKey("not a key", path.join(r, "apps/web/src/server/license-public-key.ts"), "production"))).join("\n")).toMatch(/cannot be parsed/);
  });

  it("the committed development key is reported until the vendor key is deployed", () => {
    const real = checkRelease({ root: repo, env: {} }) as string[];
    const src = fs.readFileSync(path.join(repo, "apps/web/src/server/license-public-key.ts"), "utf8");
    if (/LICENSE_KEY_CHANNEL[^=]*=\s*"development"/.test(src)) expect(real.join("\n")).toMatch(/KEY|key/);
    else expect(real.join("\n")).not.toMatch(/channel is/);
  });

  it("rejects empty, placeholder, http and reserved update feeds; accepts a real https feed", () => {
    for (const bad of ["", "__SET_PRODUCTION_UPDATE_FEED_HTTPS_URL__", "https://updates.example.invalid/petrapms", "http://downloads.acme-hotels.net/petrapms", "https://example.com/x", "https://localhost/x", "ftp://a.b.net/x"]) {
      expect(problems(tree((r) => cfg(r, { updateUrl: bad }))).join("\n"), `updateUrl ${JSON.stringify(bad)}`).toMatch(/UPDATE FEED/);
    }
    expect(problems(tree((r) => cfg(r, { updateUrl: GOOD_URL })))).toEqual([]);
  });

  it("environment variables override the file (CI) and are validated the same way", () => {
    expect(problems(tree(), { PETRA_UPDATE_URL: "https://x.invalid/feed" }).join("\n")).toMatch(/UPDATE FEED/);
    expect(problems(tree((r) => cfg(r, { updateUrl: "" })), { PETRA_UPDATE_URL: GOOD_URL })).toEqual([]);
  });

  it("requires a real homepage and an approved icon", () => {
    expect(problems(tree((r) => cfg(r, { homepage: "https://petra.example.invalid" }))).join("\n")).toMatch(/HOMEPAGE/);
    expect(problems(tree((r) => cfg(r, { iconApproved: false }))).join("\n")).toMatch(/icon not approved/);
  });

  it("refuses placeholder URLs left in installer metadata", () => {
    expect(problems(tree((r) => edit(r, "apps/desktop/electron-builder.yml", (s) => s + "\n# https://updates.example.invalid/x\n"))).join("\n")).toMatch(/INSTALLER/);
    expect(problems(tree((r) => edit(r, "apps/desktop/package.json", (s) => s.replace(/\}$/, ',"homepage":"https://petra.example.invalid"}')))).join("\n")).toMatch(/INSTALLER/);
  });

  it("refuses mismatched versions and a wrong publisher", () => {
    expect(problems(tree((r) => edit(r, "apps/web/package.json", (s) => s.replace(/"version":\s*"[^"]+"/, '"version":"0.0.1"')))).join("\n")).toMatch(/VERSION/);
    expect(problems(tree((r) => edit(r, "apps/desktop/package.json", (s) => s.replace(/"author":\s*\{[^}]*\}/, '"author":{"name":"Somebody"}')))).join("\n")).toMatch(/publisher/);
  });

  it("refuses development overrides in the build environment", () => {
    for (const v of ["PETRA_LICENSE_PUBKEY", "PETRA_FINGERPRINT", "PETRA_ALLOW_REPO_KEYS", "PETRA_TEST_PG"]) expect(problems(tree(), { [v]: "x" }).join("\n"), v).toMatch(new RegExp(v));
    expect(problems(tree(), { NODE_ENV: "development" }).join("\n")).toMatch(/NODE_ENV/);
    expect(problems(tree(), { NODE_ENV: "production" })).toEqual([]);
  });

  it("refuses private key material, licence ledgers, databases and env files in the source tree", () => {
    const header = ["-----BEGIN", "PRIVATE KEY-----"].join(" ");
    const planted: Record<string, string> = { "tools/leak.txt": `${header}\nMC4=\n`, "private.pem": "x", "licenses.json": "{}", ".env": "A=1", "data/hotel.db": "x", "backup.petrabak": "x", "issued.jsonl": "x" };
    for (const [f, body] of Object.entries(planted)) {
      const root = tree((r) => {
        fs.mkdirSync(path.dirname(path.join(r, f)), { recursive: true });
        fs.writeFileSync(path.join(r, f), body);
      });
      expect(problems(root).join("\n"), f).toMatch(/SECRETS/);
    }
    // an example env file is fine
    expect(problems(tree((r) => fs.writeFileSync(path.join(r, ".env.example"), "PORT=3000")))).toEqual([]);
  });
});

describe("development builds stay permissive", () => {
  it("only release builds call the guard", () => {
    const build = fs.readFileSync(path.join(repo, "scripts/build.mjs"), "utf8");
    expect(build).toMatch(/process\.argv\.includes\("--release"\)\s*\|\|\s*process\.env\.PETRA_RELEASE === "1"/);
    const pkg = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts.build).toBe("node scripts/build.mjs");
    expect(pkg.scripts["build:win"]).toMatch(/--release/);
    expect(fs.readFileSync(path.join(repo, "apps/desktop/package.json"), "utf8")).toMatch(/"dist:win": "node \.\.\/\.\.\/scripts\/dist-win\.mjs"/);
  });
  it("the installer config holds no hard-coded feed", () => {
    expect(fs.readFileSync(path.join(repo, "apps/desktop/electron-builder.yml"), "utf8")).toMatch(/url: \$\{env\.PETRA_UPDATE_URL\}/);
  });
  it("the License Manager marks the app key channel", () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "petra-wk-")), "k.ts");
    writeAppKey(freshPublicPem(), f);
    expect(fs.readFileSync(f, "utf8")).toMatch(/LICENSE_KEY_CHANNEL[^=]*= "development"/);
    writeAppKey(freshPublicPem(), f, "production");
    expect(fs.readFileSync(f, "utf8")).toMatch(/LICENSE_KEY_CHANNEL[^=]*= "production"/);
    expect(() => writeAppKey(freshPublicPem(), f, "staging")).toThrow();
    expect(fs.readFileSync(f, "utf8")).not.toMatch(/PRIVATE/);
  });
});

describe("update feed validation (shared by build and run time)", () => {
  it("empty URL", () => expect(urlProblem("")).toMatch(/empty/));
  it(".invalid URL", () => expect(urlProblem("https://updates.example.invalid/petrapms")).toMatch(/placeholder/));
  it("HTTP URL", () => {
    expect(urlProblem("http://downloads.acme-hotels.net/x")).toMatch(/https/);
    expect(urlProblem("http://127.0.0.1:8080/x", { release: true })).toMatch(/https/); // release: no local feeds
    expect(urlProblem("http://127.0.0.1:8080/x", { release: false })).toBeNull(); // development: local test feed
  });
  it("valid HTTPS URL", () => expect(urlProblem(GOOD_URL)).toBeNull());
  it("credentials, bare hosts and IP addresses", () => {
    expect(urlProblem("https://user:pw@downloads.acme-hotels.net/x")).toMatch(/credentials/);
    expect(urlProblem("https://intranet/x")).toMatch(/public domain/);
    expect(urlProblem("https://10.0.0.5/x")).toMatch(/public domain/);
  });
  it("the desktop shell ignores a bad configured feed and falls back to the baked-in release feed", () => {
    const data = fs.mkdtempSync(path.join(os.tmpdir(), "petra-cfgu-"));
    process.env.PETRA_DATA_DIR = data;
    const write = (u: unknown) => fs.writeFileSync(config.file(), JSON.stringify({ updateUrl: u }));
    write("https://updates.example.invalid/petrapms");
    expect(config.load().updateUrl).toBe(config.bundledUpdateUrl(data)); // data dir has no release.json → ""
    expect(config.load().updateUrl).toBe("");
    write("http://evil.acme-hotels.net/feed");
    expect(config.load().updateUrl).toBe("");
    write(GOOD_URL);
    expect(config.load().updateUrl).toBe(GOOD_URL);
    fs.writeFileSync(path.join(data, "release.json"), JSON.stringify({ updateUrl: "https://feed.acme-hotels.net/p" }));
    expect(config.bundledUpdateUrl(data)).toBe("https://feed.acme-hotels.net/p");
    fs.writeFileSync(path.join(data, "release.json"), JSON.stringify({ updateUrl: "https://x.invalid/p" }));
    expect(config.bundledUpdateUrl(data)).toBe("");
  });
});

describe("Windows Service launcher", () => {
  function run(version: string, extraEnv: Record<string, string> = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "petra-launch-"));
    fs.mkdirSync(path.join(dir, "desktop/src"), { recursive: true });
    for (const f of ["server-launcher.cjs", "config.cjs", "release-config.cjs"]) fs.copyFileSync(path.join(repo, "apps/desktop/src", f), path.join(dir, "desktop/src", f));
    fs.writeFileSync(path.join(dir, "desktop/package.json"), JSON.stringify({ name: "x", version }));
    const web = path.join(dir, "web/apps/web");
    fs.mkdirSync(web, { recursive: true });
    fs.writeFileSync(path.join(web, "server.js"), 'console.log(JSON.stringify({ v: process.env.PETRA_APP_VERSION, env: process.env.NODE_ENV, mode: process.env.PETRA_MODE }))');
    const env = { ...process.env, PETRA_WEB_DIR: path.join(dir, "web"), PETRA_DATA_DIR: path.join(dir, "data"), ...extraEnv };
    delete (env as Record<string, string | undefined>).PETRA_APP_VERSION;
    Object.assign(env, extraEnv);
    const r = spawnSync(process.execPath, [path.join(dir, "desktop/src/server-launcher.cjs")], { env, encoding: "utf8" });
    return JSON.parse(r.stdout.trim().split("\n").pop()!) as { v: string; env: string; mode: string };
  }
  it("passes the installer's own version to the server when started by the service (no env from the shell)", () => {
    expect(run("2.5.7").v).toBe("2.5.7");
    expect(run("1.0.1").v).toBe("1.0.1"); // an upgraded install must not report a stale 1.0.0
  });
  it("keeps a version passed by the desktop shell and always forces production mode", () => {
    const r = run("2.5.7", { PETRA_APP_VERSION: "3.0.0" });
    expect([r.v, r.env]).toEqual(["3.0.0", "production"]);
  });
});

describe("build stage", () => {
  it("scanForSecrets finds nothing in a clean tree and flags every secret class", () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "petra-stage-"));
    fs.writeFileSync(path.join(d, "ok.js"), "module.exports = 1");
    expect(scanForSecrets(d)).toEqual([]);
    for (const n of [".machine-id", "backup.key", ".license-hwm", "x.petrabak", "a.sqlite3"]) fs.writeFileSync(path.join(d, n), "x");
    expect(scanForSecrets(d).length).toBe(5);
  });
  it("pruneStage removes sources, configs, tests and source maps but keeps run-time files", () => {
    const s = fs.mkdtempSync(path.join(os.tmpdir(), "petra-prune-"));
    const web = path.join(s, "apps/web");
    for (const f of ["src/a.ts", "test/t.ts", "next.config.ts", "tsconfig.json", ".next/server/a.js", ".next/server/a.js.map", "server.js", "package.json", "assets/fonts/f.woff"]) {
      fs.mkdirSync(path.dirname(path.join(web, f)), { recursive: true });
      fs.writeFileSync(path.join(web, f), "x");
    }
    pruneStage(s);
    for (const f of ["src", "test", "next.config.ts", "tsconfig.json", ".next/server/a.js.map"]) expect(fs.existsSync(path.join(web, f)), f).toBe(false);
    for (const f of ["server.js", "package.json", ".next/server/a.js", "assets/fonts/f.woff"]) expect(fs.existsSync(path.join(web, f)), f).toBe(true);
  });
});
