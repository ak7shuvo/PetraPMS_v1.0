// pnpm build — generates the DB layer, builds the web app (standalone) and stages it for the desktop installer.
import { run, pnpm, root, standaloneWeb, stageStandalone } from "./_util.mjs";
import { pruneStage, scanForSecrets } from "./stage-scan.mjs";
import { checkRelease } from "./release-guard.mjs";
import fs from "node:fs";
import path from "node:path";
// Release builds (pnpm build:win, --release or PETRA_RELEASE=1) are strict: stop BEFORE the long build when the
// license key, update feed, website, icon approval, versions or environment are not production-ready.
if (process.argv.includes("--release") || process.env.PETRA_RELEASE === "1") {
  const problems = checkRelease();
  if (problems.length) {
    console.error("RELEASE BUILD REFUSED:\n- " + problems.join("\n- ") + "\nSee docs/RELEASE.md.");
    process.exit(1);
  }
  console.log("Release guard passed.");
}
await run(pnpm, ["--filter", "@petra/db", "generate"]);
await run(pnpm, ["--filter", "@petra/web", "build"]);
stageStandalone();
// Desktop staging copy with symlinks resolved (pnpm links break when copied into an installer otherwise).
const stage = path.join(root, "apps", "desktop", "stage", "web");
fs.rmSync(path.dirname(stage), { recursive: true, force: true });
fs.cpSync(path.join(root, "apps", "web", ".next", "standalone"), stage, { recursive: true, dereference: true });
// Remove build leftovers that are not needed at run time, then refuse to continue if anything from development remains.
const removed = pruneStage(stage);
console.log(`Pruned ${removed.length} unneeded item(s) from the stage (sources, configs, source maps).`);
const bad = scanForSecrets(stage);
if (bad.length) {
  console.error("Refusing to stage a build that contains development data or secrets:\n" + bad.join("\n"));
  process.exit(1);
}
if (process.argv.includes("--release") || process.env.PETRA_RELEASE === "1") fs.writeFileSync(path.join(root, "apps", "desktop", "stage", ".release-stage"), new Date().toISOString() + "\n");
console.log("\nBuild complete:", standaloneWeb);
