// Packages the Windows installer. Run ONLY on a Windows build machine, after `node scripts/build.mjs --release`
// (use `pnpm build:win`, which does both). It re-runs the release guard, bakes the production update feed into the
// app (apps/desktop/src/release.json, git-ignored) and passes the website to electron-builder.
// Code signing: set CSC_LINK / CSC_KEY_PASSWORD (or an Azure Trusted Signing configuration) in the environment.
import fs from "node:fs";
import path from "node:path";
import { run, pnpm, root } from "./_util.mjs";
import { checkRelease, releaseSettings } from "./release-guard.mjs";

// --test: an UNSIGNED, clearly labelled test installer (development license key, no update feed) for the CI "test build"
// job. It is NOT a customer release: the artifact name carries TEST and the production guard is deliberately skipped.
const testBuild = process.argv.includes("--test");
const problems = testBuild ? [] : checkRelease();
if (problems.length) {
  console.error("INSTALLER PACKAGING REFUSED:\n- " + problems.join("\n- ") + "\nSee docs/RELEASE.md.");
  process.exit(1);
}
if (process.platform !== "win32" && process.env.PETRA_ALLOW_NON_WINDOWS_PACKAGING !== "1") {
  console.error("INSTALLER PACKAGING REFUSED: the Windows installer must be built on Windows (NSIS, code signing and resource editing need it). Set PETRA_ALLOW_NON_WINDOWS_PACKAGING=1 only for a throw-away unsigned experiment.");
  process.exit(1);
}
if (!testBuild && !fs.existsSync(path.join(root, "apps", "desktop", "stage", ".release-stage"))) {
  console.error("INSTALLER PACKAGING REFUSED: the staged web bundle was not produced by `node scripts/build.mjs --release`. Run `pnpm build:win` (it does both steps).");
  process.exit(1);
}
const s = testBuild ? { updateUrl: "https://updates.invalid/test-build", homepage: "https://test.invalid" } : releaseSettings();
const desktop = path.join(root, "apps", "desktop");
// CI sets PETRA_TEST_BUILD_ID (short commit SHA) so each run's artifact has a distinct, traceable name.
// Not set outside CI, so a local `pnpm build:win:test` keeps the plain PetraPMS-Setup-TEST-UNSIGNED-<version>.exe name.
const buildId = testBuild && process.env.PETRA_TEST_BUILD_ID ? `-${process.env.PETRA_TEST_BUILD_ID.replace(/[^a-zA-Z0-9]/g, "")}` : "";
// Locate WinSW (shipped inside node-windows) regardless of the pnpm layout and stage it for electron-builder.
const winswSrc = [path.join(desktop, "node_modules", "node-windows", "bin", "winsw"), path.join(root, "node_modules", "node-windows", "bin", "winsw")].find((d) => fs.existsSync(path.join(d, "winsw.exe")));
if (!winswSrc) {
  console.error("INSTALLER PACKAGING REFUSED: winsw.exe not found (node-windows is not installed). Run `pnpm install` first.");
  process.exit(1);
}
fs.mkdirSync(path.join(desktop, "vendor", "winsw"), { recursive: true });
fs.copyFileSync(path.join(winswSrc, "winsw.exe"), path.join(desktop, "vendor", "winsw", "winsw.exe"));
const releaseJson = path.join(desktop, "src", "release.json");
if (!testBuild) fs.writeFileSync(releaseJson, JSON.stringify({ updateUrl: s.updateUrl }, null, 2) + "\n"); // test builds ship no feed: updates stay off
try {
  await run(pnpm, ["exec", "electron-builder", "--win", "nsis", "--x64", "--config", "electron-builder.yml", `-c.extraMetadata.homepage=${s.homepage}`, ...(testBuild ? [`-c.artifactName=PetraPMS-Setup-TEST-UNSIGNED-\${version}${buildId}.\${ext}`] : [])], { cwd: desktop, env: { PETRA_UPDATE_URL: s.updateUrl } });
} finally {
  fs.rmSync(releaseJson, { force: true });
}
