// Static safety check of the installer definition (runs in `pnpm test` via tools test and in CI before packaging).
// It cannot replace a clean-VM install test, but it blocks the most dangerous mistake: deleting customer data.
import fs from "node:fs";
import path from "node:path";
import { root } from "./_util.mjs";

export function verifyInstaller() {
  const problems = [];
  const nsh = fs.readFileSync(path.join(root, "apps/desktop/build/installer.nsh"), "utf8");
  const yml = fs.readFileSync(path.join(root, "apps/desktop/electron-builder.yml"), "utf8");
  const code = nsh.split(/\r?\n/).filter((l) => !l.trim().startsWith(";") && !/^\s*MessageBox/i.test(l));
  for (const l of code) {
    if (/(RMDir|Delete|rd |rmdir|del |RemoveDirectory|Rename|CopyFiles)/i.test(l) && /(COMMONPROGRAMDATA|ProgramData|PETRA_DATA|PetraData)/i.test(l)) problems.push(`installer.nsh touches the data folder destructively: ${l.trim()}`);
  }
  if (!/deleteAppDataOnUninstall:\s*false/.test(yml)) problems.push("electron-builder.yml must set nsis.deleteAppDataOnUninstall: false");
  if (!/perMachine:\s*true/.test(yml)) problems.push("installer must be per-machine");
  if (/\bfiles:[\s\S]*?(\.env|\.db|private\.pem|keys\/)/.test(yml)) problems.push("builder files list references development data");
  if (!/appId:\s*bd\.petra/.test(yml)) problems.push("appId missing");
  if (!/!macro customInit[\s\S]*?stop/.test(nsh)) problems.push("installer must stop the service before upgrading files (customInit)");
  if (!/--service refresh/.test(nsh)) problems.push("installer must refresh the service after upgrading files");
  if (!/author"?:\s*\{?\s*"?name"?:\s*"PETRA"/.test(fs.readFileSync(path.join(root, "apps/desktop/package.json"), "utf8"))) problems.push("publisher (author) must be PETRA");
  if (!/artifactName:\s*PetraPMS-Setup-\$\{version\}/.test(yml)) problems.push("installer artifactName must be PetraPMS-Setup-<version>.exe");
  return problems;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("verify-installer.mjs")) {
  const p = verifyInstaller();
  if (p.length) {
    console.error("Installer verification FAILED:\n- " + p.join("\n- "));
    process.exit(1);
  }
  console.log("Installer definition OK (no destructive operation on customer data).");
}
